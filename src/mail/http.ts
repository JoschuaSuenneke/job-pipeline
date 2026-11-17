// Small fetch helpers shared by the OAuth providers: timeouts, form posts, typed JSON, token bookkeeping.
import type { SecretStore } from "./secrets.ts";
import { getJson, setJson } from "./secrets.ts";

export const TIMEOUT_MS = 30_000;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
  ) {
    // Only the start of the body: provider errors can be long, and never contain our secrets.
    super(`HTTP ${status} ${path}: ${body.slice(0, 300)}`);
  }
}

/** JSON request with a timeout; throws HttpError on non-2xx. */
export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, new URL(url).pathname, text);
  return (text ? JSON.parse(text) : null) as T;
}

/** POST application/x-www-form-urlencoded. Returns status and parsed body without throwing. */
export async function postForm<T>(
  url: string,
  form: Record<string, string>,
): Promise<{ ok: boolean; data: T }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as T };
}

export interface StoredToken {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope: string;
}

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Converts a token endpoint response into a stored token, keeping the old refresh token if none is returned. */
export function toStoredToken(r: TokenResponse, previous?: StoredToken | null): StoredToken {
  if (!r.access_token)
    throw new Error(`token request failed: ${r.error ?? "unknown"} ${r.error_description ?? ""}`.trim());
  const refreshToken = r.refresh_token ?? previous?.refreshToken;
  if (!refreshToken)
    throw new Error("no refresh token returned; re-run the mail setup and grant offline access");
  return {
    accessToken: r.access_token,
    refreshToken,
    expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000,
    scope: r.scope ?? previous?.scope ?? "",
  };
}

/** Returns a valid access token, refreshing it one minute before expiry. */
export async function validAccessToken(
  store: SecretStore,
  key: string,
  refresh: (refreshToken: string) => Promise<TokenResponse>,
): Promise<string> {
  const token = getJson<StoredToken>(store, key);
  if (!token) throw new Error("mail is not connected; run `job-pipeline mail setup`");
  if (token.expiresAt - 60_000 > Date.now()) return token.accessToken;
  const next = toStoredToken(await refresh(token.refreshToken), token);
  setJson(store, key, next);
  return next.accessToken;
}

/** base64url without padding, as used by PKCE and the Gmail API. */
export function base64url(input: Uint8Array | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
