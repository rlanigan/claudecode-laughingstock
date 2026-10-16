"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "@/components/ui/menu";
import { Button } from "@/components/ui/primitives";
import type { CardSummaryDTO } from "@/types/dto";
import { useCardActions } from "./hooks";
import { BitPickerDialog, BoardPickerDialog } from "./pickers";
import { CombineDialog, SplitDialog } from "./CardDialogs";
import { api } from "@/lib/api-client";

/** M3 — card overflow menu with the pickers and dialogs it opens. */
export function CardMenu({ card, body, trigger, container }: { card: Omit<CardSummaryDTO, "body_excerpt">; body?: string; trigger?: React.ReactNode; container?: { type: "board" | "bit"; id: string } }) {
  const a = useCardActions();
  const router = useRouter();
  const [board, setBoard] = useState(false);
  const [bit, setBit] = useState(false);
  const [split, setSplit] = useState(false);
  const [combine, setCombine] = useState(false);
  const n = card.number;
  const killed = card.killed_at !== null;
  return (
    <>
      <Menu
        screenId="M3"
        ariaLabel="More actions"
        trigger={trigger ?? <Button size="sm" aria-label="More actions">⋯</Button>}
        items={[
          { label: "Send to workshop", onSelect: () => a.sendToWorkshop.mutate(n), disabled: killed },
          { label: "Add to bit…", onSelect: () => setBit(true), disabled: killed },
          { label: "Send to board…", onSelect: () => setBoard(true), disabled: killed },
          card.inbox_state === "inbox" ? { label: "Keep (file)", onSelect: () => a.keep.mutate(n), hint: "swipe →" } : { label: "Back to inbox", onSelect: () => a.returnToInbox.mutate(n), disabled: killed },
          "separator",
          { label: "Detach a copy", onSelect: () => a.detach.mutate({ n, container }) },
          { label: "Split…", onSelect: () => setSplit(true), disabled: !(body ?? card.body).includes(" ") },
          { label: "Combine with…", onSelect: () => setCombine(true) },
          { label: "Open lineage", onSelect: () => router.push(`/cards/${n}/lineage`) },
          "separator",
          killed ? { label: "Restore", onSelect: () => a.restore.mutate(n) } : { label: "Kill", onSelect: () => a.kill.mutate(n), danger: true, hint: "X" },
        ]}
      />
      <BoardPickerDialog open={board} onOpenChange={setBoard} onPick={(boardId) => a.sendToBoard.mutate({ n, boardId })} />
      <BitPickerDialog
        open={bit}
        onOpenChange={setBit}
        onPick={(bitId) => a.addToBit.mutate({ n, bitId })}
        onCreate={async (name) => {
          const r = await api.post<{ bit: { id: string } }>("/bits", { name, card_numbers: [n] });
          router.push(`/bits/${r.bit.id}`);
        }}
      />
      <SplitDialog open={split} onOpenChange={setSplit} body={body ?? card.body} onSplit={(at) => a.split.mutateAsync({ n, split_at: at, container }).then(() => undefined)} />
      <CombineDialog open={combine} onOpenChange={setCombine} seed={{ ...card, body_excerpt: card.body }} onCombine={(numbers) => a.combine.mutateAsync({ numbers }).then(() => undefined)} />
    </>
  );
}
