"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { VersionChip, Skeleton } from "@/components/ui/primitives";
import type { VersionDTO } from "@/types/dto";
import { shortDateTime } from "@/lib/format";

type Op = { op: "equal" | "insert" | "delete"; text: string };

export function DiffText({ ops }: { ops: Op[] }) {
  return (
    <p className="whitespace-pre-wrap text-[13px] leading-[1.6]">
      {ops.map((o, i) => (o.op === "equal" ? <span key={i}>{o.text}</span> : o.op === "insert" ? <ins key={i} className="diff-ins no-underline">{o.text}</ins> : <del key={i} className="diff-del">{o.text}</del>))}
    </p>
  );
}

/** D4 diff panel: word-level diff between two versions (insertions green, deletions red strikethrough). */
export function DiffPanel({ cardNumber, from, to, versions }: { cardNumber: number; from: string; to: string; versions: VersionDTO[] }) {
  const { data, isLoading } = useQuery({ queryKey: qk.diff(cardNumber, from, to), queryFn: () => api.get<{ from: string; to: string; ops: Op[] }>(`/cards/${cardNumber}/diff?from=${from}&to=${to}`) });
  const toV = versions.find((v) => v.label === to);
  return (
    <div className="rounded-[10px] border border-border bg-surface p-3 shadow-card">
      <div className="mb-2 flex items-center gap-2">
        <span className="label">Diff</span>
        <VersionChip label={from} /> <span className="text-ink-2">→</span> <VersionChip label={to} />
        {toV && <span className="meta ml-auto">{toV.created_context_label ?? toV.created_context} · {shortDateTime(toV.created_at)}</span>}
      </div>
      {isLoading && <Skeleton className="h-10 w-full" />}
      {data && <DiffText ops={data.ops} />}
    </div>
  );
}
