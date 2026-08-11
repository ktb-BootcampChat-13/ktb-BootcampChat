package com.ktb.chatapp.websocket.socketio.handler;

import static com.ktb.chatapp.websocket.socketio.SocketIOEvents.MESSAGE;
import static com.ktb.chatapp.websocket.socketio.SocketIOEvents.PARTICIPANTS_UPDATE;

import com.corundumstudio.socketio.SocketIOServer;
import com.ktb.chatapp.dto.UserResponse;
import com.ktb.chatapp.model.Message;
import com.ktb.chatapp.model.MessageType;
import com.ktb.chatapp.model.Room;
import com.ktb.chatapp.model.User;
import com.ktb.chatapp.repository.MessageRepository;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.annotation.PreDestroy;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@ConditionalOnProperty(name = "socketio.enabled", havingValue = "true", matchIfMissing = true)
public class RoomPostJoinDispatcher {

    private final SocketIOServer socketIOServer;
    private final MessageRepository messageRepository;
    private final MongoTemplate mongoTemplate;
    private final MessageResponseMapper messageResponseMapper;
    private final ThreadPoolExecutor[] stripes;
    private final ScheduledExecutorService scheduler;
    private final Map<String, ScheduledFuture<?>> pendingParticipantUpdates = new ConcurrentHashMap<>();
    private final Map<String, SystemMessageBatch> pendingSystemMessages = new ConcurrentHashMap<>();
    private final long participantDebounceMs;
    private final long systemMessageDebounceMs;
    private final Timer queueDelayTimer;
    private final Timer participantSnapshotTimer;

    public RoomPostJoinDispatcher(
            SocketIOServer socketIOServer,
            MessageRepository messageRepository,
            MongoTemplate mongoTemplate,
            MessageResponseMapper messageResponseMapper,
            MeterRegistry meterRegistry,
            @Value("${socketio.post-join.stripes:16}") int stripeCount,
            @Value("${socketio.post-join.queue-capacity:1000}") int queueCapacity,
            @Value("${socketio.participants.debounce-ms:250}") long participantDebounceMs,
            @Value("${socketio.system-messages.debounce-ms:1000}") long systemMessageDebounceMs) {
        this.socketIOServer = socketIOServer;
        this.messageRepository = messageRepository;
        this.mongoTemplate = mongoTemplate;
        this.messageResponseMapper = messageResponseMapper;
        this.participantDebounceMs = participantDebounceMs;
        this.systemMessageDebounceMs = systemMessageDebounceMs;
        this.queueDelayTimer = meterRegistry.timer("socketio.room.post_join.queue.delay");
        this.participantSnapshotTimer = meterRegistry.timer("socketio.room.participants.snapshot.time");
        this.stripes = new ThreadPoolExecutor[Math.max(1, stripeCount)];
        for (int i = 0; i < stripes.length; i++) {
            stripes[i] = new ThreadPoolExecutor(
                    1,
                    1,
                    0L,
                    TimeUnit.MILLISECONDS,
                    new ArrayBlockingQueue<>(Math.max(1, queueCapacity)),
                    namedThreadFactory("room-post-join-" + i + "-"),
                    new ThreadPoolExecutor.CallerRunsPolicy());
        }
        this.scheduler = Executors.newSingleThreadScheduledExecutor(
                namedThreadFactory("room-participants-debounce-"));
        Gauge.builder("socketio.room.post_join.queue.size", this, RoomPostJoinDispatcher::queuedTasks)
                .register(meterRegistry);
        Gauge.builder("socketio.room.participants.pending", pendingParticipantUpdates, Map::size)
                .register(meterRegistry);
    }

