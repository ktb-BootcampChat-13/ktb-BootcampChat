package com.ktb.chatapp.service.session;

import com.ktb.chatapp.model.Session;
import com.ktb.chatapp.service.SessionMetadata;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import static com.ktb.chatapp.service.SessionService.SESSION_TTL_SEC;

@Component
@RequiredArgsConstructor
public class SessionRedisStore implements SessionStore {

    private static final String KEY_PREFIX = "auth:session:";
    private static final String SESSION_ID = "sessionId";
    private static final String USER_ID = "userId";
    private static final String CREATED_AT = "createdAt";
    private static final String LAST_ACTIVITY = "lastActivity";
    private static final String USER_AGENT = "userAgent";
    private static final String IP_ADDRESS = "ipAddress";
    private static final String DEVICE_INFO = "deviceInfo";
    private static final DefaultRedisScript<Long> DELETE_IF_SESSION_MATCHES =
            new DefaultRedisScript<>(
                    "if redis.call('HGET', KEYS[1], 'sessionId') == ARGV[1] "
                            + "then return redis.call('DEL', KEYS[1]) else return 0 end",
                    Long.class
            );
    private static final DefaultRedisScript<Long> TOUCH_IF_SESSION_MATCHES =
            new DefaultRedisScript<>(
                    "if redis.call('HGET', KEYS[1], 'sessionId') == ARGV[1] then "
                            + "redis.call('HSET', KEYS[1], 'lastActivity', ARGV[2]); "
                            + "redis.call('EXPIRE', KEYS[1], ARGV[3]); return 1 else return 0 end",
                    Long.class
            );

    private final StringRedisTemplate redisTemplate;

    @Override
    public Optional<Session> findByUserId(String userId) {
        String key = buildKey(userId);
        Map<Object, Object> values = redisTemplate.opsForHash().entries(key);
        if (values.isEmpty()) {
            return Optional.empty();
        }

        Long ttlSeconds = redisTemplate.getExpire(key);
        Instant expiresAt = ttlSeconds != null && ttlSeconds > 0
                ? Instant.now().plusSeconds(ttlSeconds)
                : Instant.now();

        return Optional.of(Session.builder()
                .userId(value(values, USER_ID))
                .sessionId(value(values, SESSION_ID))
                .createdAt(longValue(values, CREATED_AT))
                .lastActivity(longValue(values, LAST_ACTIVITY))
                .metadata(readMetadata(values))
                .expiresAt(expiresAt)
                .build());
    }

    @Override
    public Session save(Session session) {
        String key = buildKey(session.getUserId());
        Map<String, String> values = new HashMap<>();
        values.put(USER_ID, session.getUserId());
        values.put(SESSION_ID, session.getSessionId());
        values.put(CREATED_AT, Long.toString(session.getCreatedAt()));
        values.put(LAST_ACTIVITY, Long.toString(session.getLastActivity()));
        writeMetadata(values, session.getMetadata());

        redisTemplate.opsForHash().putAll(key, values);
        redisTemplate.expire(key, Duration.ofSeconds(SESSION_TTL_SEC));
        return session;
    }

    @Override
    public boolean touch(String userId, String sessionId, long lastActivity) {
        Long result = redisTemplate.execute(
                TOUCH_IF_SESSION_MATCHES,
                List.of(buildKey(userId)),
                sessionId,
                Long.toString(lastActivity),
                Long.toString(SESSION_TTL_SEC)
        );
        return result != null && result == 1L;
    }

    @Override
    public void delete(String userId, String sessionId) {
        redisTemplate.execute(
                DELETE_IF_SESSION_MATCHES,
                List.of(buildKey(userId)),
                sessionId
        );
    }

    @Override
    public void deleteAll(String userId) {
        redisTemplate.delete(buildKey(userId));
    }

    private String buildKey(String userId) {
        return KEY_PREFIX + userId;
    }

    private String value(Map<Object, Object> values, String key) {
        Object value = values.get(key);
        return value != null ? value.toString() : null;
    }

    private long longValue(Map<Object, Object> values, String key) {
        String value = value(values, key);
        return value != null ? Long.parseLong(value) : 0L;
    }

    private SessionMetadata readMetadata(Map<Object, Object> values) {
        String userAgent = nullableValue(values, USER_AGENT);
        String ipAddress = nullableValue(values, IP_ADDRESS);
        String deviceInfo = nullableValue(values, DEVICE_INFO);
        if (userAgent == null && ipAddress == null && deviceInfo == null) {
            return null;
        }
        return new SessionMetadata(userAgent, ipAddress, deviceInfo);
    }

    private void writeMetadata(Map<String, String> values, SessionMetadata metadata) {
        values.put(USER_AGENT, metadata != null ? emptyIfNull(metadata.userAgent()) : "");
        values.put(IP_ADDRESS, metadata != null ? emptyIfNull(metadata.ipAddress()) : "");
        values.put(DEVICE_INFO, metadata != null ? emptyIfNull(metadata.deviceInfo()) : "");
    }

    private String nullableValue(Map<Object, Object> values, String key) {
        String value = value(values, key);
        return value == null || value.isEmpty() ? null : value;
    }

    private String emptyIfNull(String value) {
        return value != null ? value : "";
    }
}
