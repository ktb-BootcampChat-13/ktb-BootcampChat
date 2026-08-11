package com.ktb.chatapp.repository;

import com.ktb.chatapp.model.Room;
import java.time.LocalDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.data.domain.Sort;
import org.bson.types.ObjectId;

@RequiredArgsConstructor
public class RoomRepositoryImpl implements RoomRepositoryCustom {

    private final MongoTemplate mongoTemplate;

    @Override
    public Room addParticipantAndReturn(String roomId, String userId) {
        Query query = Query.query(Criteria.where("_id").is(roomId)
            .and("participantIds").ne(userId));
        Update update = new Update().addToSet("participantIds", userId);
        return mongoTemplate.findAndModify(
            query,
            update,
            FindAndModifyOptions.options().returnNew(true),
            Room.class
        );
    }

    @Override
    public List<Room> findPage(LocalDateTime cursorCreatedAt, String cursorId, int limit) {
        Query query = new Query().limit(limit).with(Sort.by(
            Sort.Order.desc("createdAt"),
            Sort.Order.desc("_id")
        ));
        if (cursorCreatedAt != null && cursorId != null) {
            query.addCriteria(new Criteria().orOperator(
                Criteria.where("createdAt").lt(cursorCreatedAt),
                new Criteria().andOperator(
                    Criteria.where("createdAt").is(cursorCreatedAt),
                    Criteria.where("_id").lt(new ObjectId(cursorId))
                )
            ));
        }
        return mongoTemplate.find(query, Room.class);
    }
}
