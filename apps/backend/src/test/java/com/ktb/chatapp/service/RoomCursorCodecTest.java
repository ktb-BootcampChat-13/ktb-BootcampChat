package com.ktb.chatapp.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.time.LocalDateTime;
import com.ktb.chatapp.exception.InvalidRoomCursorException;
import org.junit.jupiter.api.Test;

class RoomCursorCodecTest {

    @Test
    void roundTripsVersionedCursor() {
        LocalDateTime createdAt = LocalDateTime.of(2026, 8, 12, 10, 30, 15, 123_000_000);
        String id = "507f1f77bcf86cd799439011";

        RoomCursorCodec.Cursor decoded = RoomCursorCodec.decode(RoomCursorCodec.encode(createdAt, id));

        assertEquals(createdAt, decoded.createdAt());
        assertEquals(id, decoded.id());
    }

    @Test
    void rejectsInvalidCursorPayload() {
        assertThrows(InvalidRoomCursorException.class, () -> RoomCursorCodec.decode("broken"));
        assertThrows(InvalidRoomCursorException.class,
            () -> RoomCursorCodec.encode(LocalDateTime.now(), "not-an-object-id"));
    }
}
