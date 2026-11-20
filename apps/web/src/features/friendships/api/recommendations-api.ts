import { resolveApiUrl } from '../../../shared/config/env';

export type FriendRecommendation = {
  id: string; displayName: string; bio: string | null; location: string | null; mutualFriendCount: number;
};

export async function getFriendRecommendations(signal?: AbortSignal): Promise<FriendRecommendation[]> {
  const response = await fetch(resolveApiUrl('/friendships/recommendations'), {
    credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Không thể tải gợi ý kết bạn.');
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('items' in body) || !Array.isArray(body.items)) throw new Error('Phản hồi gợi ý không hợp lệ.');
  return body.items as FriendRecommendation[];
}
