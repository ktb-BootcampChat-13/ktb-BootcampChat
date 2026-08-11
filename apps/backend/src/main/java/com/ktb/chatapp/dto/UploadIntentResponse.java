package com.ktb.chatapp.dto;

import java.time.Instant;
import java.util.Map;

public record UploadIntentResponse(
        String uploadId, String key, String uploadUrl, String method,
        Map<String, String> headers, Instant expiresAt) {}
