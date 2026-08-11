package com.ktb.chatapp.repository;

import com.ktb.chatapp.model.Room;

public interface RoomRepositoryCustom {

    Room addParticipantAndReturn(String roomId, String userId);
}
