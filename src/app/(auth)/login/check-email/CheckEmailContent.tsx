"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { requestLink } from "../actions";
import { ScreenIdBadge } from "@/components/ui/primitives";

/** S2 — Check email. */
export function CheckEmailContent() {
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const [cooldown, setCooldown] = useState(30);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-[360px] rounded-[10px] border border-border bg-surface p-6 shadow-card">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="font-serif text-[24px] font-semibold">Check your email</h1>
          <ScreenIdBadge id="S2" />
        </div>
        <p className="text-[13px] text-ink-body">
          We sent a sign-in link to <strong>{email}</strong>. Open it on the device you want to use.
        </p>
        <div className="mt-5 flex items-center justify-between">
          <Link href="/login" className="text-[13px] font-semibold text-accent-dark hover:underline">
            Use a different email
          </Link>
          <button
            type="button"
            disabled={cooldown > 0}
            className="rounded-md border border-border-strong bg-field px-3 py-1.5 text-[12px] disabled:opacity-45"
            onClick={async () => {
              const fd = new FormData();
              fd.set("email", email);
              await requestLink(undefined, fd);
              setSent(true);
              setCooldown(30);
            }}
          >
            {cooldown > 0 ? `Resend link (${cooldown}s)` : sent ? "Resent" : "Resend link"}
          </button>
        </div>
      </div>
    </main>
  );
}
