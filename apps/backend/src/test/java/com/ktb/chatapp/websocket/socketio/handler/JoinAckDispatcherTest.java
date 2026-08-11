package com.ktb.chatapp.websocket.socketio.handler;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.corundumstudio.socketio.SocketIOClient;
import com.ktb.chatapp.dto.FetchMessagesRequest;
import com.ktb.chatapp.dto.FetchMessagesResponse;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class JoinAckDispatcherTest {

    @Mock private MessageLoader messageLoader;
    @Mock private ReadStatusDispatcher readStatusDispatcher;
    @Mock private RoomPostJoinDispatcher postJoinDispatcher;
    @Mock private SocketIOClient firstClient;
    @Mock private SocketIOClient secondClient;

    private JoinAckDispatcher dispatcher;

    @BeforeEach
    void setUp() {
        dispatcher = new JoinAckDispatcher(
                messageLoader,
                readStatusDispatcher,
                postJoinDispatcher,
                new SimpleMeterRegistry(),
                1,
                10,
                25);
    }

    @AfterEach
    void tearDown() {
        dispatcher.shutdown();
    }

    @Test
    void coalescesHistoryAndAcknowledgesEveryWaitingClient() {
        FetchMessagesResponse history = FetchMessagesResponse.builder()
                .messages(List.of())
                .hasMore(false)
                .build();
        when(messageLoader.loadMessages(any(FetchMessagesRequest.class), eq(null))).thenReturn(history);

        dispatcher.request(firstClient, "room-1", "user-1", "first");
        dispatcher.request(secondClient, "room-1", "user-2", "second");

        verify(firstClient, org.mockito.Mockito.timeout(1_000))
                .sendEvent(eq("joinRoomSuccess"), any());
        verify(secondClient, org.mockito.Mockito.timeout(1_000))
                .sendEvent(eq("joinRoomSuccess"), any());
        verify(messageLoader, times(1)).loadMessages(any(FetchMessagesRequest.class), eq(null));
        verify(postJoinDispatcher, org.mockito.Mockito.timeout(1_000))
                .scheduleSystemMessage("room-1", "first님이 입장하였습니다.");
        verify(postJoinDispatcher, org.mockito.Mockito.timeout(1_000))
                .scheduleSystemMessage("room-1", "second님이 입장하였습니다.");
    }
}
