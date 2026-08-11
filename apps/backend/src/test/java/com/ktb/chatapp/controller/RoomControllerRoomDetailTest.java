package com.ktb.chatapp.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anySet;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ktb.chatapp.dto.RoomResponse;
import com.ktb.chatapp.dto.JoinRoomRequest;
import com.ktb.chatapp.model.Room;
import com.ktb.chatapp.model.User;
import com.ktb.chatapp.repository.UserRepository;
import com.ktb.chatapp.service.RecentMessageCounter;
import com.ktb.chatapp.service.RoomService;
import java.security.Principal;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

@ExtendWith(MockitoExtension.class)
class RoomControllerRoomDetailTest {

    @Mock private UserRepository userRepository;
    @Mock private RecentMessageCounter recentMessageCounter;
    @Mock private RoomService roomService;

    private RoomController roomController;

    @BeforeEach
    void setUp() {
        roomController = new RoomController(userRepository, recentMessageCounter, roomService);
    }

    @Test
    void getRoomById_batchesCreatorAndParticipantsAndPreservesOrder() {
        Room room = Room.builder()
            .id("room-1")
            .name("Room")
            .creator("creator-1")
            .createdAt(LocalDateTime.of(2026, 8, 11, 10, 0))
            .participantIds(new LinkedHashSet<>(List.of(
                "participant-2", "missing-user", "participant-1")))
            .build();
        User creator = user("creator-1", "Creator");
        User participant1 = user("participant-1", "Participant 1");
        User participant2 = user("participant-2", "Participant 2");
        when(roomService.findRoomById("room-1")).thenReturn(Optional.of(room));
        when(userRepository.findSummariesByIdIn(anySet()))
            .thenReturn(List.of(participant1, creator, participant2));
        when(recentMessageCounter.countRecentMessages("room-1")).thenReturn(7);

        ResponseEntity<?> response = roomController.getRoomById("room-1", principal("viewer@test.com"));

        assertEquals(200, response.getStatusCode().value());
        RoomResponse data = (RoomResponse) ((Map<?, ?>) response.getBody()).get("data");
        assertEquals("creator-1", data.getCreator().getId());
        assertEquals(List.of("participant-2", "participant-1"), data.getParticipants().stream()
            .map(participant -> participant.getId()).toList());
        assertEquals(7, data.getRecentMessageCount());
        assertTrue((Boolean) ((Map<?, ?>) response.getBody()).get("success"));
        verify(userRepository).findSummariesByIdIn(anySet());
        verify(userRepository, never()).findById(org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void getRoomById_returnsServerErrorWhenCreatorIsMissing() {
        Room room = Room.builder()
            .id("room-1")
            .creator("missing-creator")
            .participantIds(new LinkedHashSet<>())
            .build();
        when(roomService.findRoomById("room-1")).thenReturn(Optional.of(room));
        when(userRepository.findSummariesByIdIn(anySet())).thenReturn(List.of());

        ResponseEntity<?> response = roomController.getRoomById("room-1", principal("viewer@test.com"));

        assertEquals(500, response.getStatusCode().value());
        verify(userRepository).findSummariesByIdIn(anySet());
    }

    @Test
    void joinRoom_passesJwtUserIdAndReturnsServiceResponseWithoutRemapping() {
        RoomResponse roomResponse = RoomResponse.builder()
            .id("room-1")
            .participants(List.of())
            .createdAtDateTime(LocalDateTime.now())
            .build();
        when(roomService.joinRoom("room-1", "secret", "user-1")).thenReturn(roomResponse);

        ResponseEntity<?> response = roomController.joinRoom(
            "room-1",
            JoinRoomRequest.builder().password("secret").build(),
            authentication("user-1", "user@test.com")
        );

        assertEquals(200, response.getStatusCode().value());
        assertSame(roomResponse, ((Map<?, ?>) response.getBody()).get("data"));
        verify(userRepository, never()).findSummariesByIdIn(anySet());
        verify(recentMessageCounter, never()).countRecentMessages(org.mockito.ArgumentMatchers.anyString());
    }

    private static Principal principal(String name) {
        return () -> name;
    }

    private static JwtAuthenticationToken authentication(String userId, String email) {
        Instant now = Instant.now();
        Jwt jwt = Jwt.withTokenValue("token")
            .header("alg", "none")
            .subject(email)
            .claim("userId", userId)
            .issuedAt(now)
            .expiresAt(now.plusSeconds(60))
            .build();
        return new JwtAuthenticationToken(jwt, List.of(), email);
    }

    private static User user(String id, String name) {
        return User.builder().id(id).name(name).email(id + "@test.com").build();
    }
}
