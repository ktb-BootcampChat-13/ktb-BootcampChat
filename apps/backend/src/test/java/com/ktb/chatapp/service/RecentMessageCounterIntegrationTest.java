package com.ktb.chatapp.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.ktb.chatapp.config.MongoTestContainer;
import com.ktb.chatapp.config.RedisTestContainer;
import com.ktb.chatapp.model.Message;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.test.context.TestPropertySource;

@SpringBootTest
@Import({MongoTestContainer.class, RedisTestContainer.class})
@TestPropertySource(properties = "socketio.enabled=false")
class RecentMessageCounterIntegrationTest {

    private static final List<String> ROOM_IDS = List.of("batch-room-1", "batch-room-2");

    @Autowired private RecentMessageCounter recentMessageCounter;
    @Autowired private MongoTemplate mongoTemplate;

    @AfterEach
    void tearDown() {
        mongoTemplate.remove(
            Query.query(Criteria.where("room").in(ROOM_IDS)),
            Message.class
        );
    }

    @Test
    void countRecentMessages_groupsRoomsAndExcludesBeforeBoundary() {
        LocalDateTime since = LocalDateTime.of(2026, 8, 10, 12, 0);
        mongoTemplate.insert(List.of(
            message("batch-1", "batch-room-1", since.minusNanos(1)),
            message("batch-2", "batch-room-1", since),
            message("batch-3", "batch-room-1", since.plusMinutes(1)),
            message("batch-4", "batch-room-2", since.plusMinutes(2))
        ), Message.class);

        Map<String, Integer> counts =
            recentMessageCounter.countRecentMessages(ROOM_IDS, since);

        assertThat(counts).containsExactlyInAnyOrderEntriesOf(Map.of(
            "batch-room-1", 2,
            "batch-room-2", 1
        ));
    }

    private static Message message(String id, String roomId, LocalDateTime timestamp) {
        return Message.builder()
            .id(id)
            .roomId(roomId)
            .content("message")
            .timestamp(timestamp)
            .build();
    }
}
