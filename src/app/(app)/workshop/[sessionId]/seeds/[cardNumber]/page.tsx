"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiRequestError } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { CenterHeader, DesktopPage, Inspector, InspectorSection, PhonePage } from "@/components/shell/ScreenFrame";
import { RailItem, RailSection } from "@/components/shell/LeftRail";
import { Button, Chip, EmptyState, SkeletonRows, TextArea, TextInput, cx } from "@/components/ui/primitives";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { WorkshopCanvas, QUESTION_DROP_TYPE } from "@/components/workshop/WorkshopCanvas";
import { CardChips } from "@/components/cards/CardChips";
import { useCardList } from "@/components/cards/hooks";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { readLocal, writeLocal } from "@/lib/storage";
import { shortDate, shortDateTime } from "@/lib/format";
import { toast } from "@/components/ui/toast";
import type { BranchDTO, LaughSize, MapDTO, NodeDTO, QuestionDTO, QuestionTemplateDTO, SessionSummaryDTO } from "@/types/dto";

function useSession(id: string) {
  return useQuery({ queryKey: qk.session(id), queryFn: () => api.get<{ session: SessionSummaryDTO }>(`/workshop/sessions/${id}`).then((r) => r.session) });
}
function useMap(n: number) {
  return useQuery({ queryKey: qk.map(n), queryFn: () => api.get<MapDTO>(`/workshop/maps/${n}`) });
}
function useTemplates() {
  return useQuery({ queryKey: qk.templates, queryFn: () => api.get<{ items: QuestionTemplateDTO[] }>("/question-templates").then((r) => r.items), staleTime: 300_000 });
}

/** D5 (desktop) / P5 (phone) — Workshop map for one seed. */
export default function SeedPage() {
  const { sessionId, cardNumber } = useParams<{ sessionId: string; cardNumber: string }>();
  const n = Number(cardNumber);
  const phone = useIsPhone();
  const mounted = useMounted();
  const map = useMap(n);
  if (!mounted) return null;
  if (map.error instanceof ApiRequestError && map.error.status === 404) return <EmptyState title="This card hasn't been seeded in the workshop." action={<Link href={`/cards/${n}`} className="text-accent-dark">Open the card</Link>} />;
  if (!map.data) return <SkeletonRows n={4} />;
  return phone ? <SeedPhone sessionId={sessionId} map={map.data} /> : <SeedDesktop sessionId={sessionId} map={map.data} />;
}

function useWorkshopMutations(sessionId: string, cardNumber: number) {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: qk.map(cardNumber) }); qc.invalidateQueries({ queryKey: ["workshop", "branch", cardNumber] }); qc.invalidateQueries({ queryKey: qk.session(sessionId) }); qc.invalidateQueries({ queryKey: qk.card(cardNumber) }); qc.invalidateQueries({ queryKey: ["cards"] }); };
  const ask = useMutation({ mutationFn: ({ nodeId, template_id, text, save_to_deck }: { nodeId: string; template_id?: string; text?: string; save_to_deck?: boolean }) => api.post<{ rating?: boolean; question?: QuestionDTO }>(`/workshop/nodes/${nodeId}/questions`, { template_id, text, short_label: text?.slice(0, 40), save_to_deck, session_id: sessionId }), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: qk.templates }); }, onError: (e) => toast(e.message) });
  const answer = useMutation({ mutationFn: ({ questionId, text, author }: { questionId: string; text: string; author: string | null }) => api.post<{ node: NodeDTO }>(`/workshop/questions/${questionId}/answers`, { text, author_label: author, session_id: sessionId }), onSuccess: refresh, onError: (e) => toast(e.message) });
  const patchNode = useMutation({ mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch<{ node: NodeDTO }>(`/workshop/nodes/${id}`, body), onSuccess: refresh, onError: (e) => toast(e.message) });
  const deleteNode = useMutation({ mutationFn: (id: string) => api.delete(`/workshop/nodes/${id}`), onSuccess: refresh });
  const deleteQuestion = useMutation({ mutationFn: (id: string) => api.delete(`/workshop/questions/${id}`), onSuccess: refresh });
  const promote = useMutation({ mutationFn: (id: string) => api.post<{ card: { number: number; display_number: string } }>(`/workshop/nodes/${id}/promote`, { session_id: sessionId }), onSuccess: (r) => { refresh(); toast(`Promoted as joke ${r.card.display_number}`); }, onError: (e) => toast(e.message) });
  const theme = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => api.post(`/workshop/nodes/${id}/theme`, { name }), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: qk.themes }); toast("Saved as theme"); }, onError: (e) => toast(e.message) });
  const tidy = useMutation({ mutationFn: () => api.post(`/workshop/maps/${cardNumber}/tidy`), onSuccess: refresh });
  const patchSession = useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch(`/workshop/sessions/${sessionId}`, body), onSuccess: () => { qc.invalidateQueries({ queryKey: qk.session(sessionId) }); qc.invalidateQueries({ queryKey: qk.sessions }); } });
  return { ask, answer, patchNode, deleteNode, deleteQuestion, promote, theme, tidy, patchSession, refresh };
}

