// Interactive mail setup: collects credentials for the chosen provider, connects, and verifies by reading.
import type { Prompter } from "../core/prompter.ts";
import type { Workspace } from "../core/workspace.ts";
import { authorizeGmail, GmailProvider, gmailScopes } from "./gmail.ts";
import { IMAP_PRESETS, ImapProvider, type ImapSettings } from "./imap.ts";
import { authorizeMicrosoft, MicrosoftProvider, microsoftScopes } from "./microsoft.ts";
import { createSecretStore, setJson } from "./secrets.ts";
import { IMAP_SETTINGS_KEY } from "./sync.ts";
import type { MailProvider } from "./types.ts";

export type MailProviderId = "imap" | "gmail" | "microsoft";

/** Walks the user through connecting one provider, then reads the last week to prove it works. */
export async function setupMail(
  ws: Workspace,
  provider: MailProviderId,
  io: Prompter,
  features: { filing: boolean; drafts: boolean },
): Promise<{ ok: true; messagesLastWeek: number }> {
  const store = createSecretStore(ws.secretsDir);
  let client: MailProvider;

  if (provider === "imap") {
    io.say(
      "IMAP works with almost every mailbox. Use an app password, not your normal password (see docs/mail-setup.md).",
    );
    const presetName = await io.ask(
      `Mail service (${Object.keys(IMAP_PRESETS).join(", ")}, or "custom")`,
      "gmail",
    );
    const preset = IMAP_PRESETS[presetName];
    const host = preset?.host ?? (await io.ask("IMAP host"));
    const port = preset?.port ?? Number(await io.ask("IMAP port", "993"));
    const settings: ImapSettings = {
      host,
      port,
      secure: preset?.secure ?? port === 993,
      user: await io.ask("Email address / login"),
      password: await io.secret("App password"),
      includeJunk: (await io.ask("Also read the spam folder? (y/n)", "y")).toLowerCase().startsWith("y"),
    };
    setJson(store, IMAP_SETTINGS_KEY, settings);
    client = new ImapProvider(settings);
  } else if (provider === "gmail") {
    io.say("Gmail uses your own Google OAuth client (Desktop app). Steps: docs/mail-setup.md#gmail");
    const clientId = await io.ask("OAuth client ID");
    const clientSecret = await io.secret("OAuth client secret");
    await authorizeGmail(store, { clientId, clientSecret }, gmailScopes(features), (url) => {
      io.say(`Opening Google sign-in. If nothing opens, visit:\n${url}`);
      io.open(url);
    });
    client = new GmailProvider(store);
  } else {
    io.say("Outlook uses your own Microsoft Entra app (public client). Steps: docs/mail-setup.md#outlook");
    const clientId = await io.ask("Application (client) ID");
    const tenant = await io.ask(
      'Tenant ("consumers" for outlook.com, "organizations" for work accounts)',
      "consumers",
    );
    await authorizeMicrosoft(store, { clientId, tenant, scopes: microsoftScopes(features) }, io.say);
    client = new MicrosoftProvider(store);
  }

  try {
    const lastWeek = await client.listMessages(new Date(Date.now() - 7 * 86_400_000).toISOString());
    io.say(`Connected. ${lastWeek.length} messages in the last 7 days are readable.`);
    return { ok: true, messagesLastWeek: lastWeek.length };
  } finally {
    await client.close();
  }
}
