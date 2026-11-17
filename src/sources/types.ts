// Port for job sources. An adapter only fetches and normalises; screening and storage happen elsewhere.
import type { Config, RawJobInput } from "../core/schema.ts";

export interface SourceContext {
  config: Config;
  /** Search terms derived from the config (roles + keywords). */
  keywords: string[];
  log: (message: string) => void;
  fetch: typeof fetch;
}

export interface SourceAdapter {
  /** Stable id used in config.sources.enabled, e.g. "ats", "arbeitsagentur", "remote-boards". */
  id: string;
  name: string;
  /** Countries this source is useful for (ISO 3166 alpha-2), or ["*"]. Used by onboarding to suggest sources. */
  countries: string[];
  /** Official API or public feed. Adapters that would break a site's terms are not shipped. */
  access: "official-api" | "public-feed";
  fetchJobs(ctx: SourceContext): Promise<RawJobInput[]>;
}
