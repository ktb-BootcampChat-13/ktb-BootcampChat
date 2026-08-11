package com.ktb.chatapp.service;

import com.ktb.chatapp.util.FileUtil;
import java.nio.charset.StandardCharsets;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.http.HttpStatus;

@Component
public class UploadPolicy {
    public static final long MAX_SIZE = 5L * 1024 * 1024;

    public void validate(String originalFilename, String contentType, long size, boolean profileImage) {
        if (!StringUtils.hasText(originalFilename) || originalFilename.getBytes(StandardCharsets.UTF_8).length > 255) {
            throw new IllegalArgumentException("파일명이 올바르지 않습니다.");
        }
        if (size <= 0) {
            throw new IllegalArgumentException("파일이 비어있습니다.");
        }
        if (size > MAX_SIZE) {
            throw new UploadIntentException(HttpStatus.PAYLOAD_TOO_LARGE, "파일 크기는 5MB를 초과할 수 없습니다.");
        }
        if (!FileUtil.isAllowedType(originalFilename, contentType)) {
            throw new IllegalArgumentException("지원하지 않는 파일 형식입니다.");
        }
        if (profileImage && !contentType.startsWith("image/")) {
            throw new IllegalArgumentException("이미지 파일만 업로드할 수 있습니다.");
        }
    }
}
