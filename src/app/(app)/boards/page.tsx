"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { DesktopPage, PhonePage } from "@/components/shell/ScreenFrame";
import { Button, EmptyState, SkeletonRows, TextInput } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { relativeTime } from "@/lib/format";
import type { BoardSummaryDTO } from "@/types/dto";

/** S7 — Boards index. */
export default function BoardsPage() {
  const phone = useIsPhone();
  const mounted = useMounted();
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const [archived, setArchived] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: [...qk.boards, archived], queryFn: () => api.get<{ items: BoardSummaryDTO[] }>(`/boards?archived=${archived}`) });
  const [open, setOpen] = useState(sp.get("new") === "1");
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: (n: string) => api.post<{ board: BoardSummaryDTO }>("/boards", { name: n }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: qk.boards });
      router.push(`/boards/${r.board.id}`);
    },
  });
  const unarchive = useMutation({ mutationFn: (id: string) => api.patch(`/boards/${id}`, { archived: false }), onSuccess: () => qc.invalidateQueries({ queryKey: qk.boards }) });
  useEffect(() => setOpen(sp.get("new") === "1"), [sp]);
  if (!mounted) return null;
  const items = data?.items ?? [];
  const body = (
    <div className="p-4 md:p-5">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="font-serif text-[18px] font-semibold md:text-[18px]">Boards</h2>
        <span className="meta">{items.length} board{items.length === 1 ? "" : "s"}</span>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setArchived((v) => !v)}>{archived ? "Active" : "Archived"}</Button>
        <Button size="sm" variant="primary" onClick={() => setOpen(true)}>+ New board</Button>
      </div>
      {isLoading && <SkeletonRows n={3} />}
      {data && items.length === 0 && !archived && <EmptyState title="No boards yet." body="Boards are where you spread cards out and group them." action={<Button variant="primary" onClick={() => setOpen(true)}>Create board</Button>} />}
      {data && items.length === 0 && archived && <EmptyState title="Nothing archived." />}
      <div className="grid gap-3 md:grid-cols-3">
        {items.map((b) => (
          <div key={b.id} className="rounded-[10px] border border-border bg-card p-4 shadow-card">
            <Link href={`/boards/${b.id}`} className="block">
              <div className="font-serif text-[16px] font-semibold">{b.name}</div>
              <div className="meta mt-1">{b.card_count} cards · {b.cluster_count} clusters · {relativeTime(b.updated_at)}</div>
            </Link>
            {archived && <Button size="sm" className="mt-2" onClick={() => unarchive.mutate(b.id)}>Restore</Button>}
          </div>
        ))}
        {!archived && (
          <button type="button" onClick={() => setOpen(true)} className="flex min-h-[90px] items-center justify-center rounded-[10px] border border-dashed border-dashed text-[13px] text-ink-2 hover:border-accent hover:text-accent-dark">+ New board</button>
        )}
      </div>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) router.replace("/boards"); }} title="New board" footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate(name.trim())}>Create</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(name.trim()); }}>
          <TextInput autoFocus placeholder="Travel, Dating, Family…" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Board name" />
          {create.error && <p className="mt-1 text-[12px] text-danger-text">{create.error.message}</p>}
        </form>
      </Dialog>
    </div>
  );
  if (phone) return <PhonePage id="S7" title="Boards">{body}</PhonePage>;
  return <DesktopPage id="S7"><div className="h-full overflow-y-auto">{body}</div></DesktopPage>;
}
