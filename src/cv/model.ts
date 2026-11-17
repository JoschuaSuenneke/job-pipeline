// The CV model. A CV is a projection of confirmed facts; it never holds text that no fact backs.
//
// Fact conventions the agent follows when proposing facts (see the generated CLAUDE.md):
// - An experience or education entry is one fact tagged "header" whose text is
//   "Title | Organisation | Period | Location" (location optional), e.g.
//   "Product Manager | Acme GmbH | 03/2021 – 06/2024 | Berlin".
// - Every bullet of that entry is a separate fact with the same `entry` id and section "experience"
//   (or "education"/"achievement"), tagged with role families and tools it is evidence for.
// - Skills are facts with section "skill"; one skill or a short group per fact.

/** One bullet in the CV, always tied to the fact it came from. */
export interface CvBullet {
  factId: string;
  text: string;
  /** Relevance score against the target job (0 when no job was given). */
  score: number;
}

/** One experience or education entry. */
export interface CvEntry {
  entry: string;
  title: string;
  organisation: string;
  period: string;
  location: string;
  headerFactId: string;
  bullets: CvBullet[];
}

/** A complete CV ready to render. `factIds` lists every fact that contributed text. */
export interface Cv {
  language: string;
  name: string;
  contact: string[];
  experience: CvEntry[];
  education: CvEntry[];
  skills: string[];
  languages: string[];
  factIds: string[];
  /** Short human-readable notes on why bullets were chosen (shown to the user, never rendered). */
  notes: string[];
}

/** The job a CV is tailored to. Only title and description are used for ranking. */
export interface TargetJob {
  title: string;
  company?: string;
  description?: string;
}

/** Splits a header fact text "Title | Organisation | Period | Location" into its parts. */
export function parseHeader(text: string): Pick<CvEntry, "title" | "organisation" | "period" | "location"> {
  const [title = "", organisation = "", period = "", location = ""] = text.split("|").map((s) => s.trim());
  return { title, organisation, period, location };
}
