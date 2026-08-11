package com.ktb.chatapp.service;

import com.ktb.chatapp.dto.ProfileImageResponse;
import com.ktb.chatapp.dto.UploadIntentRequest;
import com.ktb.chatapp.dto.UploadIntentResponse;
import com.ktb.chatapp.model.File;
import com.ktb.chatapp.model.PendingUpload;
import com.ktb.chatapp.model.User;
import com.ktb.chatapp.repository.FileRepository;
import com.ktb.chatapp.repository.PendingUploadRepository;
import com.ktb.chatapp.repository.UserRepository;
import com.ktb.chatapp.storage.PresignedUpload;
import com.ktb.chatapp.storage.StorageKey;
import com.ktb.chatapp.storage.StoragePort;
import com.ktb.chatapp.util.FileUtil;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
@RequiredArgsConstructor
@Slf4j
public class UploadIntentService {
    private static final Duration URL_TTL = Duration.ofMinutes(5);
    private static final Duration PENDING_TTL = Duration.ofMinutes(15);
    private static final int MAX_PENDING = 5;

    private final PendingUploadRepository pendingRepository;
    private final FileRepository fileRepository;
    private final UserRepository userRepository;
    private final StoragePort storage;
    private final UploadPolicy policy;

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
        String pendingKey = "pending/" + purpose.name().toLowerCase() + "/" + UUID.randomUUID();
        String safeName = FileUtil.generateSafeFileName(StringUtils.cleanPath(request.originalFilename()));
        String finalKey = purpose == PendingUpload.Purpose.CHAT
                ? StorageKey.chat(safeName) : StorageKey.profile(safeName);
        Instant now = Instant.now();
        PendingUpload pending = PendingUpload.builder().id(id).userId(user.getId()).purpose(purpose)
                .pendingKey(pendingKey).finalKey(finalKey).originalFilename(request.originalFilename())
                .contentType(request.contentType()).expectedSize(request.size()).status(PendingUpload.Status.PENDING)
                .createdAt(now).expiresAt(now.plus(PENDING_TTL)).build();
        pendingRepository.save(pending);
        try {
            PresignedUpload signed = storage.presignPut(pendingKey, request.contentType(), request.size(), URL_TTL);
            return new UploadIntentResponse(id, signed.url().toString(), "PUT", signed.headers(), signed.expiresAt());
        } catch (RuntimeException ex) {
            pendingRepository.deleteById(id);
            throw ex;
        }
    }

    public synchronized File completeChat(String email, String uploadId) {
        User user = user(email);
        PendingUpload pending = owned(uploadId, user.getId(), PendingUpload.Purpose.CHAT);
        if (pending.getStatus() == PendingUpload.Status.COMPLETED) {
            return fileRepository.findById(pending.getCompletedFileId())
                    .orElseThrow(() -> new UploadIntentException(HttpStatus.CONFLICT, "완료된 파일 메타데이터가 없습니다."));
        }
        verifyAndPromote(pending);
        File entity = File.builder().filename(filename(pending.getFinalKey()))
                .originalname(FileUtil.normalizeOriginalFilename(pending.getOriginalFilename()))
                .mimetype(pending.getContentType()).size(pending.getExpectedSize()).path(pending.getFinalKey())
                .uploadId(uploadId).user(user.getId()).uploadDate(LocalDateTime.now()).build();
        try {
            entity = fileRepository.save(entity);
        } catch (DuplicateKeyException ex) {
            entity = fileRepository.findByUploadId(uploadId).orElseThrow(() -> ex);
        }
        pending.setCompletedFileId(entity.getId());
        pending.setStatus(PendingUpload.Status.COMPLETED);
        pendingRepository.save(pending);
        return entity;
    }

    public synchronized ProfileImageResponse completeProfile(String email, String uploadId) {
        User user = user(email);
        PendingUpload pending = owned(uploadId, user.getId(), PendingUpload.Purpose.PROFILE);
        if (pending.getStatus() == PendingUpload.Status.COMPLETED) return ProfileImageResponse.updated(pending.getFinalKey());
        verifyAndPromote(pending);
        String oldKey = user.getProfileImage();
        user.setProfileImage(pending.getFinalKey());
        user.setUpdatedAt(LocalDateTime.now());
        userRepository.save(user);
        pending.setStatus(PendingUpload.Status.COMPLETED);
        pendingRepository.save(pending);
        if (StringUtils.hasText(oldKey) && !oldKey.equals(pending.getFinalKey())) {
            try { storage.delete(oldKey); } catch (RuntimeException ex) {
                log.warn("이전 프로필 이미지 삭제 실패 (새 프로필은 적용됨): {}", oldKey, ex);
            }
        }
        return ProfileImageResponse.updated(pending.getFinalKey());
    }

    private void verifyAndPromote(PendingUpload pending) {
        if (pending.getStatus() == PendingUpload.Status.FAILED || pending.getExpiresAt().isBefore(Instant.now())) {
            throw new UploadIntentException(HttpStatus.GONE, "업로드 요청이 만료되었거나 실패했습니다.");
        }
        var metadata = storage.head(pending.getPendingKey());
        if (metadata.isEmpty()) {
            // Copy succeeded but a subsequent DB write failed: accept the already-promoted object on retry.
            var promoted = storage.head(pending.getFinalKey());
            if (matches(promoted, pending)) return;
        }
        if (!matches(metadata, pending)) {
            if (metadata.isPresent()) storage.delete(pending.getPendingKey());
            pending.setStatus(PendingUpload.Status.FAILED);
            pendingRepository.save(pending);
            throw new UploadIntentException(HttpStatus.UNPROCESSABLE_ENTITY, "업로드된 객체의 크기 또는 형식이 일치하지 않습니다.");
        }
        storage.promote(pending.getPendingKey(), pending.getFinalKey());
    }

    private boolean matches(java.util.Optional<com.ktb.chatapp.storage.UploadObjectMetadata> metadata,
                            PendingUpload pending) {
        return metadata.isPresent() && metadata.get().size() == pending.getExpectedSize()
                && pending.getContentType().equalsIgnoreCase(metadata.get().contentType());
    }

    private PendingUpload owned(String id, String userId, PendingUpload.Purpose purpose) {
        return pendingRepository.findByIdAndUserIdAndPurpose(id, userId, purpose)
                .orElseThrow(() -> new UploadIntentException(HttpStatus.NOT_FOUND, "업로드 요청을 찾을 수 없습니다."));
    }
    private User user(String email) {
        return userRepository.findByEmail(email.toLowerCase())
                .orElseThrow(() -> new UsernameNotFoundException("사용자를 찾을 수 없습니다."));
    }
    private String filename(String key) { return key.substring(key.lastIndexOf('/') + 1); }
}
