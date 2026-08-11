package com.ktb.chatapp.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;

import java.io.ByteArrayInputStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

@ExtendWith(MockitoExtension.class)
@DisplayName("S3Storage 단위 테스트")
class S3StorageTest {

    @Mock
    private S3Client s3Client;

    @Mock
    private S3Presigner s3Presigner;

    private S3Storage storage;

    @BeforeEach
    void setUp() {
        storage = new S3Storage(s3Client, s3Presigner);
        ReflectionTestUtils.setField(storage, "bucket", "test-bucket");
    }

    @Test
    @DisplayName("이미지 바이트를 지정한 S3 key와 Content-Type으로 저장한다")
    void putStoresObjectInS3() {
        byte[] content = "image-bytes".getBytes();

        StoredObject result = storage.put(
                new ByteArrayInputStream(content), "profiles/avatar.png", "image/png", content.length);

        ArgumentCaptor<PutObjectRequest> request = ArgumentCaptor.forClass(PutObjectRequest.class);
        verify(s3Client).putObject(request.capture(), any(RequestBody.class));
        assertThat(request.getValue().bucket()).isEqualTo("test-bucket");
        assertThat(request.getValue().key()).isEqualTo("profiles/avatar.png");
        assertThat(request.getValue().contentType()).isEqualTo("image/png");
        assertThat(result).isEqualTo(new StoredObject("profiles/avatar.png", content.length));
    }
}
