import Link from "next/link";

/** S13 — Offline fallback served by the service worker for uncached routes. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="meta">S13</span>
      <h1 className="font-serif text-[24px] font-semibold">You&apos;re offline. Capture still works.</h1>
      <Link href="/capture" className="rounded-md border border-accent-border bg-accent px-4 py-2.5 text-[15px] font-semibold text-white">
        Open Capture
      </Link>
    </main>
  );
}
