import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomId } from '../useRoomId';

const navigationMocks = vi.hoisted(() => ({
  useParams: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: navigationMocks.useParams,
}));

describe('useRoomId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('decodes an encoded room id from the route', () => {
    navigationMocks.useParams.mockReturnValue({
      room: 'room-join-exp2-20260811%3Aroom%3A1%3A0',
    });

    const { result } = renderHook(() => useRoomId());

    expect(result.current).toBe('room-join-exp2-20260811:room:1:0');
  });

  it('keeps an unencoded room id unchanged', () => {
    navigationMocks.useParams.mockReturnValue({ room: 'room-1' });

    const { result } = renderHook(() => useRoomId());

    expect(result.current).toBe('room-1');
  });

  it('keeps malformed route encoding unchanged', () => {
    navigationMocks.useParams.mockReturnValue({ room: 'room%invalid' });

    const { result } = renderHook(() => useRoomId());

    expect(result.current).toBe('room%invalid');
  });
});
