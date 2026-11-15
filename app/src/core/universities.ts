import data from "./universities.json";

export type University = {
  school_id: string;
  name: string;
  short_name: string;
  domain: string;
  color: string;
  conference?: string;
  espn_id?: string; // same id in every ESPN college sport (sports poller)
};

export const UNIVERSITIES: University[] = data.universities;
export const OTHER_SCHOOL = "other";

/** Registrable .edu domain of an email host, e.g. "cs.stanford.edu" -> "stanford.edu". */
export function eduDomain(host: string): string | null {
  const parts = host.toLowerCase().split(".");
  if (parts.length < 2 || parts[parts.length - 1] !== "edu") return null;
  return parts.slice(-2).join(".");
}

/**
 * Check an email against the chosen school. Listed schools must use their domain (subdomains allowed, e.g.
 * cs.wisc.edu). "other" accepts any .edu address and derives a school from its domain.
 * Returns the school to store, or an error message.
 */
export function schoolForEmail(email: string, schoolId: string): { school: University } | { error: string } {
  const m = /^[a-z0-9._%+-]+@([a-z0-9-]+(\.[a-z0-9-]+)+)$/.exec(email);
  if (!m) return { error: "Enter a valid email address." };
  const host = m[1];
  if (schoolId === OTHER_SCHOOL) {
    const domain = eduDomain(host);
    if (!domain) return { error: "Use your school's .edu email address." };
    const listed = UNIVERSITIES.find((u) => u.domain === domain);
    if (listed) return { school: listed };
    return {
      school: { school_id: `edu-${domain.replace(/\.edu$/, "")}`, name: domain, short_name: domain.replace(/\.edu$/, ""), domain, color: "#7c3aed" },
    };
  }
  const school = UNIVERSITIES.find((u) => u.school_id === schoolId);
  if (!school) return { error: "Pick your university." };
  if (host !== school.domain && !host.endsWith(`.${school.domain}`))
    return { error: `Use your @${school.domain} email for ${school.short_name}.` };
  return { school };
}
