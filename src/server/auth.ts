import NextAuth, { type NextAuthConfig } from "next-auth";
import Resend from "next-auth/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDb } from "./db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { env } from "./env";
import { logger } from "./logger";
import { ensureUserBootstrap } from "./services/users";

const NINETY_DAYS = 90 * 24 * 60 * 60;
const ONE_DAY = 24 * 60 * 60;

/** Dev transport: when no Resend key is configured the link is printed to the server console. */
async function sendVerificationRequest(params: { identifier: string; url: string; provider: { apiKey?: string; from?: string } }) {
  const { identifier, url } = params;
  const allowed = env.allowedEmails;
  if (allowed.length > 0 && !allowed.includes(identifier.toLowerCase())) {
    // Silent: the user still sees S2 so addresses cannot be enumerated.
    logger.info({ event: "signin_blocked_allowlist" });
    return;
  }
  if (!env.resendApiKey) {
    console.log(`\n[auth] Magic link for ${identifier}:\n${url}\n`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.emailFrom,
      to: identifier,
      subject: "Sign in to Cards",
      text: `Sign in to Cards:\n${url}\n\nIf you didn't ask for this, ignore this email.`,
      html: `<p>Sign in to <strong>Cards</strong>:</p><p><a href="${url}">Open the sign-in link</a></p><p>Open it on the device you want to use. If you didn't ask for this, ignore this email.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}`);
}

export const authConfig: NextAuthConfig = {
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Resend({
      apiKey: env.resendApiKey ?? "unused",
      from: env.emailFrom,
      maxAge: ONE_DAY,
      sendVerificationRequest,
    }),
  ],
  session: { strategy: "database", maxAge: NINETY_DAYS, updateAge: ONE_DAY },
  pages: { signIn: "/login", verifyRequest: "/login/check-email", error: "/login" },
  trustHost: true,
  callbacks: {
    async signIn({ user }) {
      const allowed = env.allowedEmails;
      if (allowed.length === 0) return true;
      return !!user.email && allowed.includes(user.email.toLowerCase());
    },
    async session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id) await ensureUserBootstrap(getDb(), user.id);
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/** Resolves the signed-in user's id or null. */
export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
