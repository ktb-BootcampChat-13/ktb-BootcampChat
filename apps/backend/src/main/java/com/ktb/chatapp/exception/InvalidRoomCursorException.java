package com.ktb.chatapp.exception;

public class InvalidRoomCursorException extends RuntimeException {

    public InvalidRoomCursorException() {
        super("INVALID_CURSOR");
    }

    public InvalidRoomCursorException(Throwable cause) {
        super("INVALID_CURSOR", cause);
    }
}
