// All shipped source adapters, and helpers to pick them from the config or suggest them during onboarding.
import type { Config } from "../core/schema.ts";
import { arbeitsagenturAdapter } from "./arbeitsagentur.ts";
import { atsAdapter } from "./ats.ts";
import { remoteBoardsAdapter } from "./remote-boards.ts";
import type { SourceAdapter } from "./types.ts";

/** Every adapter shipped with job-pipeline. */
export const ADAPTERS: readonly SourceAdapter[] = [atsAdapter, arbeitsagenturAdapter, remoteBoardsAdapter];

/** The adapters switched on in `config.sources.enabled`, in that order. Unknown ids throw, so typos surface early. */
export function getAdapters(config: Config): SourceAdapter[] {
  return config.sources.enabled.map((id) => {
    const adapter = ADAPTERS.find((a) => a.id === id);
    if (!adapter)
      throw new Error(`Unknown source "${id}". Available: ${ADAPTERS.map((a) => a.id).join(", ")}`);
    return adapter;
  });
}

/** Adapters worth enabling for someone living in `country` (ISO 3166 alpha-2): country-specific ones plus global ones. */
export function suggestSources(country: string): SourceAdapter[] {
  const cc = country.toUpperCase();
  return ADAPTERS.filter((a) => a.countries.includes("*") || a.countries.includes(cc));
}
