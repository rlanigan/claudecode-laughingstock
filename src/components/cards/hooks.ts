"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, ApiRequestError, qs } from "@/lib/api-client";
import { qk } from "@/lib/query-keys";
import { toast } from "@/components/ui/toast";
import type { CardDTO, CardSummaryDTO, PartDTO, PartKind, SubjectDTO, ThemeDTO } from "@/types/dto";
import type { EditCardInput } from "@/lib/validation";

export function useCard(number: number | null) {
  return useQuery({ queryKey: qk.card(number ?? 0), queryFn: () => api.get<{ card: CardDTO }>(`/cards/${number}`).then((r) => r.card), enabled: number !== null && number > 0 });
}

export function useCardCounts() {
  return useQuery({ queryKey: qk.cardCounts, queryFn: () => api.get<{ all: number; inbox: number; untagged: number; week: number; phone: number; on_board: number; jokes: number; killed: number }>("/cards/counts"), staleTime: 15_000 });
}

export function invalidateCard(qc: ReturnType<typeof useQueryClient>, number?: number) {
  qc.invalidateQueries({ queryKey: ["cards"] });
  qc.invalidateQueries({ queryKey: qk.me });
  if (number) {
    qc.invalidateQueries({ queryKey: qk.card(number) });
    qc.invalidateQueries({ queryKey: qk.lineage(number) });
  }
}

