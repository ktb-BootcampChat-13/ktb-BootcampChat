package com.ktb.chatapp.model;

import java.time.Instant;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@Document(collection = "pending_uploads")
public class PendingUpload {
    @Id private String id;
    @Indexed private String userId;
    private Purpose purpose;
    @Indexed(unique = true) private String pendingKey;
    private String originalFilename;
    private String contentType;
    private long expectedSize;
    private Status status;
    private Instant createdAt;
    @Indexed(expireAfter = "0s") private Instant expiresAt;

    public enum Purpose { CHAT, PROFILE }
    public enum Status { PENDING, COMPLETED, FAILED }
}
