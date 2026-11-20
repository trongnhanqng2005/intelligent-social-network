import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecommendationsPage } from './recommendations-page';

const fetchMock = vi.fn<typeof fetch>();
vi.mock('./friendship-actions', () => ({
  FriendshipActions: ({ onRelationshipChanged }: { onRelationshipChanged(): void }) =>
    <button onClick={onRelationshipChanged}>Mock friendship action</button>,
}));
function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body) } as unknown as Response;
}
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('recommendations page', () => {
  it('shows explainable mutual-friend recommendations, profile links, and refetches after a mutation', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(response(200, { items: [{ id: 'member-1', displayName: 'Mai', bio: 'Xin chào', location: 'Huế', mutualFriendCount: 3 }] }))
      .mockResolvedValueOnce(response(200, { items: [{ id: 'member-1', displayName: 'Mai', bio: 'Xin chào', location: 'Huế', mutualFriendCount: 3 }] }));
    render(<MemoryRouter><RecommendationsPage /></MemoryRouter>);
    expect(await screen.findByText('3 bạn chung')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Mai' })).toHaveAttribute('href', '/thanh-vien/member-1');
    await user.click(screen.getByRole('button', { name: 'Mock friendship action' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
