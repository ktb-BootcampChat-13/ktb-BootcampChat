package com.ktb.chatapp.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anySet;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
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
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.ArgumentCaptor;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.security.crypto.password.PasswordEncoder;

@ExtendWith(MockitoExtension.class)
class RoomServiceTest {

    @Mock private RoomRepository roomRepository;
    @Mock private UserRepository userRepository;
    @Mock private RecentMessageCounter recentMessageCounter;
    @Mock private PasswordEncoder passwordEncoder;
    @Mock private ApplicationEventPublisher eventPublisher;
    @Mock private MongoTemplate mongoTemplate;

    private RoomService roomService;

    @BeforeEach
    void setUp() {
        roomService = new RoomService(
            roomRepository,
            userRepository,
            recentMessageCounter,
            passwordEncoder,
            eventPublisher,
            mongoTemplate
        );
    }

    @Test
    void getAllRooms_emptyList_avoidsBatchLookups() {
        when(roomRepository.findAll()).thenReturn(List.of());

        RoomsResponse response = roomService.getAllRooms("viewer@test.com");

        assertTrue(response.isSuccess());
        assertTrue(response.getData().isEmpty());
        verify(userRepository, never()).findAllById(anySet());
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
        when(userRepository.findAllById(anySet())).thenReturn(List.of(creator, participant));
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
        verify(userRepository).findAllById(anySet());
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
    void joinRoom_addsNewParticipantAndReturnsIt() {
        Room before = room("room-1", "Room", "creator-1", LocalDateTime.now(),
            new java.util.HashSet<>(Set.of("creator-1")));
        Room after = room("room-1", "Room", "creator-1", before.getCreatedAt(),
            new java.util.HashSet<>(Set.of("creator-1", "participant-1")));
        User joining = user("participant-1", "Participant", "participant@test.com");
        User creator = user("creator-1", "Creator", "creator@test.com");
        when(roomRepository.findById("room-1")).thenReturn(Optional.of(before));
        when(mongoTemplate.findAndModify(any(Query.class), any(Update.class),
            any(FindAndModifyOptions.class), any(Class.class))).thenReturn(after);
        when(mongoTemplate.find(any(Query.class), org.mockito.ArgumentMatchers.eq(User.class)))
            .thenReturn(List.of(creator, joining));

        RoomResponse response = roomService.joinRoomResponse(
            "room-1", null, joining.getEmail(), joining.getId());

        assertTrue(response.getParticipants().stream().anyMatch(p -> p.getId().equals(joining.getId())));
        verify(roomRepository, never()).save(any(Room.class));
        ArgumentCaptor<RoomUpdatedEvent> event = ArgumentCaptor.forClass(RoomUpdatedEvent.class);
        verify(eventPublisher).publishEvent(event.capture());
        assertSame(response, event.getValue().getRoomResponse());
        verify(recentMessageCounter).countRecentMessages("room-1");
        verify(userRepository, never()).findByEmail(joining.getEmail());
        ArgumentCaptor<Query> usersQuery = ArgumentCaptor.forClass(Query.class);
        verify(mongoTemplate).find(usersQuery.capture(), org.mockito.ArgumentMatchers.eq(User.class));
        assertEquals(
            org.bson.Document.parse("{'_id':1,'name':1,'email':1,'profileImage':1}"),
            usersQuery.getValue().getFieldsObject());
    }

    @Test
    void joinRoom_isIdempotentForExistingParticipant() {
        User joining = user("participant-1", "Participant", "participant@test.com");
        Room room = room("room-1", "Room", "creator-1", LocalDateTime.now(),
            new java.util.HashSet<>(Set.of("creator-1", joining.getId())));
        when(roomRepository.findById("room-1")).thenReturn(Optional.of(room));
        when(mongoTemplate.find(any(Query.class), org.mockito.ArgumentMatchers.eq(User.class)))
            .thenReturn(List.of(joining));

        roomService.joinRoomResponse("room-1", null, joining.getEmail(), joining.getId());
        roomService.joinRoomResponse("room-1", null, joining.getEmail(), joining.getId());

        assertEquals(2, room.getParticipantIds().size());
        verify(roomRepository, never()).save(any(Room.class));
        verify(eventPublisher, never()).publishEvent(any(RoomUpdatedEvent.class));
        verify(mongoTemplate, never()).findAndModify(any(Query.class), any(Update.class),
            any(FindAndModifyOptions.class), any(Class.class));
    }

    @Test
    void joinRoom_rejectsWrongPassword() {
        Room room = room("room-1", "Private", "creator-1", LocalDateTime.now(),
            new java.util.HashSet<>(Set.of("creator-1")));
        room.setHasPassword(true);
        room.setPassword("encoded");
        User joining = user("participant-1", "Participant", "participant@test.com");
        when(roomRepository.findById("room-1")).thenReturn(Optional.of(room));
        when(userRepository.findByEmail(joining.getEmail())).thenReturn(Optional.of(joining));
        when(passwordEncoder.matches("wrong", "encoded")).thenReturn(false);

        RuntimeException error = assertThrows(RuntimeException.class,
            () -> roomService.joinRoom("room-1", "wrong", joining.getEmail()));

        assertTrue(error.getMessage().contains("\uBE44\uBC00\uBC88\uD638"));
        verify(mongoTemplate, never()).findAndModify(any(Query.class), any(Update.class),
            any(FindAndModifyOptions.class), any(Class.class));
    }

    @Test
    void joinRoom_returnsNullForMissingRoom() {
        when(roomRepository.findById("missing")).thenReturn(Optional.empty());

        assertNull(roomService.joinRoomResponse(
            "missing", null, "participant@test.com", "participant-1"));
        verify(userRepository, never()).findByEmail("participant@test.com");
    }

    @Test
    void joinRoom_returnsNullWhenRoomDisappearsBeforeAtomicUpdate() {
        Room room = room("room-1", "Room", "creator-1", LocalDateTime.now(),
            new java.util.HashSet<>(Set.of("creator-1")));
        User joining = user("participant-1", "Participant", "participant@test.com");
        when(roomRepository.findById("room-1"))
            .thenReturn(Optional.of(room), Optional.empty());
        when(mongoTemplate.findAndModify(any(Query.class), any(Update.class),
            any(FindAndModifyOptions.class), any(Class.class))).thenReturn(null);

        assertNull(roomService.joinRoomResponse(
            "room-1", null, joining.getEmail(), joining.getId()));

        verify(roomRepository, times(2)).findById("room-1");
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
