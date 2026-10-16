// Opaque keyset cursors: base64url JSON of the sort key tuple.

function toBase64Url(s: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(s, "utf8").toString("base64url");
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(s, "base64url").toString("utf8");
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return decodeURIComponent(escape(atob(b)));
}

export function encodeCursor(value: unknown): string {
  return toBase64Url(JSON.stringify(value));
}

export function decodeCursor<T>(cursor: string): T | null {
  try {
    const parsed = JSON.parse(fromBase64Url(cursor));
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}
