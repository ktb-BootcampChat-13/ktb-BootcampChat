package com.ktb.chatapp.repository;

import com.ktb.chatapp.model.Room;
import lombok.RequiredArgsConstructor;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;

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
}
