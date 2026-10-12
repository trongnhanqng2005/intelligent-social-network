import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from './app-routes';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('application routes', () => {
  it('renders the home page at /', () => {
    renderAt('/');

    expect(
      screen.getByRole('heading', { level: 1, name: 'A foundation to build on.' }),
    ).toBeVisible();
  });

  it('renders a not-found page for unknown routes', () => {
    renderAt('/unrecognized');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible();
  });
});
