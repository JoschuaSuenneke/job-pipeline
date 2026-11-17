#!/usr/bin/env bun
// job-pipeline CLI. Humans use it for setup and quick checks; the agent uses the MCP server.
import { writeAgentKit } from "../agents/kit.ts";
import { createApp } from "../core/app.ts";
import { hasConfig, loadConfig, loadFacts, resolveWorkspace, saveConfig } from "../core/workspace.ts";
import { startDashboard } from "../dashboard/server.ts";
import { type MailProviderId, setupMail } from "../mail/setup.ts";
import { createProvider, syncMail } from "../mail/sync.ts";
import { importCv } from "../onboarding/import-cv.ts";
import { runInit } from "../onboarding/init.ts";
import { runScout } from "../sources/scout.ts";
import { createDemo } from "./demo.ts";
import { terminalPrompter } from "./prompt.ts";

const HELP = `job-pipeline: an AI-native, local-first job search pipeline

Setup
  init                 create your workspace and config, write the agent kit
  import-cv <file>     turn your CV (PDF/TXT/MD) into text for the onboarding
  mail setup           connect a mailbox (IMAP, Gmail or Outlook)
  kit                  rewrite CLAUDE.md / AGENTS.md / .mcp.json after config changes
  doctor               check config, database, sources and mail

Daily use (your agent does these through MCP; the CLI is for you)
  scout [--only id,..] fetch and screen new jobs
  mail sync            read new mail and update statuses
  status               counts per status
  dashboard [--port n] open the local dashboard
  demo [sam|erika]     try the dashboard with a fictional candidate (no setup)
  mcp                  run the MCP server on stdio (agents start this themselves)

Workspace: $JOB_PIPELINE_HOME or ~/.job-pipeline`;

const flag = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main(argv: string[]): Promise<number> {
  const [cmd, sub] = argv;
  const ws = resolveWorkspace();

  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;

    case "init": {
      const io = terminalPrompter();
      try {
        await runInit(ws, io);
      } finally {
        io.close();
      }
      return 0;
    }

    case "import-cv": {
      if (!sub) throw new Error("Usage: job-pipeline import-cv <file>");
      const r = importCv(ws, sub);
      console.log(
        r.method === "none"
          ? r.hint
          : `Wrote ${r.characters} characters to ${r.textPath}. Now ask your agent: "onboard me".`,
      );
      return r.method === "none" ? 1 : 0;
    }

    case "kit": {
      const kit = writeAgentKit(ws, loadConfig(ws));
      console.log(`Wrote:\n  ${kit.written.join("\n  ")}`);
      return 0;
    }

    case "scout": {
      const app = createApp(ws);
      const only = flag(argv, "--only")?.split(",");
      const r = await runScout(app, { only, log: (m) => console.error(m) });
      console.log(JSON.stringify(r, null, 2));
      app.close();
      return 0;
    }

    case "mail": {
      if (sub === "setup") {
        const config = loadConfig(ws);
        const io = terminalPrompter();
        try {
          const choice = (await io.ask(
            "Provider: imap (recommended), gmail, microsoft",
            "imap",
          )) as MailProviderId;
          if (!["imap", "gmail", "microsoft"].includes(choice))
            throw new Error(`Unknown provider "${choice}"`);
          await setupMail(ws, choice, io, {
            filing: config.mail.fileConfirmations,
            drafts: config.rules.emailDrafts,
          });
          const app = createApp(ws);
          app.config.mail.provider = choice;
          saveConfig(ws, app.config);
          app.close();
          io.say("Mail connected. Run `job-pipeline mail sync` or ask your agent to check the inbox.");
        } finally {
          io.close();
        }
        return 0;
      }
      if (sub === "sync") {
        const app = createApp(ws);
        const provider = createProvider(app);
        if (!provider) throw new Error("No mailbox connected. Run `job-pipeline mail setup`.");
        try {
          console.log(JSON.stringify(await syncMail(app, provider), null, 2));
        } finally {
          await provider.close();
          app.close();
        }
        return 0;
      }
      throw new Error("Usage: job-pipeline mail setup|sync");
    }

    case "status": {
      const app = createApp(ws);
      console.log(
        JSON.stringify({ counts: app.repo.countByStatus(), appliedToday: app.repo.appliedToday() }, null, 2),
      );
      app.close();
      return 0;
    }

    case "dashboard": {
      const app = createApp(ws);
      const { url } = startDashboard(app, { port: Number(flag(argv, "--port") ?? 4747) });
      console.log(`Dashboard: ${url}  (Ctrl+C to stop)`);
      terminalPrompter().open(url);
      await new Promise(() => undefined);
      return 0;
    }

    case "mcp":
      await import("../mcp/server.ts");
      await new Promise(() => undefined);
      return 0;

    case "demo": {
      const app = createDemo(argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined);
      const { url } = startDashboard(app, { port: Number(flag(argv, "--port") ?? 4747) });
      console.log(`Demo dashboard with a fictional candidate: ${url}  (Ctrl+C to stop)`);
      if (!argv.includes("--no-open")) terminalPrompter().open(url);
      await new Promise(() => undefined);
      return 0;
    }

    case "doctor":
      return doctor(ws);

    default:
      console.error(`Unknown command "${cmd}".\n\n${HELP}`);
      return 1;
  }
}

async function doctor(ws: ReturnType<typeof resolveWorkspace>): Promise<number> {
  const line = (ok: boolean, msg: string) => console.log(`${ok ? "✓" : "✗"} ${msg}`);
  if (!hasConfig(ws)) {
    line(false, `no config at ${ws.configPath}. Run \`job-pipeline init\``);
    return 1;
  }
  let failed = 0;
  try {
    const app = createApp(ws);
    line(
      true,
      `config valid (${app.config.targets.roles.length} target roles, ${app.config.location.tiers.length} commute tiers)`,
    );
    const facts = loadFacts(ws);
    const confirmed = facts.filter((f) => f.confirmed).length;
    line(
      confirmed > 0,
      `${confirmed} confirmed facts${confirmed ? "" : '. Open your agent and say "onboard me"'}`,
    );
    line(true, `database ok (${Object.values(app.repo.countByStatus()).reduce((a, b) => a + b, 0)} jobs)`);
    if (app.config.mail.provider !== "none") {
      const provider = createProvider(app);
      try {
        const n =
          (await provider?.listMessages(new Date(Date.now() - 86_400_000).toISOString()))?.length ?? 0;
        line(true, `mail (${app.config.mail.provider}) readable, ${n} messages in the last day`);
      } catch (e) {
        failed++;
        line(false, `mail (${app.config.mail.provider}): ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        await provider?.close();
      }
    } else line(true, "mail not connected (optional)");
    app.close();
  } catch (e) {
    failed++;
    line(false, e instanceof Error ? e.message : String(e));
  }
  return failed ? 1 : 0;
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}

export { main };
