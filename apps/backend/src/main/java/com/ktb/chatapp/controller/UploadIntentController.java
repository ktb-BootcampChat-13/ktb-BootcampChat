package com.ktb.chatapp.controller;

import com.ktb.chatapp.dto.StandardResponse;
import com.ktb.chatapp.dto.UploadIntentRequest;
import com.ktb.chatapp.model.File;
import com.ktb.chatapp.model.PendingUpload;
import com.ktb.chatapp.service.UploadIntentException;
import com.ktb.chatapp.service.UploadIntentService;
import jakarta.validation.Valid;
import java.security.Principal;
import java.util.LinkedHashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/files/upload-intents")
@RequiredArgsConstructor
public class UploadIntentController {
    private final UploadIntentService service;

    @PostMapping
    public ResponseEntity<?> create(@Valid @RequestBody UploadIntentRequest request, Principal principal) {
        return ResponseEntity.ok(service.create(principal.getName(), request, PendingUpload.Purpose.CHAT));
    }

    @PostMapping("/{uploadId}/complete")
    public ResponseEntity<?> complete(@PathVariable String uploadId, Principal principal) {
        File file = service.completeChat(principal.getName(), uploadId);
        Map<String, Object> fileData = new LinkedHashMap<>();
        fileData.put("_id", file.getId());
        fileData.put("filename", file.getFilename());
        fileData.put("originalname", file.getOriginalname());
        fileData.put("mimetype", file.getMimetype());
        fileData.put("size", file.getSize());
        fileData.put("uploadDate", file.getUploadDate());
        return ResponseEntity.ok(Map.of("success", true, "message", "파일 업로드 성공", "file", fileData));
    }

    @ExceptionHandler(UploadIntentException.class)
    ResponseEntity<?> handle(UploadIntentException ex) {
        return ResponseEntity.status(ex.status()).body(StandardResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<?> handleInvalid(IllegalArgumentException ex) {
        return ResponseEntity.badRequest().body(StandardResponse.error(ex.getMessage()));
    }
}
