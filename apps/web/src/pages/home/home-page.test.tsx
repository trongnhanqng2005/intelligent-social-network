import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './home-page';

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/api');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('HomePage', () => {
  it('shows the foundation and reflects a valid live health response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }));
    render(
      <StrictMode>
        <HomePage />
      </StrictMode>,
    );

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'A foundation to build on.',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('region', { name: 'API connection' }),
    ).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Checking API connection.',
    );

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'The API is responding normally.',
      );
    });
    expect(screen.getByText('Connected')).toBeVisible();
  });

  it('shows a useful failure and lets the user retry successfully', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('network detail'))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }));
    const user = userEvent.setup();
    render(<HomePage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The API could not be reached. Check that the backend is running.',
    );

    await user.click(screen.getByRole('button', { name: 'Retry connection' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'The API is responding normally.',
      );
    });
    expect(screen.getByText('Connected')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Retry connection' }),
    ).not.toBeInTheDocument();
  });
});
