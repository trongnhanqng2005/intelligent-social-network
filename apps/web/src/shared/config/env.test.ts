import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiBaseUrl, resolveApiUrl } from './env';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('API environment configuration', () => {
  it('defaults to the relative development proxy path', () => {
    vi.stubEnv('VITE_API_BASE_URL', '');

    expect(getApiBaseUrl()).toBe('/api');
  });

  it('trims whitespace and trailing slashes from the configured base', () => {
    vi.stubEnv('VITE_API_BASE_URL', '  https://api.example.test/v1///  ');

    expect(getApiBaseUrl()).toBe('https://api.example.test/v1');
  });

  it('joins relative and absolute bases without duplicate separators', () => {
    expect(resolveApiUrl('/health', '/api/')).toBe('/api/health');
    expect(resolveApiUrl('/health', 'https://api.example.test/v1/')).toBe(
      'https://api.example.test/v1/health',
    );
  });

  it('rejects an empty endpoint path', () => {
    expect(() => resolveApiUrl('  ', '/api')).toThrow(
      'API request path must not be empty',
    );
  });
});