function SeedDesktop({ sessionId, map }: { sessionId: string; map: MapDTO }) {
  const router = useRouter();
  const n = map.seed.number;
  const session = useSession(sessionId);
  const templates = useTemplates();
  const m = useWorkshopMutations(sessionId, n);
  const [selectedNode, setSelectedNode] = useState<string | null>(map.root.id);
  const [selectedQuestion, setSelectedQuestion] = useState<string | null>(null);
  const [collapse, setCollapse] = useState(false);
  const [askFor, setAskFor] = useState<string | null>(null);
  const [answering, setAnswering] = useState<QuestionDTO | null>(null);
  const [pull, setPull] = useState(false);
  const [outline, setOutline] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ kind: "node" | "question"; id: string; impact?: { follow_ups: number; promoted: number[] } } | null>(null);
  useEffect(() => setCollapse(readLocal(`collapseDeadEnds:${map.seed.id}`, false)), [map.seed.id]);
  const inbox = useCardList({ view: "inbox", limit: 50 }, pull);
  const seedMore = useMutation({ mutationFn: (num: number) => api.post("/workshop/seed", { card_number: num, session_id: sessionId }), onSuccess: (_r, num) => { m.refresh(); router.push(`/workshop/${sessionId}/seeds/${num}`); } });

  const node = map.nodes.find((x) => x.id === selectedNode) ?? null;
  const question = map.questions.find((q) => q.id === selectedQuestion) ?? null;
  const onDropTemplate = useCallback((nodeId: string, templateId: string) => {
    const t = templates.data?.find((x) => x.id === templateId);
    if (t?.category === "rating") { setSelectedNode(nodeId); return; }
    m.ask.mutate({ nodeId, template_id: templateId }, { onSuccess: (r) => { if (r.question) { setSelectedNode(nodeId); setAnswering(r.question); } } });
  }, [m.ask, templates.data]);

  const requestDelete = async (kind: "node" | "question", id: string) => {
    if (kind === "node") {
      const impact = await api.get<{ follow_ups: number; promoted: number[] }>(`/workshop/nodes/${id}/impact`);
      if (impact.follow_ups > 0 || impact.promoted.length > 0) setDeleteConfirm({ kind, id, impact });
      else m.deleteNode.mutate(id, { onSuccess: () => { setSelectedNode(map.root.id); toast("Answer deleted"); } });
    } else {
      const answers = map.nodes.filter((x) => x.question_id === id);
      if (answers.length) setDeleteConfirm({ kind, id, impact: { follow_ups: answers.length, promoted: answers.filter((a) => a.promoted_card_number !== null).map((a) => a.promoted_card_number!) } });
      else m.deleteQuestion.mutate(id, { onSuccess: () => setSelectedQuestion(null) });
    }
  };

  // Keyboard: Delete removes the selected node; Q asks.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && node && node.kind === "answer") { e.preventDefault(); void requestDelete("node", node.id); }
      if (e.key.toLowerCase() === "q" && node) setAskFor(node.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node]);

  const path = useMemo(() => (node ? pathTo(map, node.id) : []), [map, node]);
  const author = readLocal<string | null>(`sessionAuthor:${sessionId}`, null);

  const rail = (
    <>
      <RailSection title="Session">
        <div className="rounded-md border border-border bg-card p-2.5">
          <SessionTitle session={session.data} onSave={(title) => m.patchSession.mutate({ title })} />
          <Participants session={session.data} onSave={(participants) => m.patchSession.mutate({ participants })} />
          <div className="meta mt-1.5">{session.data ? `${shortDate(session.data.started_at)} · ${session.data.ended_at ? `ended ${shortDateTime(session.data.ended_at)}` : "in progress"}` : ""}</div>
          {session.data && !session.data.ended_at && <Button size="sm" className="mt-2" onClick={() => m.patchSession.mutate({ ended: true })}>End session</Button>}
        </div>
      </RailSection>
      <RailSection title="Seeds in this session" action={<button type="button" className="text-[10px] normal-case tracking-normal text-accent-dark hover:underline" onClick={() => setPull(true)}>+ Pull from inbox</button>}>
        {(session.data?.seeds ?? []).map((s) => <RailItem key={s.card.id} href={`/workshop/${sessionId}/seeds/${s.card.number}`} active={s.card.number === n} count={s.node_count}>{s.card.display_title}</RailItem>)}
      </RailSection>
      <EarlierSessions current={sessionId} />
      <RailSection title="">
        <RailItem href="/review?kind=joke" count={session.data?.promoted_count ?? 0}>Promoted jokes</RailItem>
        <RailItem count={session.data?.dead_end_count ?? 0}>Dead ends</RailItem>
      </RailSection>
    </>
  );

  const inspector = question ? (
    <Inspector title="Selected question" meta={<Chip variant="version">{question.category}</Chip>}>
      <p className="text-[14px]">{question.text}</p>
      <p className="meta">{map.nodes.filter((x) => x.question_id === question.id).length} answers</p>
      <div className="flex gap-2"><Button variant="primary" onClick={() => setAnswering(question)}>Add an answer</Button><Button onClick={() => requestDelete("question", question.id)}>Delete question</Button></div>
    </Inspector>
  ) : node?.kind === "answer" ? (
    <AnswerInspector map={map} node={node} path={path} session={session.data ?? null} author={author} templates={templates.data ?? []} onPatch={(body) => m.patchNode.mutate({ id: node.id, body })} onPromote={() => m.promote.mutate(node.id)} onTheme={(name) => m.theme.mutate({ id: node.id, name })} onAsk={() => setAskFor(node.id)} onRate={() => undefined} onNotes={(notes) => m.patchSession.mutate({ notes })} />
  ) : (
    <Inspector title="Seed" meta={map.seed.display_number}>
      <p className="whitespace-pre-wrap text-[13px]">{map.seed.current_version.title && <strong className="block">{map.seed.current_version.title}</strong>}{map.seed.current_version.body}</p>
      {map.seed.current_version.context && <p className="text-[12px] text-ink-2">{map.seed.current_version.context}</p>}
      {map.seed.parts.length > 0 && <InspectorSection title="Parts"><ul className="space-y-1 text-[12px]">{map.seed.parts.map((p) => <li key={p.id}><Chip>{p.kind.replace("_", " ")}</Chip> {p.body}</li>)}</ul></InspectorSection>}
      <CardChips card={map.seed} />
      <div className="flex gap-2"><Button variant="primary" onClick={() => setAskFor(map.root.id)}>Ask a question ▾</Button><Link href={`/cards/${n}`} className="self-center text-[13px] font-semibold text-accent-dark">Open card</Link></div>
    </Inspector>
  );

  return (
    <DesktopPage id="D5" rail={rail} hideStandardRail inspector={inspector} inspectorOpen>
      <div className="flex h-full flex-col">
        <CenterHeader title={map.seed.display_title} chip={<Chip variant="dark">seed · {map.seed.display_number}</Chip>} meta={`${map.stats.angle_count} angles · ${map.stats.node_count} nodes · ${map.stats.promoted_count} promoted`}>
          <Button size="sm" variant={collapse ? "primary" : "secondary"} onClick={() => { setCollapse((v) => { writeLocal(`collapseDeadEnds:${map.seed.id}`, !v); return !v; }); }}>Collapse dead ends</Button>
          <Button size="sm" variant={outline ? "primary" : "secondary"} onClick={() => setOutline((v) => !v)}>Outline view</Button>
          <Button size="sm" onClick={() => m.tidy.mutate()}>Tidy</Button>
          <Button size="sm" onClick={() => download(`${map.seed.display_title}.md`, outlineMarkdown(map))}>Export map</Button>
        </CenterHeader>
        <div className="relative min-h-0 flex-1">
          {outline ? (
            <OutlineView map={map} selected={selectedNode} onSelect={(id) => { setSelectedNode(id); setSelectedQuestion(null); }} />
          ) : (
            <WorkshopCanvas map={map} collapseDeadEnds={collapse} selectedNodeId={selectedNode} selectedQuestionId={selectedQuestion} onSelectNode={(id) => { setSelectedNode(id); setSelectedQuestion(null); }} onSelectQuestion={(id) => { setSelectedQuestion(id); setSelectedNode(null); }} onAsk={(id) => setAskFor(id)} onDropTemplate={onDropTemplate} onMoveNode={(id, x, y) => m.patchNode.mutate({ id, body: { x, y } })} />
          )}
          {map.questions.length === 0 && !outline && <div className="pointer-events-none absolute left-1/2 top-[220px] -translate-x-1/2 rounded-full bg-surface px-3 py-1 text-[12px] text-ink-2 shadow-card">Drag a question from the deck onto the seed to start.</div>}
        </div>
        <QuestionDeck templates={templates.data ?? []} onClick={(t) => { if (!selectedNode) { toast("Select a node first"); return; } onDropTemplate(selectedNode, t.id); }} onOwn={() => selectedNode && setAskFor(selectedNode)} />
      </div>
      <AskDialog open={!!askFor} onOpenChange={(o) => !o && setAskFor(null)} templates={templates.data ?? []} onPick={(t) => { if (!askFor) return; if (t.category === "rating") { setSelectedNode(askFor); setAskFor(null); return; } m.ask.mutate({ nodeId: askFor, template_id: t.id }, { onSuccess: (r) => { if (r.question) { setSelectedNode(askFor); setAnswering(r.question); } } }); setAskFor(null); }} onOwn={(text, save) => { if (!askFor) return; m.ask.mutate({ nodeId: askFor, text, save_to_deck: save }, { onSuccess: (r) => { if (r.question) { setSelectedNode(askFor); setAnswering(r.question); } } }); setAskFor(null); }} />
      <AnswerDialog question={answering} session={session.data ?? null} defaultAuthor={author} onClose={() => setAnswering(null)} onSubmit={(text, auth, again) => { if (!answering) return; writeLocal(`sessionAuthor:${sessionId}`, auth); m.answer.mutate({ questionId: answering.id, text, author: auth }, { onSuccess: (r) => { setSelectedNode(r.node.id); if (!again) setAnswering(null); } }); }} />
      <Dialog open={pull} onOpenChange={setPull} title="Pull from inbox" width={480}>
        <ul className="divide-y divide-divider rounded-md border border-border bg-card">{(inbox.data?.items ?? []).map((c) => <li key={c.id}><button type="button" className="block w-full px-3 py-2.5 text-left text-[13px] hover:bg-surface" onClick={() => { seedMore.mutate(c.number); setPull(false); }}><span className="meta mr-2">{c.display_number}</span>{c.display_title}</button></li>)}{inbox.data?.items.length === 0 && <li className="px-3 py-3 text-[13px] text-ink-2">Inbox is empty.</li>}</ul>
      </Dialog>
      <ConfirmDialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)} screenId="M10" title={deleteConfirm?.kind === "question" ? `Delete this question and its ${deleteConfirm.impact?.follow_ups ?? 0} answers?` : `Delete this answer and its ${deleteConfirm?.impact?.follow_ups ?? 0} follow-ups?`} body={deleteConfirm?.impact?.promoted.length ? `The promoted joke${deleteConfirm.impact.promoted.length > 1 ? "s" : ""} ${deleteConfirm.impact.promoted.map((p) => `#${String(p).padStart(4, "0")}`).join(", ")} stay in your library.` : undefined} confirmLabel="Delete" onConfirm={async () => { if (!deleteConfirm) return; if (deleteConfirm.kind === "node") { await m.deleteNode.mutateAsync(deleteConfirm.id); setSelectedNode(map.root.id); } else { await m.deleteQuestion.mutateAsync(deleteConfirm.id); setSelectedQuestion(null); } }} />
    </DesktopPage>
  );
}

