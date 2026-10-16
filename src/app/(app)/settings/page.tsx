"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { api } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { DesktopPage, PhonePage } from "@/components/shell/ScreenFrame";
import { Button, Chip, SectionLabel, TextInput, cx } from "@/components/ui/primitives";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useIsPhone, useMe, useMounted } from "@/lib/hooks";
import { signOutAction } from "./actions";
import type { QuestionTemplateDTO, SettingsDTO } from "@/types/dto";

/** S6 — Settings. */
export default function SettingsPage() {
  const phone = useIsPhone();
  const mounted = useMounted();
  if (!mounted) return null;
  const body = <SettingsBody />;
  if (phone) return <PhonePage id="S6" title="Settings">{body}</PhonePage>;
  return <DesktopPage id="S6"><div className="h-full overflow-y-auto">{body}</div></DesktopPage>;
}

function Section({ title, children, danger }: { title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <section className={cx("rounded-[10px] border bg-card p-4", danger ? "border-danger-text/50" : "border-border")}>
      <h3 className="mb-3 font-serif text-[16px] font-semibold">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function SettingsBody() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [name, setName] = useState("");
  const [wpm, setWpm] = useState(150);
  const [consent, setConsent] = useState(false);
  const [del, setDel] = useState(false);
  useEffect(() => {
    if (me) {
      setName(me.user.name ?? "");
      setWpm(me.settings.reading_wpm);
    }
  }, [me]);
  const saveName = useMutation({ mutationFn: (n: string) => api.patch("/me", { name: n || null }), onSuccess: () => { qc.invalidateQueries({ queryKey: qk.me }); toast("Saved"); } });
  const saveSettings = useMutation({
    mutationFn: (patch: Partial<Pick<SettingsDTO, "ai_assist_enabled" | "reading_wpm">>) => api.patch<{ settings: SettingsDTO }>("/me/settings", patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.me }); qc.invalidateQueries({ queryKey: ["bit"] }); qc.invalidateQueries({ queryKey: ["set"] }); toast("Saved"); },
    onError: (e) => toast(e.message, { durationMs: 4000 }),
  });
  const deleteAccount = useMutation({ mutationFn: () => api.delete("/me", { confirm: "DELETE" }), onSuccess: () => { window.location.href = "/login"; } });
  const s = me?.settings;
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4 p-4 md:p-5">
      <h2 className="font-serif text-[18px] font-semibold">Settings</h2>
      <Section title="Account">
        <label className="block">
          <SectionLabel>Display name</SectionLabel>
          <TextInput className="mt-1" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => me && name !== (me.user.name ?? "") && saveName.mutate(name.trim())} maxLength={80} />
        </label>
        <div>
          <SectionLabel>Email</SectionLabel>
          <div className="mt-1 text-[13px]">{me?.user.email ?? "…"}</div>
        </div>
        <form action={signOutAction}><Button type="submit">Sign out</Button></form>
      </Section>
      <Section title="Writing">
        <label className="block">
          <SectionLabel>Reading speed (words per minute)</SectionLabel>
          <div className="mt-1 flex items-center gap-2">
            <input type="number" min={90} max={220} className="field w-[120px]" value={wpm} onChange={(e) => setWpm(Number(e.target.value))} onBlur={() => s && wpm !== s.reading_wpm && wpm >= 90 && wpm <= 220 && saveSettings.mutate({ reading_wpm: wpm })} />
            <span className="meta">90–220 · used for bit and set runtimes</span>
          </div>
        </label>
      </Section>
      <Section title="Question deck"><QuestionDeck /></Section>
      <Section title="AI assist">
        <label className="flex items-start gap-3 text-[13px]">
          <input type="checkbox" className="mt-0.5" checked={!!s?.ai_assist_enabled} disabled={!s?.ai_available} onChange={(e) => { if (e.target.checked) setConsent(true); else saveSettings.mutate({ ai_assist_enabled: false }); }} title={s && !s.ai_available ? "AI assist isn't available on this server." : undefined} />
          <span>
            <span className="font-semibold">Suggest tags and forms using AI</span>
            <span className="block text-ink-2">Off by default. When on, the text of a note is sent to Anthropic to suggest tags. Nothing is used to write jokes.{s && !s.ai_available ? " Not available on this server." : ""}</span>
          </span>
        </label>
        <Dialog open={consent} onOpenChange={setConsent} title="Turn on AI assist?" screenId="M20" footer={<><Button onClick={() => setConsent(false)}>Cancel</Button><Button variant="primary" onClick={() => { saveSettings.mutate({ ai_assist_enabled: true }); setConsent(false); }}>Turn on</Button></>}>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-ink-body">
            <li><strong>What is sent:</strong> the text of a note, its context, and the names of your existing tags.</li>
            <li><strong>To whom:</strong> the Anthropic API.</li>
            <li><strong>Used for:</strong> suggesting subject tags, guessing a card&apos;s form, and phrasing theme labels. Never for writing jokes.</li>
            <li>You can turn it off anytime.</li>
          </ul>
        </Dialog>
      </Section>
      <Section title="Data">
        <div className="flex items-center gap-3">
          <a href="/api/v1/me/export" className="inline-flex min-h-[44px] items-center rounded-md border border-border-strong bg-field px-3 text-[13px] md:min-h-[30px]">Export everything</a>
          <span className="meta">ZIP with JSON and Markdown. A weekly export is a good habit.</span>
        </div>
      </Section>
      <Section title="Danger zone" danger>
        <div className="flex items-center gap-3">
          <Button variant="danger" onClick={() => setDel(true)}>Delete account</Button>
          <span className="meta">Deletes all cards, boards, sessions, sets and recordings immediately.</span>
        </div>
        <ConfirmDialog open={del} onOpenChange={setDel} screenId="M19" title="Delete your account?" body="This permanently deletes every card, board, workshop session, bit, set, anchor, performance and recording. There is no undo." confirmLabel="Delete account" requireText="DELETE" onConfirm={() => deleteAccount.mutateAsync().then(() => undefined)} />
      </Section>
    </div>
  );
}

