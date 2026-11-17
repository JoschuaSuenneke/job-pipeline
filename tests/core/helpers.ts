import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type App, createApp } from "../../src/core/app.ts";
import type { ConfigInput } from "../../src/core/schema.ts";
import { ensureWorkspace, resolveWorkspace, saveConfig } from "../../src/core/workspace.ts";

export const testConfig: ConfigInput = {
  version: 1,
  candidate: {
    name: "Erika Mustermann",
    email: "erika@example.com",
    home: "Münster",
    country: "DE",
    languages: [],
  },
  targets: {
    roles: ["product manager", "business analyst"],
    keywords: ["product discovery"],
    maxYearsRequired: 5,
  },
  location: {
    remoteCountries: ["Germany", "DE"],
    tiers: [
      { label: "daily", places: ["Münster", "Osnabrück"], maxOfficeDays: 5 },
      { label: "hybrid", places: ["Köln", "Düsseldorf"], maxOfficeDays: 2 },
    ],
  },
  compensation: { floor: 60000, ask: 70000 },
  rules: {
    blocklist: ["Evil Corp"],
    oneRolePerCompany: true,
    dailyApplicationLimit: 2,
    consents: {
      privacy: true,
      talentPool: true,
      termsOfUse: false,
      backgroundCheck: false,
      recording: false,
    },
    emailDrafts: true,
  },
};

/** A fresh app on a temporary workspace. */
export function tempApp(config: ConfigInput = testConfig): App {
  const ws = resolveWorkspace(mkdtempSync(join(tmpdir(), "jp-test-")));
  ensureWorkspace(ws);
  saveConfig(ws, config);
  return createApp(ws);
}
