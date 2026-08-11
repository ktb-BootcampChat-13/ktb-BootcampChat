package com.ktb.chatapp.websocket.socketio.handler;

import com.corundumstudio.socketio.SocketIOClient;
import com.mongodb.client.result.UpdateResult;
import com.ktb.chatapp.websocket.socketio.SocketUser;
import com.ktb.chatapp.websocket.socketio.UserRooms;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;

import static com.ktb.chatapp.websocket.socketio.SocketIOEvents.JOIN_ROOM_ERROR;
import static com.ktb.chatapp.websocket.socketio.SocketIOEvents.JOIN_ROOM_SUCCESS;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RoomJoinHandlerTest {

    @Mock private MongoTemplate mongoTemplate;
    @Mock private UserRooms userRooms;
    @Mock private RoomPostJoinDispatcher postJoinDispatcher;
    @Mock private JoinAckDispatcher joinAckDispatcher;
    @Mock private SocketIOClient client;

    private RoomJoinHandler handler;

    @BeforeEach
    void setUp() {
        handler = new RoomJoinHandler(mongoTemplate, userRooms, postJoinDispatcher, joinAckDispatcher);
    }

    @Test
    void handleJoinRoom_rejectsUnauthorizedClient() {
        when(client.get("user")).thenReturn(null);

        handler.handleJoinRoom(client, "room-1");

        verify(client).sendEvent(eq(JOIN_ROOM_ERROR), any());
    }

    @Test
    void handleJoinRoomAcknowledgesBeforeDispatchingPostJoinWork() {
        SocketUser socketUser = new SocketUser("user-1", "tester", "session-1", "socket-1");

        when(client.get("user")).thenReturn(socketUser);
        when(userRooms.isInRoom("user-1", "room-1")).thenReturn(false);
        when(mongoTemplate.updateFirst(any(Query.class), any(Update.class), eq("rooms")))
                .thenReturn(UpdateResult.acknowledged(1, 1L, null));

        handler.handleJoinRoom(client, "room-1");

        verify(mongoTemplate).updateFirst(any(Query.class), any(Update.class), eq("rooms"));
        verify(client).joinRoom("room-1");
        verify(userRooms).add("user-1", "room-1");
        verify(joinAckDispatcher).request(client, "room-1", "user-1", "tester");
        verify(postJoinDispatcher).scheduleParticipantsUpdate("room-1");
    }

    @Test
    void handleJoinRoom_missingRoomStopsBeforeJoiningSocket() {
        SocketUser socketUser = new SocketUser("user-1", "tester", "session-1", "socket-1");
        when(client.get("user")).thenReturn(socketUser);
        when(userRooms.isInRoom("user-1", "room-1")).thenReturn(false);
        when(mongoTemplate.updateFirst(any(Query.class), any(Update.class), eq("rooms")))
                .thenReturn(UpdateResult.acknowledged(0, 0L, null));

        handler.handleJoinRoom(client, "room-1");

        verify(client).sendEvent(eq(JOIN_ROOM_ERROR), any());
        verify(client, never()).joinRoom(any());
        verify(joinAckDispatcher, never()).request(any(), any(), any(), any());
    }
}
