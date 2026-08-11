package com.ktb.chatapp.websocket.socketio.handler;

import com.ktb.chatapp.service.MessageReadStatusService;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
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
public class ReadStatusDispatcher {

    private final MessageReadStatusService readStatusService;
    private final ScheduledExecutorService scheduler;
    private final ThreadPoolExecutor worker;
    private final long delayMs;

    public ReadStatusDispatcher(
            MessageReadStatusService readStatusService,
            MeterRegistry meterRegistry,
            @Value("${socketio.read-status.workers:8}") int workers,
            @Value("${socketio.read-status.queue-capacity:1000}") int queueCapacity,
            @Value("${socketio.read-status.delay-ms:2000}") long delayMs) {
        this.readStatusService = readStatusService;
        this.delayMs = delayMs;
        this.scheduler = Executors.newSingleThreadScheduledExecutor(namedThreadFactory("read-status-delay-"));
        this.worker = new ThreadPoolExecutor(
                Math.max(1, workers),
                Math.max(1, workers),
                0L,
                TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(Math.max(1, queueCapacity)),
                namedThreadFactory("read-status-worker-"),
                new ThreadPoolExecutor.CallerRunsPolicy());
        Gauge.builder("socketio.read_status.queue.size", worker.getQueue(), java.util.Collection::size)
                .register(meterRegistry);
    }

    public void schedule(List<String> messageIds, String userId) {
        if (messageIds == null || messageIds.isEmpty() || userId == null) {
            return;
        }
        List<String> snapshot = List.copyOf(messageIds);
        scheduler.schedule(
                () -> worker.execute(() -> {
                    try {
                        readStatusService.updateReadStatus(snapshot, userId);
                    } catch (Exception e) {
                        log.error("Deferred read-status update failed for user {}", userId, e);
                    }
                }),
                delayMs,
                TimeUnit.MILLISECONDS);
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
}
