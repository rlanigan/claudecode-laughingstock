"use client";
import { useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button, Chip, TextArea, cx } from "@/components/ui/primitives";
import { PART_KINDS, PART_LABELS, type PartDTO, type PartKind } from "@/types/dto";
import { announce } from "@/app/providers";

/** M21 — Add part: kind chooser then a text field. */
export function AddPartDialog({ open, onOpenChange, onAdd, initialKind }: { open: boolean; onOpenChange: (o: boolean) => void; onAdd: (kind: PartKind, body: string) => Promise<void> | void; initialKind?: PartKind }) {
  const [kind, setKind] = useState<PartKind>(initialKind ?? "alt_line");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setBody(""); }} title="Add a part" description="alt · tag · context · note · question" screenId="M21" width={440}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!body.trim() || busy} onClick={async () => { setBusy(true); try { await onAdd(kind, body.trim()); setBody(""); onOpenChange(false); } finally { setBusy(false); } }}>
            Add part
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Part kind">
          {PART_KINDS.map((k) => (
            <Chip key={k} variant={kind === k ? "dark" : "neutral"} pressed={kind === k} onClick={() => setKind(k)} className="!px-3 !py-2 md:!py-1">
              {PART_LABELS[k]}
            </Chip>
          ))}
        </div>
        <TextArea autoFocus value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === "question" ? "What are you still wondering?" : kind === "note" ? "Note to self…" : "Write the line…"} maxLength={5000} className="min-h-[90px]" />
      </div>
    </Dialog>
  );
}

function PartRow({ part, onEdit, onDelete }: { part: PartDTO; onEdit: (body: string) => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: part.id });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(part.body);
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cx("flex items-start gap-2 border-b border-divider-soft px-2 py-2 last:border-b-0", isDragging && "lifted bg-card")}>
      <button type="button" {...attributes} {...listeners} aria-label={`Reorder ${PART_LABELS[part.kind]}`} className="mt-0.5 cursor-grab text-ink-2 touch-none">
        <GripVertical size={14} aria-hidden />
      </button>
      <Chip className="mt-0.5 shrink-0">{PART_LABELS[part.kind]}</Chip>
      {editing ? (
        <TextArea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (text.trim() && text !== part.body) onEdit(text.trim());
          }}
          onKeyDown={(e) => { if (e.key === "Escape") { setText(part.body); setEditing(false); } }}
          className="min-h-[40px] flex-1"
        />
      ) : (
        <button type="button" className="min-w-0 flex-1 whitespace-pre-wrap text-left text-[13px] leading-[1.45] md:text-[13px]" onClick={() => setEditing(true)}>
          {part.body}
        </button>
      )}
      <button type="button" aria-label="Delete part" className="text-ink-2 hover:text-danger-text" onClick={onDelete}>
        ✕
      </button>
    </li>
  );
}

export function PartsList({ parts, onAdd, onEdit, onDelete, onReorder }: { parts: PartDTO[]; onAdd: (kind: PartKind, body: string) => Promise<void> | void; onEdit: (part: PartDTO, body: string) => void; onDelete: (part: PartDTO) => void; onReorder: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = parts.map((p) => p.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    onReorder(next);
    announce(`Part moved to position ${next.indexOf(String(active.id)) + 1} of ${next.length}`);
  };
  return (
    <div className="rounded-md border border-border bg-card">
      {parts.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={parts.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <ul>
              {parts.map((p) => (
                <PartRow key={p.id} part={p} onEdit={(b) => onEdit(p, b)} onDelete={() => onDelete(p)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      <button type="button" className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[13px] font-semibold text-accent-dark md:py-2" onClick={() => setOpen(true)}>
        + Add a part
        <span className="meta font-normal">alt · tag · context · note · question</span>
      </button>
      <AddPartDialog open={open} onOpenChange={setOpen} onAdd={onAdd} />
    </div>
  );
}
