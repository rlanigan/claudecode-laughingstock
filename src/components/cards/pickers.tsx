"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { Dialog } from "@/components/ui/dialog";
import { Button, Chip, TextInput, cx } from "@/components/ui/primitives";
import type { BitSummaryDTO, BoardSummaryDTO, ThemeDTO } from "@/types/dto";
import { formatMmSs } from "@/lib/format";

/** M6 — Board picker (recent first) with inline "New board…". */
export function BoardPickerDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (boardId: string) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: qk.boards, queryFn: () => api.get<{ items: BoardSummaryDTO[] }>("/boards"), enabled: open });
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: (n: string) => api.post<{ board: BoardSummaryDTO }>("/boards", { name: n }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: qk.boards });
      setName("");
      onPick(r.board.id);
      onOpenChange(false);
    },
  });
  const boards = [...(data?.items ?? [])].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Send to board" screenId="M6" width={400}>
      <ul className="mb-3 divide-y divide-divider rounded-md border border-border bg-card">
        {boards.map((b) => (
          <li key={b.id}>
            <button type="button" className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[14px] hover:bg-surface md:py-2 md:text-[13px]" onClick={() => { onPick(b.id); onOpenChange(false); }}>
              <span>{b.name}</span>
              <span className="meta">{b.card_count} cards</span>
            </button>
          </li>
        ))}
        {boards.length === 0 && <li className="px-3 py-3 text-[13px] text-ink-2">No boards yet.</li>}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(name.trim()); }}>
        <TextInput placeholder="New board…" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="New board name" />
        <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending}>Create</Button>
      </form>
      {create.error && <p className="mt-1 text-[12px] text-danger-text">{create.error.message}</p>}
    </Dialog>
  );
}

/** M7 — Bit picker with "New bit…". */
export function BitPickerDialog({ open, onOpenChange, onPick, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (bitId: string) => void; onCreate?: (name: string) => Promise<void> | void }) {
  const { data } = useQuery({ queryKey: qk.bits, queryFn: () => api.get<{ items: BitSummaryDTO[] }>("/bits"), enabled: open });
  const [name, setName] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add to bit" screenId="M7" width={400}>
      <ul className="mb-3 divide-y divide-divider rounded-md border border-border bg-card">
        {(data?.items ?? []).map((b) => (
          <li key={b.id}>
            <button type="button" className="flex w-full items-center justify-between px-3 py-2.5 text-left text-[14px] hover:bg-surface md:py-2 md:text-[13px]" onClick={() => { onPick(b.id); onOpenChange(false); }}>
              <span>{b.name}</span>
              <span className="meta">{b.joke_count} jokes · {formatMmSs(b.duration_seconds)}</span>
            </button>
          </li>
        ))}
        {(data?.items ?? []).length === 0 && <li className="px-3 py-3 text-[13px] text-ink-2">No bits yet.</li>}
      </ul>
      {onCreate && (
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (name.trim()) { await onCreate(name.trim()); setName(""); onOpenChange(false); } }}>
          <TextInput placeholder="New bit…" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="New bit name" />
          <Button type="submit" variant="primary" disabled={!name.trim()}>Create</Button>
        </form>
      )}
    </Dialog>
  );
}

/** Theme picker: existing themes as toggles plus "type a new one". */
export function ThemePickerDialog({ open, onOpenChange, selected, onSave, cardNumber }: { open: boolean; onOpenChange: (o: boolean) => void; selected: ThemeDTO[]; onSave: (ids: string[]) => Promise<void> | void; cardNumber: number }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: qk.themes, queryFn: () => api.get<{ items: (ThemeDTO & { count: number })[] }>("/themes"), enabled: open });
  const [ids, setIds] = useState<string[]>(selected.map((t) => t.id));
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: (n: string) => api.post<{ theme: ThemeDTO }>("/themes", { name: n, source: "manual", card_numbers: [cardNumber] }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: qk.themes });
      qc.invalidateQueries({ queryKey: qk.card(cardNumber) });
      setIds((v) => (v.includes(r.theme.id) ? v : [...v, r.theme.id]));
      setName("");
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) void onSave(ids); onOpenChange(o); }} title="Themes" description="What the card is about. Themes also come from workshop answers and cluster names." width={420}>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(data?.items ?? []).map((t) => {
          const on = ids.includes(t.id);
          return (
            <Chip key={t.id} variant={on ? "dark" : "theme"} pressed={on} onClick={() => setIds((v) => (on ? v.filter((x) => x !== t.id) : [...v, t.id]))} className={cx("!py-2 md:!py-1")}>
              {t.name}
            </Chip>
          );
        })}
        {(data?.items ?? []).length === 0 && <span className="text-[13px] text-ink-2">No themes yet.</span>}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(name.trim()); }}>
        <TextInput placeholder="New theme…" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="New theme" />
        <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending}>Add</Button>
      </form>
    </Dialog>
  );
}

export function useBoardsQuery(enabled = true) {
  return useQuery({ queryKey: qk.boards, queryFn: () => api.get<{ items: BoardSummaryDTO[] }>(`/boards${qs({})}`), enabled });
}
