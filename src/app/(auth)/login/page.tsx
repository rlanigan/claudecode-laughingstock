import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

/** S1 — Login (server wrapper; the form reads search params on the client). */
export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-bg" />}>
      <LoginForm />
    </Suspense>
  );
}
