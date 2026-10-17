"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { DesktopPage, PhonePage } from "@/components/shell/ScreenFrame";
import { Button, Chip, EmptyState, SkeletonRows, TextInput } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { dateOnly, formatMmSs, parseMmSs, relativeTime } from "@/lib/format";
import { writeLocal } from "@/lib/storage";
import type { BitSummaryDTO, SetDTO, SetSummaryDTO } from "@/types/dto";

/** S8 — Sets index (with a Bits section). */
export default function SetsPage() {
  const phone = useIsPhone();
  const mounted = useMounted();
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const { data: sets, isLoading } = useQuery({ queryKey: qk.sets, queryFn: () => api.get<{ items: SetSummaryDTO[] }>("/sets") });
  const { data: bits } = useQuery({ queryKey: qk.bits, queryFn: () => api.get<{ items: BitSummaryDTO[] }>("/bits") });
  const [newSet, setNewSet] = useState(false);
  const [newBit, setNewBit] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("5:00");
  const [bitName, setBitName] = useState("");
  useEffect(() => {
    setNewSet(sp.get("new") === "1");
    setNewBit(sp.get("newBit") === "1");
  }, [sp]);
  const createSet = useMutation({
    mutationFn: () => api.post<SetDTO>("/sets", { name: name.trim(), target_duration_seconds: parseMmSs(target) }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: qk.sets });
      writeLocal("lastSetId", r.set.id);
      router.push(`/sets/${r.set.id}`);
    },
  });
  const createBit = useMutation({
    mutationFn: () => api.post<{ bit: { id: string } }>("/bits", { name: bitName.trim() }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: qk.bits });
      router.push(`/bits/${r.bit.id}`);
    },
  });
  if (!mounted) return null;
  const items = sets?.items ?? [];
  const body = (
    <div className="mx-auto max-w-[840px] p-4 md:p-5">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="font-serif text-[18px] font-semibold">Sets</h2>
        <span className="meta">{items.length} set{items.length === 1 ? "" : "s"}</span>
        <div className="flex-1" />
        <Button size="sm" variant="primary" onClick={() => setNewSet(true)}>+ New set</Button>
      </div>
      {isLoading && <SkeletonRows n={3} />}
      {sets && items.length === 0 && <EmptyState title="No sets yet. Build one from your bits." action={<Button variant="primary" onClick={() => setNewSet(true)}>+ New set</Button>} />}
      <ul className="divide-y divide-divider rounded-[10px] border border-border bg-card">
        {items.map((s) => (
          <li key={s.id}>
            <Link href={phone ? `/sets/${s.id}?mode=script` : `/sets/${s.id}`} onClick={() => writeLocal("lastSetId", s.id)} className="flex flex-wrap items-center gap-3 px-3.5 py-3 hover:bg-surface">
              <span className="font-serif text-[16px] font-semibold">{s.name}</span>
              <Chip variant="status">{s.status}</Chip>
              {s.current_anchor ? <Chip variant="version">v{s.current_anchor.number} · {s.current_anchor.name}</Chip> : <Chip variant="dashed">no anchor yet</Chip>}
              <span className="meta ml-auto">
                {formatMmSs(s.runtime_seconds)}{s.target_duration_seconds ? ` of ${formatMmSs(s.target_duration_seconds)}` : ""}
                {s.last_performed_on ? ` · performed ${dateOnly(s.last_performed_on)}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div id="bits" className="mb-3 mt-8 flex items-center gap-3">
        <h2 className="font-serif text-[18px] font-semibold">Bits</h2>
        <span className="meta">{bits?.items.length ?? 0} bit{bits?.items.length === 1 ? "" : "s"}</span>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setNewBit(true)}>+ New bit</Button>
      </div>
      {bits && bits.items.length === 0 && <EmptyState title="No bits yet." body="Start one from a board cluster, from a joke's menu, or right here." />}
      <ul className="divide-y divide-divider rounded-[10px] border border-border bg-card">
        {(bits?.items ?? []).map((b) => (
          <li key={b.id}>
            <Link href={`/bits/${b.id}`} className="flex flex-wrap items-center gap-3 px-3.5 py-3 hover:bg-surface">
              <span className="text-[14px] font-semibold">{b.name}</span>
              {b.is_new && <Chip variant="accent">new</Chip>}
              <span className="meta ml-auto">{b.joke_count} joke{b.joke_count === 1 ? "" : "s"} · {formatMmSs(b.duration_seconds)} · {relativeTime(b.updated_at)}</span>
            </Link>
          </li>
        ))}
      </ul>

      <Dialog open={newSet} onOpenChange={(o) => { setNewSet(o); if (!o) router.replace("/sets"); }} title="New set" footer={<><Button onClick={() => setNewSet(false)}>Cancel</Button><Button variant="primary" disabled={!name.trim() || createSet.isPending} onClick={() => createSet.mutate()}>Create</Button></>}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) createSet.mutate(); }}>
          <label className="block"><span className="label mb-1 block">Name</span><TextInput autoFocus placeholder="Tight 5 · Oct" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
          <label className="block"><span className="label mb-1 block">Target length (m:ss, optional)</span><TextInput placeholder="5:00" value={target} onChange={(e) => setTarget(e.target.value)} className="w-[120px]" /></label>
        </form>
      </Dialog>
      <Dialog open={newBit} onOpenChange={(o) => { setNewBit(o); if (!o) router.replace("/sets"); }} title="New bit" footer={<><Button onClick={() => setNewBit(false)}>Cancel</Button><Button variant="primary" disabled={!bitName.trim() || createBit.isPending} onClick={() => createBit.mutate()}>Create</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); if (bitName.trim()) createBit.mutate(); }}>
          <TextInput autoFocus placeholder="Airport security" value={bitName} onChange={(e) => setBitName(e.target.value)} maxLength={80} aria-label="Bit name" />
        </form>
      </Dialog>
    </div>
  );
  if (phone) return <PhonePage id="S8" title="Sets">{body}</PhonePage>;
  return <DesktopPage id="S8"><div className="h-full overflow-y-auto">{body}</div></DesktopPage>;
}
