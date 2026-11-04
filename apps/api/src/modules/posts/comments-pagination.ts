export interface CommentsCursor { createdAt: string; id: string }

export function encodeCommentsCursor(cursor: CommentsCursor, viewerId: string, postId: string): string {
  return Buffer.from(JSON.stringify({ v: 1, viewerId, postId, ...cursor })).toString('base64url');
}

export function decodeCommentsCursor(value: unknown, viewerId: string, postId: string): CommentsCursor | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Con trỏ bình luận không hợp lệ.');
  try {
    const json = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(json, 'utf8').toString('base64url') !== value) throw new Error();
    const decoded = JSON.parse(json) as Record<string, unknown>;
    if (decoded.v !== 1 || decoded.viewerId !== viewerId || decoded.postId !== postId ||
        typeof decoded.createdAt !== 'string' || !Number.isFinite(Date.parse(decoded.createdAt)) || typeof decoded.id !== 'string') {
      throw new Error();
    }
    return { createdAt: new Date(decoded.createdAt).toISOString(), id: decoded.id };
  } catch { throw new Error('Con trỏ bình luận không hợp lệ.'); }
}
