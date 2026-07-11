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