    public void publishSystemMessage(String roomId, String content) {
        execute(roomId, () -> {
            try {
                Message message = Message.builder()
                        .roomId(roomId)
                        .content(content)
                        .type(MessageType.system)
                        .timestamp(LocalDateTime.now())
                        .mentions(new ArrayList<>())
                        .reactions(new HashMap<>())
                        .readers(new ArrayList<>())
                        .metadata(new HashMap<>())
                        .build();
                Message saved = messageRepository.save(message);
                socketIOServer.getRoomOperations(roomId)
                        .sendEvent(MESSAGE, messageResponseMapper.mapToMessageResponse(saved, null));
            } catch (Exception e) {
                log.error("Failed to publish system message for room {}", roomId, e);
            }
        });
    }

    public void scheduleSystemMessage(String roomId, String content) {
        pendingSystemMessages.compute(roomId, (key, existing) -> {
            SystemMessageBatch batch = existing != null ? existing : new SystemMessageBatch();
            batch.add(content);
            batch.reschedule(scheduler.schedule(
                    () -> flushSystemMessages(roomId, batch),
                    systemMessageDebounceMs,
                    TimeUnit.MILLISECONDS));
            return batch;
        });
    }

    private void flushSystemMessages(String roomId, SystemMessageBatch batch) {
        if (!pendingSystemMessages.remove(roomId, batch)) {
            return;
        }
        for (String content : batch.contents()) {
            publishSystemMessage(roomId, content);
        }
    }

    public void scheduleParticipantsUpdate(String roomId) {
        pendingParticipantUpdates.compute(roomId, (key, previous) -> {
            if (previous != null) {
                previous.cancel(false);
            }
            return scheduler.schedule(
                    () -> {
                        pendingParticipantUpdates.remove(roomId);
                        execute(roomId, () -> broadcastParticipantSnapshot(roomId));
                    },
                    participantDebounceMs,
                    TimeUnit.MILLISECONDS);
        });
    }

    private void broadcastParticipantSnapshot(String roomId) {
        participantSnapshotTimer.record(() -> {
            try {
                Query roomQuery = Query.query(Criteria.where("_id").is(roomId));
                roomQuery.fields().include("participantIds");
                Room room = mongoTemplate.findOne(roomQuery, Room.class);
                if (room == null || room.getParticipantIds() == null) {
                    return;
                }

                Query usersQuery = Query.query(Criteria.where("_id").in(room.getParticipantIds()));
                usersQuery.fields().include("_id").include("name").include("email").include("profileImage");
                Map<String, User> usersById = mongoTemplate.find(usersQuery, User.class).stream()
                        .filter(user -> user.getId() != null)
                        .collect(Collectors.toMap(User::getId, user -> user));
                List<UserResponse> participants = room.getParticipantIds().stream()
                        .map(usersById::get)
                        .filter(Objects::nonNull)
                        .map(UserResponse::from)
                        .toList();
                socketIOServer.getRoomOperations(roomId).sendEvent(PARTICIPANTS_UPDATE, participants);
            } catch (Exception e) {
                log.error("Failed to broadcast participant snapshot for room {}", roomId, e);
            }
        });
    }

    private void execute(String roomId, Runnable task) {
        long queuedAt = System.nanoTime();
        stripe(roomId).execute(() -> {
            queueDelayTimer.record(System.nanoTime() - queuedAt, TimeUnit.NANOSECONDS);
            task.run();
        });
    }

    private ThreadPoolExecutor stripe(String roomId) {
        return stripes[Math.floorMod(roomId.hashCode(), stripes.length)];
    }

    private double queuedTasks() {
        int queued = 0;
        for (ThreadPoolExecutor stripe : stripes) {
            queued += stripe.getQueue().size();
        }
        return queued;
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
        for (ThreadPoolExecutor stripe : stripes) {
            stripe.shutdown();
        }
    }

    private static final class SystemMessageBatch {
        private final List<String> contents = new ArrayList<>();
        private ScheduledFuture<?> future;

        private synchronized void add(String content) {
            contents.add(content);
        }

        private synchronized void reschedule(ScheduledFuture<?> next) {
            if (future != null) {
                future.cancel(false);
            }
            future = next;
        }

        private synchronized List<String> contents() {
            return List.copyOf(contents);
        }
    }
}
