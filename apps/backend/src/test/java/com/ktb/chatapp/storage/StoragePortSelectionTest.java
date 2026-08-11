package com.ktb.chatapp.storage;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.stereotype.Component;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("S3 전용 스토리지 선택 단위 테스트")
class StoragePortSelectionTest {

    @Test
    @DisplayName("S3Storage만 애플리케이션 빈으로 등록된다")
    void onlyS3StorageIsApplicationComponent() {
        assertThat(S3Storage.class).hasAnnotation(Component.class);
        assertThat(LocalStorage.class.getAnnotation(Component.class)).isNull();
    }
}
