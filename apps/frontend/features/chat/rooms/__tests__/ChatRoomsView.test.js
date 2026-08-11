import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatRoomsView from '../ChatRoomsView';
import { CONNECTION_STATUS } from '../useServerConnection';

const mocks = vi.hoisted(() => ({
  connectionStatus: 'checking',
  error: null,
  listStatus: 'ready',
  rooms: [],
  fetchRooms: vi.fn(() => Promise.resolve()),
  refreshRooms: vi.fn(() => Promise.resolve(true)),
  attemptConnection: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      token: 'token-1',
    },
  }),
}));

vi.mock('../useServerConnection', async () => {
  const actual = await vi.importActual('../useServerConnection');
  return {
    ...actual,
    useServerConnection: () => ({
      connectionStatus: mocks.connectionStatus,
      setConnectionStatus: vi.fn(),
      retryCount: 0,
      setRetryCount: vi.fn(),
      isRetrying: false,
      setIsRetrying: vi.fn(),
      getRetryDelay: vi.fn(() => 1000),
      attemptConnection: mocks.attemptConnection,
    }),
  };
});

vi.mock('../useRoomList', () => ({
  ROOM_LIST_STATUS: { LOADING: 'loading', READY: 'ready', ERROR: 'error' },
  useRoomList: () => ({
    rooms: mocks.rooms,
    setRooms: vi.fn(),
    error: mocks.error,
    loading: false,
    refreshing: false,
    joiningRoom: false,
    joiningRoomId: null,
    navigationTarget: null,
    listStatus: mocks.listStatus,
    hasMore: false,
    loadingMore: false,
    hasNewRooms: false,
    setHasNewRooms: vi.fn(),
    fetchRooms: mocks.fetchRooms,
    refreshRooms: mocks.refreshRooms,
    loadMoreRooms: vi.fn(),
    handleJoinRoom: vi.fn(),
  }),
}));

vi.mock('../useRoomsSocket', () => ({
  useRoomsSocket: vi.fn(),
}));

describe('ChatRoomsView', () => {
  beforeEach(() => {
    mocks.connectionStatus = CONNECTION_STATUS.CHECKING;
    mocks.error = null;
    mocks.listStatus = 'ready';
    mocks.rooms = [];
    mocks.fetchRooms.mockClear();
    mocks.refreshRooms.mockClear();
    mocks.attemptConnection.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not refetch rooms when connection status changes after the initial load starts', async () => {
    const { rerender } = render(<ChatRoomsView router={{ push: vi.fn() }} />);

    await waitFor(() => {
      expect(mocks.fetchRooms).toHaveBeenCalledTimes(1);
    });

    mocks.connectionStatus = CONNECTION_STATUS.CONNECTED;
    rerender(<ChatRoomsView router={{ push: vi.fn() }} />);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.fetchRooms).toHaveBeenCalledTimes(1);
  });

  it('refreshes the room list on an interval while connected', async () => {
    mocks.connectionStatus = CONNECTION_STATUS.CONNECTED;
    vi.useFakeTimers();

    render(<ChatRoomsView router={{ push: vi.fn() }} />);

    await vi.advanceTimersByTimeAsync(30000);

    expect(mocks.refreshRooms).toHaveBeenCalledWith({ silent: true });
  });

  it('does not auto refresh while the server connection is not established', async () => {
    mocks.connectionStatus = CONNECTION_STATUS.DISCONNECTED;
    vi.useFakeTimers();

    render(<ChatRoomsView router={{ push: vi.fn() }} />);

    await vi.advanceTimersByTimeAsync(90000);

    expect(mocks.refreshRooms).not.toHaveBeenCalled();
  });

  it('catches up as soon as the tab becomes visible again', async () => {
    mocks.connectionStatus = CONNECTION_STATUS.CONNECTED;

    render(<ChatRoomsView router={{ push: vi.fn() }} />);

    await waitFor(() => {
      expect(mocks.fetchRooms).toHaveBeenCalled();
    });

    document.dispatchEvent(new Event('visibilitychange'));

    expect(mocks.refreshRooms).toHaveBeenCalledWith({ silent: true });
  });

  it('refreshes the list when the refresh button is clicked', async () => {
    mocks.connectionStatus = CONNECTION_STATUS.CONNECTED;

    render(<ChatRoomsView router={{ push: vi.fn() }} />);

    fireEvent.click(await screen.findByTestId('refresh-rooms-button'));

    expect(mocks.refreshRooms).toHaveBeenCalledTimes(1);
    expect(mocks.refreshRooms).toHaveBeenCalledWith();
  });

  it('offers reconnect instead of refresh while an error is shown', async () => {
    mocks.connectionStatus = CONNECTION_STATUS.ERROR;
    mocks.error = { title: '연결 오류', message: '서버와 연결할 수 없습니다.', type: 'danger' };

    render(<ChatRoomsView router={{ push: vi.fn() }} />);

    await waitFor(() => {
      expect(screen.getByText('재연결')).toBeTruthy();
    });

    expect(screen.queryByTestId('refresh-rooms-button')).toBeNull();
  });

  it('always reserves a stable slot for room-list states', () => {
    render(<ChatRoomsView router={{ push: vi.fn() }} />);

    expect(screen.getByTestId('rooms-content-slot')).toBeInTheDocument();
    expect(screen.getByTestId('rooms-content-slot')).toHaveAttribute('data-state', 'ready');
  });

  it('keeps the REST room list visible when the socket connection fails', () => {
    mocks.connectionStatus = CONNECTION_STATUS.ERROR;
    mocks.rooms = [{ _id: 'room-1', name: '방 1', createdAt: '2026-08-12T10:00:00' }];

    render(<ChatRoomsView router={{ push: vi.fn() }} />);

    expect(screen.getByTestId('rooms-socket-error')).toBeInTheDocument();
    expect(screen.getByTestId('join-chat-room-button')).toHaveAttribute('data-room-id', 'room-1');
  });

  it('exposes a dedicated room-list load error state', () => {
    mocks.listStatus = 'error';

    render(<ChatRoomsView router={{ push: vi.fn() }} />);

    expect(screen.getByTestId('rooms-load-error')).toBeInTheDocument();
  });
});
