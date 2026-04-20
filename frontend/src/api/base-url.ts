const CONNECTION_STORAGE_KEY = 'informeer-connection';

/**
 * API base URL resolution. In production the PWA is served from the same origin
 * as the API, so all calls use relative `/v1` paths. The stored server URL and
 * VITE_API_URL env var provide overrides for development and split deploys.
 */

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function normalizeServerUrlInternal(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Please enter a full server URL, for example http://localhost:3011');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Server URL must use http or https');
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
  const pathSuffix = normalizedPath && normalizedPath !== '/' ? normalizedPath : '';
  return `${parsed.origin}${pathSuffix}`;
}

function ensureApiPrefix(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function getDefaultServerUrl(): string | null {
  const configuredUrl = import.meta.env.VITE_API_URL?.trim();
  if (!configuredUrl) {
    return null;
  }

  try {
    return normalizeServerUrlInternal(configuredUrl);
  } catch {
    console.warn('Ignoring invalid VITE_API_URL value.');
    return null;
  }
}

export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }
  return normalizeServerUrlInternal(trimmed);
}

export function getStoredServerUrl(): string {
  if (!canUseLocalStorage()) {
    return '';
  }

  try {
    const raw = window.localStorage.getItem(CONNECTION_STORAGE_KEY);
    if (!raw) {
      return '';
    }

    const parsed = JSON.parse(raw) as { serverUrl?: string };
    return parsed.serverUrl ? normalizeServerUrl(parsed.serverUrl) : '';
  } catch {
    return '';
  }
}

export function setStoredServerUrl(serverUrl: string): void {
  if (!canUseLocalStorage()) {
    return;
  }

  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized) {
    window.localStorage.removeItem(CONNECTION_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(CONNECTION_STORAGE_KEY, JSON.stringify({ serverUrl: normalized }));
}

export function getConfiguredServerUrl(): string {
  return getStoredServerUrl() || getDefaultServerUrl() || '';
}

export function getApiBaseUrl(): string {
  const configuredUrl = getConfiguredServerUrl();
  if (configuredUrl) {
    return ensureApiPrefix(configuredUrl);
  }

  return '/v1';
}

export function buildApiUrl(path: string): string {
  return `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

export function buildBackendUrl(path: string): string {
  const configuredUrl = getConfiguredServerUrl();
  if (!configuredUrl) {
    return path;
  }
  return `${configuredUrl}${path.startsWith('/') ? path : `/${path}`}`;
}