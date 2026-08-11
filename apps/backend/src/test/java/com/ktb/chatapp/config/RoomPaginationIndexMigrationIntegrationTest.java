package com.ktb.chatapp.config;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoCollection;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import org.bson.Document;
import org.bson.types.ObjectId;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mongodb.MongoDBContainer;

@Testcontainers(disabledWithoutDocker = true)
class RoomPaginationIndexMigrationIntegrationTest {

    @Container
    private static final MongoDBContainer MONGO = new MongoDBContainer("mongo:8.3.4");

    private static MongoClient mongoClient;
    private static MongoTemplate mongoTemplate;

    @BeforeAll
    static void setUpClient() {
        mongoClient = MongoClients.create(MONGO.getConnectionString());
        mongoTemplate = new MongoTemplate(mongoClient, "room-pagination-migration-test");
    }

    @AfterAll
    static void closeClient() {
        mongoClient.close();
    }

    @BeforeEach
    void clearRooms() {
        mongoTemplate.dropCollection(RoomPaginationIndexMigration.COLLECTION);
    }

    @Test
    void backfillsCreatedAtAndCreatesIndexIdempotently() {
        ObjectId id = new ObjectId();
        rooms().insertOne(new Document("_id", id).append("name", "room"));
        RoomPaginationIndexMigration migration = new RoomPaginationIndexMigration(mongoTemplate);

        migration.run(null);
        assertDoesNotThrow(() -> migration.run(null));

        assertNotNull(rooms().find(new Document("_id", id)).first().getDate("createdAt"));
        assertEquals(RoomPaginationIndexMigration.INDEX_NAME, paginationIndex().getString("name"));
    }

    @Test
    void rejectsInvalidIdsBeforeChangingAnyRoom() {
        rooms().insertMany(List.of(
            new Document("_id", new ObjectId()).append("name", "valid"),
            new Document("_id", "invalid-id").append("name", "invalid")
        ));

        assertThrows(IllegalStateException.class,
            () -> new RoomPaginationIndexMigration(mongoTemplate).run(null));

        assertEquals(0, rooms().countDocuments(new Document("createdAt", new Document("$type", "date"))));
    }

    @Test
    void paginationSortUsesTheCompoundIndex() {
        List<Document> roomDocuments = new ArrayList<>();
        for (int index = 0; index < 100; index++) {
            roomDocuments.add(new Document("_id", new ObjectId()).append("createdAt", new Date()));
        }
        rooms().insertMany(roomDocuments);
        new RoomPaginationIndexMigration(mongoTemplate).run(null);

        Document find = new Document("find", RoomPaginationIndexMigration.COLLECTION)
            .append("filter", new Document())
            .append("sort", new Document("createdAt", -1).append("_id", -1))
            .append("limit", 31);
        Document explain = mongoTemplate.getDb().runCommand(
            new Document("explain", find).append("verbosity", "executionStats")
        );

        assertTrue(explain.toJson().contains("IXSCAN"));
        assertTrue(explain.get("executionStats", Document.class).getInteger("totalDocsExamined") <= 31);
    }

    private static MongoCollection<Document> rooms() {
        return mongoTemplate.getCollection(RoomPaginationIndexMigration.COLLECTION);
    }

    private static Document paginationIndex() {
        return rooms().listIndexes().into(new ArrayList<>()).stream()
            .filter(index -> RoomPaginationIndexMigration.INDEX_NAME.equals(index.getString("name")))
            .findFirst()
            .orElseThrow();
    }
}
