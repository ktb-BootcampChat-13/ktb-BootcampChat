package com.ktb.chatapp.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ktb.chatapp.dto.RoomsResponse;
import com.ktb.chatapp.dto.StandardResponse;
import com.ktb.chatapp.repository.UserRepository;
import com.ktb.chatapp.service.RecentMessageCounter;
import com.ktb.chatapp.service.RoomService;
import com.ktb.chatapp.exception.InvalidRoomCursorException;
import java.security.Principal;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;

@ExtendWith(MockitoExtension.class)
class RoomControllerPaginationTest {

    @Mock private UserRepository userRepository;
    @Mock private RecentMessageCounter recentMessageCounter;
    @Mock private RoomService roomService;

    private RoomController controller;

    @BeforeEach
    void setUp() {
        controller = new RoomController(userRepository, recentMessageCounter, roomService);
    }

    @Test
    void forwardsValidatedPageRequest() {
        RoomsResponse rooms = RoomsResponse.builder().success(true).data(List.of()).build();
        when(roomService.getAllRooms("viewer@test.com", 30, "cursor")).thenReturn(rooms);

        ResponseEntity<?> response = controller.getAllRooms(principal(), "30", "cursor");

        assertEquals(200, response.getStatusCode().value());
        verify(roomService).getAllRooms("viewer@test.com", 30, "cursor");
    }

    @Test
    void rejectsOutOfRangePageSize() {
        ResponseEntity<?> response = controller.getAllRooms(principal(), "101", null);

        assertEquals(400, response.getStatusCode().value());
        assertEquals("INVALID_PAGE_SIZE", ((StandardResponse<?>) response.getBody()).getCode());
    }

    @Test
    void mapsMalformedCursorToBadRequest() {
        when(roomService.getAllRooms("viewer@test.com", 30, "broken"))
            .thenThrow(new InvalidRoomCursorException());

        ResponseEntity<?> response = controller.getAllRooms(principal(), "30", "broken");

        assertEquals(400, response.getStatusCode().value());
        assertEquals("INVALID_CURSOR", ((StandardResponse<?>) response.getBody()).getCode());
    }

    private static Principal principal() {
        return () -> "viewer@test.com";
    }
}
