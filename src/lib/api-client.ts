// Typed fetch wrapper for /api/v1 (client side).
import type { ApiError } from "@/types/dto";

export class ApiRequestError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(status: number, body: ApiError["error"]) {
    super(body.message);
    this.name = "ApiRequestError";
    this.code = body.code;
    this.status = status;
    this.details = body.details;
  }
}

export const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: init.signal,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as ApiError | null)?.error ?? { code: res.status === 401 ? "UNAUTHENTICATED" : "INTERNAL", message: res.status === 401 ? "You've been signed out." : "Something went wrong." };
    if (res.status === 401 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ccw:unauthenticated"));
    throw new ApiRequestError(res.status, err);
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>("GET", path, undefined, init),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  delete: <T = void>(path: string, body?: unknown) => request<T>("DELETE", path, body),
};

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
