// Outlook / Microsoft 365 via the user's OWN Entra app (device-code flow) and Microsoft Graph.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { postForm, requestJson, type TokenResponse, toStoredToken, validAccessToken } from "./http.ts";
import { getJson, type SecretStore, setJson } from "./secrets.ts";
import type { Draft, MailMessage, MailProvider } from "./types.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";
export const MS_APP_KEY = "microsoft-app";
export const MS_TOKEN_KEY = "microsoft-token";

export interface MicrosoftApp {
  clientId: string;
  /** "consumers" for outlook.com/hotmail, "organizations" or a tenant id for work accounts, "common" for both. */
  tenant: string;
  scopes: string;
}

/** Least-privilege scopes: Mail.Read unless filing or drafts are enabled. */
export function microsoftScopes(opts: { filing: boolean; drafts: boolean }): string {
  return `offline_access User.Read ${opts.filing || opts.drafts ? "Mail.ReadWrite" : "Mail.Read"}`;
}

const authority = (tenant: string) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;

interface DeviceCode {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  interval?: number;
  expires_in?: number;
  message?: string;
  error_description?: string;
}

/** Device-code sign-in: shows a code, the user enters it at microsoft.com/link, we poll for the token. */
export async function authorizeMicrosoft(
  store: SecretStore,
  app: MicrosoftApp,
  show: (message: string) => void,
): Promise<void> {
  const { ok, data } = await postForm<DeviceCode>(`${authority(app.tenant)}/devicecode`, {
    client_id: app.clientId,
    scope: app.scopes,
  });
  if (!ok || !data.device_code)
    throw new Error(`device code request failed: ${data.error_description ?? "unknown"}`);
  show(data.message ?? `Open ${data.verification_uri} and enter ${data.user_code}`);
  const deadline = Date.now() + (data.expires_in ?? 900) * 1000;
  while (Date.now() < deadline) {
    await Bun.sleep((data.interval ?? 5) * 1000);
    const r = await postForm<TokenResponse>(`${authority(app.tenant)}/token`, {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: app.clientId,
      device_code: data.device_code,
    });
    if (r.ok) {
      setJson(store, MS_APP_KEY, app);
      setJson(store, MS_TOKEN_KEY, toStoredToken(r.data));
      return;
    }
    if (r.data.error !== "authorization_pending" && r.data.error !== "slow_down") {
      throw new Error(`sign-in failed: ${r.data.error ?? "unknown"}`);
    }
  }
  throw new Error("sign-in timed out");
}

interface GraphMessage {
  id: string;
  receivedDateTime: string;
  subject?: string;
  parentFolderId?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  body?: { content?: string };
}

export class MicrosoftProvider implements MailProvider {
  readonly id = "microsoft" as const;
  private sentFolderId: string | null = null;
  private me: string | null = null;
  private folderIds = new Map<string, string>();

  constructor(private readonly store: SecretStore) {}

  private app(): MicrosoftApp {
    const a = getJson<MicrosoftApp>(this.store, MS_APP_KEY);
    if (!a) throw new Error("Outlook is not connected; run `job-pipeline mail setup`");
    return a;
  }

  private async token(): Promise<string> {
    const app = this.app();
    return validAccessToken(this.store, MS_TOKEN_KEY, async (refreshToken) => {
      const { data } = await postForm<TokenResponse>(`${authority(app.tenant)}/token`, {
        grant_type: "refresh_token",
        client_id: app.clientId,
        refresh_token: refreshToken,
        scope: app.scopes,
      });
      return data;
    });
  }

  private async graph<T>(
    path: string,
    init: RequestInit = {},
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const headers = {
      Authorization: `Bearer ${await this.token()}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    };
    return requestJson<T>(path.startsWith("http") ? path : `${GRAPH}${path}`, { ...init, headers });
  }

  async listMessages(since: string): Promise<MailMessage[]> {
    this.sentFolderId ??= (await this.graph<{ id: string }>("/me/mailFolders/sentitems?$select=id")).id;
    if (this.me === null) {
      const me = await this.graph<{ mail?: string; userPrincipalName?: string }>(
        "/me?$select=mail,userPrincipalName",
      );
      this.me = (me.mail ?? me.userPrincipalName ?? "").toLowerCase();
    }
    const select = "id,receivedDateTime,subject,from,parentFolderId,body";
    let url: string | undefined =
      `/me/messages?$filter=receivedDateTime ge ${new Date(since).toISOString()}&$orderby=receivedDateTime asc&$top=50&$select=${select}`;
    const out: MailMessage[] = [];
    while (url && out.length < 1000) {
      const page: { value: GraphMessage[]; "@odata.nextLink"?: string } = await this.graph(
        url,
        {},
        {
          Prefer: 'outlook.body-content-type="text"',
        },
      );
      for (const m of page.value) {
        const address = (m.from?.emailAddress?.address ?? "").toLowerCase();
        out.push({
          id: m.id,
          receivedAt: m.receivedDateTime,
          fromAddress: address,
          fromName: m.from?.emailAddress?.name ?? "",
          subject: m.subject ?? "",
          text: (m.body?.content ?? "").replace(/\s+/g, " ").slice(0, 8000),
          // Sent copies come from the user's own address, or an Exchange legacy DN ("/O=…") with no SMTP address.
          fromSelf:
            m.parentFolderId === this.sentFolderId ||
            (this.me !== "" && address === this.me) ||
            address.startsWith("/o="),
        });
      }
      url = page["@odata.nextLink"];
    }
    return out;
  }

  private async folderId(name: string): Promise<string> {
    const cached = this.folderIds.get(name);
    if (cached) return cached;
    const found = await this.graph<{ value: { id: string }[] }>(
      `/me/mailFolders?$filter=displayName eq '${name.replace(/'/g, "''")}'&$select=id`,
    );
    const id =
      found.value[0]?.id ??
      (
        await this.graph<{ id: string }>("/me/mailFolders", {
          method: "POST",
          body: JSON.stringify({ displayName: name }),
        })
      ).id;
    this.folderIds.set(name, id);
    return id;
  }

  async moveToFolder(messageId: string, folder: string): Promise<void> {
    await this.graph(`/me/messages/${messageId}/move`, {
      method: "POST",
      body: JSON.stringify({ destinationId: await this.folderId(folder) }),
    });
  }

  /** Creates a message in Drafts (Graph saves unsent messages as drafts). Never sends. */
  async createDraft(draft: Draft): Promise<{ id: string }> {
    const res = await this.graph<{ id: string }>("/me/messages", {
      method: "POST",
      body: JSON.stringify({
        subject: draft.subject,
        body: { contentType: "Text", content: draft.body },
        toRecipients: [{ emailAddress: { address: draft.to } }],
        attachments: draft.attachments.map((a) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: a.filename || basename(a.path),
          contentBytes: readFileSync(a.path).toString("base64"),
        })),
      }),
    });
    return { id: res.id };
  }

  async close(): Promise<void> {}
}
