package com.ktb.chatapp.websocket.socketio.handler;

import static com.ktb.chatapp.websocket.socketio.SocketIOEvents.JOIN_ROOM_SUCCESS;

import com.corundumstudio.socketio.SocketIOClient;
import com.ktb.chatapp.dto.FetchMessagesRequest;
import com.ktb.chatapp.dto.FetchMessagesResponse;
import com.ktb.chatapp.dto.JoinRoomSuccessResponse;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@ConditionalOnProperty(name = "socketio.enabled", havingValue = "true", matchIfMissing = true)
public class JoinAckDispatcher {

    private final MessageLoader messageLoader;
    private final ReadStatusDispatcher readStatusDispatcher;
    private final RoomPostJoinDispatcher postJoinDispatcher;
    private final ScheduledExecutorService scheduler;
    private final ThreadPoolExecutor worker;
    private final Map<String, JoinBatch> pending = new ConcurrentHashMap<>();
    private final long debounceMs;
    private final Counter requestCounter;
    private final Counter queryCounter;

    public JoinAckDispatcher(
            MessageLoader messageLoader,
            ReadStatusDispatcher readStatusDispatcher,
            RoomPostJoinDispatcher postJoinDispatcher,
            MeterRegistry meterRegistry,
            @Value("${socketio.join-ack.workers:8}") int workers,
            @Value("${socketio.join-ack.queue-capacity:1000}") int queueCapacity,
            @Value("${socketio.join-ack.debounce-ms:100}") long debounceMs) {
        this.messageLoader = messageLoader;
        this.readStatusDispatcher = readStatusDispatcher;
        this.postJoinDispatcher = postJoinDispatcher;
        this.debounceMs = debounceMs;
        this.scheduler = Executors.newSingleThreadScheduledExecutor(namedThreadFactory("join-ack-debounce-"));
        this.worker = new ThreadPoolExecutor(
                Math.max(1, workers),
                Math.max(1, workers),
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(Math.max(1, queueCapacity)),
                namedThreadFactory("join-ack-worker-"),
                new ThreadPoolExecutor.CallerRunsPolicy());
        this.requestCounter = meterRegistry.counter("socketio.join_ack.requests");
        this.queryCounter = meterRegistry.counter("socketio.join_ack.history_queries");
        Gauge.builder("socketio.join_ack.pending", pending, Map::size).register(meterRegistry);
        Gauge.builder("socketio.join_ack.queue.size", worker.getQueue(), java.util.Collection::size)
                .register(meterRegistry);
    }

    public void request(SocketIOClient client, String roomId, String userId, String userName) {
        requestCounter.increment();
        pending.compute(roomId, (key, existing) -> {
            JoinBatch batch = existing != null ? existing : new JoinBatch();
            batch.add(new WaitingJoin(client, userId, userName));
            if (existing == null) {
                scheduler.schedule(() -> flush(roomId, batch), debounceMs, TimeUnit.MILLISECONDS);
            }
            return batch;
        });
    }

    private void flush(String roomId, JoinBatch batch) {
        if (!pending.remove(roomId, batch)) {
            return;
        }
        worker.execute(() -> {
            queryCounter.increment();
            FetchMessagesResponse history = messageLoader.loadMessages(
                    new FetchMessagesRequest(roomId, 30, null), null);
            JoinRoomSuccessResponse response = JoinRoomSuccessResponse.builder()
                    .roomId(roomId)
                    .messages(history.getMessages())
                    .hasMore(history.isHasMore())
                    .activeStreams(Collections.emptyList())
                    .build();
            List<String> messageIds = history.getMessages().stream()
                    .map(com.ktb.chatapp.dto.MessageResponse::getId)
                    .toList();
            List<WaitingJoin> clients = batch.clients();

            // 모든 참가자에게 화면 준비 ACK를 먼저 큐잉한 뒤 입장 fan-out을 시작한다.
            for (WaitingJoin waiting : clients) {
                waiting.client().sendEvent(JOIN_ROOM_SUCCESS, response);
            }
            for (WaitingJoin waiting : clients) {
                readStatusDispatcher.schedule(messageIds, waiting.userId());
                postJoinDispatcher.scheduleSystemMessage(
                        roomId, waiting.userName() + "님이 입장하였습니다.");
            }
        });
    }

    private static ThreadFactory namedThreadFactory(String prefix) {
        AtomicInteger sequence = new AtomicInteger();
        return runnable -> {
            Thread thread = new Thread(runnable, prefix + sequence.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
    }

    @PreDestroy
    void shutdown() {
        scheduler.shutdown();
        worker.shutdown();
    }

    private record WaitingJoin(SocketIOClient client, String userId, String userName) {}

    private static final class JoinBatch {
        private final List<WaitingJoin> clients = new ArrayList<>();

        private synchronized void add(WaitingJoin client) {
            clients.add(client);
        }

        private synchronized List<WaitingJoin> clients() {
            return List.copyOf(clients);
        }
    }
}