function pathTo(map: MapDTO, nodeId: string): { q: QuestionDTO; a: NodeDTO }[] {
  const out: { q: QuestionDTO; a: NodeDTO }[] = [];
  let cur = map.nodes.find((x) => x.id === nodeId);
  while (cur && cur.question_id) {
    const q = map.questions.find((x) => x.id === cur!.question_id);
    if (!q) break;
    out.unshift({ q, a: cur });
    cur = map.nodes.find((x) => x.id === q.node_id);
  }
  return out;
}

function AnswerInspector({ map, node, path, session, author, templates, onPatch, onPromote, onTheme, onAsk, onNotes }: { map: MapDTO; node: NodeDTO; path: { q: QuestionDTO; a: NodeDTO }[]; session: SessionSummaryDTO | null; author: string | null; templates: QuestionTemplateDTO[]; onPatch: (b: Record<string, unknown>) => void; onPromote: () => void; onTheme: (name: string) => void; onAsk: () => void; onRate: () => void; onNotes: (n: string) => void }) {
  const q = map.questions.find((x) => x.id === node.question_id);
  const [text, setText] = useState(node.text ?? "");
  const [notes, setNotes] = useState(session?.notes ?? "");
  const [themeOpen, setThemeOpen] = useState(false);
  const [themeName, setThemeName] = useState("");
  useEffect(() => setText(node.text ?? ""), [node.id, node.text]);
  useEffect(() => setNotes(session?.notes ?? ""), [session?.notes]);
  const isPoint = q?.system_key === "point" || q?.category === "analyze";
  void author;
  void templates;
  return (
    <Inspector title="Selected answer" meta={q && <Chip variant="version">{q.short_label}</Chip>}>
      <TextArea aria-label="Answer text" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() && text !== node.text && onPatch({ text: text.trim() })} className="min-h-[80px] text-[13px]" />
      <InspectorSection title="Path from seed">
        <ol className="space-y-1 text-[12px]">
          <li className="font-semibold">{map.seed.display_title}</li>
          {path.map((s, i) => <li key={s.a.id} className={cx("pl-2", i === path.length - 1 && "font-semibold")}><span className="text-accent-dark">{s.q.short_label}</span> → {i === path.length - 1 ? "this" : (s.a.text ?? "").slice(0, 60)}</li>)}
        </ol>
        <p className="meta mt-1">This path becomes the joke&apos;s lineage when promoted.</p>
      </InspectorSection>
      <InspectorSection title="Laugh size">
        <div className="flex gap-1">{(["table", "big", "unsure"] as LaughSize[]).map((l) => <Chip key={l} variant={node.laugh_size === l ? "dark" : "status"} pressed={node.laugh_size === l} onClick={() => onPatch({ laugh_size: node.laugh_size === l ? null : l })}>{l === "table" ? "Table laugh" : l === "big" ? "Big laugh" : "Unsure"}</Chip>)}</div>
      </InspectorSection>
      <InspectorSection title="Angle">
        {node.angle_label ? <div className="flex items-center gap-2"><Chip variant="version">Angle {node.angle_label}</Chip><Button size="sm" onClick={() => onPatch({ angle: false })}>Remove</Button></div> : <Button size="sm" onClick={() => onPatch({ angle: true })} disabled={map.stats.angle_count >= 26}>Mark as angle</Button>}
      </InspectorSection>
      <InspectorSection title="Author">
        <select className="field text-[12px]" value={node.author_label ?? ""} onChange={(e) => onPatch({ author_label: e.target.value || null })} aria-label="Author">
          <option value="">Me</option>
          {(session?.participants ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </InspectorSection>
      <InspectorSection title="Session notes">
        <TextArea aria-label="Session notes" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (session?.notes ?? "") && onNotes(notes)} className="min-h-[56px] text-[12px]" />
      </InspectorSection>
      {isPoint && <Button size="sm" onClick={() => { setThemeName((node.text ?? "").slice(0, 120)); setThemeOpen(true); }}>Save as theme</Button>}
      <div className="flex flex-wrap gap-2 border-t border-divider pt-3">
        {node.promoted_card_number !== null ? <Link href={`/cards/${node.promoted_card_number}`} className="inline-flex min-h-[30px] items-center rounded-md border border-accent-border bg-accent px-2.5 text-[12px] font-semibold text-white">Promoted as joke #{String(node.promoted_card_number).padStart(4, "0")} · open</Link> : <Button variant="primary" onClick={onPromote}>Promote to joke</Button>}
        <Button onClick={onAsk}>Ask another ▾</Button>
        <Button onClick={() => onPatch({ is_dead_end: !node.is_dead_end })}>{node.is_dead_end ? "Not a dead end" : "Dead end"}</Button>
      </div>
      <Dialog open={themeOpen} onOpenChange={setThemeOpen} title="Save as theme" screenId="M8" description={`Attaches to ${map.seed.display_number}. If a theme with this name exists, it links to that one.`} footer={<><Button onClick={() => setThemeOpen(false)}>Cancel</Button><Button variant="primary" disabled={!themeName.trim()} onClick={() => { onTheme(themeName.trim()); setThemeOpen(false); }}>Save theme</Button></>}>
        <TextInput autoFocus value={themeName} onChange={(e) => setThemeName(e.target.value)} maxLength={120} aria-label="Theme name" />
      </Dialog>
    </Inspector>
  );
}

function QuestionDeck({ templates, onClick, onOwn }: { templates: QuestionTemplateDTO[]; onClick: (t: QuestionTemplateDTO) => void; onOwn: () => void }) {
  const groups: QuestionTemplateDTO["category"][] = ["analyze", "audience", "build"];
  return (
    <div className="flex h-[74px] shrink-0 items-center gap-4 overflow-x-auto border-t border-border bg-surface px-4">
      <span className="label shrink-0">Question deck · drag onto a node</span>
      {groups.map((g) => (
        <div key={g} className="flex shrink-0 items-center gap-1.5">
          <span className="meta">{g}</span>
          {templates.filter((t) => t.category === g).map((t) => (
            <button key={t.id} type="button" draggable onDragStart={(e) => { e.dataTransfer.setData(QUESTION_DROP_TYPE, t.id); e.dataTransfer.effectAllowed = "copy"; }} onClick={() => onClick(t)} className="cursor-grab rounded-full border-[1.5px] border-accent bg-accent-wash px-3 py-1.5 font-mono text-[10px] text-accent-dark hover:bg-accent-tint" title={t.text}>
              {t.short_label}
            </button>
          ))}
        </div>
      ))}
      <button type="button" onClick={onOwn} className="shrink-0 rounded-full border border-dashed border-dashed px-3 py-1.5 font-mono text-[10px] text-ink-2 hover:border-accent hover:text-accent-dark">+ own</button>
    </div>
  );
}

/** M22 — Ask a question. */
function AskDialog({ open, onOpenChange, templates, onPick, onOwn }: { open: boolean; onOpenChange: (o: boolean) => void; templates: QuestionTemplateDTO[]; onPick: (t: QuestionTemplateDTO) => void; onOwn: (text: string, save: boolean) => void }) {
  const [own, setOwn] = useState("");
  const [save, setSave] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Ask a question" screenId="M22" width={460}>
      {(["analyze", "audience", "build", "rating"] as const).map((g) => (
        <div key={g} className="mb-3">
          <div className="label mb-1">{g}</div>
          <div className="flex flex-col gap-1">{templates.filter((t) => t.category === g).map((t) => <button key={t.id} type="button" className="rounded-md border border-border bg-card px-3 py-2.5 text-left text-[14px] hover:border-accent md:py-2 md:text-[13px]" onClick={() => onPick(t)}>{t.text}{g === "rating" && <span className="meta ml-2">opens the laugh-size picker</span>}</button>)}</div>
        </div>
      ))}
      <div className="label mb-1">Write your own…</div>
      <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (own.trim()) { onOwn(own.trim(), save); setOwn(""); } }}>
        <TextInput value={own} onChange={(e) => setOwn(e.target.value)} placeholder="What would Sam say?" maxLength={200} aria-label="Custom question" />
        <div className="flex items-center justify-between"><label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Save to deck</label><Button type="submit" variant="primary" size="sm" disabled={!own.trim()}>Ask</Button></div>
      </form>
    </Dialog>
  );
}

