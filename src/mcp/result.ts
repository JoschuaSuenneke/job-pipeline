// Tool results as JSON text. Errors are returned (isError) instead of thrown, so the agent can read the reason.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function fail(reason: string): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: reason }) }], isError: true };
}
