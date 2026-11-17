// The one place that decides when two company names or job titles are "the same".
// Used for dedup (fingerprints), ATS slug matching and linking mail to jobs.

const LEGAL_FORMS =
  /\b(gmbh|ag|se|inc|ltd|llc|bv|b\.v\.|ug|co|kg|sas|sa|oy|ab|plc|corp(?:oration)?|company|group|holding|haftungsbeschränkt)\b\.?/g;
const GENDER_TAG = /\((m|w|d|f|x|all genders?)[/|,\s\w]*\)/g;

function fold(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
}

/** "Acme Labs GmbH & Co. KG" → "acmelabs". Comparison key for company names. */
export function companyKey(name: string): string {
  return fold(name)
    .replace(/&/g, " ")
    .replace(LEGAL_FORMS, "")
    .replace(/[^a-z0-9]/g, "");
}

/** "Product Manager (m/w/d)" → "product manager". Comparison key for job titles. */
export function titleKey(title: string): string {
  return fold(title)
    .replace(GENDER_TAG, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
