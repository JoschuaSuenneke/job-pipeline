// Credential storage. Files with mode 0600 in the workspace's secrets folder; on macOS optionally the Keychain.
// Values are never logged or included in error messages.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SecretStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

const KEY = /^[a-z0-9][a-z0-9._-]{0,80}$/;
function checkKey(key: string): void {
  if (!KEY.test(key)) throw new Error(`invalid secret key "${key}"`);
}

/** Stores each secret as its own 0600 file under `dir`. */
export class FileSecretStore implements SecretStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  private path(key: string): string {
    checkKey(key);
    return join(this.dir, `${key}.secret`);
  }
  get(key: string): string | null {
    const p = this.path(key);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  }
  set(key: string, value: string): void {
    const p = this.path(key);
    writeFileSync(p, value, { mode: 0o600 });
    chmodSync(p, 0o600);
  }
  delete(key: string): void {
    rmSync(this.path(key), { force: true });
  }
}

/** macOS Keychain via the `security` CLI (generic passwords under service "job-pipeline"). */
export class KeychainSecretStore implements SecretStore {
  private readonly service = "job-pipeline";
  get(key: string): string | null {
    checkKey(key);
    const r = spawnSync("security", ["find-generic-password", "-s", this.service, "-a", key, "-w"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    return r.status === 0 ? r.stdout.replace(/\n$/, "") : null;
  }
  set(key: string, value: string): void {
    checkKey(key);
    const r = spawnSync(
      "security",
      ["add-generic-password", "-U", "-s", this.service, "-a", key, "-w", value],
      {
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    if (r.status !== 0) throw new Error(`could not store secret "${key}" in the Keychain`);
  }
  delete(key: string): void {
    checkKey(key);
    spawnSync("security", ["delete-generic-password", "-s", this.service, "-a", key], { timeout: 10_000 });
  }
}

/** Keychain on macOS when JOB_PIPELINE_KEYCHAIN=1, otherwise 0600 files in `secretsDir`. */
export function createSecretStore(secretsDir: string): SecretStore {
  if (process.platform === "darwin" && process.env.JOB_PIPELINE_KEYCHAIN === "1")
    return new KeychainSecretStore();
  return new FileSecretStore(secretsDir);
}

/** JSON helpers for structured secrets (OAuth tokens, IMAP settings). */
export function getJson<T>(store: SecretStore, key: string): T | null {
  const raw = store.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
export function setJson(store: SecretStore, key: string, value: unknown): void {
  store.set(key, JSON.stringify(value));
}
