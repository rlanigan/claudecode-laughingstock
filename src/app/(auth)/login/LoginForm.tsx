"use client";
import { useActionState, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { requestLink } from "./actions";
import { readLocal, writeLocal } from "@/lib/storage";
import { ScreenIdBadge } from "@/components/ui/primitives";

/** S1 — Login. */
export function LoginForm() {
  const params = useSearchParams();
  const [state, action, pending] = useActionState(requestLink, undefined);
  const [email, setEmail] = useState("");
  useEffect(() => {
    setEmail(readLocal("lastEmail", ""));
  }, []);
  const urlError = params.get("error");
  const linkError = urlError === "Verification" ? "That link has expired. Enter your email for a new one." : urlError ? "We couldn't sign you in. Try again." : null;
  const error = state?.error ?? linkError;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        action={action}
        onSubmit={() => writeLocal("lastEmail", email.trim().toLowerCase())}
        className="w-full max-w-[360px] rounded-[10px] border border-border bg-surface p-6 shadow-card"
      >
        <div className="mb-1 flex items-center justify-between">
          <span className="font-serif text-[24px] font-semibold">Cards</span>
          <ScreenIdBadge id="S1" />
        </div>
        <p className="mb-5 text-[13px] text-ink-2">Your comedy, one card at a time.</p>
        <label className="block">
          <span className="label mb-1 block">Email</span>
          <input name="email" type="email" autoComplete="email" inputMode="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error || undefined} aria-describedby={error ? "login-error" : undefined} />
        </label>
        <input type="hidden" name="next" value={params.get("next") ?? "/"} />
        {error && (
          <p id="login-error" role="alert" className="mt-2 text-[12px] text-danger-text">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending} className="mt-4 w-full rounded-md border border-accent-border bg-accent px-3 py-2.5 text-[14px] font-semibold text-white hover:bg-accent-hover disabled:opacity-45">
          {pending ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>
    </main>
  );
}
