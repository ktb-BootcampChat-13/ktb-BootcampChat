package com.ktb.chatapp.storage;

import java.time.Duration;

public interface MirrorUploadPresigner {
    PresignedUpload presign(String key, String contentType, long size, Duration ttl);
}
