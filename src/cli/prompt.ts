// Terminal prompts for the wizards. Reads stdin as a line queue, so it works when a person types and when
// answers are piped in (scripts, CI): readline's question() drops lines that arrive before it is called.
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import type { Prompter } from "../core/prompter.ts";

export function terminalPrompter(): Prompter & { close(): void } {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const interactive = Boolean(process.stdin.isTTY);

  async function readLine(): Promise<string> {
    const next = await lines.next();
    if (next.done) throw new Error("Input ended before the setup was finished.");
    return next.value.trim();
  }

  return {
    async ask(question, fallback) {
      process.stdout.write(fallback ? `${question} [${fallback}]: ` : `${question}: `);
      const answer = await readLine();
      if (!interactive) process.stdout.write(`${answer}\n`);
      return answer || fallback || "";
    },
    async secret(question) {
      process.stdout.write(`${question}: `);
      if (!interactive) return readLine();
      // The terminal echoes typed characters; switch echo off while the secret is entered.
      spawnSync("stty", ["-echo"], { stdio: "inherit" });
      try {
        return await readLine();
      } finally {
        spawnSync("stty", ["echo"], { stdio: "inherit" });
        process.stdout.write("\n");
      }
    },
    say(message) {
      console.log(message);
    },
    open(url) {
      const cmd =
        process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      spawn(cmd, [url], { stdio: "ignore", detached: true })
        .on("error", () => undefined)
        .unref();
    },
    close() {
      rl.close();
    },
  };
}
