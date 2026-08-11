package com.ktb.chatapp.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ktb.chatapp.dto.UploadIntentRequest;
import com.ktb.chatapp.dto.MirrorUploadResultRequest;
import com.ktb.chatapp.model.PendingUpload;
import com.ktb.chatapp.model.User;
import com.ktb.chatapp.repository.PendingUploadRepository;
import com.ktb.chatapp.repository.UserRepository;
import com.ktb.chatapp.storage.PresignedUpload;
import com.ktb.chatapp.storage.MirrorUploadPresigner;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.net.URI;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class UploadIntentServiceTest {
    @Mock PendingUploadRepository pendingRepository;
    @Mock UserRepository userRepository;
    @Mock MirrorUploadPresigner presigner;

    private UploadIntentService service;
    private User user;
    private SimpleMeterRegistry meterRegistry;

    @BeforeEach
    void setUp() {
        meterRegistry = new SimpleMeterRegistry();
        service = new UploadIntentService(
                pendingRepository, userRepository, presigner, new UploadPolicy(), meterRegistry);
        user = User.builder().id("user-1").email("user@example.com").build();
        when(userRepository.findByEmail("user@example.com")).thenReturn(Optional.of(user));
    }

    @Test
    void createReturnsFiveMinutePresignedPutForOwnedPendingObject() {
        when(presigner.presign(any(), any(), anyLong(), any())).thenReturn(
                new PresignedUpload(URI.create("https://s3.test/pending"),
                        Map.of("Content-Type", "image/png"), Instant.now().plusSeconds(300)));

        var response = service.create("USER@example.com",
                new UploadIntentRequest("image.png", "image/png", 100), PendingUpload.Purpose.CHAT);

        assertThat(response.method()).isEqualTo("PUT");
        assertThat(response.uploadUrl()).isEqualTo("https://s3.test/pending");
        assertThat(response.key()).startsWith("pending/mirror/chat/");
        verify(pendingRepository).save(any(PendingUpload.class));
    }

    @Test
    void recordResultClosesPendingIntentAndRecordsPutMetric() {
        PendingUpload pending = PendingUpload.builder().id("upload-1").userId("user-1")
                .purpose(PendingUpload.Purpose.CHAT).expectedSize(100).contentType("image/png")
                .status(PendingUpload.Status.PENDING).build();
        when(pendingRepository.findByIdAndUserIdAndPurpose(
                "upload-1", "user-1", PendingUpload.Purpose.CHAT)).thenReturn(Optional.of(pending));

        service.recordResult("user@example.com",
                new MirrorUploadResultRequest("upload-1", true, 200, 42), PendingUpload.Purpose.CHAT);

        assertThat(pending.getStatus()).isEqualTo(PendingUpload.Status.COMPLETED);
        assertThat(meterRegistry.get("mirror_put_success").counter().count()).isEqualTo(1);
        verify(pendingRepository).save(pending);
    }
}
