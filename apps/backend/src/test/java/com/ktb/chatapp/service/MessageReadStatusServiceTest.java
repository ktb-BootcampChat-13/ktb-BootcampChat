package com.ktb.chatapp.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.ktb.chatapp.model.Message;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;

@ExtendWith(MockitoExtension.class)
class MessageReadStatusServiceTest {

    @Mock private MongoTemplate mongoTemplate;

    @Test
    void updateReadStatusUsesOneBulkUpdateForDistinctMessages() {
        MessageReadStatusService service = new MessageReadStatusService(mongoTemplate);

        service.updateReadStatus(List.of("message-1", "message-1", "message-2"), "user-1");

        verify(mongoTemplate).updateMulti(any(Query.class), any(Update.class), eq(Message.class));
    }

    @Test
    void updateReadStatusSkipsEmptyInput() {
        MessageReadStatusService service = new MessageReadStatusService(mongoTemplate);

        service.updateReadStatus(List.of(), "user-1");

        verify(mongoTemplate, never()).updateMulti(any(Query.class), any(Update.class), eq(Message.class));
    }
}
