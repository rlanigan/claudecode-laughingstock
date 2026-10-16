// Route-handler wrapper: session, Zod validation, error mapping, request id, rate limit.
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { DomainError } from "./errors";
import { logger } from "./logger";
import { getDb } from "./db";
import { env } from "./env";

export interface HandlerCtx<B, Q, P> {
  req: NextRequest;
  userId: string;
  body: B;
  query: Q;
  params: P;
  requestId: string;
}

interface HandlerOptions<B, Q> {
  body?: ZodType<B>;
  query?: ZodType<Q>;
  /** Default true. */
  auth?: boolean;
  /** Override the default per-user limit (requests per minute). */
  rateLimit?: { key: string; limit: number; windowSeconds: number };
}

type Params = Record<string, string>;
type RouteContext = { params: Promise<Params> };

/** Test seam: API tests inject a user id instead of going through Auth.js. */
let testUserResolver: (() => Promise<string | null>) | null = null;
export function __setTestUserResolver(fn: (() => Promise<string | null>) | null) {
  testUserResolver = fn;
}

async function resolveUserId(): Promise<string | null> {
  if (testUserResolver) return testUserResolver();
  const { currentUserId } = await import("./auth");
  return currentUserId();
}

export function errorResponse(code: string, message: string, status: number, details?: unknown, requestId?: string) {
  const res = NextResponse.json({ error: { code, message, details } }, { status });
  if (requestId) res.headers.set("x-request-id", requestId);
  return res;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function sameOrigin(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const o = new URL(origin);
      const u = new URL(req.url);
      if (o.host !== u.host) {
        const app = new URL(env.appUrl);
        return o.host === app.host;
      }
    } catch {
      return false;
    }
  }
  return true;
}

/** Postgres-backed fixed-window counter. Returns true when within the limit. */
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; retryAfter: number }> {
  const db = getDb();
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000);
  const rows = await db.execute(sql`
    insert into rate_limits (key, window_start, count) values (${key}, ${windowStart}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`);
  const count = Number((rows as unknown as { count: number }[])[0]?.count ?? 0);
  const retryAfter = Math.ceil((windowStart.getTime() + windowSeconds * 1000 - now) / 1000);
  return { ok: count <= limit, retryAfter };
}

export function handler<B = undefined, Q = undefined, P extends Params = Params>(
  options: HandlerOptions<B, Q>,
  fn: (ctx: HandlerCtx<B, Q, P>) => Promise<Response | object | null | void>,
) {
  return async (req: NextRequest, context?: RouteContext): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    const started = Date.now();
    let userId = "";
    try {
      if (options.auth !== false) {
        const id = await resolveUserId();
        if (!id) return errorResponse("UNAUTHENTICATED", "You've been signed out. Sign in again.", 401, undefined, requestId);
        userId = id;
        if (MUTATING.has(req.method)) {
          if (!sameOrigin(req)) return errorResponse("FORBIDDEN_ORIGIN", "Cross-origin request blocked.", 403, undefined, requestId);
          const ct = req.headers.get("content-type") ?? "";
          if (req.method !== "DELETE" && !ct.includes("application/json") && req.headers.get("content-length") !== "0" && req.headers.get("content-length") !== null) {
            return errorResponse("UNSUPPORTED_MEDIA_TYPE", "Send JSON.", 415, undefined, requestId);
          }
        }
        if (!env.isTest) {
          const rl = options.rateLimit ?? { key: "api", limit: 600, windowSeconds: 60 };
          const r = await checkRateLimit(`${rl.key}:${userId}`, rl.limit, rl.windowSeconds);
          if (!r.ok) {
            const res = errorResponse("RATE_LIMITED", "Slow down a moment, then try again.", 429, undefined, requestId);
            res.headers.set("Retry-After", String(r.retryAfter));
            return res;
          }
        }
      }
      const params = (context ? await context.params : {}) as P;
      let body = undefined as B;
      if (options.body) {
        let raw: unknown = undefined;
        const text = await req.text();
        if (text.length > 256 * 1024) return errorResponse("PAYLOAD_TOO_LARGE", "Request body too large.", 413, undefined, requestId);
        if (text.trim().length) {
          try {
            raw = JSON.parse(text);
          } catch {
            return errorResponse("VALIDATION_ERROR", "Body must be valid JSON.", 422, undefined, requestId);
          }
        }
        body = options.body.parse(raw ?? {});
      }
      let query = undefined as Q;
      if (options.query) {
        const obj: Record<string, string> = {};
        req.nextUrl.searchParams.forEach((v, k) => {
          obj[k] = v;
        });
        query = options.query.parse(obj);
      }
      const result = await fn({ req, userId, body, query, params, requestId });
      let res: Response;
      if (result instanceof Response) res = result;
      else if (result === null || result === undefined) res = new NextResponse(null, { status: 204 });
      else res = NextResponse.json(result);
      res.headers.set("x-request-id", requestId);
      logger.info({ request_id: requestId, user_id: userId || null, route: req.nextUrl.pathname, method: req.method, status: res.status, duration_ms: Date.now() - started });
      return res;
    } catch (err) {
      return mapError(err, { requestId, userId, route: req.nextUrl.pathname, method: req.method, started });
    }
  };
}

export function mapError(err: unknown, meta: { requestId: string; userId: string; route: string; method: string; started: number }) {
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return errorResponse("VALIDATION_ERROR", "Some fields need attention.", 422, details, meta.requestId);
  }
  if (err instanceof DomainError) {
    logger.info({ ...meta, error_code: err.code, status: err.status });
    return errorResponse(err.code, err.message, err.status, err.details, meta.requestId);
  }
  const e = err as Error & { code?: string };
  if (e && (e.code === "ECONNREFUSED" || e.code === "CONNECTION_ENDED" || e.code === "ENOTFOUND")) {
    logger.error({ ...meta, error_code: "SERVICE_UNAVAILABLE", err: e.message });
    return errorResponse("SERVICE_UNAVAILABLE", "We can't reach the server. Your captures are saved on this device.", 503, undefined, meta.requestId);
  }
  logger.error({ ...meta, error_code: "INTERNAL", err: e?.message, stack: e?.stack });
  return errorResponse("INTERNAL", "Something went wrong. It's been reported.", 500, undefined, meta.requestId);
}

export const created = (data: object) => NextResponse.json(data, { status: 201 });
export const noContent = () => new NextResponse(null, { status: 204 });
