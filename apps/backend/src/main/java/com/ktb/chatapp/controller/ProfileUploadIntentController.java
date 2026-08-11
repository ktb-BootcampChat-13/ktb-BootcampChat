package com.ktb.chatapp.controller;

import com.ktb.chatapp.dto.StandardResponse;
import com.ktb.chatapp.dto.UploadIntentRequest;
import com.ktb.chatapp.model.PendingUpload;
import com.ktb.chatapp.service.UploadIntentException;
import com.ktb.chatapp.service.UploadIntentService;
import jakarta.validation.Valid;
import java.security.Principal;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users/profile-image/upload-intents")
@RequiredArgsConstructor
public class ProfileUploadIntentController {
    private final UploadIntentService service;

    @PostMapping
    public ResponseEntity<?> create(@Valid @RequestBody UploadIntentRequest request, Principal principal) {
        return ResponseEntity.ok(service.create(principal.getName(), request, PendingUpload.Purpose.PROFILE));
    }

    @PostMapping("/{uploadId}/complete")
    public ResponseEntity<?> complete(@PathVariable String uploadId, Principal principal) {
        return ResponseEntity.ok(service.completeProfile(principal.getName(), uploadId));
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
