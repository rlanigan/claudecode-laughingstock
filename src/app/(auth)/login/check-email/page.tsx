import { Suspense } from "react";
import { CheckEmailContent } from "./CheckEmailContent";

export const metadata = { title: "Check your email" };

/** S2 — Check email. */
export default function CheckEmailPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-bg" />}>
      <CheckEmailContent />
    </Suspense>
  );
}
