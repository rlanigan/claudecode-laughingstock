"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api-client";
import { normalizeSubject, MAX_SUBJECTS_PER_CARD } from "@/domain/tags";
import { Chip, cx } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { useDebounced } from "@/lib/hooks";

/**
 * M5 — tag editor body: selected chips with ×, suggestions, and a text input with
 * prefix autocomplete. Enter adds (creates if new). Max 20.
 */
export function TagEditor({ value, onChange, suggestions = [], autoFocus, compact }: { value: string[]; onChange: (next: string[]) => void; suggestions?: string[]; autoFocus?: boolean; compact?: boolean }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dq = useDebounced(text, 150);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data } = useQuery({
    queryKey: ["subjects", "autocomplete", dq],
    queryFn: () => api.get<{ items: { id: string; name: string; count: number }[] }>(`/subjects/autocomplete${qs({ q: dq })}`),
    enabled: dq.trim().length > 0,
  });
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const add = (raw: string) => {
    const n = normalizeSubject(raw);
    if (!n) {
      setError("Tags can use letters, numbers, spaces and hyphens (max 40).");
      return;
    }
    if (value.includes(n)) {
      setText("");
      return;
    }
    if (value.length >= MAX_SUBJECTS_PER_CARD) {
      setError("A card can have up to 20 tags.");
      return;
    }
    setError(null);
    onChange([...value, n]);
    setText("");
  };
  const remove = (n: string) => onChange(value.filter((v) => v !== n));
  const completions = (data?.items ?? []).filter((i) => !value.includes(i.name)).slice(0, 6);
  const suggested = suggestions.filter((s) => !value.includes(s));

  return (
    <div className="flex flex-col gap-2">
      {suggested.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <span className="meta mr-1 self-center">suggested</span>
          {suggested.map((s) => (
            <Chip key={s} variant="dashed" onClick={() => add(s)} title={`Add ${s}`}>
              + {s}
            </Chip>
          ))}
        </div>
      )}
      <div className={cx("flex flex-wrap items-center gap-1 rounded-md border border-border bg-field px-2 py-1.5", compact && "py-1")}>
        {value.map((v) => (
          <Chip key={v} variant="dark">
            {v}
            <button type="button" aria-label={`Remove ${v}`} className="ml-0.5 opacity-70 hover:opacity-100" onClick={() => remove(v)}>
              ×
            </button>
          </Chip>
        ))}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              if (text.trim()) add(text);
            } else if (e.key === "Backspace" && !text && value.length) {
              remove(value[value.length - 1]);
            }
          }}
          placeholder={value.length ? "" : "Add a subject…"}
          className="min-w-[120px] flex-1 bg-transparent py-1 text-[13px] outline-none"
          aria-label="Add subject tag"
          autoComplete="off"
        />
      </div>
      {completions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {completions.map((c) => (
            <Chip key={c.id} onClick={() => add(c.name)}>
              {c.name} <span className="opacity-60">{c.count}</span>
            </Chip>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-[12px] text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}

/** M5 as a popover/sheet wrapping the editor; commits on close. */
export function TagDialog({ open, onOpenChange, value, suggestions, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; value: string[]; suggestions?: string[]; onSave: (tags: string[]) => void | Promise<void> }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) void onSave(draft);
        onOpenChange(o);
      }}
      title="Subject tags"
      description="Nouns for what the card is about. Enter adds, × removes."
      screenId="M5"
      width={420}
    >
      <TagEditor value={draft} onChange={setDraft} suggestions={suggestions} autoFocus />
    </Dialog>
  );
}
