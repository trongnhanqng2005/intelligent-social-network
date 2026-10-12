const DEFAULT_API_BASE_URL = '/api';

export function getApiBaseUrl(
  value: string | undefined = import.meta.env.VITE_API_BASE_URL,
): string {
  const normalizedValue = value?.trim().replace(/\/+$/, '');
  return normalizedValue || DEFAULT_API_BASE_URL;
}

export function resolveApiUrl(
  path: string,
  baseUrl: string = getApiBaseUrl(),
): string {
  const normalizedPath = path.trim().replace(/^\/+/, '');
  if (!normalizedPath) {
    throw new Error('API request path must not be empty');
  }

  const normalizedBase = baseUrl.trim().replace(/\/+$/, '');
  return normalizedBase
    ? `${normalizedBase}/${normalizedPath}`
    : `/${normalizedPath}`;
}
