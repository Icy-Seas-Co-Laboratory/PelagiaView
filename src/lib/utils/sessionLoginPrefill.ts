export type SessionLoginPrefill = {
  endpoint?: string;
  username?: string;
  password?: string;
};

const endpointKeys = ['server', 'serverUrl', 'server_url', 'endpoint', 'url', 'baseUrl', 'base_url'];
const usernameKeys = ['username', 'user'];
const passwordKeys = ['password', 'pass'];

export function sessionLoginPrefillFromUrl(url: URL): SessionLoginPrefill {
  const params = mergedLoginParams(url);
  return {
    endpoint: firstParam(params, endpointKeys),
    username: firstParam(params, usernameKeys),
    password: firstParam(params, passwordKeys)
  };
}

export function hasSessionLoginPrefill(url: URL): boolean {
  const prefill = sessionLoginPrefillFromUrl(url);
  return Boolean(prefill.endpoint || prefill.username || prefill.password);
}

export function scrubSessionLoginPrefillFromCurrentUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  let changed = false;

  for (const key of loginParamKeys()) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }

  const scrubbedHash = scrubHashParams(url.hash);
  if (scrubbedHash !== url.hash) {
    url.hash = scrubbedHash;
    changed = true;
  }

  if (changed) {
    window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
  }
}

function mergedLoginParams(url: URL): URLSearchParams {
  const params = new URLSearchParams(url.search);
  const hashParams = paramsFromHash(url.hash);
  for (const [key, value] of hashParams.entries()) {
    if (!params.has(key)) params.set(key, value);
  }
  return params;
}

function paramsFromHash(hash: string): URLSearchParams {
  const raw = hash.replace(/^#/, '');
  if (!raw) return new URLSearchParams();
  const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw;
  return new URLSearchParams(query);
}

function scrubHashParams(hash: string): string {
  if (!hash) return hash;
  const raw = hash.replace(/^#/, '');
  const queryIndex = raw.indexOf('?');
  if (queryIndex < 0) return hash;
  const prefix = raw.slice(0, queryIndex);
  const params = new URLSearchParams(raw.slice(queryIndex + 1));
  let changed = false;
  for (const key of loginParamKeys()) {
    if (params.has(key)) {
      params.delete(key);
      changed = true;
    }
  }
  if (!changed) return hash;
  const query = params.toString();
  return query ? `#${prefix}?${query}` : prefix ? `#${prefix}` : '';
}

function loginParamKeys(): string[] {
  return [...endpointKeys, ...usernameKeys, ...passwordKeys];
}

function firstParam(params: URLSearchParams, keys: string): string | undefined;
function firstParam(params: URLSearchParams, keys: string[]): string | undefined;
function firstParam(params: URLSearchParams, keys: string | string[]): string | undefined {
  const candidates = Array.isArray(keys) ? keys : [keys];
  for (const key of candidates) {
    const value = params.get(key)?.trim();
    if (value) return value;
  }
  return undefined;
}
