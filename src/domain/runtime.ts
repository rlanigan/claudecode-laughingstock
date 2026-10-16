// Rule 7.9 — runtime estimates. Pure.

export const DEFAULT_WPM = 150;

/** Bit duration: override if set, else words ÷ wpm × 60 rounded to the nearest 5 s. */
export function bitDurationSeconds(words: number, wpm: number, override: number | null): number {
  if (override !== null && override !== undefined) return override;
  const raw = (words / Math.max(wpm, 1)) * 60;
  return Math.round(raw / 5) * 5;
}

export function transitionSeconds(words: number, wpm: number): number {
  return (words / Math.max(wpm, 1)) * 60;
}

export function formatMmSs(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function parseMmSs(text: string): number | null {
  const m = /^\s*(\d{1,3}):([0-5]\d)\s*$/.exec(text);
  if (!m) {
    const n = Number(text);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  return Number(m[1]) * 60 + Number(m[2]);
}
