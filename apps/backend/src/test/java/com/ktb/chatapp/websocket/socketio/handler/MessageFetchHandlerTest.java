package com.ktb.chatapp.websocket.socketio.handler;

import com.corundumstudio.socketio.SocketIOClient;
import com.ktb.chatapp.dto.FetchMessagesRequest;
import com.ktb.chatapp.dto.FetchMessagesResponse;
import com.ktb.chatapp.websocket.socketio.SocketUser;
import com.ktb.chatapp.websocket.socketio.UserRooms;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static com.ktb.chatapp.websocket.socketio.SocketIOEvents.ERROR;
import static com.ktb.chatapp.websocket.socketio.SocketIOEvents.PREVIOUS_MESSAGES_LOADED;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class MessageFetchHandlerTest {

    @Mock private UserRooms userRooms;
    @Mock private MessageFetchDispatcher messageFetchDispatcher;
    @Mock private SocketIOClient client;

    private MessageFetchHandler handler;

    @BeforeEach
    void setUp() {
        handler = new MessageFetchHandler(userRooms, messageFetchDispatcher);
    }

    @Test
    void handleFetchMessages_rejectsUnauthorizedClient() {
        FetchMessagesRequest request = new FetchMessagesRequest("room-1", 30, null);
        when(client.get("user")).thenReturn(null);

        handler.handleFetchMessages(client, request);

        verify(client).sendEvent(eq(ERROR), any());
        verify(messageFetchDispatcher, never()).request(any(), any(), any());
    }

    @Test
    void handleFetchMessages_loadsMessagesForParticipant() {
        FetchMessagesRequest request = new FetchMessagesRequest("room-1", 30, null);
        when(client.get("user"))
                .thenReturn(new SocketUser("user-1", "tester", "session-1", "socket-1"));
        when(userRooms.isInRoom("user-1", "room-1")).thenReturn(true);

        handler.handleFetchMessages(client, request);

        verify(client, never()).sendEvent(eq("messageLoadStart"));
        verify(messageFetchDispatcher).request(client, request, "user-1");
    }
}
