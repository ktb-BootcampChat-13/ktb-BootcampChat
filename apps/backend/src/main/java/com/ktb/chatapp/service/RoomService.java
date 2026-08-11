package com.ktb.chatapp.service;

import com.ktb.chatapp.dto.*;
import com.ktb.chatapp.event.RoomCreatedEvent;
import com.ktb.chatapp.event.RoomUpdatedEvent;
import com.ktb.chatapp.model.Room;
import com.ktb.chatapp.model.User;
import com.ktb.chatapp.repository.RoomRepository;
import com.ktb.chatapp.repository.UserRepository;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Slf4j
@Service
@RequiredArgsConstructor
public class RoomService {

    private final RoomRepository roomRepository;
    private final UserRepository userRepository;
    private final RecentMessageCounter recentMessageCounter;
    private final PasswordEncoder passwordEncoder;
    private final ApplicationEventPublisher eventPublisher;
    private final MongoTemplate mongoTemplate;

    public RoomsResponse getAllRooms(String name) {

        try {
            List<Room> rooms = roomRepository.findAll();
            Set<String> userIds = rooms.stream()
                .flatMap(room -> {
                    Set<String> ids = new LinkedHashSet<>();
                    if (room.getCreator() != null) {
                        ids.add(room.getCreator());
                    }
                    if (room.getParticipantIds() != null) {
                        ids.addAll(room.getParticipantIds());
                    }
                    return ids.stream();
                })
                .collect(Collectors.toSet());
            Map<String, User> usersById = userIds.isEmpty()
                ? Map.of()
                : userRepository.findAllById(userIds).stream()
                    .filter(user -> user != null && user.getId() != null)
                    .collect(Collectors.toMap(User::getId, Function.identity()));
            Set<String> roomIds = rooms.stream()
                .map(Room::getId)
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toSet());
            Map<String, Integer> recentMessageCounts = roomIds.isEmpty()
                ? Map.of()
                : recentMessageCounter.countRecentMessages(roomIds);

            // 전체 방을 조회해 최신순으로 정렬한다
            List<RoomResponse> roomResponses = rooms.stream()
                .map(room -> mapToRoomResponse(
                    room,
                    name,
                    usersById,
                    recentMessageCounts.getOrDefault(room.getId(), 0)))
                .sorted(Comparator.comparing(
                    RoomResponse::getCreatedAtDateTime,
                    Comparator.nullsLast(Comparator.reverseOrder())))
                .collect(Collectors.toList());

            PageMetadata metadata = PageMetadata.builder()
                .total(roomResponses.size())
                .page(0)
                .pageSize(roomResponses.size())
                .totalPages(1)
                .hasMore(false)
                .currentCount(roomResponses.size())
                .build();

            return RoomsResponse.builder()
                .success(true)
                .data(roomResponses)
                .metadata(metadata)
                .build();

        } catch (Exception e) {
            log.error("방 목록 조회 에러", e);
            return RoomsResponse.builder()
                .success(false)
                .data(List.of())
                .build();
        }
    }

    public HealthResponse getHealthStatus() {
        try {
            long startTime = System.currentTimeMillis();

            // MongoDB 연결 상태 확인
            boolean isMongoConnected = false;
            long latency = 0;

            try {
                // 간단한 쿼리로 연결 상태 및 지연 시간 측정
                roomRepository.findOneForHealthCheck();
                long endTime = System.currentTimeMillis();
                latency = endTime - startTime;
                isMongoConnected = true;
            } catch (Exception e) {
                log.warn("MongoDB 연결 확인 실패", e);
                isMongoConnected = false;
            }

            // 최근 활동 조회
            LocalDateTime lastActivity = roomRepository.findMostRecentRoom()
                    .map(Room::getCreatedAt)
                    .orElse(null);

            // 서비스 상태 정보 구성
            Map<String, HealthResponse.ServiceHealth> services = new HashMap<>();
            services.put("database", HealthResponse.ServiceHealth.builder()
                .connected(isMongoConnected)
                .latency(latency)
                .build());

            return HealthResponse.builder()
                .success(true)
                .services(services)
                .lastActivity(lastActivity)
                .build();

        } catch (Exception e) {
            log.error("Health check 실행 중 에러 발생", e);
            return HealthResponse.builder()
                .success(false)
                .services(new HashMap<>())
                .build();
        }
    }

    public Room createRoom(CreateRoomRequest createRoomRequest, String name) {
        User creator = userRepository.findByEmail(name)
            .orElseThrow(() -> new RuntimeException("사용자를 찾을 수 없습니다: " + name));

        Room room = new Room();
        room.setName(createRoomRequest.getName().trim());
        room.setCreator(creator.getId());
        room.getParticipantIds().add(creator.getId());

        if (createRoomRequest.getPassword() != null && !createRoomRequest.getPassword().isEmpty()) {
            room.setHasPassword(true);
            room.setPassword(passwordEncoder.encode(createRoomRequest.getPassword()));
        }

        Room savedRoom = roomRepository.save(room);
        
        // Publish event for room created
        try {
            RoomResponse roomResponse = mapToRoomResponse(savedRoom, name);
            eventPublisher.publishEvent(new RoomCreatedEvent(this, roomResponse));
        } catch (Exception e) {
            log.error("roomCreated 이벤트 발행 실패", e);
        }
        
        return savedRoom;
    }

    public Optional<Room> findRoomById(String roomId) {
        return roomRepository.findById(roomId);
    }

    public Room joinRoom(String roomId, String password, String name) {
        User user = userRepository.findByEmail(name)
            .orElseThrow(() -> new RuntimeException("사용자를 찾을 수 없습니다: " + name));
        JoinRoomResult result = joinRoomInternal(roomId, password, user.getId());
        if (result == null) {
            return null;
        }
        publishRoomUpdatedIfParticipantAdded(roomId, name, result);
        return result.room();
    }

    private JoinRoomResult joinRoomInternal(String roomId, String password, String userId) {
        Optional<Room> roomOpt = roomRepository.findById(roomId);
        if (roomOpt.isEmpty()) {
            return null;
        }

        Room room = roomOpt.get();
        // 비밀번호 확인
        if (room.isHasPassword()) {
            if (password == null || !passwordEncoder.matches(password, room.getPassword())) {
                throw new RuntimeException("비밀번호가 일치하지 않습니다.");
            }
        }

        if (room.getParticipantIds() != null && room.getParticipantIds().contains(userId)) {
            return new JoinRoomResult(room, false);
        }

        Query addParticipant = Query.query(Criteria.where("_id").is(roomId)
            .and("participantIds").ne(userId));
        Room updatedRoom = mongoTemplate.findAndModify(
            addParticipant,
            new Update().addToSet("participantIds", userId),
            FindAndModifyOptions.options().returnNew(true),
            Room.class);
        if (updatedRoom != null) {
            return new JoinRoomResult(updatedRoom, true);
        }

        // The room was deleted, or another concurrent request added the same participant first.
        return roomRepository.findById(roomId)
            .map(latestRoom -> new JoinRoomResult(latestRoom, false))
            .orElse(null);
    }

    public RoomResponse joinRoomResponse(String roomId, String password, String name) {
        User user = userRepository.findByEmail(name)
            .orElseThrow(() -> new RuntimeException("사용자를 찾을 수 없습니다: " + name));
        return joinRoomResponse(roomId, password, name, user.getId());
    }

    public RoomResponse joinRoomResponse(
            String roomId, String password, String name, String userId) {
        JoinRoomResult result = joinRoomInternal(roomId, password, userId);
        if (result == null) {
            return null;
        }

        RoomResponse response = mapToRoomResponse(result.room(), name);
        publishRoomUpdatedIfParticipantAdded(roomId, result, response);
        return response;
    }

    private void publishRoomUpdatedIfParticipantAdded(
            String roomId, String name, JoinRoomResult result) {
        if (!result.participantAdded()) {
            return;
        }
        publishRoomUpdatedIfParticipantAdded(roomId, result, mapToRoomResponse(result.room(), name));
    }

    private void publishRoomUpdatedIfParticipantAdded(
            String roomId, JoinRoomResult result, RoomResponse response) {
        if (!result.participantAdded()) {
            return;
        }
        try {
            eventPublisher.publishEvent(new RoomUpdatedEvent(this, roomId, response));
        } catch (Exception e) {
            log.error("roomUpdate 이벤트 발행 실패", e);
        }
    }

    private RoomResponse mapToRoomResponse(Room room, String name) {
        if (room == null) return null;

        Set<String> userIds = new LinkedHashSet<>();
        if (room.getCreator() != null) {
            userIds.add(room.getCreator());
        }
        if (room.getParticipantIds() != null) {
            userIds.addAll(room.getParticipantIds());
        }
        Query usersQuery = Query.query(Criteria.where("_id").in(userIds));
        usersQuery.fields()
            .include("_id")
            .include("name")
            .include("email")
            .include("profileImage");
        Map<String, User> usersById = userIds.isEmpty()
            ? Map.of()
            : mongoTemplate.find(usersQuery, User.class).stream()
                .filter(user -> user != null && user.getId() != null)
                .collect(Collectors.toMap(User::getId, Function.identity()));
        User creator = room.getCreator() != null ? usersById.get(room.getCreator()) : null;
        List<User> participants = room.getParticipantIds() == null
            ? List.of()
            : room.getParticipantIds().stream()
                .map(usersById::get)
                .filter(java.util.Objects::nonNull)
                .toList();

        int recentMessageCount = recentMessageCounter.countRecentMessages(room.getId());

        return buildRoomResponse(room, name, creator, participants, recentMessageCount);
    }

    private RoomResponse mapToRoomResponse(
            Room room,
            String name,
            Map<String, User> usersById,
            int recentMessageCount) {
        if (room == null) return null;

        User creator = room.getCreator() != null ? usersById.get(room.getCreator()) : null;
        List<User> participants = room.getParticipantIds() == null
            ? List.of()
            : room.getParticipantIds().stream()
                .map(usersById::get)
                .filter(java.util.Objects::nonNull)
                .toList();

        return buildRoomResponse(room, name, creator, participants, recentMessageCount);
    }

    private RoomResponse buildRoomResponse(
            Room room,
            String name,
            User creator,
            List<User> participants,
            int recentMessageCount) {
        return RoomResponse.builder()
            .id(room.getId())
            .name(room.getName() != null ? room.getName() : "제목 없음")
            .hasPassword(room.isHasPassword())
            .creator(creator != null ? UserResponse.builder()
                .id(creator.getId())
                .name(creator.getName() != null ? creator.getName() : "알 수 없음")
                .email(creator.getEmail() != null ? creator.getEmail() : "")
                .build() : null)
            .participants(participants.stream()
                .filter(p -> p != null && p.getId() != null)
                .map(p -> UserResponse.builder()
                    .id(p.getId())
                    .name(p.getName() != null ? p.getName() : "알 수 없음")
                    .email(p.getEmail() != null ? p.getEmail() : "")
                    .build())
                .collect(Collectors.toList()))
            .createdAtDateTime(room.getCreatedAt())
            .isCreator(creator != null && creator.getId().equals(name))
            .recentMessageCount(recentMessageCount)
            .build();
    }

    private record JoinRoomResult(Room room, boolean participantAdded) {}
}
