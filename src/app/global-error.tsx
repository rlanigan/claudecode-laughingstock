"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f4f1ea", color: "#1f1d1a", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <main style={{ textAlign: "center", padding: 24 }}>
          <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: "#5a554d" }}>S14</p>
          <h1 style={{ fontSize: 24, fontWeight: 600 }}>Something went wrong. It&apos;s been reported.</h1>
          {error.digest && <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }}>ref {error.digest}</p>}
          <button type="button" onClick={reset} style={{ marginTop: 12, background: "#c2552d", color: "#fff", border: "1px solid #a9451f", borderRadius: 6, padding: "8px 12px" }}>
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
