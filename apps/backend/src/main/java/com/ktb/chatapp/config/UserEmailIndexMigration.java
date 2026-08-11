package com.ktb.chatapp.config;

import com.mongodb.client.MongoCollection;
import com.mongodb.client.model.IndexOptions;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.bson.Document;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class UserEmailIndexMigration implements ApplicationRunner {

    static final String COLLECTION = "users";
    static final String INDEX_NAME = "email_unique";
    private static final Document EMAIL_KEY = new Document("email", 1);

    private final MongoTemplate mongoTemplate;

    @Override
    public void run(ApplicationArguments args) {
        MongoCollection<Document> users = mongoTemplate.getCollection(COLLECTION);
        for (Document index : users.listIndexes()) {
            if (!EMAIL_KEY.equals(index.get("key", Document.class))) {
                continue;
            }
            if (Boolean.TRUE.equals(index.getBoolean("unique"))) {
                return;
            }
            throw new IllegalStateException(
                "Cannot create unique users.email index: conflicting non-unique index "
                    + index.getString("name")
            );
        }

        Document duplicate = users.aggregate(List.of(
            new Document("$group", new Document("_id", "$email")
                .append("ids", new Document("$push", "$_id"))
                .append("count", new Document("$sum", 1))),
            new Document("$match", new Document("count", new Document("$gt", 1))),
            new Document("$limit", 1)
        )).first();
        if (duplicate != null) {
            throw new IllegalStateException(
                "Cannot create unique users.email index: duplicate email="
                    + duplicate.get("_id") + ", userIds=" + duplicate.getList("ids", Object.class)
            );
        }

        try {
            users.createIndex(EMAIL_KEY, new IndexOptions().unique(true).name(INDEX_NAME));
        } catch (RuntimeException exception) {
            throw new IllegalStateException(
                "Failed to create unique users.email index on collection " + COLLECTION,
                exception
            );
        }
    }
}
