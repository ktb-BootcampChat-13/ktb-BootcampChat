package com.ktb.chatapp.service;

import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class UploadPolicyTest {
    private final UploadPolicy policy = new UploadPolicy();

    @Test
    void acceptsEveryDocumentTypeAtFiveMegabytes() {
        assertThatNoException().isThrownBy(() -> policy.validate("report.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                UploadPolicy.MAX_SIZE, false));
    }

    @Test
    void rejectsOversizeAndMimeExtensionMismatch() {
        assertThatThrownBy(() -> policy.validate("photo.jpg", "image/jpeg", UploadPolicy.MAX_SIZE + 1, false))
                .isInstanceOf(UploadIntentException.class);
        assertThatIllegalArgumentException().isThrownBy(() ->
                policy.validate("photo.pdf", "image/jpeg", 10, false));
    }

    @Test
    void profilePurposeOnlyAcceptsImages() {
        assertThatIllegalArgumentException().isThrownBy(() ->
                policy.validate("clip.mp4", "video/mp4", 10, true));
    }
}