function AnswerDialog({ question, session, defaultAuthor, onClose, onSubmit }: { question: QuestionDTO | null; session: SessionSummaryDTO | null; defaultAuthor: string | null; onClose: () => void; onSubmit: (text: string, author: string | null, again: boolean) => void }) {
  const [text, setText] = useState("");
  const [author, setAuthor] = useState<string | null>(defaultAuthor);
  useEffect(() => { if (question) setText(""); }, [question]);
  const submit = (again: boolean) => { if (!text.trim()) return; onSubmit(text.trim(), author, again); setText(""); };
  return (
    <Dialog open={!!question} onOpenChange={(o) => !o && onClose()} title={question?.text ?? ""} description="Enter saves and opens another answer. Esc closes." width={480}
      footer={<><select className="field mr-auto w-auto text-[12px]" value={author ?? ""} onChange={(e) => setAuthor(e.target.value || null)} aria-label="Author"><option value="">Me</option>{(session?.participants ?? []).map((p) => <option key={p} value={p}>{p}</option>)}</select><Button onClick={onClose}>Done</Button><Button variant="primary" disabled={!text.trim()} onClick={() => submit(false)}>Add answer</Button></>}
    >
      <TextArea autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(true); } }} placeholder="Write an answer…" className="min-h-[90px] text-[14px]" maxLength={5000} />
    </Dialog>
  );
}

