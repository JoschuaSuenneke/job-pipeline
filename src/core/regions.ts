// Whether a remote job's location is open to someone allowed to work from given countries.
// The one place for country names and the regions they belong to ("Remote (EMEA)", "US only", "Americas").

const EU = ["europe", "emea", "eu", "european union"];
const EUROPE = ["europe", "emea"];
const AMERICAS = ["north america", "americas", "na"];
const GLOBAL = /\b(anywhere|worldwide|global|international)\b/i;

/** ISO 3166 alpha-2 → names a posting may use, and the regions that include the country. */
const COUNTRIES: Record<string, { names: string[]; regions: string[] }> = {
  US: { names: ["united states", "usa", "us", "u.s.", "u.s.a."], regions: AMERICAS },
  CA: { names: ["canada"], regions: AMERICAS },
  GB: { names: ["united kingdom", "uk", "great britain", "england", "scotland"], regions: EUROPE },
  IE: { names: ["ireland"], regions: EU },
  DE: { names: ["germany", "deutschland"], regions: [...EU, "dach"] },
  AT: { names: ["austria", "österreich"], regions: [...EU, "dach"] },
  CH: { names: ["switzerland", "schweiz", "suisse"], regions: [...EUROPE, "dach"] },
  NL: { names: ["netherlands", "nederland", "holland"], regions: [...EU, "benelux"] },
  BE: { names: ["belgium", "belgië", "belgique"], regions: [...EU, "benelux"] },
  LU: { names: ["luxembourg"], regions: [...EU, "benelux"] },
  FR: { names: ["france"], regions: EU },
  ES: { names: ["spain", "españa"], regions: EU },
  PT: { names: ["portugal"], regions: EU },
  IT: { names: ["italy", "italia"], regions: EU },
  PL: { names: ["poland", "polska"], regions: EU },
  CZ: { names: ["czechia", "czech republic"], regions: EU },
  DK: { names: ["denmark", "danmark"], regions: [...EU, "nordics"] },
  SE: { names: ["sweden", "sverige"], regions: [...EU, "nordics"] },
  FI: { names: ["finland", "suomi"], regions: [...EU, "nordics"] },
  NO: { names: ["norway", "norge"], regions: [...EUROPE, "nordics"] },
  AU: { names: ["australia"], regions: ["apac", "anz"] },
  NZ: { names: ["new zealand"], regions: ["apac", "anz"] },
  IN: { names: ["india"], regions: ["apac", "asia"] },
  SG: { names: ["singapore"], regions: ["apac", "asia"] },
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordMatch = (text: string, term: string) =>
  new RegExp(`(^|[^a-z])${escapeRegex(term)}($|[^a-z])`, "i").test(text);

/** Every term that marks a posting as open to `country`, which may be an ISO code or a plain name. */
export function countryTerms(country: string): string[] {
  const known = COUNTRIES[country.toUpperCase()];
  return known ? [...known.names, ...known.regions] : [country.toLowerCase()];
}

/** True when a remote job at `location` can be done from one of `countries`. No countries means anywhere. */
export function remoteOpenTo(location: string, countries: string[]): boolean {
  if (countries.length === 0 || GLOBAL.test(location)) return true;
  return countries.some((c) => countryTerms(c).some((term) => wordMatch(location, term)));
}
