package com.ktb.chatapp.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;

public record UploadIntentRequest(
        @NotBlank String originalFilename,
        @NotBlank String contentType,
        @Positive long size) {}