function SessionTitle({ session, onSave }: { session?: SessionSummaryDTO; onSave: (t: string) => void }) {
  const [t, setT] = useState(session?.title ?? "");
  useEffect(() => setT(session?.title ?? ""), [session?.title]);
  return <input aria-label="Session title" className="w-full bg-transparent font-serif text-[15px] font-semibold outline-none" value={t} onChange={(e) => setT(e.target.value)} onBlur={() => t.trim() && t !== session?.title && onSave(t.trim())} />;
}

function Participants({ session, onSave }: { session?: SessionSummaryDTO; onSave: (p: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const list = session?.participants ?? [];
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {list.map((p) => <Chip key={p} variant="dark">{p}<button type="button" aria-label={`Remove ${p}`} className="ml-0.5 opacity-70" onClick={() => onSave(list.filter((x) => x !== p))}>×</button></Chip>)}
      {adding ? <input autoFocus className="w-[90px] rounded border border-border bg-field px-1 text-[12px]" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim()) onSave([...list, name.trim()]); setAdding(false); setName(""); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} aria-label="Participant name" /> : <Chip variant="dashed" onClick={() => setAdding(true)}>+ add person</Chip>}
    </div>
  );
}

function EarlierSessions({ current }: { current: string }) {
  const { data } = useQuery({ queryKey: qk.sessions, queryFn: () => api.get<{ items: SessionSummaryDTO[] }>("/workshop/sessions?limit=6") });
  const items = (data?.items ?? []).filter((s) => s.id !== current).slice(0, 5);
  if (!items.length) return null;
  return <RailSection title="Earlier sessions">{items.map((s) => <RailItem key={s.id} href={s.seeds[0] ? `/workshop/${s.id}/seeds/${s.seeds[0].card.number}` : `/workshop/${s.id}`} count={`${s.seed_count} seeds`}>{shortDate(s.started_at)} · {s.participants.length ? `with ${s.participants[0]}` : "solo"}</RailItem>)}</RailSection>;
}

