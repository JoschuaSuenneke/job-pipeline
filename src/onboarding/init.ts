// `job-pipeline init`: a short terminal wizard for the settings a person must decide themselves.
// Everything about the CV and experience happens afterwards in the agent session ("onboard me").
import { writeAgentKit } from "../agents/kit.ts";
import type { Prompter } from "../core/prompter.ts";
import type { Config, ConfigInput } from "../core/schema.ts";
import { ensureWorkspace, hasConfig, loadConfig, saveConfig, type Workspace } from "../core/workspace.ts";
import { suggestSources } from "../sources/registry.ts";

const csv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const yes = (s: string) => /^(y|yes|j|ja)$/i.test(s.trim());
const num = (s: string, fallback: number) =>
  Number.isFinite(Number(s)) && s.trim() !== "" ? Number(s) : fallback;

async function askTiers(io: Prompter, home: string): Promise<Config["location"]["tiers"]> {
  io.say("\nCommute tiers decide which on-site and hybrid jobs are worth it.");
  const tiers: Config["location"]["tiers"] = [];
  const daily = csv(await io.ask("Places you could commute to daily (comma separated)", home));
  if (daily.length) tiers.push({ label: "daily commute", places: daily, maxOfficeDays: 5 });
  const hybrid = csv(await io.ask("Places for hybrid roles (2-3 office days), optional", ""));
  if (hybrid.length) {
    const days = num(await io.ask("Max office days per week there", "2"), 2);
    tiers.push({ label: "hybrid", places: hybrid, maxOfficeDays: days });
  }
  const rare = csv(await io.ask("Places you'd visit only occasionally (1 day), optional", ""));
  if (rare.length) tiers.push({ label: "occasional", places: rare, maxOfficeDays: 1 });
  return tiers;
}

/** Runs the wizard and writes config plus the agent kit. Returns the saved config. */
export async function runInit(ws: Workspace, io: Prompter): Promise<Config> {
  ensureWorkspace(ws);
  const previous = hasConfig(ws) ? loadConfig(ws) : null;
  if (previous && !yes(await io.ask("A config exists. Start over? (y/n)", "n"))) {
    io.say("Keeping your config. Change single sections with `job-pipeline dashboard` → Settings.");
    return previous;
  }

  io.say(`job-pipeline setup. Press Enter to accept a [default]. Your data stays in ${ws.root}`);
  const name = await io.ask("Your name");
  const email = await io.ask("Email for applications");
  const phone = await io.ask("Phone (optional)", "");
  const home = await io.ask("Where do you live (city)");
  const country = (await io.ask("Country code (ISO, e.g. DE, NL, US)", "DE")).toUpperCase();
  const workAuthorization = await io.ask(
    "Work authorization, as forms should state it (e.g. US citizen, needs visa sponsorship; optional)",
    "",
  );
  const languages = csv(await io.ask("Languages with level (e.g. de:native, en:C1)", "en:C1")).map((l) => {
    const [code = l, level = "fluent"] = l.split(":");
    return { code: code.trim(), level: level.trim() };
  });

  io.say("\nWhat are you looking for?");
  const roles = csv(await io.ask("Target roles (comma separated, e.g. product owner, business analyst)"));
  const keywords = csv(await io.ask("Extra search keywords (optional)", ""));
  const senior = yes(await io.ask("Include senior/lead roles? (y/n)", "n"));
  const maxYears = num(await io.ask("Skip jobs that require more than N years", "5"), 5);
  const exclude = csv(await io.ask("Exclude titles matching (comma separated, optional)", ""));

  const remoteCountries = csv(await io.ask("Remote work is possible from (countries)", country));
  const tiers = await askTiers(io, home);

  io.say("\nPay and rules.");
  const currency = await io.ask("Currency", country === "US" ? "USD" : country === "GB" ? "GBP" : "EUR");
  const floor = num(await io.ask("Lowest yearly salary you'd accept"), 0);
  const ask = num(await io.ask("Salary you ask for", String(floor)), floor);
  const preferFixed = yes(await io.ask("Prefer fixed salary over commission/OTE? (y/n)", "y"));
  const blocklist = csv(await io.ask("Never apply to (companies or groups, optional)", ""));
  const limit = num(await io.ask("Max applications per day", "15"), 15);
  const talentPool = yes(await io.ask("May your agent tick talent-pool consents? (y/n)", "y"));
  const emailDrafts = yes(
    await io.ask("May your agent put application emails into your Drafts? It never sends. (y/n)", "y"),
  );

  const suggested = suggestSources(country).map((s) => s.id);
  io.say(
    `\nSources for ${country}: ${suggested.join(", ")}. Add target companies later in the agent session.`,
  );
  const drivers = csv(
    await io.ask("Agent(s) you use: claude, codex, generic-mcp", "claude"),
  ) as Config["agent"]["drivers"];

  const input: ConfigInput = {
    version: 1,
    candidate: {
      name,
      email,
      phone: phone || undefined,
      home,
      country,
      workAuthorization: workAuthorization || undefined,
      languages,
    },
    targets: {
      roles,
      keywords,
      seniority: senior ? ["junior", "mid", "senior", "lead"] : ["junior", "mid"],
      excludeTitlePatterns: exclude,
      maxYearsRequired: maxYears,
    },
    location: { remoteCountries, tiers },
    compensation: { currency, floor, ask, preferFixed },
    rules: {
      blocklist,
      oneRolePerCompany: true,
      dailyApplicationLimit: limit,
      consents: { privacy: true, talentPool, termsOfUse: false, backgroundCheck: false, recording: false },
      emailDrafts,
    },
    sources: { enabled: suggested, companies: [] },
    documents: {
      cvTemplate: "clean",
      cvLanguages: languages.map((l) => l.code).slice(0, 2),
      coverLetterMaxWords: 220,
    },
    mail: { provider: "none", fileConfirmations: false, folder: "Job Pipeline" },
    agent: { drivers },
  };
  const config = saveConfig(ws, input);
  const kit = writeAgentKit(ws, config);

  io.say(`\nSaved ${ws.configPath}`);
  if (config.agent.drivers.includes("codex"))
    io.say(`\nAdd this to ~/.codex/config.toml:\n${kit.codexSnippet}`);
  io.say(
    [
      "",
      "Next:",
      "  job-pipeline mail setup     connect your mailbox (optional)",
      `  cd ${ws.root} && claude      or: codex`,
      '  then say: "onboard me"      your agent reads your CV and builds your facts with you',
    ].join("\n"),
  );
  return config;
}
