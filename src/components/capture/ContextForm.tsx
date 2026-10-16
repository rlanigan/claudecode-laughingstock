"use client";
import { Chip, SectionLabel, TextArea } from "@/components/ui/primitives";
import { TagEditor } from "@/components/cards/TagPopover";
import { FORM_LABELS, type CardForm } from "@/types/dto";
import type { CaptureDraft } from "./useCapture";

const QUICK_FORMS: CardForm[] = ["observation", "line", "premise", "story"];

/** P2 fields (also embedded in M2): context, details, form chips, suggested tags. */
export function ContextForm({ draft, setDraft, suggestions, allForms = false }: { draft: CaptureDraft; setDraft: (p: Partial<CaptureDraft>) => void; suggestions: string[]; allForms?: boolean }) {
  const forms = allForms ? (Object.keys(FORM_LABELS) as CardForm[]) : QUICK_FORMS;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <SectionLabel htmlFor="ctx-context">Context · where, when, who</SectionLabel>
        <TextArea id="ctx-context" className="mt-1 min-h-[64px]" placeholder="Hospital waiting room, Tuesday…" value={draft.context} onChange={(e) => setDraft({ context: e.target.value })} maxLength={5000} />
      </div>
      <div>
        <SectionLabel htmlFor="ctx-details">Other details</SectionLabel>
        <TextArea id="ctx-details" className="mt-1 min-h-[64px]" placeholder="What made you laugh? Anything you want to remember later?" value={draft.details} onChange={(e) => setDraft({ details: e.target.value })} maxLength={5000} />
      </div>
      <div>
        <SectionLabel>What is it</SectionLabel>
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Form">
          {forms.map((f) => (
            <Chip key={f} variant={draft.form === f ? "dark" : "neutral"} pressed={draft.form === f} onClick={() => setDraft({ form: draft.form === f ? null : f })} className="!px-3 !py-2 md:!py-1">
              {FORM_LABELS[f]}
            </Chip>
          ))}
        </div>
      </div>
      <div>
        <SectionLabel>Tags · suggested from the text</SectionLabel>
        <div className="mt-1.5">
          <TagEditor value={draft.tags} onChange={(tags) => setDraft({ tags })} suggestions={suggestions} compact />
        </div>
      </div>
    </div>
  );
}
