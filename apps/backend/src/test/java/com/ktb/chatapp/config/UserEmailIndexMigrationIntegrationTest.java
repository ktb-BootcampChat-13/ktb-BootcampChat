package com.ktb.chatapp.config;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.model.IndexOptions;
import java.util.ArrayList;
import java.util.List;
import org.bson.Document;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mongodb.MongoDBContainer;

@Testcontainers(disabledWithoutDocker = true)
class UserEmailIndexMigrationIntegrationTest {

    @Container
    private static final MongoDBContainer MONGO = new MongoDBContainer("mongo:8.3.4");

    private static MongoClient mongoClient;
    private static MongoTemplate mongoTemplate;

    @BeforeAll
    static void setUpClient() {
        mongoClient = MongoClients.create(MONGO.getConnectionString());
        mongoTemplate = new MongoTemplate(mongoClient, "migration-test");
    }

    @AfterAll
    static void closeClient() {
        mongoClient.close();
    }

    @BeforeEach
    void clearUsers() {
        mongoTemplate.dropCollection(UserEmailIndexMigration.COLLECTION);
    }

    @Test
    void createsUniqueIndexForEmptyDatabaseAndIsIdempotent() {
        UserEmailIndexMigration migration = new UserEmailIndexMigration(mongoTemplate);

        migration.run(null);
        assertDoesNotThrow(() -> migration.run(null));

        Document index = emailIndex();
        assertEquals(UserEmailIndexMigration.INDEX_NAME, index.getString("name"));
        assertTrue(index.getBoolean("unique"));
    }

    @Test
    void keepsEquivalentUniqueIndexWithDifferentName() {
        users().createIndex(
            new Document("email", 1),
            new IndexOptions().unique(true).name("existing_email_unique")
        );

        new UserEmailIndexMigration(mongoTemplate).run(null);

        assertEquals("existing_email_unique", emailIndex().getString("name"));
    }

    @Test
    void createsIndexForExistingDatabaseWithoutIndex() {
        users().insertMany(List.of(
            new Document("_id", "user-1").append("email", "one@test.com"),
            new Document("_id", "user-2").append("email", "two@test.com")
        ));

        new UserEmailIndexMigration(mongoTemplate).run(null);

        assertTrue(emailIndex().getBoolean("unique"));
    }

    @Test
    void rejectsDuplicateEmailWithoutDeletingData() {
        users().insertMany(List.of(
            new Document("_id", "user-1").append("email", "duplicate@test.com"),
            new Document("_id", "user-2").append("email", "duplicate@test.com")
        ));

        IllegalStateException exception = assertThrows(
            IllegalStateException.class,
            () -> new UserEmailIndexMigration(mongoTemplate).run(null)
        );

        assertTrue(exception.getMessage().contains("duplicate@test.com"));
        assertTrue(exception.getMessage().contains("user-1"));
        assertTrue(exception.getMessage().contains("user-2"));
        assertEquals(2, users().countDocuments());
    }

    @Test
    void rejectsConflictingNonUniqueEmailIndex() {
        users().createIndex(new Document("email", 1), new IndexOptions().name("email_lookup"));

        IllegalStateException exception = assertThrows(
            IllegalStateException.class,
            () -> new UserEmailIndexMigration(mongoTemplate).run(null)
        );

        assertTrue(exception.getMessage().contains("email_lookup"));
    }

    private static MongoCollection<Document> users() {
        return mongoTemplate.getCollection(UserEmailIndexMigration.COLLECTION);
    }

    private static Document emailIndex() {
        List<Document> indexes = users().listIndexes().into(new ArrayList<>());
        return indexes.stream()
            .filter(index -> new Document("email", 1).equals(index.get("key", Document.class)))
            .findFirst()
            .orElseThrow();
    }
}
