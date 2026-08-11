package com.ktb.chatapp.config;

import com.mongodb.client.MongoCollection;
import com.mongodb.client.model.IndexOptions;
import com.mongodb.client.model.UpdateOneModel;
import com.mongodb.client.model.UpdateOptions;
import com.mongodb.client.model.WriteModel;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.bson.Document;
import org.bson.types.ObjectId;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class RoomPaginationIndexMigration implements ApplicationRunner {

    static final String COLLECTION = "rooms";
    static final String INDEX_NAME = "rooms_created_at_id_desc";
    private static final Document INDEX_KEY = new Document("createdAt", -1).append("_id", -1);
    private static final Document MISSING_CREATED_AT = new Document("$or", List.of(
        new Document("createdAt", new Document("$exists", false)),
        new Document("createdAt", null)
    ));

    private final MongoTemplate mongoTemplate;

    @Override
    public void run(ApplicationArguments args) {
        MongoCollection<Document> rooms = mongoTemplate.getCollection(COLLECTION);
        backfillCreatedAt(rooms);
        ensureIndex(rooms);
    }

    private void backfillCreatedAt(MongoCollection<Document> rooms) {
        List<Document> missing = rooms.find(MISSING_CREATED_AT)
            .projection(new Document("_id", 1))
            .into(new ArrayList<>());
        List<WriteModel<Document>> updates = new ArrayList<>();
        for (Document room : missing) {
            Object rawId = room.get("_id");
            ObjectId objectId = objectId(rawId);
            if (objectId == null) {
                throw new IllegalStateException(
                    "Cannot backfill rooms.createdAt: invalid ObjectId=" + rawId
                );
            }
            Date createdAt = Date.from(Instant.ofEpochSecond(objectId.getTimestamp()));
            updates.add(new UpdateOneModel<>(
                new Document("_id", rawId).append("$or", MISSING_CREATED_AT.get("$or")),
                new Document("$set", new Document("createdAt", createdAt)),
                new UpdateOptions()
            ));
        }
        if (!updates.isEmpty()) rooms.bulkWrite(updates);
    }

    private void ensureIndex(MongoCollection<Document> rooms) {
        for (Document index : rooms.listIndexes()) {
            Document key = index.get("key", Document.class);
            if (INDEX_KEY.equals(key)) return;
            if (INDEX_NAME.equals(index.getString("name"))) {
                throw new IllegalStateException(
                    "Cannot create room pagination index: conflicting index name=" + INDEX_NAME
                );
            }
        }
        rooms.createIndex(INDEX_KEY, new IndexOptions().name(INDEX_NAME));
    }

    private ObjectId objectId(Object rawId) {
        if (rawId instanceof ObjectId objectId) return objectId;
        if (rawId instanceof String id && ObjectId.isValid(id)) return new ObjectId(id);
        return null;
    }
}
