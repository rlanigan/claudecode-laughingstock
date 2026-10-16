"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { DesktopPage, Inspector, InspectorSection, PhonePage } from "@/components/shell/ScreenFrame";
import { LineageGraph } from "@/components/lineage/LineageGraph";
import { DiffPanel } from "@/components/lineage/DiffPanel";
import { Button, Chip, SegmentedControl, SkeletonRows, TextArea, VersionChip, cx } from "@/components/ui/primitives";
import { Menu } from "@/components/ui/menu";
import { useCardActions } from "@/components/cards/hooks";
import { CombineDialog } from "@/components/cards/CardDialogs";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { dateOnly, shortDate, shortDateTime } from "@/lib/format";
import { joinTitle, splitTitle } from "@/domain/title-split";
import type { LineageDTO, VersionDTO } from "@/types/dto";

/** D4 — Card lineage (desktop) / vertical timeline (phone). */
export default function LineagePage() {
  const params = useParams<{ number: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const number = Number(params.number);
  const phone = useIsPhone();
  const mounted = useMounted();
  const a = useCardActions();
  const { data: lineage, isLoading } = useQuery({ queryKey: qk.lineage(number), queryFn: () => api.get<LineageDTO>(`/cards/${number}/lineage`) });
  const [selected, setSelected] = useState<string | null>(sp.get("b") ?? sp.get("a"));
  const [compare, setCompare] = useState<string | null>(sp.get("a") && sp.get("b") ? sp.get("a") : null);
  const [view, setView] = useState<"graph" | "timeline">("graph");
  const [combineOpen, setCombineOpen] = useState(false);

  useEffect(() => {
    if (lineage && !selected) setSelected(lineage.versions[lineage.versions.length - 1]?.label ?? null);
  }, [lineage, selected]);

  const onSelect = useCallback((label: string, shift: boolean) => {
    if (shift && selected && selected !== label) {
      setCompare(selected);
      setSelected(label);
    } else {
      setSelected(label);
      setCompare(null);
    }
  }, [selected]);

  const selectedVersion = lineage?.versions.find((v) => v.label === selected) ?? null;
  const diffPair = useMemo(() => {
    if (!lineage || !selected) return null;
    if (compare) return { from: compare, to: selected };
    const v = lineage.versions.find((x) => x.label === selected);
    if (v?.parent_label) return { from: v.parent_label, to: selected };
    return null;
  }, [lineage, selected, compare]);

  if (!mounted) return null;
  if (isLoading || !lineage) return <SkeletonRows n={4} />;

  const boardsPinningOther = lineage.appears_in.filter((x) => x.type === "board" && selectedVersion && x.version_label !== selectedVersion.label);
  const versionMenu = (label: string, onPick: (v: VersionDTO) => void) => lineage.versions.map((v) => ({ label: `${v.label} · ${v.created_context_label ?? v.created_context} · ${shortDate(v.created_at)}`, onSelect: () => onPick(v) }));

  const inspector = (
    <Inspector title="Selected version" meta={selectedVersion ? <VersionChip label={selectedVersion.label} /> : undefined}>
      {selectedVersion && (
        <>
          <VersionText number={number} version={selectedVersion} />
          <InspectorSection title="Appears in">
            {lineage.appears_in.length === 0 && <p className="text-[12px] text-ink-2">Only in your library so far.</p>}
            <ul className="space-y-1 text-[12px]">
              {lineage.appears_in.map((x, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <Link href={x.type === "board" ? `/boards/${x.id}` : x.type === "bit" ? `/bits/${x.id}` : x.type === "set" ? `/sets/${x.id}` : `/workshop/${x.id}/seeds/${number}`} className="truncate hover:underline">
                    <span className="capitalize">{x.type}</span> · {x.name}
                  </Link>
                  <span className="meta shrink-0">{x.detail}</span>
                </li>
              ))}
            </ul>
          </InspectorSection>
          <InspectorSection title="Performed">
            {lineage.performed.length === 0 ? <p className="text-[12px] text-ink-2">{selectedVersion.label} not yet performed.</p> : (
              <ul className="space-y-1 text-[12px]">
                {lineage.performed.map((p) => (
                  <li key={`${p.performance_id}-${p.version_label}`} className="flex items-center justify-between gap-2">
                    <span>{dateOnly(p.performed_on)} · {p.venue_label ?? p.set_name} · {p.version_label}</span>
                    <Chip variant={p.result === "landed" ? "success" : p.result === "cut" ? "danger" : "status"}>{p.result}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </InspectorSection>
          <InspectorSection title="Related by tag">
            {lineage.related.length === 0 && <p className="text-[12px] text-ink-2">Nothing shares a tag yet.</p>}
            <ul className="space-y-1 text-[12px]">
              {lineage.related.map((c) => <li key={c.id}><Link href={`/cards/${c.number}`} className="hover:underline"><span className="meta mr-1">{c.display_number}</span>{c.display_title}</Link></li>)}
            </ul>
          </InspectorSection>
          <div className="flex flex-wrap gap-2 border-t border-divider pt-3">
            {boardsPinningOther.length > 0 && <Button variant="primary" onClick={() => a.pin.mutate({ n: number, label: selectedVersion.label })}>Make {selectedVersion.label} the board version</Button>}
            <Button onClick={() => a.versionAction.mutate({ n: number, mode: "fork", from: selectedVersion.label })}>Fork</Button>
            <Button onClick={() => setCombineOpen(true)}>Combine with ▾</Button>
          </div>
        </>
      )}
    </Inspector>
  );

  const header = (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface/60 px-5 py-2">
      <button type="button" className="text-[13px] text-accent-dark hover:underline" onClick={() => router.back()}>← Back</button>
      <h2 className="font-serif text-[18px] font-semibold">Lineage · card {lineage.card.display_number}</h2>
      <span className="meta max-w-[280px] truncate">“{lineage.card.display_title}”</span>
      <div className="flex-1" />
      {!phone && <SegmentedControl ariaLabel="View" size="sm" value={view} options={[{ value: "graph", label: "Graph" }, { value: "timeline", label: "Timeline" }]} onChange={setView} />}
      <Button size="sm" disabled={!selectedVersion} onClick={() => selectedVersion && a.versionAction.mutate({ n: number, mode: "fork", from: selectedVersion.label })}>Fork from here</Button>
      <Menu screenId="M24" trigger={<Button size="sm">Compare ▾</Button>} items={versionMenu("", (v) => { if (selected && v.label !== selected) setCompare(v.label); else setSelected(v.label); })} />
      <Menu screenId="M24" trigger={<Button size="sm">Restore ▾</Button>} items={lineage.versions.map((v) => ({ label: `${v.label} · ${shortDate(v.created_at)}`, hint: "creates a new version", onSelect: () => a.versionAction.mutate({ n: number, mode: "restore", from: v.label }) }))} />
    </div>
  );

  const timeline = (
    <div className="mx-auto flex max-w-[720px] flex-col gap-3 p-4">
      {lineage.columns.map((col) => (
        <section key={col.key}>
          <div className="label mb-1.5">{col.label} · {col.date_label}</div>
          <ul className="space-y-2">
            {col.version_labels.map((l) => {
              const v = lineage.versions.find((x) => x.label === l)!;
              const isSel = selected === l;
              return (
                <li key={l}>
                  <button type="button" onClick={(e) => onSelect(l, e.shiftKey || (phone && !!selected && selected !== l && compare === null && false))} className={cx("w-full rounded-lg border bg-card p-3 text-left", isSel ? "border-accent ring-2 ring-[var(--accent-ring)]" : compare === l ? "border-dashed border-accent-dark" : "border-border")}>
                    <div className="flex items-center justify-between"><VersionChip label={v.label} /><span className="meta">{shortDateTime(v.created_at)}{v.sealed ? " · sealed" : ""}</span></div>
                    <p className="mt-1.5 line-clamp-3 text-[13px] text-ink-body">{joinTitle(v.title, v.body)}</p>
                    {v.change_note && <p className="meta mt-1">{v.change_note}</p>}
                  </button>
                  {phone && selected && selected !== l && <button type="button" className="mt-1 text-[12px] text-accent-dark" onClick={() => setCompare(l)}>Compare with {selected}</button>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {lineage.versions.length === 1 && <p className="text-center text-[13px] text-ink-2">Only one version so far.</p>}
      {diffPair && <DiffPanel cardNumber={number} from={diffPair.from} to={diffPair.to} versions={lineage.versions} />}
      {phone && <div className="rounded-lg border border-border bg-surface">{inspector}</div>}
    </div>
  );

  if (phone) {
    return (
      <PhonePage id="D4" left={<button type="button" className="text-[15px] text-accent-dark" onClick={() => router.back()}>‹</button>} title={`Lineage · ${lineage.card.display_number}`}>
        {timeline}
        <CombineDialog open={combineOpen} onOpenChange={setCombineOpen} seed={lineage.card} onCombine={(numbers) => a.combine.mutateAsync({ numbers }).then(() => undefined)} />
      </PhonePage>
    );
  }
  return (
    <DesktopPage id="D4" noRail inspector={inspector} inspectorOpen>
      <div className="flex h-full flex-col">
        {header}
        <div className="relative min-h-0 flex-1">
          {view === "graph" ? <LineageGraph lineage={lineage} selected={selected} compare={compare} onSelect={onSelect} /> : <div className="h-full overflow-y-auto">{timeline}</div>}
          {view === "graph" && diffPair && <div className="absolute inset-x-6 bottom-4 z-10 max-h-[40%] overflow-y-auto"><DiffPanel cardNumber={number} from={diffPair.from} to={diffPair.to} versions={lineage.versions} /></div>}
          {view === "graph" && lineage.versions.length === 1 && <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-surface px-3 py-1 text-[12px] text-ink-2 shadow-card">Only one version so far. Shift+click selects a second version to diff.</div>}
        </div>
      </div>
      <CombineDialog open={combineOpen} onOpenChange={setCombineOpen} seed={lineage.card} onCombine={(numbers) => a.combine.mutateAsync({ numbers }).then(() => undefined)} />
    </DesktopPage>
  );
}

/** Editable text of the selected version; editing an old version branches (context lineage). */
function VersionText({ number, version }: { number: number; version: VersionDTO }) {
  const a = useCardActions();
  const [text, setText] = useState(joinTitle(version.title, version.body));
  useEffect(() => setText(joinTitle(version.title, version.body)), [version.id, version.title, version.body]);
  const { data: card } = useQuery({ queryKey: qk.card(number), queryFn: () => api.get<{ card: { rev: number } }>(`/cards/${number}`).then((r) => r.card) });
  const commit = () => {
    if (text === joinTitle(version.title, version.body) || !card) return;
    const { title, body } = splitTitle(text);
    a.edit.mutate({ n: number, input: { rev: card.rev, context: { type: "lineage", id: null }, version_label: version.label, title, body } });
  };
  return (
    <div>
      <TextArea aria-label="Version text" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} className="min-h-[100px] text-[13px]" />
      <p className="meta mt-1">{version.created_context_label ?? version.created_context} · {shortDateTime(version.created_at)} · {version.word_count} words{version.sealed ? " · sealed (edits branch)" : ""}</p>
    </div>
  );
}
