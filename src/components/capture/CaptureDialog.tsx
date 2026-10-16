"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button, KeyHint } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useShell } from "@/components/shell/AppShell";
import { CaptureEditor, type CaptureEditorHandle } from "./CaptureEditor";
import { ContextForm } from "./ContextForm";
import { useCapture, useSubjectSuggestions } from "./useCapture";

/** M2 — desktop capture overlay (⌘N). Enter saves, Shift+Enter newline, Esc keeps the draft locally. */
export function CaptureDialog() {
  const open = useShell((s) => s.captureOpen);
  const setOpen = useShell((s) => s.setCapture);
  const { draft, setDraft, canSave, save } = useCapture({ source: "desktop" });
  const suggestions = useSubjectSuggestions(draft.text, open);
  const [showContext, setShowContext] = useState(false);
  const editor = useRef<CaptureEditorHandle>(null);
  useEffect(() => {
    if (open) setTimeout(() => editor.current?.focus(), 50);
  }, [open]);
  const submit = async () => {
    if (!canSave) return;
    if (await save()) {
      toast("Saved to inbox");
      setOpen(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen} title="Capture" description="Nothing is required. Esc keeps your draft on this device." width={560} screenId="M2" sheetOnPhone={false}
      footer={
        <>
          <span className="meta mr-auto self-center">
            <KeyHint>Enter</KeyHint> to save · <KeyHint>Shift+Enter</KeyHint> for a line break
          </span>
          <Button onClick={() => setShowContext((v) => !v)}>{showContext ? "Hide context" : "+ Context"}</Button>
          <Button variant="primary" disabled={!canSave} onClick={submit}>
            Add card
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <CaptureEditor ref={editor} value={draft.text} onChange={(text) => setDraft({ text })} onSubmit={submit} minHeight={140} size="desktop" submitOnEnter />
        <p className="meta">First line becomes the title. Everything else is the note.</p>
        {showContext ? (
          <ContextForm draft={draft} setDraft={setDraft} suggestions={suggestions} allForms />
        ) : (
          suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="meta mr-1">suggested</span>
              {suggestions
                .filter((s) => !draft.tags.includes(s))
                .map((s) => (
                  <button key={s} type="button" className="rounded-full border border-dashed border-dashed px-2 py-[3px] font-mono text-[10px] text-ink-2 hover:border-accent hover:text-accent-dark" onClick={() => setDraft({ tags: [...draft.tags, s] })}>
                    + {s}
                  </button>
                ))}
              {draft.tags.map((t) => (
                <span key={t} className="rounded-full bg-ink px-2 py-[3px] font-mono text-[10px] text-[#f1ece3]">
                  {t}
                </span>
              ))}
            </div>
          )
        )}
      </div>
    </Dialog>
  );
}
