package com.ktb.chatapp.websocket.socketio.handler;

import static com.ktb.chatapp.websocket.socketio.SocketIOEvents.ERROR;
import static com.ktb.chatapp.websocket.socketio.SocketIOEvents.PREVIOUS_MESSAGES_LOADED;

import com.corundumstudio.socketio.SocketIOClient;
import com.ktb.chatapp.dto.FetchMessagesRequest;
import com.ktb.chatapp.dto.FetchMessagesResponse;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import java.util.ArrayList;
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
public class MessageFetchDispatcher {

    private final MessageLoader messageLoader;
    private final ReadStatusDispatcher readStatusDispatcher;
    private final ScheduledExecutorService scheduler;
    private final ThreadPoolExecutor worker;
    private final Map<FetchKey, FetchBatch> pending = new ConcurrentHashMap<>();
    private final long debounceMs;
    private final Counter requestCounter;
    private final Counter queryCounter;

    public MessageFetchDispatcher(
            MessageLoader messageLoader,
            ReadStatusDispatcher readStatusDispatcher,
            MeterRegistry meterRegistry,
            @Value("${socketio.message-fetch.workers:8}") int workers,
            @Value("${socketio.message-fetch.queue-capacity:1000}") int queueCapacity,
            @Value("${socketio.message-fetch.debounce-ms:100}") long debounceMs) {
        this.messageLoader = messageLoader;
        this.readStatusDispatcher = readStatusDispatcher;
        this.debounceMs = debounceMs;
        this.scheduler = Executors.newSingleThreadScheduledExecutor(namedThreadFactory("message-fetch-debounce-"));
        this.worker = new ThreadPoolExecutor(
                Math.max(1, workers),
                Math.max(1, workers),
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(Math.max(1, queueCapacity)),
                namedThreadFactory("message-fetch-worker-"),
                new ThreadPoolExecutor.CallerRunsPolicy());
        this.requestCounter = meterRegistry.counter("socketio.message_fetch.requests");
        this.queryCounter = meterRegistry.counter("socketio.message_fetch.queries");
        Gauge.builder("socketio.message_fetch.pending", pending, Map::size).register(meterRegistry);
        Gauge.builder("socketio.message_fetch.queue.size", worker.getQueue(), java.util.Collection::size)
                .register(meterRegistry);
    }

    public void request(SocketIOClient client, FetchMessagesRequest request, String userId) {
        requestCounter.increment();
        FetchKey key = new FetchKey(request.roomId(), request.limit(), request.before());
        pending.compute(key, (ignored, existing) -> {
            FetchBatch batch = existing != null ? existing : new FetchBatch(request);
            batch.add(new WaitingClient(client, userId));
            if (existing == null) {
                scheduler.schedule(() -> flush(key, batch), debounceMs, TimeUnit.MILLISECONDS);
            }
            return batch;
        });
    }

    private void flush(FetchKey key, FetchBatch batch) {
        if (!pending.remove(key, batch)) {
            return;
        }
        worker.execute(() -> {
            queryCounter.increment();
            try {
                FetchMessagesResponse result = messageLoader.loadMessages(batch.request(), null);
                List<String> messageIds = result.getMessages().stream()
                        .map(com.ktb.chatapp.dto.MessageResponse::getId)
                        .toList();
                for (WaitingClient waiting : batch.clients()) {
                    waiting.client().sendEvent(PREVIOUS_MESSAGES_LOADED, result);
                    readStatusDispatcher.schedule(messageIds, waiting.userId());
                }
            } catch (Exception e) {
                log.error("Failed to load messages for room {}", key.roomId(), e);
                for (WaitingClient waiting : batch.clients()) {
                    waiting.client().sendEvent(ERROR, Map.of(
                            "code", "LOAD_ERROR",
                            "message", "이전 메시지를 불러오는 중 오류가 발생했습니다."));
                }
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

    private record FetchKey(String roomId, Integer limit, Long before) {}

    private record WaitingClient(SocketIOClient client, String userId) {}

    private static final class FetchBatch {
        private final FetchMessagesRequest request;
        private final List<WaitingClient> clients = new ArrayList<>();

        private FetchBatch(FetchMessagesRequest request) {
            this.request = request;
        }

        private synchronized void add(WaitingClient client) {
            clients.add(client);
        }

        private FetchMessagesRequest request() {
            return request;
        }

        private synchronized List<WaitingClient> clients() {
            return List.copyOf(clients);
        }
    }
}
