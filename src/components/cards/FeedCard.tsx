"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { cx } from "@/components/ui/primitives";
import { relativeTime } from "@/lib/format";
import type { CardSummaryDTO } from "@/types/dto";
import { CardChips } from "./CardChips";

/** P3 feed card with swipe: right = Keep, left = Kill (threshold 35 % width, §5.12). */
export function FeedCard({ card, onKeep, onKill, onTag, onWorkshop, href }: { card: CardSummaryDTO; onKeep: () => void; onKill: () => void; onTag: () => void; onWorkshop: () => void; href: string }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; w: number } | null>(null);
  const horizontal = useRef<boolean | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY, w: e.currentTarget.clientWidth };
    horizontal.current = null;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const ddx = e.clientX - start.current.x;
    const ddy = e.clientY - start.current.y;
    if (horizontal.current === null) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      horizontal.current = Math.abs(ddx) > Math.abs(ddy);
      if (horizontal.current) {
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }
    if (horizontal.current) setDx(ddx);
  };
  const finish = () => {
    if (!start.current) return;
    const threshold = start.current.w * 0.35;
    if (dx > threshold) onKeep();
    else if (dx < -threshold) onKill();
    setDx(0);
    setDragging(false);
    start.current = null;
  };
  const keepReveal = Math.max(0, dx);
  const killReveal = Math.max(0, -dx);

  return (
    <div className="relative overflow-hidden rounded-[10px]">
      <div aria-hidden className="absolute inset-0 flex items-center justify-between px-4 font-semibold text-white">
        <span className="rounded-md bg-success-text px-3 py-1.5" style={{ opacity: Math.min(1, keepReveal / 80) }}>Keep</span>
        <span className="rounded-md bg-danger-text px-3 py-1.5" style={{ opacity: Math.min(1, killReveal / 80) }}>Kill</span>
      </div>
      <article
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        style={{ transform: `translateX(${dx}px)`, transition: dragging ? "none" : "transform 180ms var(--ease)" }}
        className={cx("relative touch-pan-y rounded-[10px] border border-border bg-card", card.status === "killed" && "opacity-60")}
      >
        <Link href={href} className="block px-3.5 py-3" draggable={false} onClick={(e) => { if (Math.abs(dx) > 5) e.preventDefault(); }}>
          {card.title && <div className="text-[17px] font-semibold leading-[1.3]">{card.title}</div>}
          <div className="text-[15px] leading-[1.45] text-ink-body">{card.body}</div>
          <div className="meta mt-1.5">
            {relativeTime(card.captured_at)} · {card.capture_source} · {card.display_number}
            {card.usage_label && <span className="ml-2 text-accent-dark">{card.usage_label}</span>}
          </div>
          <div className="mt-2">
            <CardChips card={card} showUntagged />
          </div>
        </Link>
        <div className="flex divide-x divide-divider border-t border-divider">
          <button type="button" className="min-h-[44px] flex-1 text-[14px]" onClick={onTag}>Tag</button>
          <button type="button" className="min-h-[44px] flex-1 text-[14px] font-semibold text-accent-dark" onClick={onWorkshop}>Workshop</button>
          <button type="button" className="min-h-[44px] flex-1 text-[14px]" onClick={onKill}>Kill</button>
        </div>
      </article>
    </div>
  );
}
