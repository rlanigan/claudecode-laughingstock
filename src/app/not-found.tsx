import Link from "next/link";

/** S12 — Not found. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="meta">S12</span>
      <h1 className="font-serif text-[24px] font-semibold">That doesn&apos;t exist or was deleted.</h1>
      <div className="flex gap-2">
        <Link href="/inbox" className="rounded-md border border-border-strong bg-field px-3 py-2 text-[13px] max-md:hidden">
          Go to Inbox
        </Link>
        <Link href="/review" className="rounded-md border border-border-strong bg-field px-3 py-2 text-[13px] md:hidden">
          Go to Review
        </Link>
      </div>
    </main>
  );
}
