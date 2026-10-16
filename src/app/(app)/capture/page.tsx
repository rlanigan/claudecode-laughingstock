"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { PhonePage } from "@/components/shell/ScreenFrame";
import { CaptureEditor, type CaptureEditorHandle } from "@/components/capture/CaptureEditor";
import { TodayStrip } from "@/components/capture/TodayStrip";
import { useCapture } from "@/components/capture/useCapture";
import { Button, Chip } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useIsPhone, useKeyboardOpenClass, useMe, useMounted, useOnline } from "@/lib/hooks";
import { useShell } from "@/components/shell/AppShell";
import { readLocal, writeLocal } from "@/lib/storage";
import { TagDialog } from "@/components/cards/TagPopover";
import { useSubjectSuggestions } from "@/components/capture/useCapture";
import { updateOutboxPayload } from "@/lib/offline/outbox";
import type { OutboxRow } from "@/lib/offline/db";

/** P1 — Capture (phone landing). On desktop widths this redirects to /inbox with M2 open. */
export default function CapturePage() {
  const phone = useIsPhone();
  const mounted = useMounted();
  const router = useRouter();
  const setCapture = useShell((s) => s.setCapture);
  useEffect(() => {
    if (mounted && !phone) {
      setCapture(true);
      router.replace("/inbox");
    }
  }, [mounted, phone, router, setCapture]);
  if (!mounted || !phone) return null;
  return <PhoneCapture />;
}

function PhoneCapture() {
  const { draft, setDraft, loaded, canSave, save } = useCapture({ source: "phone", saveOnHide: true });
  const suggestions = useSubjectSuggestions(draft.text);
  const { data: me } = useMe();
  const online = useOnline();
  const editor = useRef<CaptureEditorHandle>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [hint, setHint] = useState(false);
  const [installHint, setInstallHint] = useState(false);
  useKeyboardOpenClass(true);

  useEffect(() => {
    setHint(!readLocal("hintCaptureSeen", false));
    const captures = readLocal<number>("captureCount", 0);
    const isIos = /iPhone|iPad/.test(navigator.userAgent) && !("standalone" in navigator && (navigator as unknown as { standalone: boolean }).standalone);
    setInstallHint(isIos && captures >= 3 && !readLocal("installHintSeen", false));
  }, []);

  const onSave = async () => {
    if (await save()) {
      toast("Saved to inbox");
      writeLocal("captureCount", readLocal<number>("captureCount", 0) + 1);
      editor.current?.focus();
    }
  };

  const fixOutbox = (row: OutboxRow) => {
    setDraft({ text: row.payload.text, context: row.payload.context ?? "", details: row.payload.details ?? "", form: row.payload.form, tags: row.payload.subjects });
    void updateOutboxPayload(row.clientId, row.payload).then(() => import("@/lib/offline/outbox").then((m) => m.discardOutboxItem(row.clientId)));
    toast("Loaded into the editor. Fix it and save again.", { durationMs: 3000 });
  };

  return (
    <PhonePage id="P1" title="New note" right={<Link href="/review?view=inbox"><Chip variant="accent">Inbox {me?.counts.inbox ?? 0}</Chip></Link>}>
      {!online && <div role="status" className="bg-accent-tint px-4 py-1 text-center text-[12px] text-accent-dark">Offline · notes will sync later</div>}
      <div className="flex flex-col gap-3 p-4">
        {hint && (
          <div className="flex items-start justify-between gap-3 rounded-[10px] border border-border bg-surface px-3 py-2.5 text-[13px] text-ink-body">
            <span>Type anything. First line becomes the title. Nothing is required.</span>
            <button type="button" className="shrink-0 font-semibold text-accent-dark" onClick={() => { writeLocal("hintCaptureSeen", true); setHint(false); }}>
              Got it
            </button>
          </div>
        )}
        <div>
          <CaptureEditor ref={editor} value={loaded ? draft.text : ""} onChange={(text) => setDraft({ text })} autoFocus minHeight={260} />
          <p className="meta mt-1.5">First line becomes the title. Everything else is the note.</p>
        </div>
        <div className="grid grid-cols-[1fr_1fr_48px] gap-2">
          <Link href="/capture/context" className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-border-strong bg-field text-[14px]">
            + Context
          </Link>
          <Button onClick={() => setTagOpen(true)}>+ Tag{draft.tags.length ? ` (${draft.tags.length})` : ""}</Button>
          <Button aria-label="Record voice note" onClick={() => { editor.current?.focus(); toast("Use the microphone on your keyboard to dictate", { durationMs: 3000 }); }}>
            <Mic size={18} strokeWidth={1.75} aria-hidden />
          </Button>
        </div>
        <Button variant="primary" size="lg" full disabled={!canSave} onClick={onSave}>
          Save to inbox
        </Button>
        <p className="text-center text-[12px] text-ink-2">Nothing is required. Closing the app saves too.</p>
        {installHint && (
          <div className="flex items-start justify-between gap-3 rounded-[10px] border border-border bg-surface px-3 py-2.5 text-[13px]">
            <span>Add Cards to your Home Screen for one-tap capture: Share → Add to Home Screen.</span>
            <button type="button" className="shrink-0 text-accent-dark" onClick={() => { writeLocal("installHintSeen", true); setInstallHint(false); }}>✕</button>
          </div>
        )}
        <TodayStrip onFix={fixOutbox} />
      </div>
      <TagDialog open={tagOpen} onOpenChange={setTagOpen} value={draft.tags} suggestions={suggestions} onSave={(tags) => setDraft({ tags })} />
    </PhonePage>
  );
}
