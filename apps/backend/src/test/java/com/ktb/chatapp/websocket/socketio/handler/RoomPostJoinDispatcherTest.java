package com.ktb.chatapp.websocket.socketio.handler;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.corundumstudio.socketio.BroadcastOperations;
import com.corundumstudio.socketio.SocketIOServer;
import com.ktb.chatapp.model.Room;
import com.ktb.chatapp.model.User;
import com.ktb.chatapp.repository.MessageRepository;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;

@ExtendWith(MockitoExtension.class)
class RoomPostJoinDispatcherTest {

    @Mock private SocketIOServer socketIOServer;
    @Mock private MessageRepository messageRepository;
    @Mock private MongoTemplate mongoTemplate;
    @Mock private MessageResponseMapper messageResponseMapper;
    @Mock private BroadcastOperations roomOperations;

    private RoomPostJoinDispatcher dispatcher;

    @BeforeEach
    void setUp() {
        dispatcher = new RoomPostJoinDispatcher(
                socketIOServer,
                messageRepository,
                mongoTemplate,
                messageResponseMapper,
                new SimpleMeterRegistry(),
                1,
                10,
                25,
                25);
    }

    @AfterEach
    void tearDown() {
        dispatcher.shutdown();
    }

    @Test
    void repeatedParticipantUpdatesAreCoalescedIntoOneSnapshot() {
        Room room = Room.builder().id("room-1").participantIds(Set.of("user-1")).build();
        User user = User.builder().id("user-1").name("tester").email("tester@example.com").build();
        when(mongoTemplate.findOne(any(Query.class), eq(Room.class))).thenReturn(room);
        when(mongoTemplate.find(any(Query.class), eq(User.class))).thenReturn(List.of(user));
        when(socketIOServer.getRoomOperations("room-1")).thenReturn(roomOperations);

        dispatcher.scheduleParticipantsUpdate("room-1");
        dispatcher.scheduleParticipantsUpdate("room-1");
        dispatcher.scheduleParticipantsUpdate("room-1");

        verify(roomOperations, org.mockito.Mockito.timeout(1_000).times(1))
                .sendEvent(eq("participantsUpdate"), any());
        verify(mongoTemplate, times(1)).findOne(any(Query.class), eq(Room.class));
    }
}
