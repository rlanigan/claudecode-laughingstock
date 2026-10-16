import pino from "pino";
import { env } from "./env";

/**
 * Structured JSON logs to stdout. Never log note text, parts, transcripts, prompts or emails.
 */
export const logger = pino({
  level: env.isTest ? "silent" : env.logLevel,
  base: undefined,
  redact: { paths: ["email", "*.email", "body", "text", "cookie", "headers.cookie"], remove: true },
});
