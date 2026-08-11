package com.ktb.chatapp.storage;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

@Component
@RequiredArgsConstructor
public class S3MirrorUploadPresigner implements MirrorUploadPresigner {
    private final S3Presigner presigner;

    @Value("${aws.s3.bucket}")
    private String bucket;

    @Override
    public PresignedUpload presign(String key, String contentType, long size, Duration ttl) {
        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(bucket).key(key).contentType(contentType).contentLength(size).build();
        var signed = presigner.presignPutObject(PutObjectPresignRequest.builder()
                .signatureDuration(ttl).putObjectRequest(request).build());
        return new PresignedUpload(URI.create(signed.url().toString()),
                Map.of("Content-Type", contentType), Instant.now().plus(ttl));
    }
}
