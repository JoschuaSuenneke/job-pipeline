// The workspace is the user's private folder: config, facts, CVs, database, secrets. Never inside the repo.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { Config, type ConfigInput, Fact } from "./schema.ts";

export interface Workspace {
  root: string;
  configPath: string;
  factsPath: string;
  dbPath: string;
  cvDir: string;
  outDir: string;
  secretsDir: string;
}

export function resolveWorkspace(
  root = process.env.JOB_PIPELINE_HOME ?? join(homedir(), ".job-pipeline"),
): Workspace {
  return {
    root,
    configPath: join(root, "job-pipeline.config.yaml"),
    factsPath: join(root, "facts.yaml"),
    dbPath: join(root, "pipeline.db"),
    cvDir: join(root, "cv"),
    outDir: join(root, "out"),
    secretsDir: join(root, "secrets"),
  };
}

export function ensureWorkspace(ws: Workspace): void {
  for (const dir of [ws.root, ws.cvDir, ws.outDir, ws.secretsDir])
    mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function hasConfig(ws: Workspace): boolean {
  return existsSync(ws.configPath);
}

export function loadConfig(ws: Workspace): Config {
  if (!hasConfig(ws)) throw new Error(`No config at ${ws.configPath}. Run \`job-pipeline init\` first.`);
  return Config.parse(YAML.parse(readFileSync(ws.configPath, "utf8")));
}

export function saveConfig(ws: Workspace, config: ConfigInput): Config {
  const parsed = Config.parse(config);
  writeFileSync(ws.configPath, YAML.stringify(parsed), { mode: 0o600 });
  return parsed;
}

export function loadFacts(ws: Workspace): Fact[] {
  if (!existsSync(ws.factsPath)) return [];
  return Fact.array().parse(YAML.parse(readFileSync(ws.factsPath, "utf8")) ?? []);
}

export function saveFacts(ws: Workspace, facts: Fact[]): void {
  writeFileSync(ws.factsPath, YAML.stringify(Fact.array().parse(facts)), { mode: 0o600 });
}
