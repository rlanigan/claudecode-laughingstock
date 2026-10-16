// IndexedDB (Dexie) storage for the capture draft and the outbox (HANDOFF.md §8).
import Dexie, { type EntityTable } from "dexie";
import type { CardForm } from "@/types/dto";

export interface DraftRow {
  id: "draft";
  text: string;
  context: string;
  details: string;
  form: CardForm | null;
  tags: string[];
  updatedAt: number;
}

export type OutboxStatus = "pending" | "syncing" | "error";

export interface OutboxRow {
  clientId: string;
  payload: {
    client_id: string;
    text: string;
    context: string | null;
    details: string | null;
    form: CardForm | null;
    subjects: string[];
    capture_source: "phone" | "desktop";
    captured_at: string;
  };
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: number;
}

export class OfflineDb extends Dexie {
  draft!: EntityTable<DraftRow, "id">;
  outbox!: EntityTable<OutboxRow, "clientId">;
  constructor() {
    super("ccw");
    this.version(1).stores({ draft: "id", outbox: "clientId, status, createdAt" });
  }
}

let instance: OfflineDb | null = null;
export function offlineDb(): OfflineDb {
  if (!instance) instance = new OfflineDb();
  return instance;
}
