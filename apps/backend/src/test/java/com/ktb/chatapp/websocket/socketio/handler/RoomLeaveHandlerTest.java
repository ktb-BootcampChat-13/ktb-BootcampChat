package com.ktb.chatapp.websocket.socketio.handler;

import com.corundumstudio.socketio.SocketIOClient;
import com.ktb.chatapp.model.Room;
import com.ktb.chatapp.model.User;
import com.ktb.chatapp.repository.RoomRepository;
import com.ktb.chatapp.repository.UserRepository;
import com.ktb.chatapp.websocket.socketio.SocketUser;
import com.ktb.chatapp.websocket.socketio.UserRooms;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static com.ktb.chatapp.websocket.socketio.SocketIOEvents.ERROR;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RoomLeaveHandlerTest {

    @Mock private RoomRepository roomRepository;
    @Mock private UserRepository userRepository;
    @Mock private UserRooms userRooms;
    @Mock private RoomPostJoinDispatcher postJoinDispatcher;
    @Mock private SocketIOClient client;

    private RoomLeaveHandler handler;

    @BeforeEach
    void setUp() {
        handler = new RoomLeaveHandler(roomRepository, userRepository, userRooms, postJoinDispatcher);
    }

    @Test
    void handleLeaveRoom_rejectsUnauthorizedClient() {
        when(client.get("user")).thenReturn(null);

        handler.handleLeaveRoom(client, "room-1");

        verify(client).sendEvent(eq(ERROR), any());
        verify(roomRepository, never()).removeParticipant(any(), any());
    }

    @Test
    void handleLeaveRoom_removesParticipantAndBroadcasts() {
        SocketUser socketUser = new SocketUser("user-1", "tester", "session-1", "socket-1");
        User user = User.builder().id("user-1").name("tester").email("tester@example.com").build();
        Room roomBeforeLeave = Room.builder()
                .id("room-1")
                .name("room")
                .participantIds(Set.of("user-1", "user-2"))
                .build();
        when(client.get("user")).thenReturn(socketUser);
        when(userRooms.isInRoom("user-1", "room-1")).thenReturn(true);
        when(userRepository.findById("user-1")).thenReturn(Optional.of(user));
        when(roomRepository.findById("room-1")).thenReturn(Optional.of(roomBeforeLeave));

        handler.handleLeaveRoom(client, "room-1");

        verify(roomRepository).removeParticipant("room-1", "user-1");
        verify(client).leaveRoom("room-1");
        verify(userRooms).remove("user-1", "room-1");
        verify(postJoinDispatcher).scheduleSystemMessage("room-1", "tester님이 퇴장하였습니다.");
        verify(postJoinDispatcher).scheduleParticipantsUpdate("room-1");
    }
}