function TemplateRow({ t, onPatch }: { t: QuestionTemplateDTO; onPatch: (p: Partial<QuestionTemplateDTO>) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: t.id });
  const [text, setText] = useState(t.text);
  const [short, setShort] = useState(t.short_label);
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cx("flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2", t.archived && "opacity-50")}>
      <button type="button" {...attributes} {...listeners} aria-label="Reorder" className="cursor-grab text-ink-2 touch-none"><GripVertical size={14} aria-hidden /></button>
      <input className="field min-w-[200px] flex-1 !py-1 text-[13px]" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() && text !== t.text && onPatch({ text: text.trim() })} aria-label="Question text" />
      <input className="field w-[160px] !py-1 text-[12px]" value={short} onChange={(e) => setShort(e.target.value)} onBlur={() => short.trim() && short !== t.short_label && onPatch({ short_label: short.trim() })} aria-label="Short label" />
      {t.system_key ? <Chip>{t.category}</Chip> : (
        <select className="field w-[110px] !py-1 text-[12px]" value={t.category} onChange={(e) => onPatch({ category: e.target.value as QuestionTemplateDTO["category"] })} aria-label="Category">
          <option value="analyze">analyze</option><option value="audience">audience</option><option value="build">build</option>
        </select>
      )}
      <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={t.archived} onChange={(e) => onPatch({ archived: e.target.checked })} /> archived</label>
    </li>
  );
}

function QuestionDeck() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: [...qk.templates, "all"], queryFn: () => api.get<{ items: QuestionTemplateDTO[] }>("/question-templates?include_archived=true") });
  const [adding, setAdding] = useState(false);
  const [nt, setNt] = useState({ text: "", short_label: "", category: "analyze" as "analyze" | "audience" | "build" });
  const refresh = () => qc.invalidateQueries({ queryKey: qk.templates });
  const patch = useMutation({ mutationFn: ({ id, p }: { id: string; p: Partial<QuestionTemplateDTO> }) => api.patch(`/question-templates/${id}`, p), onSuccess: refresh, onError: (e) => toast(e.message) });
  const reorder = useMutation({ mutationFn: (ids: string[]) => api.put("/question-templates/order", { ids }), onSuccess: refresh });
  const create = useMutation({ mutationFn: () => api.post("/question-templates", nt), onSuccess: () => { refresh(); setAdding(false); setNt({ text: "", short_label: "", category: "analyze" }); } });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const items = data?.items ?? [];
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = items.map((i) => i.id);
    reorder.mutate(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="meta">Drag to reorder. Built-in questions can be archived but not deleted. The laugh-size rating lives in the inspector.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-1.5">{items.map((t) => <TemplateRow key={t.id} t={t} onPatch={(p) => patch.mutate({ id: t.id, p })} />)}</ul>
        </SortableContext>
      </DndContext>
      {adding ? (
        <form className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-dashed p-2" onSubmit={(e) => { e.preventDefault(); if (nt.text.trim() && nt.short_label.trim()) create.mutate(); }}>
          <TextInput autoFocus placeholder="Question" value={nt.text} onChange={(e) => setNt({ ...nt, text: e.target.value })} className="min-w-[200px] flex-1 !py-1" maxLength={200} />
          <TextInput placeholder="Short label" value={nt.short_label} onChange={(e) => setNt({ ...nt, short_label: e.target.value })} className="w-[160px] !py-1" maxLength={40} />
          <select className="field w-[110px] !py-1 text-[12px]" value={nt.category} onChange={(e) => setNt({ ...nt, category: e.target.value as typeof nt.category })}><option value="analyze">analyze</option><option value="audience">audience</option><option value="build">build</option></select>
          <Button type="submit" size="sm" variant="primary" disabled={!nt.text.trim() || !nt.short_label.trim()}>Add</Button>
          <Button size="sm" onClick={() => setAdding(false)}>Cancel</Button>
        </form>
      ) : (
        <Button size="sm" onClick={() => setAdding(true)} className="self-start">+ Add question</Button>
      )}
    </div>
  );
}