/** Card actions with optimistic toasts and Undo (§3.14). */
export function useCardActions() {
  const qc = useQueryClient();
  const router = useRouter();
  const refresh = (n?: number) => invalidateCard(qc, n);

  const kill = useMutation({
    mutationFn: (n: number) => api.post<{ card: CardDTO }>(`/cards/${n}/kill`),
    onSuccess: (_d, n) => {
      refresh(n);
      toast("Killed", { action: { label: "Undo", onClick: () => restore.mutate(n) } });
    },
  });
  const restore = useMutation({ mutationFn: (n: number) => api.post<{ card: CardDTO }>(`/cards/${n}/restore`), onSuccess: (_d, n) => refresh(n) });
  const keep = useMutation({
    mutationFn: (n: number) => api.post<{ card: CardDTO }>(`/cards/${n}/keep`),
    onSuccess: (_d, n) => {
      refresh(n);
      toast("Kept — filed out of the inbox", { action: { label: "Undo", onClick: () => returnToInbox.mutate(n) } });
    },
  });
  const returnToInbox = useMutation({ mutationFn: (n: number) => api.post<{ card: CardDTO }>(`/cards/${n}/return-to-inbox`), onSuccess: (_d, n) => refresh(n) });
  const deleteForever = useMutation({ mutationFn: (n: number) => api.delete(`/cards/${n}`), onSuccess: (_d, n) => refresh(n) });
  const sendToWorkshop = useMutation({
    mutationFn: (n: number) => api.post<{ session_id: string; root_node_id: string; created_session: boolean }>("/workshop/seed", { card_number: n }),
    onSuccess: (r, n) => {
      refresh(n);
      qc.invalidateQueries({ queryKey: ["workshop"] });
      router.push(`/workshop/${r.session_id}/seeds/${n}`);
    },
  });
  const sendToBoard = useMutation({
    mutationFn: ({ n, boardId }: { n: number; boardId: string }) => api.post<{ item: unknown }>(`/boards/${boardId}/items`, { card_number: n }),
    onSuccess: (_r, { n, boardId }) => {
      refresh(n);
      qc.invalidateQueries({ queryKey: qk.board(boardId) });
      qc.invalidateQueries({ queryKey: qk.boards });
      toast("Added to board", { action: { label: "Open", onClick: () => router.push(`/boards/${boardId}`) } });
    },
    onError: (e, { boardId }) => {
      if (e instanceof ApiRequestError && e.code === "ALREADY_ON_BOARD") toast("Already on that board", { action: { label: "Open", onClick: () => router.push(`/boards/${boardId}`) } });
      else toast(e.message);
    },
  });
  const addToBit = useMutation({
    mutationFn: ({ n, bitId }: { n: number; bitId: string }) => api.post(`/bits/${bitId}/items`, { kind: "joke", card_number: n }),
    onSuccess: (_r, { n, bitId }) => {
      refresh(n);
      qc.invalidateQueries({ queryKey: qk.bit(bitId) });
      qc.invalidateQueries({ queryKey: qk.bits });
      toast("Added to bit", { action: { label: "Open", onClick: () => router.push(`/bits/${bitId}`) } });
    },
    onError: (e) => toast(e instanceof ApiRequestError && e.code === "ALREADY_IN_BIT" ? "Already in this bit." : e.message),
  });
  const edit = useMutation({
    mutationFn: ({ n, input }: { n: number; input: EditCardInput }) => api.patch<{ card: CardDTO; version: unknown; created_new_version: boolean }>(`/cards/${n}`, input),
    onSuccess: (r, { n }) => {
      qc.setQueryData(qk.card(n), r.card);
      refresh(n);
      qc.invalidateQueries({ queryKey: ["board"] });
      qc.invalidateQueries({ queryKey: ["bit"] });
      qc.invalidateQueries({ queryKey: ["set"] });
    },
  });
  const setSubjects = useMutation({
    mutationFn: ({ n, names }: { n: number; names: string[] }) => api.put<{ subjects: SubjectDTO[] }>(`/cards/${n}/subjects`, { names }),
    onSuccess: (_r, { n }) => {
      refresh(n);
      qc.invalidateQueries({ queryKey: ["subjects"] });
    },
    onError: (e) => toast(e.message),
  });
  const setThemes = useMutation({
    mutationFn: ({ n, ids }: { n: number; ids: string[] }) => api.put<{ themes: ThemeDTO[] }>(`/cards/${n}/themes`, { theme_ids: ids }),
    onSuccess: (_r, { n }) => refresh(n),
  });
  const addPart = useMutation({ mutationFn: ({ n, kind, body }: { n: number; kind: PartKind; body: string }) => api.post<{ part: PartDTO }>(`/cards/${n}/parts`, { kind, body }), onSuccess: (_r, { n }) => refresh(n) });
  const patchPart = useMutation({ mutationFn: ({ id, body, kind }: { id: string; body?: string; kind?: PartKind; n: number }) => api.patch<{ part: PartDTO }>(`/parts/${id}`, { body, kind }), onSuccess: (_r, { n }) => refresh(n) });
  const deletePart = useMutation({
    mutationFn: ({ id }: { id: string; n: number; part: PartDTO }) => api.delete(`/parts/${id}`),
    onSuccess: (_r, { n, part }) => {
      refresh(n);
      toast("Part deleted", { action: { label: "Undo", onClick: () => addPart.mutate({ n, kind: part.kind, body: part.body }) } });
    },
  });
  const reorderParts = useMutation({ mutationFn: ({ n, ids }: { n: number; ids: string[] }) => api.put<{ parts: PartDTO[] }>(`/cards/${n}/parts/order`, { part_ids: ids }), onSuccess: (_r, { n }) => refresh(n) });
  const pin = useMutation({ mutationFn: ({ n, label }: { n: number; label: string }) => api.post<{ updated_board_items: number }>(`/cards/${n}/pin`, { version_label: label }), onSuccess: (r, { n }) => { refresh(n); qc.invalidateQueries({ queryKey: ["board"] }); toast(`${r.updated_board_items} board${r.updated_board_items === 1 ? "" : "s"} now show ${label(r)}`); } });
  const detach = useMutation({ mutationFn: ({ n, version_label, container }: { n: number; version_label?: string; container?: { type: "board" | "bit"; id: string } }) => api.post<{ card: CardDTO }>(`/cards/${n}/detach`, { version_label, container }), onSuccess: (r, { n }) => { refresh(n); qc.invalidateQueries({ queryKey: ["board"] }); qc.invalidateQueries({ queryKey: ["bit"] }); toast(`Detached as ${r.card.display_number}`, { action: { label: "Open", onClick: () => router.push(`/cards/${r.card.number}`) } }); } });
  const split = useMutation({ mutationFn: ({ n, split_at, version_label, container }: { n: number; split_at: number; version_label?: string; container?: { type: "board" | "bit"; id: string } }) => api.post<{ cards: CardDTO[] }>(`/cards/${n}/split`, { split_at, version_label, container }), onSuccess: (r, { n }) => { refresh(n); qc.invalidateQueries({ queryKey: ["board"] }); qc.invalidateQueries({ queryKey: ["bit"] }); toast(`Split into ${r.cards.map((c) => c.display_number).join(" and ")}`); } });
  const combine = useMutation({ mutationFn: ({ numbers, title }: { numbers: number[]; title?: string }) => api.post<{ card: CardDTO }>("/cards/combine", { card_numbers: numbers, title }), onSuccess: (r) => { refresh(); toast(`Combined into ${r.card.display_number}`, { action: { label: "Open", onClick: () => router.push(`/cards/${r.card.number}`) } }); } });
  const versionAction = useMutation({ mutationFn: ({ n, mode, from }: { n: number; mode: "fork" | "restore" | "seal"; from: string }) => api.post<{ card: CardDTO; version: { label: string } }>(`/cards/${n}/versions`, { mode, from_label: from }), onSuccess: (r, { n, mode }) => { refresh(n); if (mode !== "seal") toast(`Created ${r.version.label}`); } });

  return { kill, restore, keep, returnToInbox, deleteForever, sendToWorkshop, sendToBoard, addToBit, edit, setSubjects, setThemes, addPart, patchPart, deletePart, reorderParts, pin, detach, split, combine, versionAction };
}

const label = (_r: unknown) => "the pushed version";

export function useCardList(filters: Record<string, string | number | undefined>, enabled = true) {
  return useQuery({
    queryKey: qk.cards(filters),
    queryFn: () => api.get<{ items: CardSummaryDTO[]; next_cursor: string | null; total_estimate: number }>(`/cards${qs(filters)}`),
    enabled,
  });
}
