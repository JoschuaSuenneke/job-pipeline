// Gmail via the user's OWN Google OAuth client (installed-app flow, loopback redirect, PKCE).
// Restricted Gmail scopes require Google's security assessment for a shared public client, so every user
// brings a "Desktop app" client from their own Google Cloud project. See docs/mail-setup.md.
import { createHash, randomBytes } from "node:crypto";
import {
  base64url,
  postForm,
  requestJson,
  type StoredToken,
  type TokenResponse,
  toStoredToken,
  validAccessToken,
} from "./http.ts";
import { buildMime } from "./mime.ts";
import { getJson, type SecretStore, setJson } from "./secrets.ts";
import type { Draft, MailMessage, MailProvider } from "./types.ts";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
export const GMAIL_CLIENT_KEY = "gmail-client";
export const GMAIL_TOKEN_KEY = "gmail-token";

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

/** Least-privilege scopes for the features the user enabled. */
export function gmailScopes(opts: { filing: boolean; drafts: boolean }): string[] {
  const scopes = [
    opts.filing
      ? "https://www.googleapis.com/auth/gmail.modify"
      : "https://www.googleapis.com/auth/gmail.readonly",
  ];
  if (opts.drafts) scopes.push("https://www.googleapis.com/auth/gmail.compose");
  return scopes;
}

/**
 * Runs the consent flow: starts a one-shot server on 127.0.0.1, prints/opens the Google URL, waits for the
 * redirect, exchanges the code (PKCE) and stores the token. Times out after five minutes.
 */
export async function authorizeGmail(
  store: SecretStore,
  client: GoogleClient,
  scopes: string[],
  openUrl: (url: string) => void,
): Promise<void> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(16));

  let resolveCode: (code: string) => void = () => undefined;
  let rejectCode: (err: Error) => void = () => undefined;
  const codePromise = new Promise<string>((res, rej) => {
    resolveCode = res;
    rejectCode = rej;
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      // Browsers also ask for /favicon.ico and similar; only the redirect itself carries code or error.
      if (!code && !error) return new Response("Not found", { status: 404 });
      if (url.searchParams.get("state") !== state || !code) {
        rejectCode(
          new Error(`consent was not completed: ${url.searchParams.get("error") ?? "state mismatch"}`),
        );
        return new Response("Consent failed. You can close this tab.", { status: 400 });
      }
      resolveCode(code);
      return new Response("Gmail is connected to job-pipeline. You can close this tab.");
    },
  });
  const redirectUri = `http://127.0.0.1:${server.port}`;
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  openUrl(`${AUTH_URL}?${params}`);
  const timer = setTimeout(() => rejectCode(new Error("timed out waiting for Google consent")), 5 * 60_000);
  try {
    const code = await codePromise;
    const { data } = await postForm<TokenResponse>(TOKEN_URL, {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
    setJson(store, GMAIL_CLIENT_KEY, client);
    setJson(store, GMAIL_TOKEN_KEY, toStoredToken(data));
  } finally {
    clearTimeout(timer);
    server.stop(true);
  }
}

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: GmailHeader[];
}
interface GmailMessage {
  id: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
}

/** First text/plain part, decoded. */
export function gmailText(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data)
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const p of part.parts ?? []) {
    const t = gmailText(p);
    if (t) return t;
  }
  return "";
}

/** Parses a "Name <addr>" header. */
export function parseAddress(value: string): { name: string; address: string } {
  const m = value.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  return m
    ? { name: (m[1] ?? "").trim(), address: (m[2] ?? "").toLowerCase() }
    : { name: "", address: value.trim().toLowerCase() };
}

export class GmailProvider implements MailProvider {
  readonly id = "gmail" as const;
  constructor(private readonly store: SecretStore) {}

  private client(): GoogleClient {
    const c = getJson<GoogleClient>(this.store, GMAIL_CLIENT_KEY);
    if (!c) throw new Error("Gmail is not connected; run `job-pipeline mail setup`");
    return c;
  }

  private async token(): Promise<string> {
    const c = this.client();
    return validAccessToken(this.store, GMAIL_TOKEN_KEY, async (refreshToken) => {
      const { data } = await postForm<TokenResponse>(TOKEN_URL, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: c.clientId,
        client_secret: c.clientSecret,
      });
      return data;
    });
  }

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json" };
    return requestJson<T>(`${API}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  }

  async listMessages(since: string): Promise<MailMessage[]> {
    const after = Math.floor(new Date(since).getTime() / 1000);
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({ q: `after:${after} -in:chats`, maxResults: "100" });
      if (pageToken) q.set("pageToken", pageToken);
      const page = await this.api<{ messages?: { id: string }[]; nextPageToken?: string }>(`/messages?${q}`);
      ids.push(...(page.messages ?? []).map((m) => m.id));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < 1000);

    const out: MailMessage[] = [];
    for (const id of ids) {
      const m = await this.api<GmailMessage>(`/messages/${id}?format=full`);
      const header = (name: string) =>
        m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
      const from = parseAddress(header("From"));
      out.push({
        id: m.id,
        receivedAt: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
        fromAddress: from.address,
        fromName: from.name,
        subject: header("Subject"),
        text: gmailText(m.payload).slice(0, 8000),
        fromSelf: (m.labelIds ?? []).includes("SENT"),
      });
    }
    return out.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  }

  private async labelId(name: string): Promise<string> {
    const { labels = [] } = await this.api<{ labels?: { id: string; name: string }[] }>("/labels");
    const found = labels.find((l) => l.name === name);
    if (found) return found.id;
    const created = await this.api<{ id: string }>("/labels", {
      method: "POST",
      body: JSON.stringify({ name, labelListVisibility: "labelShow", messageListVisibility: "show" }),
    });
    return created.id;
  }

  async moveToFolder(messageId: string, folder: string): Promise<void> {
    const label = await this.labelId(folder);
    await this.api(`/messages/${messageId}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: [label], removeLabelIds: ["INBOX"] }),
    });
  }

  async createDraft(draft: Draft): Promise<{ id: string }> {
    const profile = await this.api<{ emailAddress: string }>("/profile");
    const raw = base64url(buildMime(draft, profile.emailAddress));
    const res = await this.api<{ id: string }>("/drafts", {
      method: "POST",
      body: JSON.stringify({ message: { raw } }),
    });
    return { id: res.id };
  }

  async close(): Promise<void> {}
}

/** True when a Gmail token is stored. */
export function gmailConnected(store: SecretStore): boolean {
  return getJson<StoredToken>(store, GMAIL_TOKEN_KEY) !== null;
}
