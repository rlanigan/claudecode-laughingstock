"use client";
import Link from "next/link";
import { useEffect } from "react";

/** S14 — Error boundary. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="meta">S14</span>
      <h1 className="font-serif text-[24px] font-semibold">Something went wrong. It&apos;s been reported.</h1>
      {error.digest && <p className="meta">ref {error.digest}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={reset} className="rounded-md border border-accent-border bg-accent px-3 py-2 text-[13px] font-semibold text-white">
          Reload
        </button>
        <Link href="/" className="rounded-md border border-border-strong bg-field px-3 py-2 text-[13px]">
          Go home
        </Link>
      </div>
    </main>
  );
}
