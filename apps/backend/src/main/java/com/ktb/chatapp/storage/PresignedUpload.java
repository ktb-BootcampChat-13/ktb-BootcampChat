package com.ktb.chatapp.storage;

import java.net.URI;
import java.time.Instant;
import java.util.Map;

public record PresignedUpload(URI url, Map<String, String> headers, Instant expiresAt) {}
