package com.ktb.chatapp.controller;

import com.ktb.chatapp.dto.StandardResponse;
import com.ktb.chatapp.dto.MirrorUploadResultRequest;
import com.ktb.chatapp.dto.UploadIntentRequest;
import com.ktb.chatapp.model.PendingUpload;
import com.ktb.chatapp.service.UploadIntentException;
import com.ktb.chatapp.service.UploadIntentService;
import jakarta.validation.Valid;
import java.security.Principal;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users/profile-image")
@RequiredArgsConstructor
public class ProfileUploadIntentController {
    private final UploadIntentService service;

    @PostMapping("/presign")
    public ResponseEntity<?> create(@Valid @RequestBody UploadIntentRequest request, Principal principal) {
        return ResponseEntity.ok(service.create(principal.getName(), request, PendingUpload.Purpose.PROFILE));
    }

    @PostMapping("/mirror-result")
    public ResponseEntity<Void> result(@Valid @RequestBody MirrorUploadResultRequest request, Principal principal) {
        service.recordResult(principal.getName(), request, PendingUpload.Purpose.PROFILE);
        return ResponseEntity.noContent().build();
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
