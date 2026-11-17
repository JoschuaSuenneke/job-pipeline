// Shared HTTP helpers for source adapters: one User-Agent, timeouts on every request, no retries storms.

/** Identifies the tool to job boards. Set JOB_PIPELINE_UA to add a contact URL for your installation. */
export const USER_AGENT =
  process.env.JOB_PIPELINE_UA ?? "job-pipeline/0.1 (open-source, local job search tool)";

/** Default per-request timeout in milliseconds. */
export const TIMEOUT_MS = 20_000;

export type Fetch = typeof fetch;

/** Error carrying the HTTP status, so callers can tell "not found" from "broken". */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { "User-Agent": USER_AGENT, Accept: "application/json, text/xml;q=0.9, */*;q=0.5", ...extra };
}

/** GET a URL and parse JSON. Throws HttpError on non-2xx. */
export async function getJson<T = unknown>(
  http: Fetch,
  url: string,
  extra?: Record<string, string>,
): Promise<T> {
  const res = await http(url, { headers: headers(extra), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new HttpError(res.status, url);
  return (await res.json()) as T;
}

/** GET a URL as text. Throws HttpError on non-2xx. */
export async function getText(http: Fetch, url: string, extra?: Record<string, string>): Promise<string> {
  const res = await http(url, { headers: headers(extra), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new HttpError(res.status, url);
  return res.text();
}

/** POST a JSON body and parse the JSON response. Throws HttpError on non-2xx. */
export async function postJson<T = unknown>(http: Fetch, url: string, body: unknown): Promise<T> {
  const res = await http(url, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return (await res.json()) as T;
}

/** Like getJson, but returns null instead of throwing. Used for probing (ATS detection). */
export async function tryJson<T = unknown>(http: Fetch, url: string): Promise<T | null> {
  try {
    return await getJson<T>(http, url);
  } catch {
    return null;
  }
}

/** Like getText, but returns null instead of throwing. */
export async function tryText(http: Fetch, url: string): Promise<string | null> {
  try {
    return await getText(http, url);
  } catch {
    return null;
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. Results keep input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
