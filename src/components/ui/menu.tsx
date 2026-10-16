"use client";
import * as DM from "@radix-ui/react-dropdown-menu";
import { cx } from "./primitives";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

/** Desktop dropdown; on phones it still works as a popover (sheet-style conversions live in callers). */
export function Menu({ trigger, items, align = "end", ariaLabel, screenId }: { trigger: React.ReactNode; items: (MenuItem | "separator")[]; align?: "start" | "end"; ariaLabel?: string; screenId?: string }) {
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild aria-label={ariaLabel}>
        {trigger}
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align={align} sideOffset={4} className="z-50 min-w-[200px] rounded-md border border-border bg-surface p-1 shadow-dialog">
          {screenId && process.env.NEXT_PUBLIC_SHOW_SCREEN_IDS === "true" && <div className="meta px-2 py-1">{screenId}</div>}
          {items.map((it, i) =>
            it === "separator" ? (
              <DM.Separator key={i} className="my-1 h-px bg-divider" />
            ) : (
              <DM.Item key={i} disabled={it.disabled} onSelect={it.onSelect} className={cx("flex cursor-pointer select-none items-center justify-between gap-4 rounded-[5px] px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-tab-active data-[disabled]:opacity-45", it.danger ? "text-danger-text" : "text-ink")}>
                <span>{it.label}</span>
                {it.hint && <span className="meta">{it.hint}</span>}
              </DM.Item>
            ),
          )}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}
