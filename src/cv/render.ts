// Renders CVs and cover notes to HTML from templates, and to PDF when Playwright is installed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { labelsFor } from "./labels.ts";
import type { Cv, CvEntry } from "./model.ts";

/** Repository folder holding `cv/<name>.html` and `cover/<name>.html`. */
export const TEMPLATE_DIR = join(import.meta.dir, "..", "..", "templates");

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

function loadTemplate(kind: "cv" | "cover", name: string, templateDir: string): string {
  const path = join(templateDir, kind, `${name}.html`);
  if (!existsSync(path)) throw new Error(`Template not found: ${path}`);
  return readFileSync(path, "utf8");
}

function entryHtml(e: CvEntry): string {
  const org = [e.organisation, e.location].filter(Boolean).map(escapeHtml).join(", ");
  const bullets = e.bullets.length
    ? `<ul>${e.bullets.map((b) => `<li>${escapeHtml(b.text)}</li>`).join("")}</ul>`
    : "";
  return `<div class="entry"><div class="entry-head"><span><span class="entry-title">${escapeHtml(e.title)}</span>${
    org ? `, ${org}` : ""
  }</span><span class="entry-meta">${escapeHtml(e.period)}</span></div>${bullets}</div>`;
}

function section(title: string, inner: string): string {
  return inner ? `<section><h2>${escapeHtml(title)}</h2>${inner}</section>` : "";
}

/** Renders a CV to a complete HTML document using `templates/cv/<template>.html`. */
export function renderCvHtml(cv: Cv, template = "clean", templateDir = TEMPLATE_DIR): string {
  const l = labelsFor(cv.language);
  const body = [
    `<header><h1>${escapeHtml(cv.name)}</h1><p class="contact">${cv.contact
      .map((c) => `<span>${escapeHtml(c)}</span>`)
      .join("")}</p></header>`,
    section(l.experience, cv.experience.map(entryHtml).join("")),
    section(l.education, cv.education.map(entryHtml).join("")),
    section(
      l.skills,
      cv.skills.length ? `<p class="inline-list">${cv.skills.map(escapeHtml).join(" · ")}</p>` : "",
    ),
    section(
      l.languages,
      cv.languages.length ? `<p class="inline-list">${cv.languages.map(escapeHtml).join(" · ")}</p>` : "",
    ),
  ].join("\n");
  return fillTemplate(loadTemplate("cv", template, templateDir), {
    lang: escapeHtml(cv.language),
    title: escapeHtml(`CV ${cv.name}`),
    body,
  });
}

/** Input for a cover note. `paragraphs` is the agent's fact-checked text, split on blank lines. */
export interface CoverNote {
  language: string;
  senderName: string;
  senderContact: string[];
  recipient?: string;
  subject?: string;
  date?: string;
  paragraphs: string[];
}

/** Splits free text into paragraphs on blank lines. */
export function toParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Renders a cover note to a complete HTML document using `templates/cover/<template>.html`. */
export function renderCoverHtml(note: CoverNote, template = "clean", templateDir = TEMPLATE_DIR): string {
  const meta = [note.recipient, note.date, note.subject]
    .filter(Boolean)
    .map((m) => `<div>${escapeHtml(m as string)}</div>`);
  const body = [
    `<p class="sender">${[note.senderName, ...note.senderContact].map((c) => `<span>${escapeHtml(c)}</span>`).join("")}</p>`,
    meta.length ? `<div class="meta">${meta.join("")}</div>` : "",
    ...note.paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`),
  ].join("\n");
  return fillTemplate(loadTemplate("cover", template, templateDir), {
    lang: escapeHtml(note.language),
    title: escapeHtml(note.subject ?? `Cover note ${note.senderName}`),
    body,
  });
}

/** Result of writing a document: the HTML path always, the PDF path when Playwright was available. */
export interface RenderResult {
  htmlPath: string;
  pdfPath: string | null;
  note: string;
}

interface PlaywrightLike {
  chromium: {
    launch(): Promise<{
      newPage(): Promise<{
        setContent(html: string, o: { waitUntil: string }): Promise<void>;
        pdf(o: object): Promise<unknown>;
      }>;
      close(): Promise<void>;
    }>;
  };
}

async function loadPlaywright(): Promise<PlaywrightLike | null> {
  const moduleName = "playwright";
  try {
    return (await import(moduleName)) as PlaywrightLike;
  } catch {
    return null;
  }
}

/**
 * Writes `<basePath>.html` and, if Playwright and Chromium are installed, `<basePath>.pdf`.
 * Install once with `bun add -d playwright && bunx playwright install chromium`.
 */
export async function writeDocument(html: string, basePath: string): Promise<RenderResult> {
  mkdirSync(dirname(basePath), { recursive: true });
  const htmlPath = `${basePath}.html`;
  writeFileSync(htmlPath, html);
  const pw = await loadPlaywright();
  if (!pw) {
    return {
      htmlPath,
      pdfPath: null,
      note: "Playwright is not installed: wrote HTML only. Run `bun add -d playwright && bunx playwright install chromium` for PDFs.",
    };
  }
  const pdfPath = `${basePath}.pdf`;
  try {
    const browser = await pw.chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.pdf({ path: pdfPath, format: "A4", printBackground: true, preferCSSPageSize: true });
    } finally {
      await browser.close();
    }
    return { htmlPath, pdfPath, note: "Wrote HTML and PDF." };
  } catch (error) {
    return { htmlPath, pdfPath: null, note: `PDF failed (${(error as Error).message}); HTML is ready.` };
  }
}
