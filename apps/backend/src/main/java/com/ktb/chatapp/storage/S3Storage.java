package com.ktb.chatapp.storage;

import java.io.InputStream;
import java.net.URI;
import java.time.Duration;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

@Component
@ConditionalOnProperty(name = "file.storage.type", havingValue = "s3", matchIfMissing = true)
@RequiredArgsConstructor
public class S3Storage implements StoragePort {

    private final S3Client s3Client;
    private final S3Presigner s3Presigner;

    @Value("${aws.s3.bucket}")
    private String bucket;

    @Override
    public StoredObject put(InputStream content, String key, String contentType, long size) {
        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .contentType(contentType)
                .contentLength(size)
                .build();
        s3Client.putObject(request, RequestBody.fromInputStream(content, size));
        return new StoredObject(key, size);
    }

    @Override
    public Optional<Resource> open(String key) {
        try {
            byte[] content = s3Client.getObjectAsBytes(GetObjectRequest.builder()
                    .bucket(bucket)
                    .key(key)
                    .build()).asByteArray();
            return Optional.of(new ByteArrayResource(content));
        } catch (NoSuchKeyException ex) {
            return Optional.empty();
        }
    }

    @Override
    public void delete(String key) {
        s3Client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
    }

    @Override
    public Optional<URI> offloadUrl(String key, Duration ttl, ContentDisposition disposition) {
        GetObjectRequest objectRequest = GetObjectRequest.builder()
                .bucket(bucket)
                .key(key)
                .responseContentDisposition(disposition.toString())
                .build();
        GetObjectPresignRequest presignRequest = GetObjectPresignRequest.builder()
                .signatureDuration(ttl)
                .getObjectRequest(objectRequest)
                .build();
        return Optional.of(URI.create(s3Presigner.presignGetObject(presignRequest).url().toString()));
    }
}
