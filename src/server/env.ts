// Typed access to environment variables (HANDOFF.md §15).

const bool = (v: string | undefined) => v === "true" || v === "1";

export const env = {
  get appUrl() {
    return process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? "http://localhost:3000";
  },
  get allowedEmails(): string[] {
    return (process.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  get resendApiKey() {
    return process.env.RESEND_API_KEY || null;
  },
  get emailFrom() {
    return process.env.EMAIL_FROM || "Cards <signin@example.com>";
  },
  get cronSecret() {
    return process.env.CRON_SECRET || null;
  },
  get aiEnabled() {
    return bool(process.env.AI_FEATURES_ENABLED);
  },
  get aiModel() {
    return process.env.AI_MODEL || "claude-opus-5-5";
  },
  get anthropicApiKey() {
    return process.env.ANTHROPIC_API_KEY || null;
  },
  get transcriptionEnabled() {
    return bool(process.env.TRANSCRIPTION_ENABLED);
  },
  get logLevel() {
    return process.env.LOG_LEVEL || "info";
  },
  get showScreenIds() {
    return bool(process.env.NEXT_PUBLIC_SHOW_SCREEN_IDS);
  },
  get isTest() {
    return process.env.NODE_ENV === "test";
  },
};
