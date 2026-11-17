// Turns a CV file into plain text for the agent to read. The agent proposes facts from it; the user confirms them.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Workspace } from "../core/workspace.ts";

export interface ImportResult {
  textPath: string;
  characters: number;
  method: "pdftotext" | "plain" | "none";
  hint?: string;
}

/** Extracts text from a PDF with poppler's pdftotext when available; copies .txt/.md as is. */
export function importCv(ws: Workspace, file: string): ImportResult {
  if (!existsSync(file)) throw new Error(`File not found: ${file}`);
  const textPath = join(ws.cvDir, "source.txt");
  copyFileSync(file, join(ws.cvDir, `original-${basename(file)}`));
  const ext = extname(file).toLowerCase();

  if (ext === ".txt" || ext === ".md") {
    const text = readFileSync(file, "utf8");
    writeFileSync(textPath, text, { mode: 0o600 });
    return { textPath, characters: text.length, method: "plain" };
  }
  if (ext === ".pdf") {
    const r = spawnSync("pdftotext", ["-layout", "-enc", "UTF-8", file, textPath], { encoding: "utf8" });
    if (r.status === 0)
      return { textPath, characters: readFileSync(textPath, "utf8").length, method: "pdftotext" };
    return {
      textPath,
      characters: 0,
      method: "none",
      hint: "pdftotext is not installed (brew install poppler / apt install poppler-utils). Or ask your agent to read the PDF directly; Claude Code can.",
    };
  }
  throw new Error(`Unsupported file type ${ext}. Use PDF, TXT or MD.`);
}
