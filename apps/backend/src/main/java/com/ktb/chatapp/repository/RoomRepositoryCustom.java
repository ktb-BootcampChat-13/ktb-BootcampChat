package com.ktb.chatapp.repository;

import com.ktb.chatapp.model.Room;
import java.time.LocalDateTime;
import java.util.List;

public interface RoomRepositoryCustom {

    Room addParticipantAndReturn(String roomId, String userId);

    List<Room> findPage(LocalDateTime cursorCreatedAt, String cursorId, int limit);
}
