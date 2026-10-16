"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { PhonePage } from "@/components/shell/ScreenFrame";
import { ContextForm } from "@/components/capture/ContextForm";
import { useCapture, useSubjectSuggestions } from "@/components/capture/useCapture";
import { Button } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { splitTitle } from "@/domain/title-split";
import { useIsPhone, useKeyboardOpenClass, useMounted } from "@/lib/hooks";
import { useShell } from "@/components/shell/AppShell";

/** P2 — Capture with context. Shares the IndexedDB draft with P1. */
export default function CaptureContextPage() {
  const phone = useIsPhone();
  const mounted = useMounted();
  const router = useRouter();
  const setCapture = useShell((s) => s.setCapture);
  const { draft, setDraft, loaded, saving, canSave, save } = useCapture({ source: "phone", saveOnHide: true });
  const suggestions = useSubjectSuggestions(draft.text);
  useKeyboardOpenClass(true);
  useEffect(() => {
    if (mounted && !phone) {
      setCapture(true);
      router.replace("/inbox");
    }
  }, [mounted, phone, router, setCapture]);
  if (!mounted || !phone) return null;
  const { title, body } = splitTitle(draft.text);
  return (
    <PhonePage id="P2" left={<Link href="/capture" className="text-[15px] text-accent-dark">‹ Back</Link>} title="New note" right={<span className="meta">{saving ? "saving…" : "draft saved"}</span>}>
      <div className="flex flex-col gap-4 p-4">
        <Link href="/capture" className="block rounded-[10px] border border-border bg-card px-3.5 py-3">
          {title && <div className="text-[17px] font-semibold">{title}</div>}
          <div className="text-[15px] text-ink-body">{loaded ? body || <span className="text-ink-2">Tap to write the note…</span> : ""}</div>
        </Link>
        <ContextForm draft={draft} setDraft={setDraft} suggestions={suggestions} />
        <Button variant="primary" size="lg" full disabled={!canSave} onClick={async () => { if (await save()) { toast("Saved to inbox"); router.push("/capture"); } }}>
          Save to inbox
        </Button>
        <p className="text-center text-[12px] text-ink-2">All of this is optional and editable later in Review.</p>
      </div>
    </PhonePage>
  );
}
