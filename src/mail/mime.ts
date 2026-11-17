// Minimal RFC 5322 / MIME builder for drafts (text body + attachments). No external mail library.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Draft } from "./types.ts";

/** RFC 2047 encoded-word for non-ASCII header values. */
export function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

const MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  html: "text/html",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function mimeType(filename: string): string {
  return MIME_TYPES[filename.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/** Builds a complete message (CRLF line endings) ready for IMAP APPEND, Gmail `raw` or Graph MIME upload. */
export function buildMime(draft: Draft, from: string, now = new Date()): string {
  const boundary = `jp-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const headers = [
    `From: ${from}`,
    `To: ${draft.to}`,
    `Subject: ${encodeHeader(draft.subject)}`,
    `Date: ${now.toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(Buffer.from(draft.body, "utf8").toString("base64")),
    ].join("\r\n"),
    ...draft.attachments.map((a) => {
      const name = encodeHeader(a.filename || basename(a.path));
      return [
        `--${boundary}`,
        `Content-Type: ${mimeType(a.filename || a.path)}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrap76(readFileSync(a.path).toString("base64")),
      ].join("\r\n");
    }),
  ];
  return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n--${boundary}--\r\n`;
}
