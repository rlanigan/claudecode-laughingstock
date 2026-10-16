import { offlineDb, type DraftRow } from "./db";

export const EMPTY_DRAFT: Omit<DraftRow, "id" | "updatedAt"> = { text: "", context: "", details: "", form: null, tags: [] };

export async function loadDraft(): Promise<Omit<DraftRow, "id" | "updatedAt">> {
  try {
    const row = await offlineDb().draft.get("draft");
    if (!row) return { ...EMPTY_DRAFT };
    const { id: _id, updatedAt: _u, ...rest } = row;
    return rest;
  } catch {
    return { ...EMPTY_DRAFT };
  }
}

export async function saveDraft(draft: Omit<DraftRow, "id" | "updatedAt">) {
  try {
    await offlineDb().draft.put({ id: "draft", ...draft, updatedAt: Date.now() });
  } catch {
    // storage unavailable
  }
}

export async function clearDraft() {
  try {
    await offlineDb().draft.delete("draft");
  } catch {
    // ignore
  }
}
