import { useState, useCallback, useRef } from 'react';
import axiosInstance from '@/services/axios';
import { CONNECTION_STATUS } from './useServerConnection';

export const ROOM_LIST_STATUS = {
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
};

const ROOM_PAGE_SIZE = 30;

export const useRoomList = ({
  currentUser,
  router,
  connectionStatus,
  isRetrying,
}) => {
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState(null);
  const [navigationTarget, setNavigationTarget] = useState(null);
  const [listStatus, setListStatus] = useState(ROOM_LIST_STATUS.LOADING);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasNewRooms, setHasNewRooms] = useState(false);

  const isLoadingRef = useRef(false);

  const handleFetchError = useCallback((error) => {
    let errorMessage = '채팅방 목록을 불러오는데 실패했습니다.';
    let errorType = 'danger';
    let showRetry = !isRetrying;

    if (error.code === 'AUTH_EXPIRED' || error.message === 'AUTH_EXPIRED') {
      errorMessage = '인증이 만료되었습니다. 다시 로그인해주세요.';
      errorType = 'danger';
      showRetry = false;

      setError({
        title: '인증 만료',
        message: errorMessage,
        type: errorType,
        showRetry,
      });

      setListStatus(ROOM_LIST_STATUS.ERROR);
      return;
    }

    if (error.message === 'SERVER_UNREACHABLE') {
      errorMessage = '서버와 연결할 수 없습니다. 다시 시도해주세요.';
      errorType = 'warning';
      showRetry = true;
    }

    setError({
      title: '채팅방 목록 로드 실패',
      message: errorMessage,
      type: errorType,
      showRetry,
    });

    setListStatus(ROOM_LIST_STATUS.ERROR);
  }, [isRetrying]);

  const loadRooms = useCallback(async ({ cursor = null, append = false } = {}) => {
    const response = await axiosInstance.get('/api/rooms', {
      params: { size: ROOM_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
      maxRetries: 0,
    });

    if (response?.data?.success !== true || !Array.isArray(response?.data?.data)) {
      throw new Error('INVALID_RESPONSE');
    }
    const receivedRooms = response.data.data.slice(0, ROOM_PAGE_SIZE);

    if (append) {
      setRooms((currentRooms) => {
        const knownIds = new Set(currentRooms.map((room) => room._id));
        return [...currentRooms, ...receivedRooms.filter((room) => !knownIds.has(room._id))];
      });
    } else {
      setRooms(receivedRooms);
    }
    setNextCursor(response.data.metadata?.nextCursor || null);
    setHasMore(Boolean(response.data.metadata?.hasMore));
    setListStatus(ROOM_LIST_STATUS.READY);
  }, []);

  const fetchRooms = useCallback(async () => {
    if (!currentUser?.token || isLoadingRef.current) {
      return;
    }

    try {
      isLoadingRef.current = true;

      setLoading(true);
      setListStatus(ROOM_LIST_STATUS.LOADING);
      setError(null);

      await loadRooms();
      setHasNewRooms(false);

      if (isInitialLoad) {
        setIsInitialLoad(false);
      }
    } catch (error) {
      handleFetchError(error);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, [currentUser, isInitialLoad, loadRooms, handleFetchError]);

  /**
   * 이미 그려진 목록을 유지한 채 다시 조회한다.
   * 자동 갱신(silent)은 실패해도 화면을 흔들지 않고 다음 주기를 기다린다.
   */
  const refreshRooms = useCallback(async ({ silent = false } = {}) => {
    if (!currentUser?.token || isLoadingRef.current) {
      return false;
    }

    try {
      isLoadingRef.current = true;
      setRefreshing(true);

      await loadRooms();
      setHasNewRooms(false);
      setError(null);

      return true;
    } catch (error) {
      if (!silent) {
        setError({
          title: '채팅방 목록 갱신 실패',
          message: '목록을 갱신하지 못했습니다. 잠시 후 다시 시도해주세요.',
          type: 'warning',
          showRetry: false,
        });
      }

      return false;
    } finally {
      setRefreshing(false);
      isLoadingRef.current = false;
    }
  }, [currentUser, loadRooms]);

  const loadMoreRooms = useCallback(async () => {
    if (!currentUser?.token || !hasMore || !nextCursor || loadingMore) return false;
    try {
      setLoadingMore(true);
      await loadRooms({ cursor: nextCursor, append: true });
      return true;
    } catch (error) {
      setError({
        title: '채팅방 추가 로드 실패',
        message: '다음 채팅방 목록을 불러오지 못했습니다.',
        type: 'warning',
        showRetry: false,
      });
      return false;
    } finally {
      setLoadingMore(false);
    }
  }, [currentUser, hasMore, nextCursor, loadingMore, loadRooms]);

  const handleJoinRoom = useCallback(async (roomId) => {
    if (connectionStatus !== CONNECTION_STATUS.CONNECTED) {
      setError({
        title: '채팅방 입장 실패',
        message: '서버와 연결이 끊어져 있습니다.',
        type: 'danger',
      });
      return;
    }

    setJoiningRoom(true);
    setJoiningRoomId(roomId);
    setNavigationTarget(null);

    try {
      const response = await axiosInstance.post(`/api/rooms/${roomId}/join`, {});

      if (response.data.success) {
        setNavigationTarget(roomId);
        router.push(`/chat/${roomId}`);
      } else {
        throw new Error('INVALID_RESPONSE');
      }
    } catch (error) {
      let errorMessage = '입장에 실패했습니다.';
      const status = error.status ?? error.response?.status;
      if (status === 404) {
        errorMessage = '채팅방을 찾을 수 없습니다.';
      } else if (status === 403) {
        errorMessage = '채팅방 입장 권한이 없습니다.';
      }

      setError({
        title: '채팅방 입장 실패',
        message: error.data?.message || error.response?.data?.message || errorMessage,
        type: 'danger',
      });
    } finally {
      setJoiningRoom(false);
      setJoiningRoomId(null);
    }
  }, [connectionStatus, router]);

  return {
    rooms,
    setRooms,
    error,
    setError,
    loading,
    refreshing,
    joiningRoom,
    joiningRoomId,
    navigationTarget,
    listStatus,
    hasMore,
    loadingMore,
    hasNewRooms,
    setHasNewRooms,
    fetchRooms,
    refreshRooms,
    loadMoreRooms,
    handleJoinRoom,
  };
};

export default useRoomList;
