package com.ktb.chatapp.repository;

import com.ktb.chatapp.model.PendingUpload;
import java.time.Instant;
import java.util.Optional;
import org.springframework.data.mongodb.repository.MongoRepository;

public interface PendingUploadRepository extends MongoRepository<PendingUpload, String> {
    Optional<PendingUpload> findByIdAndUserIdAndPurpose(String id, String userId, PendingUpload.Purpose purpose);
    long countByUserIdAndStatusAndExpiresAtAfter(String userId, PendingUpload.Status status, Instant now);
    long countByUserIdAndCreatedAtAfter(String userId, Instant since);
}
