// Capture outbox: local-first saves that sync with a client id so retries never duplicate.
import { offlineDb, type OutboxRow } from "./db";
import { api, ApiRequestError } from "@/lib/api-client";
import type { CardDTO } from "@/types/dto";

type Listener = () => void;
const listeners = new Set<Listener>();
export function onOutboxChange(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
const notify = () => listeners.forEach((l) => l());

export async function listOutbox(): Promise<OutboxRow[]> {
  try {
    return await offlineDb().outbox.orderBy("createdAt").reverse().toArray();
  } catch {
    return [];
  }
}

export async function enqueueCapture(payload: OutboxRow["payload"]): Promise<void> {
  await offlineDb().outbox.put({ clientId: payload.client_id, payload, status: "pending", attempts: 0, lastError: null, createdAt: Date.now() });
  notify();
}

export async function updateOutboxPayload(clientId: string, payload: OutboxRow["payload"]) {
  await offlineDb().outbox.update(clientId, { payload, status: "pending", lastError: null });
  notify();
}

export async function discardOutboxItem(clientId: string) {
  await offlineDb().outbox.delete(clientId);
  notify();
}

const BACKOFF_MS = [2_000, 5_000, 15_000, 60_000];
let flushing = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Flushes pending items in order. Returns the cards created. */
export async function flushOutbox(onSynced?: (card: CardDTO) => void): Promise<number> {
  if (flushing) return 0;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
  flushing = true;
  let synced = 0;
  try {
    const rows = (await offlineDb().outbox.where("status").anyOf("pending", "syncing").toArray()).sort((a, b) => a.createdAt - b.createdAt);
    for (const row of rows) {
      await offlineDb().outbox.update(row.clientId, { status: "syncing" });
      notify();
      try {
        const { card } = await api.post<{ card: CardDTO }>("/cards", row.payload);
        await offlineDb().outbox.delete(row.clientId);
        synced++;
        onSynced?.(card);
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 422) {
          await offlineDb().outbox.update(row.clientId, { status: "error", lastError: err.message, attempts: row.attempts + 1 });
        } else if (err instanceof ApiRequestError && err.status === 401) {
          await offlineDb().outbox.update(row.clientId, { status: "pending", attempts: row.attempts });
          break;
        } else {
          const attempts = row.attempts + 1;
          await offlineDb().outbox.update(row.clientId, { status: "pending", attempts, lastError: (err as Error)?.message ?? "network" });
          scheduleRetry(attempts);
          break;
        }
      } finally {
        notify();
      }
    }
  } finally {
    flushing = false;
  }
  return synced;
}

function scheduleRetry(attempts: number) {
  if (timer) clearTimeout(timer);
  const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? 300_000;
  timer = setTimeout(() => {
    timer = null;
    void flushOutbox();
  }, attempts > BACKOFF_MS.length ? 300_000 : delay);
}

let started = false;
/** Flush on load, on `online`, and every 30 s while anything is pending. */
export function startOutboxSync(onSynced?: (card: CardDTO) => void) {
  if (started || typeof window === "undefined") return;
  started = true;
  void flushOutbox(onSynced);
  window.addEventListener("online", () => void flushOutbox(onSynced));
  setInterval(async () => {
    const pending = await offlineDb().outbox.where("status").equals("pending").count().catch(() => 0);
    if (pending > 0) void flushOutbox(onSynced);
  }, 30_000);
}
