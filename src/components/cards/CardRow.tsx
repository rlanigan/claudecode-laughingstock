"use client";
import { cx } from "@/components/ui/primitives";
import { relativeTime } from "@/lib/format";
import type { CardSummaryDTO } from "@/types/dto";
import { CardChips } from "./CardChips";

/** D1 list row (§4.0.4 CardRow). */
export function CardRow({ card, selected, onSelect, onDoubleClick, actions }: { card: CardSummaryDTO; selected?: boolean; onSelect?: () => void; onDoubleClick?: () => void; actions?: React.ReactNode }) {
  return (
    <div
      role="row"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect?.();
      }}
      className={cx("group flex cursor-pointer items-start gap-3 border-b border-divider px-3.5 py-3 outline-none", selected ? "bg-field shadow-[inset_3px_0_0_var(--accent)]" : "hover:bg-surface")}
    >
      <div className="min-w-0 flex-1">
        {card.title && <div className="text-[14px] font-semibold leading-[1.3]">{card.title}</div>}
        <div className="line-clamp-2 text-[14px] leading-[1.45] text-ink-body">{card.body}</div>
        <div className="meta mt-1">
          {relativeTime(card.captured_at)} · {card.capture_source} · {card.display_number}
          {card.usage_label && <span className="ml-2 text-accent-dark">{card.usage_label}</span>}
        </div>
        <div className="mt-1.5">
          <CardChips card={card} showUntagged />
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-1 opacity-70 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  );
}
