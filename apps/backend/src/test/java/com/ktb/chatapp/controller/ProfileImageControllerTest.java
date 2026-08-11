package com.ktb.chatapp.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.ktb.chatapp.storage.StoragePort;
import java.net.URI;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

@ExtendWith(MockitoExtension.class)
@DisplayName("프로필 이미지 조회 단위 테스트")
class ProfileImageControllerTest {

    @Mock
    private StoragePort storagePort;

    @Test
    @DisplayName("프로필 이미지는 S3 서명 URL로 리다이렉트한다")
    void redirectsToS3Url() {
        URI s3Url = URI.create("https://test-bucket.s3.ap-northeast-2.amazonaws.com/profiles/avatar.png");
        when(storagePort.offloadUrl(eq("profiles/avatar.png"), any(), any(ContentDisposition.class)))
                .thenReturn(Optional.of(s3Url));

        ResponseEntity<?> response = new ProfileImageController(storagePort).getProfileImage("avatar.png");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FOUND);
        assertThat(response.getHeaders().getLocation()).isEqualTo(s3Url);
    }
}
