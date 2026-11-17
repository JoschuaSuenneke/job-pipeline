// Mail sync: read new messages, classify them, link them to jobs, and move job statuses where the mail is clear.
import type { App } from "../core/app.ts";
import { companyKey } from "../core/names.ts";
import type { JobStatus } from "../core/schema.ts";
import { canTransition } from "../core/status.ts";
import type { JobRow } from "../db/repository.ts";
import { classifyMail, isAutomatedSender, looksJobRelated } from "./classify.ts";
import { GmailProvider } from "./gmail.ts";
import { ImapProvider, type ImapSettings } from "./imap.ts";
import { MicrosoftProvider } from "./microsoft.ts";
import { createSecretStore, getJson } from "./secrets.ts";
import type { MailKind, MailMessage, MailProvider } from "./types.ts";

export const IMAP_SETTINGS_KEY = "imap-settings";
const SINCE_KEY = "mail_since";
const FIRST_SYNC_DAYS = 30;

export interface SyncResult {
  scanned: number;
  stored: number;
  statusChanges: { jobId: number; from: string; to: string }[];
  alerts: string[];
}

/** The provider configured in `config.mail.provider`, or null when mail is off. */
export function createProvider(app: App): MailProvider | null {
  const store = createSecretStore(app.ws.secretsDir);
  switch (app.config.mail.provider) {
    case "none":
      return null;
    case "imap": {
      const settings = getJson<ImapSettings>(store, IMAP_SETTINGS_KEY);
      if (!settings) throw new Error("IMAP is not set up; run `job-pipeline mail setup`");
      return new ImapProvider(settings);
    }
    case "gmail":
      return new GmailProvider(store);
    case "microsoft":
      return new MicrosoftProvider(store);
  }
}

/** Status a mail of this kind moves a job to, for a job that has been applied to. */
const TARGET: Partial<Record<MailKind, JobStatus>> = {
  rejection: "rejected",
  interview: "interview",
  offer: "offer",
  reply: "conversation",
};

const norm = companyKey;

/**
 * Finds the job a message is about: the company name in sender, subject or body, preferring jobs that were
 * applied to. A sender domain counts too ("@acme.com" for "Acme").
 */
export function matchJob(msg: MailMessage, jobs: JobRow[]): JobRow | null {
  const haystack = norm(
    `${msg.fromName} ${msg.fromAddress.split("@")[1] ?? ""} ${msg.subject} ${msg.text.slice(0, 2000)}`,
  );
  const hits = jobs.filter((j) => {
    const name = norm(j.company);
    return name.length >= 3 && haystack.includes(name);
  });
  if (hits.length <= 1) return hits[0] ?? null;
  const subject = norm(msg.subject);
  return hits.find((j) => subject.includes(norm(j.title).slice(0, 20))) ?? hits[0] ?? null;
}

/** Reads mail since the last sync and applies it to the pipeline. Safe to re-run: messages are stored once. */
export async function syncMail(
  app: App,
  provider: MailProvider,
  opts: { now?: Date } = {},
): Promise<SyncResult> {
  const db = app.repo;
  const result: SyncResult = { scanned: 0, stored: 0, statusChanges: [], alerts: [] };
  const now = opts.now ?? new Date();
  const since = db.getKv(SINCE_KEY) ?? new Date(now.getTime() - FIRST_SYNC_DAYS * 86_400_000).toISOString();
  const jobs = db.listJobs({
    status: ["applied", "conversation", "interview", "offer", "rejected"],
    limit: 5000,
  });

  const messages = await provider.listMessages(since);
  for (const msg of messages) {
    result.scanned++;
    if (msg.fromSelf || db.hasMail(msg.id)) continue;
    if (!looksJobRelated(msg.subject, msg.text)) continue;
    const job = matchJob(msg, jobs);
    if (!job && !isAutomatedSender(msg.fromAddress)) continue; // personal mail without a known company: not ours
    const { kind, reason } = classifyMail(msg);
    db.saveMail({ id: msg.id, provider: provider.id, msg, kind, reason, jobId: job?.id ?? null });
    result.stored++;
    if (job) applyToJob(app, job, kind, reason, result);
    if (kind === "confirmation" && app.config.mail.fileConfirmations && provider.moveToFolder) {
      await provider.moveToFolder(msg.id, app.config.mail.folder).catch(() => undefined);
    }
  }
  db.setKv(SINCE_KEY, messages.at(-1)?.receivedAt ?? since);
  return result;
}

function applyToJob(app: App, job: JobRow, kind: MailKind, reason: string, result: SyncResult): void {
  if (kind === "action") result.alerts.push(`${job.company}: your move (${reason})`);
  const to = TARGET[kind];
  if (!to || job.status === to || !canTransition(job.status, to)) return;
  app.repo.setStatus(job.id, to, "mailbot", `${kind}: ${reason}`);
  result.statusChanges.push({ jobId: job.id, from: job.status, to });
  if (kind === "interview" || kind === "offer") result.alerts.push(`${job.company}: ${kind}`);
  job.status = to;
}
