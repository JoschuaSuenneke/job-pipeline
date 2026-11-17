// IMAP provider (imapflow). Works with any mailbox that offers IMAP and an app password.
import { ImapFlow, type ListResponse } from "imapflow";
import { simpleParser } from "mailparser";
import { buildMime } from "./mime.ts";
import type { Draft, MailMessage, MailProvider } from "./types.ts";

export interface ImapSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  /** Also scan the spam folder (job mail often lands there). */
  includeJunk?: boolean;
}

/** Known IMAP hosts. Users only pick a preset and paste an app password. */
export const IMAP_PRESETS: Record<string, Omit<ImapSettings, "user" | "password">> = {
  gmail: { host: "imap.gmail.com", port: 993, secure: true },
  outlook: { host: "outlook.office365.com", port: 993, secure: true },
  gmx: { host: "imap.gmx.net", port: 993, secure: true },
  webde: { host: "imap.web.de", port: 993, secure: true },
  icloud: { host: "imap.mail.me.com", port: 993, secure: true },
};

const SEPARATOR = "::";
/** Message ids encode mailbox and UID so a message can be moved later. */
export function encodeId(path: string, uid: number): string {
  return `${path}${SEPARATOR}${uid}`;
}
export function decodeId(id: string): { path: string; uid: number } {
  const i = id.lastIndexOf(SEPARATOR);
  if (i < 0) throw new Error(`not an IMAP message id: ${id}`);
  return { path: id.slice(0, i), uid: Number(id.slice(i + SEPARATOR.length)) };
}

export class ImapProvider implements MailProvider {
  readonly id = "imap" as const;
  private client: ImapFlow | null = null;
  private boxes: ListResponse[] | null = null;

  constructor(private readonly settings: ImapSettings) {}

  private async connect(): Promise<ImapFlow> {
    if (this.client) return this.client;
    const { host, port, secure, user, password } = this.settings;
    const client = new ImapFlow({
      host,
      port,
      secure,
      auth: { user, pass: password },
      logger: false,
      connectionTimeout: 30_000,
      greetingTimeout: 15_000,
      socketTimeout: 120_000,
    });
    await client.connect();
    this.client = client;
    return client;
  }

  private async mailbox(use: "\\Sent" | "\\Drafts" | "\\Junk"): Promise<string | null> {
    const client = await this.connect();
    this.boxes ??= await client.list();
    return this.boxes.find((b) => b.specialUse === use)?.path ?? null;
  }

  async listMessages(since: string): Promise<MailMessage[]> {
    const client = await this.connect();
    const sent = await this.mailbox("\\Sent");
    const junk = this.settings.includeJunk ? await this.mailbox("\\Junk") : null;
    const paths = ["INBOX", sent, junk].filter((p): p is string => Boolean(p));
    const out: MailMessage[] = [];
    for (const path of paths) out.push(...(await this.readBox(client, path, new Date(since), path === sent)));
    return out.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  }

  private async readBox(
    client: ImapFlow,
    path: string,
    since: Date,
    isSent: boolean,
  ): Promise<MailMessage[]> {
    const lock = await client.getMailboxLock(path);
    try {
      const uids = await client.search({ since }, { uid: true });
      if (!uids || uids.length === 0) return [];
      const out: MailMessage[] = [];
      for await (const msg of client.fetch(
        uids,
        { uid: true, source: true, internalDate: true },
        { uid: true },
      )) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const from = parsed.from?.value[0];
        const fromAddress = (from?.address ?? "").toLowerCase();
        out.push({
          id: encodeId(path, msg.uid),
          receivedAt: (parsed.date ?? new Date(String(msg.internalDate ?? Date.now()))).toISOString(),
          fromAddress,
          fromName: from?.name ?? "",
          subject: parsed.subject ?? "",
          text: (parsed.text ?? "").slice(0, 8000),
          fromSelf: isSent || fromAddress === this.settings.user.toLowerCase(),
        });
      }
      return out;
    } finally {
      lock.release();
    }
  }

  async moveToFolder(messageId: string, folder: string): Promise<void> {
    const client = await this.connect();
    const { path, uid } = decodeId(messageId);
    this.boxes ??= await client.list();
    if (!this.boxes.some((b) => b.path === folder)) {
      await client.mailboxCreate(folder);
      this.boxes = await client.list();
    }
    const lock = await client.getMailboxLock(path);
    try {
      await client.messageMove(String(uid), folder, { uid: true });
    } finally {
      lock.release();
    }
  }

  async createDraft(draft: Draft): Promise<{ id: string }> {
    const client = await this.connect();
    const drafts = (await this.mailbox("\\Drafts")) ?? "Drafts";
    const res = await client.append(drafts, buildMime(draft, this.settings.user), ["\\Draft"]);
    const uid = res === false ? undefined : res.uid;
    return { id: uid ? encodeId(drafts, uid) : `${drafts}${SEPARATOR}appended` };
  }

  async close(): Promise<void> {
    await this.client?.logout().catch(() => undefined);
    this.client = null;
  }
}
