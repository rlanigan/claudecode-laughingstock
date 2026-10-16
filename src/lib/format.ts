export { displayNumber, displayTitle } from "@/domain/title-split";
export { formatMmSs, parseMmSs } from "@/domain/runtime";

export function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return shortDate(iso);
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function shortDateTime(iso: string): string {
  const d = new Date(iso);
  return `${shortDate(iso)}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

/** "9:12a" style time for the Today strip. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const suffix = h >= 12 ? "p" : "a";
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")}${suffix}`;
}

export function dateOnly(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function defaultAnchorName(d = new Date()): string {
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} order`;
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent);
export const modKey = () => (isMac() ? "⌘" : "Ctrl");
