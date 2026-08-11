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
class MessageFetchDispatcherTest {

    @Mock private MessageLoader messageLoader;
    @Mock private ReadStatusDispatcher readStatusDispatcher;
    @Mock private SocketIOClient firstClient;
    @Mock private SocketIOClient secondClient;

    private MessageFetchDispatcher dispatcher;

    @BeforeEach
    void setUp() {
        dispatcher = new MessageFetchDispatcher(
                messageLoader, readStatusDispatcher, new SimpleMeterRegistry(), 1, 10, 25);
    }

    @AfterEach
    void tearDown() {
        dispatcher.shutdown();
    }

    @Test
    void coalescesEquivalentConcurrentFetchesIntoOneQuery() {
        FetchMessagesRequest request = new FetchMessagesRequest("room-1", 30, null);
        FetchMessagesResponse response = FetchMessagesResponse.builder()
                .messages(List.of())
                .hasMore(false)
                .build();
        when(messageLoader.loadMessages(request, null)).thenReturn(response);

        dispatcher.request(firstClient, request, "user-1");
        dispatcher.request(secondClient, request, "user-2");

        verify(firstClient, org.mockito.Mockito.timeout(1_000))
                .sendEvent(eq("previousMessagesLoaded"), eq(response));
        verify(secondClient, org.mockito.Mockito.timeout(1_000))
                .sendEvent(eq("previousMessagesLoaded"), eq(response));
        verify(messageLoader, times(1)).loadMessages(request, null);
    }
}