function OutlineView({ map, selected, onSelect }: { map: MapDTO; selected: string | null; onSelect: (id: string) => void }) {
  const render = (nodeId: string, depth: number): React.ReactNode => {
    const qs = map.questions.filter((q) => q.node_id === nodeId);
    return (
      <ul className={cx("space-y-1", depth > 0 && "ml-4 border-l border-wire-soft pl-3")}>
        {qs.map((q) => (
          <li key={q.id}>
            <span className="font-mono text-[10px] text-accent-dark">{q.short_label}</span>
            <ul className="ml-3 space-y-1">
              {map.nodes.filter((n) => n.question_id === q.id).map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => onSelect(n.id)} className={cx("rounded px-1 text-left text-[13px]", selected === n.id && "bg-accent-wash ring-1 ring-accent", n.is_dead_end && "opacity-55")}>{n.text}{n.angle_label && <Chip variant="version" className="ml-1">Angle {n.angle_label}</Chip>}{n.promoted_card_number !== null && <Chip variant="accent" className="ml-1">joke</Chip>}</button>
                  {render(n.id, depth + 1)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    );
  };
  return <div className="h-full overflow-y-auto p-5"><div className="mb-2 font-semibold">{map.seed.display_title}</div>{render(map.root.id, 0)}</div>;
}

function outlineMarkdown(map: MapDTO): string {
  const lines: string[] = [`# ${map.seed.display_title}`, "", map.seed.current_version.body, ""];
  const walk = (nodeId: string, depth: number) => {
    for (const q of map.questions.filter((x) => x.node_id === nodeId)) {
      lines.push(`${"  ".repeat(depth)}- **${q.text}**`);
      for (const n of map.nodes.filter((x) => x.question_id === q.id)) {
        lines.push(`${"  ".repeat(depth + 1)}- ${n.text}${n.angle_label ? ` _(Angle ${n.angle_label})_` : ""}${n.is_dead_end ? " _(dead end)_" : ""}${n.promoted_card_number !== null ? ` → joke #${String(n.promoted_card_number).padStart(4, "0")}` : ""}`);
        walk(n.id, depth + 2);
      }
    }
  };
  walk(map.root.id, 0);
  return lines.join("\n");
}

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  a.download = name;
  a.click();
}

/** P5 — one angle's branch at a time. */
function SeedPhone({ sessionId, map }: { sessionId: string; map: MapDTO }) {
  const router = useRouter();
  const sp = useSearchParams();
  const n = map.seed.number;
  const angle = sp.get("angle") ?? undefined;
  const m = useWorkshopMutations(sessionId, n);
  const templates = useTemplates();
  const session = useSession(sessionId);
  const { data: branch } = useQuery({ queryKey: qk.branch(n, angle), queryFn: () => api.get<BranchDTO>(`/workshop/maps/${n}/branch${angle ? `?angle=${angle}` : ""}`) });
  const [text, setText] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [sheet, setSheet] = useState<NodeDTO | null>(null);
  const angles = map.angles;
  const idx = branch?.angle_index ?? -1;
  const go = (d: number) => { const next = angles[idx + d]; if (next) router.replace(`/workshop/${sessionId}/seeds/${n}?angle=${next.letter}`); };
  const lastQuestion = branch ? [...branch.path].reverse().find((s): s is { question: QuestionDTO } => "question" in s)?.question : undefined;
  const leaf = branch ? [...branch.path].reverse().find((s): s is { node: NodeDTO } => "node" in s)?.node : undefined;
  const author = readLocal<string | null>(`sessionAuthor:${sessionId}`, null);
  const [touch, setTouch] = useState<number | null>(null);
  return (
    <PhonePage id="P5" left={<button type="button" className="text-[15px] text-accent-dark" onClick={() => router.back()}>‹</button>} title={map.seed.display_title} right={<span className="flex items-center gap-1"><Chip variant="version">{branch?.angle ? `Angle ${branch.angle}` : "Latest branch"}</Chip>{angles.length > 0 && <span className="meta">{idx + 1} of {angles.length}</span>}</span>}>
      <div className="flex flex-col gap-0 p-4" onTouchStart={(e) => setTouch(e.touches[0].clientX)} onTouchEnd={(e) => { if (touch === null) return; const dx = e.changedTouches[0].clientX - touch; if (dx < -60) go(1); else if (dx > 60) go(-1); setTouch(null); }}>
        {branch?.path.map((s, i) => "node" in s ? (
          <div key={s.node.id}>
            {s.node.kind === "root" ? (
              <div className="rounded-[10px] border-[1.5px] border-ink bg-card p-3"><div className="label mb-1">Seed</div><p className="text-[15px]">{map.seed.current_version.title && <strong className="block">{map.seed.current_version.title}</strong>}{map.seed.current_version.body}</p></div>
            ) : (
              <button type="button" onClick={() => setSheet(s.node)} className={cx("w-full rounded-[10px] border bg-card p-3 text-left", i === branch.path.length - 1 ? "border-accent" : "border-border", s.node.is_dead_end && "opacity-55")}>
                <p className="text-[15px]">{s.node.text}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">{s.node.angle_label && <Chip variant="version">Angle {s.node.angle_label}</Chip>}{s.node.laugh_size && <Chip variant="status">{s.node.laugh_size} laugh</Chip>}{s.node.promoted_card_number !== null && <Chip variant="accent">→ joke #{String(s.node.promoted_card_number).padStart(4, "0")}</Chip>}{s.node.author_label && <span className="meta ml-auto">{s.node.author_label}</span>}{branch.forks.find((f) => f.node_id === s.node.id) && <Chip variant="dashed">{branch.forks.find((f) => f.node_id === s.node.id)!.child_count} branches ▾</Chip>}</div>
              </button>
            )}
            {i < branch.path.length - 1 && <div className="mx-auto h-[14px] w-[2px] bg-wire" />}
          </div>
        ) : (
          <div key={s.question.id}><div className="mx-auto w-fit rounded-full border-[1.5px] border-accent bg-accent-wash px-3 py-1 font-mono text-[11px] text-accent-dark">{s.question.short_label}</div><div className="mx-auto h-[14px] w-[2px] bg-wire" /></div>
        ))}
        {!branch && <SkeletonRows n={3} />}
        <p className="meta mt-3 text-center">{angles.length > 1 ? `Swipe sideways for Angle ${angles[(idx + 1) % angles.length]?.letter}. ` : ""}Full map lives on desktop.</p>
        <TextArea value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an answer or a thought to this branch…" className="mt-3 min-h-[64px]" />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button onClick={() => setAskOpen(true)} className="font-semibold text-accent-dark">Ask a question ▾</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={() => { if (!lastQuestion || !leaf || leaf.question_id !== lastQuestion.id) { setAskOpen(true); return; } m.answer.mutate({ questionId: lastQuestion.id, text: text.trim(), author }, { onSuccess: () => setText("") }); }}>Add</Button>
        </div>
      </div>
      <AskDialog open={askOpen} onOpenChange={setAskOpen} templates={templates.data ?? []} onPick={(t) => { const target = leaf?.id ?? map.root.id; if (t.category === "rating") { if (leaf) setSheet(leaf); setAskOpen(false); return; } m.ask.mutate({ nodeId: target, template_id: t.id }, { onSuccess: (r) => { if (r.question && text.trim()) m.answer.mutate({ questionId: r.question.id, text: text.trim(), author }, { onSuccess: () => setText("") }); } }); setAskOpen(false); }} onOwn={(q, save) => { const target = leaf?.id ?? map.root.id; m.ask.mutate({ nodeId: target, text: q, save_to_deck: save }); setAskOpen(false); }} />
      <Dialog open={!!sheet} onOpenChange={(o) => !o && setSheet(null)} title="Answer">
        {sheet && (
          <div className="flex flex-col gap-3">
            <p className="text-[15px]">{sheet.text}</p>
            <div className="flex gap-1">{(["table", "big", "unsure"] as LaughSize[]).map((l) => <Chip key={l} variant={sheet.laugh_size === l ? "dark" : "status"} pressed={sheet.laugh_size === l} onClick={() => { m.patchNode.mutate({ id: sheet.id, body: { laugh_size: sheet.laugh_size === l ? null : l } }); setSheet({ ...sheet, laugh_size: sheet.laugh_size === l ? null : l }); }} className="!px-3 !py-2">{l === "table" ? "Table laugh" : l === "big" ? "Big laugh" : "Unsure"}</Chip>)}</div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { m.patchNode.mutate({ id: sheet.id, body: { angle: !sheet.angle_label } }); setSheet(null); }}>{sheet.angle_label ? `Remove Angle ${sheet.angle_label}` : "Mark as angle"}</Button>
              <Button onClick={() => { m.patchNode.mutate({ id: sheet.id, body: { is_dead_end: !sheet.is_dead_end } }); setSheet(null); }}>{sheet.is_dead_end ? "Not a dead end" : "Dead end"}</Button>
              {sheet.promoted_card_number !== null ? <Link href={`/cards/${sheet.promoted_card_number}`} className="inline-flex min-h-[44px] items-center rounded-lg border border-accent-border bg-accent px-3 text-[14px] font-semibold text-white">Open joke</Link> : <Button variant="primary" onClick={() => { m.promote.mutate(sheet.id); setSheet(null); }}>Promote to joke</Button>}
            </div>
            <span className="meta">{session.data?.title}</span>
          </div>
        )}
      </Dialog>
    </PhonePage>
  );
}
