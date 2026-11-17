// Composition root: wires the workspace, database, repository and policy for CLI, MCP and dashboard.
import { openDatabase } from "../db/database.ts";
import { Repository } from "../db/repository.ts";
import { Policy } from "./policy.ts";
import type { Config } from "./schema.ts";
import { ensureWorkspace, loadConfig, resolveWorkspace, type Workspace } from "./workspace.ts";

export interface App {
  ws: Workspace;
  config: Config;
  repo: Repository;
  policy: Policy;
  close(): void;
}

export function createApp(ws: Workspace = resolveWorkspace()): App {
  ensureWorkspace(ws);
  const config = loadConfig(ws);
  const db = openDatabase(ws.dbPath);
  const repo = new Repository(db);
  return { ws, config, repo, policy: new Policy(config, repo), close: () => db.close() };
}
