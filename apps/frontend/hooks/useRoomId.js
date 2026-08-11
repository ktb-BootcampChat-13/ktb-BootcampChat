import { useParams } from 'next/navigation';

export const useRoomId = () => {
  const roomId = useParams()?.room;

  if (typeof roomId !== 'string') {
    return roomId;
  }

  try {
    return decodeURIComponent(roomId);
  } catch {
    // 잘못 인코딩된 경로는 원본을 유지해 기존 오류 처리 흐름에 맡긴다.
    return roomId;
  }
};

export default useRoomId;
