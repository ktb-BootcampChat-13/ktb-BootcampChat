package com.ktb.chatapp.repository;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.ktb.chatapp.model.Room;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mongodb.MongoDBContainer;

@Testcontainers(disabledWithoutDocker = true)
class RoomRepositoryImplIntegrationTest {

    @Container
    private static final MongoDBContainer MONGO = new MongoDBContainer("mongo:8.3.4");

    private static MongoClient mongoClient;
    private static MongoTemplate mongoTemplate;
    private RoomRepositoryImpl repository;

    @BeforeAll
    static void setUpClient() {
        mongoClient = MongoClients.create(MONGO.getConnectionString());
        mongoTemplate = new MongoTemplate(mongoClient, "room-repository-test");
    }

    @AfterAll
    static void closeClient() {
        mongoClient.close();
    }

    @BeforeEach
    void setUp() {
        mongoTemplate.dropCollection(Room.class);
        repository = new RoomRepositoryImpl(mongoTemplate);
        mongoTemplate.save(Room.builder()
            .id("room-1")
            .creator("creator-1")
            .participantIds(new HashSet<>(Set.of("creator-1")))
            .build());
    }

    @Test
    void addParticipantAndReturnReturnsUpdatedRoom() {
        Room updated = repository.addParticipantAndReturn("room-1", "user-1");

        assertNotNull(updated);
        assertEquals(Set.of("creator-1", "user-1"), updated.getParticipantIds());
    }

    @Test
    void concurrentJoinsDoNotLoseOrDuplicateParticipants() throws Exception {
        int participantCount = 20;
        ExecutorService executor = Executors.newFixedThreadPool(participantCount);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<Room>> futures = new ArrayList<>();
        try {
            for (int index = 0; index < participantCount; index++) {
                String userId = "user-" + index;
                futures.add(executor.submit(() -> {
                    start.await();
                    return repository.addParticipantAndReturn("room-1", userId);
                }));
            }
            start.countDown();
            for (Future<Room> future : futures) {
                assertNotNull(future.get());
            }
        } finally {
            executor.shutdownNow();
        }

        Room stored = mongoTemplate.findById("room-1", Room.class);
        assertNotNull(stored);
        assertEquals(participantCount + 1, stored.getParticipantIds().size());
        assertTrue(stored.getParticipantIds().contains("creator-1"));
        for (int index = 0; index < participantCount; index++) {
            assertTrue(stored.getParticipantIds().contains("user-" + index));
        }
    }
}
