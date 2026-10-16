"use server";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/server/auth";
import { checkRateLimit } from "@/server/http";
import { headers } from "next/headers";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function requestLink(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const next = String(formData.get("next") ?? "/");
  if (!EMAIL_RE.test(email) || email.length > 254) return { error: "Enter a valid email address." };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const perEmail = await checkRateLimit(`auth:${email}`, 5, 15 * 60).catch(() => ({ ok: true, retryAfter: 0 }));
  const perIp = await checkRateLimit(`auth-ip:${ip}`, 20, 60 * 60).catch(() => ({ ok: true, retryAfter: 0 }));
  if (!perEmail.ok || !perIp.ok) return { error: "Too many sign-in attempts. Try again in a few minutes." };
  try {
    await signIn("resend", { email, redirect: false, redirectTo: next.startsWith("/") ? next : "/" });
  } catch (err) {
    if (err instanceof AuthError) {
      // AccessDenied (allowlist) still shows the check-email screen so addresses cannot be enumerated.
      if (err.type !== "AccessDenied") return { error: "We couldn't send the link. Try again in a minute." };
    } else {
      return { error: "We couldn't send the link. Try again in a minute." };
    }
  }
  redirect(`/login/check-email?email=${encodeURIComponent(email)}`);
}
