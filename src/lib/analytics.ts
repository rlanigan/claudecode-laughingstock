// Client-side product analytics: fire-and-forget to the server's first-party log via the API.
// Properties never include note text.
export function track(name: string, properties: Record<string, unknown> = {}) {
  try {
    const body = JSON.stringify({ name, properties });
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      navigator.sendBeacon("/api/v1/analytics", new Blob([body], { type: "application/json" }));
    }
  } catch {
    // analytics must never break the UI
  }
}
