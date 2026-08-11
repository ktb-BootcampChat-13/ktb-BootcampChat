import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axiosInstance from '@/services/axios';
import { ROOM_LIST_STATUS, useRoomList } from '../useRoomList';
import { CONNECTION_STATUS } from '../useServerConnection';

vi.mock('@/services/axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const roomsResponse = (rooms, metadata = {}) => ({
  data: { success: true, data: rooms, metadata },
});

const renderRoomList = (overrides = {}) =>
  renderHook(() => {
    const props = {
      currentUser: { token: 'token-1' },
      router: { push: vi.fn() },
      connectionStatus: CONNECTION_STATUS.CONNECTED,
      setConnectionStatus: vi.fn(),
      retryCount: 0,
      setRetryCount: vi.fn(),
      isRetrying: false,
      setIsRetrying: vi.fn(),
      getRetryDelay: vi.fn(() => 1000),
      attemptConnection: vi.fn(() => Promise.resolve(true)),
      ...overrides,
    };
    return useRoomList(props);
  });

describe('useRoomList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads rooms directly without a redundant health preflight', async () => {
    const attemptConnection = vi.fn(() => Promise.resolve(true));
    const setConnectionStatus = vi.fn();
    axiosInstance.get.mockResolvedValue(roomsResponse([]));

    const { result } = renderRoomList({ attemptConnection, setConnectionStatus });

    await act(async () => {
      await result.current.fetchRooms();
    });

    expect(attemptConnection).not.toHaveBeenCalled();
    expect(axiosInstance.get).toHaveBeenCalledWith('/api/rooms', {
      params: { size: 30 },
      maxRetries: 0,
    });
    expect(setConnectionStatus).not.toHaveBeenCalled();
    expect(result.current.listStatus).toBe(ROOM_LIST_STATUS.READY);
  });

  it('replaces the list on refresh without leaving the refreshing flag on', async () => {
    axiosInstance.get.mockResolvedValue(roomsResponse([{ _id: 'room-1' }]));

    const { result } = renderRoomList();

    await act(async () => {
      await result.current.refreshRooms();
    });

    expect(result.current.rooms).toEqual([{ _id: 'room-1' }]);
    expect(result.current.refreshing).toBe(false);
  });

  it('keeps the current list and stays quiet when a silent refresh fails', async () => {
    axiosInstance.get.mockResolvedValueOnce(roomsResponse([{ _id: 'room-1' }]));

    const { result } = renderRoomList();

    await act(async () => {
      await result.current.fetchRooms();
    });

    axiosInstance.get.mockRejectedValueOnce(new Error('SERVER_UNREACHABLE'));

    await act(async () => {
      await result.current.refreshRooms({ silent: true });
    });

    expect(result.current.rooms).toEqual([{ _id: 'room-1' }]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('surfaces a refresh failure when the user asked for it', async () => {
    axiosInstance.get.mockRejectedValue(new Error('SERVER_UNREACHABLE'));

    const { result } = renderRoomList();

    await act(async () => {
      await result.current.refreshRooms();
    });

    expect(result.current.error).toMatchObject({
      title: '채팅방 목록 갱신 실패',
      showRetry: false,
    });
  });

  it('clears a previous error once a refresh succeeds', async () => {
    axiosInstance.get.mockRejectedValueOnce(new Error('SERVER_UNREACHABLE'));

    const { result } = renderRoomList();

    await act(async () => {
      await result.current.refreshRooms();
    });

    expect(result.current.error).not.toBeNull();

    axiosInstance.get.mockResolvedValueOnce(roomsResponse([{ _id: 'room-1' }]));

    await act(async () => {
      await result.current.refreshRooms();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.rooms).toEqual([{ _id: 'room-1' }]);
  });

  it('loads the next cursor page and removes duplicate room ids', async () => {
    axiosInstance.get
      .mockResolvedValueOnce(roomsResponse(
        [{ _id: 'room-1' }, { _id: 'room-2' }],
        { hasMore: true, nextCursor: 'cursor-1' }
      ))
      .mockResolvedValueOnce(roomsResponse(
        [{ _id: 'room-2' }, { _id: 'room-3' }],
        { hasMore: false, nextCursor: null }
      ));
    const { result } = renderRoomList();

    await act(async () => result.current.fetchRooms());
    await act(async () => result.current.loadMoreRooms());

    expect(result.current.rooms.map((room) => room._id)).toEqual(['room-1', 'room-2', 'room-3']);
    expect(axiosInstance.get).toHaveBeenLastCalledWith('/api/rooms', {
      params: { size: 30, cursor: 'cursor-1' },
      maxRetries: 0,
    });
    expect(result.current.hasMore).toBe(false);
  });

  it('rejects a success HTTP response with an unsuccessful API body', async () => {
    axiosInstance.get.mockResolvedValue({ data: { success: false, data: [] } });
    const { result } = renderRoomList();

    await act(async () => result.current.fetchRooms());

    expect(result.current.listStatus).toBe(ROOM_LIST_STATUS.ERROR);
    expect(result.current.error.title).toBe('채팅방 목록 로드 실패');
  });

  it('never renders more than one server page from an oversized response', async () => {
    axiosInstance.get.mockResolvedValue(roomsResponse(
      Array.from({ length: 900 }, (_, index) => ({ _id: `room-${index}` }))
    ));
    const { result } = renderRoomList();

    await act(async () => result.current.fetchRooms());

    expect(result.current.rooms).toHaveLength(30);
  });

  it('routes exactly once after a successful room join', async () => {
    const router = { push: vi.fn() };
    axiosInstance.post.mockResolvedValue({ data: { success: true } });
    const { result } = renderRoomList({ router });

    await act(async () => result.current.handleJoinRoom('room-1'));

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/chat/room-1');
    expect(result.current.navigationTarget).toBe('room-1');
  });

});
