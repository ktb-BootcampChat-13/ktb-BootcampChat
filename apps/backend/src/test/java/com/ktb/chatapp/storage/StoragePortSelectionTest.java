package com.ktb.chatapp.storage;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import static org.assertj.core.api.Assertions.assertThat;

@DisplayName("로컬 스토리지 선택 단위 테스트")
class StoragePortSelectionTest {

    @Test
    @DisplayName("local 설정에서만 LocalStorage가 빈으로 등록된다")
    void localStorageIsConditionalApplicationComponent() {
        assertThat(LocalStorage.class).hasAnnotation(Component.class);

        ConditionalOnProperty condition = LocalStorage.class
            .getAnnotation(ConditionalOnProperty.class);
        assertThat(condition).isNotNull();
        assertThat(condition.name()).containsExactly("file.storage.type");
        assertThat(condition.havingValue()).isEqualTo("local");
        assertThat(condition.matchIfMissing()).isFalse();
    }
}
