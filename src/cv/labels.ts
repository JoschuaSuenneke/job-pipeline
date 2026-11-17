// Section headings per CV language. Add a language by adding one entry.
export interface CvLabels {
  experience: string;
  education: string;
  skills: string;
  languages: string;
}

const LABELS: Record<string, CvLabels> = {
  en: { experience: "Experience", education: "Education", skills: "Skills", languages: "Languages" },
  de: { experience: "Berufserfahrung", education: "Ausbildung", skills: "Kenntnisse", languages: "Sprachen" },
};

/** Labels for a language code such as "de" or "de-DE"; English when the language is unknown. */
export function labelsFor(language: string): CvLabels {
  const base = language.toLowerCase().split("-")[0] ?? "en";
  return LABELS[base] ?? (LABELS.en as CvLabels);
}
