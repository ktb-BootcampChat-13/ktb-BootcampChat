package com.ktb.chatapp.service;

import com.ktb.chatapp.exception.InvalidRoomCursorException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.Base64;
import org.bson.types.ObjectId;

final class RoomCursorCodec {

    private static final String VERSION = "v1";

    private RoomCursorCodec() {
    }

    static String encode(LocalDateTime createdAt, String id) {
        if (createdAt == null || !ObjectId.isValid(id)) {
            throw new InvalidRoomCursorException();
        }
        String payload = String.join("|", VERSION, createdAt.toString(), id);
        return Base64.getUrlEncoder().withoutPadding()
            .encodeToString(payload.getBytes(StandardCharsets.UTF_8));
    }

    static Cursor decode(String cursor) {
        if (cursor == null || cursor.isBlank()) return null;
        try {
            String payload = new String(
                Base64.getUrlDecoder().decode(cursor),
                StandardCharsets.UTF_8
            );
            String[] parts = payload.split("\\|", -1);
            if (parts.length != 3 || !VERSION.equals(parts[0]) || !ObjectId.isValid(parts[2])) {
                throw new InvalidRoomCursorException();
            }
            return new Cursor(LocalDateTime.parse(parts[1]), parts[2]);
        } catch (InvalidRoomCursorException exception) {
            throw exception;
        } catch (IllegalArgumentException | DateTimeParseException exception) {
            throw new InvalidRoomCursorException(exception);
        }
    }

    record Cursor(LocalDateTime createdAt, String id) {
    }
}
