package com.ktb.chatapp.service;

import com.ktb.chatapp.dto.MirrorUploadResultRequest;
import com.ktb.chatapp.dto.UploadIntentRequest;
import com.ktb.chatapp.dto.UploadIntentResponse;
import com.ktb.chatapp.model.PendingUpload;
import com.ktb.chatapp.model.User;
import com.ktb.chatapp.repository.PendingUploadRepository;
import com.ktb.chatapp.repository.UserRepository;
import com.ktb.chatapp.storage.PresignedUpload;
import com.ktb.chatapp.storage.MirrorUploadPresigner;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
@Slf4j
public class UploadIntentService {
    private static final Duration URL_TTL = Duration.ofMinutes(5);
    private static final Duration PENDING_TTL = Duration.ofMinutes(15);
    private static final int MAX_PENDING = 5;

    private final PendingUploadRepository pendingRepository;
    private final UserRepository userRepository;
    private final MirrorUploadPresigner presigner;
    private final UploadPolicy policy;
    private final MeterRegistry meterRegistry;

    public UploadIntentResponse create(String email, UploadIntentRequest request, PendingUpload.Purpose purpose) {
        User user = user(email);
        policy.validate(request.originalFilename(), request.contentType(), request.size(),
                purpose == PendingUpload.Purpose.PROFILE);
        if (pendingRepository.countByUserIdAndCreatedAtAfter(user.getId(), Instant.now().minusSeconds(60)) >= 20) {
            throw new UploadIntentException(HttpStatus.TOO_MANY_REQUESTS, "업로드 요청은 분당 20회까지 가능합니다.");
        }
        if (pendingRepository.countByUserIdAndStatusAndExpiresAtAfter(
                user.getId(), PendingUpload.Status.PENDING, Instant.now()) >= MAX_PENDING) {
            throw new UploadIntentException(HttpStatus.TOO_MANY_REQUESTS, "동시에 진행할 수 있는 업로드는 최대 5개입니다.");
        }

        String id = UUID.randomUUID().toString();
        String pendingKey = "pending/mirror/" + purpose.name().toLowerCase() + "/" + UUID.randomUUID();
        Instant now = Instant.now();
        PendingUpload pending = PendingUpload.builder().id(id).userId(user.getId()).purpose(purpose)
                .pendingKey(pendingKey).originalFilename(request.originalFilename())
                .contentType(request.contentType()).expectedSize(request.size()).status(PendingUpload.Status.PENDING)
                .createdAt(now).expiresAt(now.plus(PENDING_TTL)).build();
        pendingRepository.save(pending);
        try {
            PresignedUpload signed = presigner.presign(pendingKey, request.contentType(), request.size(), URL_TTL);
            meterRegistry.counter("mirror_presign_success", "purpose", purpose.name().toLowerCase()).increment();
            return new UploadIntentResponse(id, pendingKey, signed.url().toString(), "PUT",
                    signed.headers(), signed.expiresAt());
        } catch (RuntimeException ex) {
            pendingRepository.deleteById(id);
            throw ex;
        }
    }

    public void recordResult(String email, MirrorUploadResultRequest request, PendingUpload.Purpose purpose) {
        User user = user(email);
        PendingUpload pending = owned(request.uploadId(), user.getId(), purpose);
        pending.setStatus(request.success() ? PendingUpload.Status.COMPLETED : PendingUpload.Status.FAILED);
        pendingRepository.save(pending);
        meterRegistry.counter(request.success() ? "mirror_put_success" : "mirror_put_failure",
                "purpose", purpose.name().toLowerCase(), "status", Integer.toString(request.status())).increment();
        Timer.builder("mirror_put_latency").tag("purpose", purpose.name().toLowerCase())
                .register(meterRegistry).record(Duration.ofMillis(request.durationMs()));
        if (!request.success()) {
            log.warn("S3 미러 업로드 실패 purpose={} size={} mime={} status={} durationMs={}",
                    purpose, pending.getExpectedSize(), pending.getContentType(), request.status(), request.durationMs());
        }
    }

    private PendingUpload owned(String id, String userId, PendingUpload.Purpose purpose) {
        return pendingRepository.findByIdAndUserIdAndPurpose(id, userId, purpose)
                .orElseThrow(() -> new UploadIntentException(HttpStatus.NOT_FOUND, "업로드 요청을 찾을 수 없습니다."));
    }
    private User user(String email) {
        return userRepository.findByEmail(email.toLowerCase())
                .orElseThrow(() -> new UsernameNotFoundException("사용자를 찾을 수 없습니다."));
    }
}
