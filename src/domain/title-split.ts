// Rule 7.3 — title split for capture and combined title+body editors.

export function splitTitle(text: string): { title: string | null; body: string } {
  const normalised = text.replace(/\r\n?/g, "\n").trim();
  const nl = normalised.indexOf("\n");
  if (nl < 0) return { title: null, body: normalised };
  const first = normalised.slice(0, nl).trim();
  const rest = normalised.slice(nl + 1).trim();
  if (first.length > 200) return { title: null, body: normalised };
  if (rest.length === 0) return { title: null, body: first };
  return { title: first, body: rest };
}

/** Inverse of splitTitle for editors that show title and body as one text. */
export function joinTitle(title: string | null, body: string): string {
  return title ? `${title}\n${body}` : body;
}

export function displayTitle(title: string | null, body: string, max = 60): string {
  if (title && title.trim()) return title.trim();
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[,.;:!?-]+$/, "")}…`;
}

export function wordCount(...parts: (string | null | undefined)[]): number {
  return parts
    .filter((p): p is string => !!p)
    .join(" ")
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

export function displayNumber(n: number): string {
  return `#${String(n).padStart(4, "0")}`;
}
