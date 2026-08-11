package com.ktb.chatapp.service;

import com.ktb.chatapp.repository.MessageRepository;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.Collections;
import java.util.Map;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.bson.Document;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.aggregation.Aggregation;
import org.springframework.data.mongodb.core.aggregation.AggregationResults;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.stereotype.Component;

/**
 * 채팅방 목록에 노출하는 "최근 메시지 수"의 집계 창을 한곳에서 관리한다.
 */
@Component
@RequiredArgsConstructor
public class RecentMessageCounter {

    static final Duration RECENT_WINDOW = Duration.ofMinutes(30);

    private final MessageRepository messageRepository;
    private final MongoTemplate mongoTemplate;

    public int countRecentMessages(String roomId) {
        LocalDateTime since = LocalDateTime.now().minus(RECENT_WINDOW);
        return (int) messageRepository.countRecentMessagesByRoomId(roomId, since);
    }

    public Map<String, Integer> countRecentMessages(Collection<String> roomIds) {
        return countRecentMessages(roomIds, LocalDateTime.now().minus(RECENT_WINDOW));
    }

    Map<String, Integer> countRecentMessages(
            Collection<String> roomIds,
            LocalDateTime since) {
        if (roomIds == null || roomIds.isEmpty()) {
            return Collections.emptyMap();
        }

        Aggregation aggregation = Aggregation.newAggregation(
            Aggregation.match(Criteria.where("room").in(roomIds)
                .and("timestamp").gte(since)),
            Aggregation.group("room").count().as("count")
        );

        AggregationResults<Document> results = mongoTemplate.aggregate(
            aggregation,
            "messages",
            Document.class
        );

        return results.getMappedResults().stream()
            .filter(result -> result.getString("_id") != null)
            .collect(Collectors.toMap(
                result -> result.getString("_id"),
                result -> result.get("count", Number.class).intValue()
            ));
    }
}
