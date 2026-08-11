package com.ktb.chatapp.websocket.socketio.handler;

import static org.mockito.Mockito.verify;

import com.ktb.chatapp.service.MessageReadStatusService;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ReadStatusDispatcherTest {

    @Mock private MessageReadStatusService readStatusService;
    private ReadStatusDispatcher dispatcher;

    @BeforeEach
    void setUp() {
        dispatcher = new ReadStatusDispatcher(readStatusService, new SimpleMeterRegistry(), 1, 10, 10);
    }

    @AfterEach
    void tearDown() {
        dispatcher.shutdown();
    }

    @Test
    void schedulesReadStatusOutsideTheRequestThread() {
        dispatcher.schedule(List.of("message-1"), "user-1");

        verify(readStatusService, org.mockito.Mockito.timeout(1_000))
                .updateReadStatus(List.of("message-1"), "user-1");
    }
}
