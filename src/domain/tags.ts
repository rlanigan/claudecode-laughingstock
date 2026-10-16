// Rule 7.6 — subject tag normalisation.

export const MAX_SUBJECTS_PER_CARD = 20;
export const MAX_SUBJECT_LENGTH = 40;

export function normalizeSubject(raw: string): string | null {
  let s = raw.toLowerCase().trim();
  s = s.replace(/^#+/, "");
  s = s.replace(/_/g, " ");
  s = s.replace(/[^a-z0-9 -]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^[-\s]+/, "");
  if (s.length === 0 || s.length > MAX_SUBJECT_LENGTH) return null;
  if (!/^[a-z0-9]/.test(s)) return null;
  return s;
}

export function normalizeSubjects(raw: string[]): { names: string[]; invalid: string[] } {
  const names: string[] = [];
  const invalid: string[] = [];
  for (const r of raw) {
    const n = normalizeSubject(r);
    if (n === null) invalid.push(r);
    else if (!names.includes(n)) names.push(n);
  }
  return { names, invalid };
}

/**
 * Deterministic suggestions: existing tag names appearing as whole words in the text
 * (case-insensitive, simple plural "s" stripped), ranked by usage, max 5.
 */
export function suggestSubjectsFromText(
  text: string,
  existing: { name: string; count: number }[],
  max = 5,
): string[] {
  const words = new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((w) => (w.endsWith("s") && w.length > 3 ? [w, w.slice(0, -1)] : [w])),
  );
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ")} `;
  return [...existing]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .filter((t) => {
      const name = t.name;
      if (name.includes(" ")) {
        return lower.includes(` ${name} `) || lower.includes(` ${name}s `);
      }
      const singular = name.endsWith("s") && name.length > 3 ? name.slice(0, -1) : name;
      return words.has(name) || words.has(singular) || words.has(`${name}s`);
    })
    .slice(0, max)
    .map((t) => t.name);
}

export function normalizeThemeName(raw: string): string | null {
  const s = raw.replace(/\s+/g, " ").trim();
  if (s.length === 0 || s.length > 120) return null;
  return s;
}
