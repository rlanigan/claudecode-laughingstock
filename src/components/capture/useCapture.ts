"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api-client";
import { clearDraft, EMPTY_DRAFT, loadDraft, saveDraft } from "@/lib/offline/draft";
import { enqueueCapture, flushOutbox } from "@/lib/offline/outbox";
import { qk } from "@/lib/query-keys";
import { toast } from "@/components/ui/toast";
import { splitTitle } from "@/domain/title-split";
import type { CardForm } from "@/types/dto";
import { track } from "@/lib/analytics";

export interface CaptureDraft {
  text: string;
  context: string;
  details: string;
  form: CardForm | null;
  tags: string[];
}

/**
 * Shared capture state for P1/P2/M2: draft persisted to IndexedDB 300 ms after typing stops,
 * local-first save into the outbox, and auto-save when the page is hidden with text present.
 */
export function useCapture(opts: { source: "phone" | "desktop"; saveOnHide?: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraftState] = useState<CaptureDraft>({ ...EMPTY_DRAFT });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    loadDraft().then((d) => {
      if (!alive) return;
      setDraftState(d);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const setDraft = useCallback((patch: Partial<CaptureDraft>) => {
    setDraftState((d) => {
      const next = { ...d, ...patch };
      draftRef.current = next;
      if (timer.current) clearTimeout(timer.current);
      setSaving(true);
      timer.current = setTimeout(() => {
        void saveDraft(next).then(() => setSaving(false));
      }, 300);
      return next;
    });
  }, []);

  const canSave = draft.text.trim().length > 0;

  const save = useCallback(async (): Promise<boolean> => {
    const d = draftRef.current;
    if (!d.text.trim()) return false;
    const { title, body } = splitTitle(d.text);
    if (title === null && body.length === 0) return false;
    const payload = {
      client_id: crypto.randomUUID(),
      text: d.text,
      context: d.context.trim() || null,
      details: d.details.trim() || null,
      form: d.form,
      subjects: d.tags,
      capture_source: opts.source,
      captured_at: new Date().toISOString(),
    };
    await enqueueCapture(payload);
    const empty = { ...EMPTY_DRAFT };
    draftRef.current = empty;
    setDraftState(empty);
    if (timer.current) clearTimeout(timer.current);
    await clearDraft();
    track("card_captured_local", { source: opts.source, has_title: !!title });
    void flushOutbox((card) => {
      qc.invalidateQueries({ queryKey: ["cards"] });
      qc.invalidateQueries({ queryKey: qk.me });
      qc.invalidateQueries({ queryKey: qk.today });
      void card;
    });
    qc.invalidateQueries({ queryKey: qk.today });
    return true;
  }, [opts.source, qc]);

  // Backgrounding with text saves (§F-02).
  useEffect(() => {
    if (!opts.saveOnHide) return;
    const onHide = () => {
      if (document.visibilityState === "hidden" && draftRef.current.text.trim()) {
        void save().then((ok) => ok && toast("Saved to inbox"));
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
    };
  }, [opts.saveOnHide, save]);

  return { draft, setDraft, loaded, saving, canSave, save };
}

/** Deterministic suggestions from the text (500 ms after typing stops). */
export function useSubjectSuggestions(text: string, enabled = true) {
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), 500);
    return () => clearTimeout(t);
  }, [text]);
  const q = useQuery({
    queryKey: ["subjects", "suggest", debounced],
    queryFn: () => api.get<{ suggestions: { name: string; existing: boolean }[] }>(`/subjects/suggest${qs({ text: debounced.slice(0, 2000) })}`),
    enabled: enabled && debounced.trim().length >= 3,
    staleTime: 60_000,
  });
  return q.data?.suggestions.map((s) => s.name) ?? [];
}
