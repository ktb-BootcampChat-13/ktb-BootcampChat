package com.ktb.chatapp.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;

public record MirrorUploadResultRequest(
        @NotBlank String uploadId,
        boolean success,
        @Min(0) @Max(599) int status,
        @Min(0) long durationMs) {}
