package com.ktb.chatapp.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anySet;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.ktb.chatapp.dto.RoomResponse;
import com.ktb.chatapp.dto.RoomsResponse;
import com.ktb.chatapp.event.RoomUpdatedEvent;
import com.ktb.chatapp.model.Room;
import com.ktb.chatapp.model.User;
import com.ktb.chatapp.repository.RoomRepository;
import com.ktb.chatapp.repository.UserRepository;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class RoomServiceTest {

    @Mock private RoomRepository roomRepository;
    @Mock private UserRepository userRepository;
    @Mock private RecentMessageCounter recentMessageCounter;
    @Mock private PasswordEncoder passwordEncoder;
    @Mock private ApplicationEventPublisher eventPublisher;

    private RoomService roomService;

    @BeforeEach
    void setUp() {
        roomService = new RoomService(
            roomRepository,
            userRepository,
            recentMessageCounter,
            passwordEncoder,
            eventPublisher
        );
    }

    @Test
    void getAllRooms_emptyList_avoidsBatchLookups() {
        when(roomRepository.findAll()).thenReturn(List.of());

        RoomsResponse response = roomService.getAllRooms("viewer@test.com");

        assertTrue(response.isSuccess());
        assertTrue(response.getData().isEmpty());
        verify(userRepository, never()).findSummariesByIdIn(anySet());
        verify(recentMessageCounter, never()).countRecentMessages(anySet());
    }

    @Test
    void getAllRooms_batchesUsersAndMessageCountsOnceAndKeepsContract() throws Exception {
        LocalDateTime older = LocalDateTime.of(2026, 8, 10, 10, 0);
        LocalDateTime newer = older.plusMinutes(1);
        Room oldRoom = room("room-old", "Old", "creator-1", older,
            Set.of("creator-1", "participant-1", "missing-user"));
        Room newRoom = room("room-new", null, "missing-creator", newer,
            Set.of("participant-1"));
        User creator = user("creator-1", "Creator", "creator@test.com");
        User participant = user("participant-1", null, null);

        when(roomRepository.findAll()).thenReturn(List.of(oldRoom, newRoom));
        when(userRepository.findSummariesByIdIn(anySet())).thenReturn(List.of(creator, participant));
        when(recentMessageCounter.countRecentMessages(anySet()))
            .thenReturn(Map.of("room-old", 7));

        RoomsResponse response = roomService.getAllRooms("viewer@test.com");

        assertTrue(response.isSuccess());
        assertEquals(List.of("room-new", "room-old"), response.getData().stream()
            .map(RoomResponse::getId).toList());
        RoomResponse first = response.getData().get(0);
        RoomResponse second = response.getData().get(1);
        assertEquals("제목 없음", first.getName());
        assertNull(first.getCreator());
        assertEquals(0, first.getRecentMessageCount());
        assertEquals(1, first.getParticipantsCount());
        assertEquals("알 수 없음", first.getParticipants().get(0).getName());
        assertEquals("", first.getParticipants().get(0).getEmail());
        assertEquals(7, second.getRecentMessageCount());
        assertEquals(2, second.getParticipantsCount());
        verify(userRepository).findSummariesByIdIn(anySet());
        verify(recentMessageCounter).countRecentMessages(anySet());

        JsonNode json = new ObjectMapper().findAndRegisterModules().valueToTree(second);
        assertTrue(json.has("_id"));
        assertTrue(json.has("name"));
        assertTrue(json.has("hasPassword"));
        assertTrue(json.has("creator"));
        assertTrue(json.has("participants"));
        assertTrue(json.has("participantsCount"));
        assertTrue(json.has("createdAt"));
        assertTrue(json.has("recentMessageCount"));
        assertFalse(json.has("isCreator"));
        assertFalse(json.has("createdAtDateTime"));
    }

    @Test
    void joinRoom_usesUserIdAtomicUpdateAndSharesOneResponseWithEvent() {
        Room before = room("room-1", "Room", "creator-1", LocalDateTime.now(),
            new java.util.LinkedHashSet<>(List.of("creator-1")));
        Room after = room("room-1", "Room", "creator-1", before.getCreatedAt(),
            new java.util.LinkedHashSet<>(List.of("creator-1", "user-1")));
        User creator = user("creator-1", "Creator", "creator@test.com");
        User participant = user("user-1", "Participant", "participant@test.com");
        when(roomRepository.findById("room-1")).thenReturn(java.util.Optional.of(before));
        when(roomRepository.addParticipantAndReturn("room-1", "user-1")).thenReturn(after);
        when(userRepository.findSummariesByIdIn(anySet())).thenReturn(List.of(participant, creator));
        when(recentMessageCounter.countRecentMessages("room-1")).thenReturn(4);

        RoomResponse response = roomService.joinRoom("room-1", null, "user-1");

        assertEquals(List.of("creator-1", "user-1"), response.getParticipants().stream()
            .map(participantResponse -> participantResponse.getId()).toList());
        assertEquals(false, ReflectionTestUtils.getField(response, "isCreator"));
        assertEquals(4, response.getRecentMessageCount());
        verify(userRepository, never()).findByEmail(any());
        verify(roomRepository, never()).save(any());
        verify(userRepository).findSummariesByIdIn(anySet());
        verify(recentMessageCounter).countRecentMessages("room-1");
        ArgumentCaptor<RoomUpdatedEvent> eventCaptor = ArgumentCaptor.forClass(RoomUpdatedEvent.class);
        verify(eventPublisher).publishEvent(eventCaptor.capture());
        assertSame(response, eventCaptor.getValue().getRoomResponse());
    }

    @Test
    void joinRoom_keepsExistingParticipantWithoutMutationAndUsesIdForIsCreator() {
        Room room = room("room-1", "Room", "creator-1", LocalDateTime.now(),
            new java.util.LinkedHashSet<>(List.of("creator-1")));
        User creator = user("creator-1", "Creator", "creator@test.com");
        when(roomRepository.findById("room-1")).thenReturn(java.util.Optional.of(room));
        when(userRepository.findSummariesByIdIn(anySet())).thenReturn(List.of(creator));

        RoomResponse response = roomService.joinRoom("room-1", null, "creator-1");

        assertEquals(true, ReflectionTestUtils.getField(response, "isCreator"));
        verify(roomRepository, never()).addParticipantAndReturn(any(), any());
        verify(roomRepository, never()).save(any());
        verify(userRepository, never()).findByEmail(any());
        verify(eventPublisher, never()).publishEvent(any(RoomUpdatedEvent.class));
    }

    @Test
    void joinRoom_reloadsRoomWithoutPublishingWhenConcurrentRequestAlreadyAddedParticipant() {
        Room before = room("room-1", "Room", "creator-1", LocalDateTime.now(),
            new java.util.LinkedHashSet<>(List.of("creator-1")));
        Room latest = room("room-1", "Room", "creator-1", before.getCreatedAt(),
            new java.util.LinkedHashSet<>(List.of("creator-1", "user-1")));
        User creator = user("creator-1", "Creator", "creator@test.com");
        User participant = user("user-1", "Participant", "participant@test.com");
        when(roomRepository.findById("room-1"))
            .thenReturn(java.util.Optional.of(before), java.util.Optional.of(latest));
        when(roomRepository.addParticipantAndReturn("room-1", "user-1")).thenReturn(null);
        when(userRepository.findSummariesByIdIn(anySet()))
            .thenReturn(List.of(creator, participant));

        RoomResponse response = roomService.joinRoom("room-1", null, "user-1");

        assertEquals(2, response.getParticipantsCount());
        verify(roomRepository, never()).save(any());
        verify(eventPublisher, never()).publishEvent(any(RoomUpdatedEvent.class));
    }

    private static Room room(
            String id,
            String name,
            String creator,
            LocalDateTime createdAt,
            Set<String> participants) {
        return Room.builder()
            .id(id)
            .name(name)
            .creator(creator)
            .createdAt(createdAt)
            .participantIds(participants)
            .build();
    }

    private static User user(String id, String name, String email) {
        return User.builder().id(id).name(name).email(email).build();
    }
}
