"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LeftRail } from "./LeftRail";
import { cx, ScreenIdBadge } from "@/components/ui/primitives";
import { useIsWide } from "@/lib/hooks";

/** Mounts the screen-ID badge into the desktop header slot. */
export function ScreenId({ id }: { id: string }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(document.getElementById("screen-id-slot"));
  }, []);
  if (!slot) return null;
  return createPortal(<ScreenIdBadge id={id} />, slot);
}

/**
 * Desktop three-column frame (§4.0.1). Below 1280 px the inspector becomes an overlay drawer
 * when `inspectorOpen` is true.
 */
export function DesktopPage({ id, rail, hideStandardRail, noRail, children, inspector, inspectorOpen = true, onCloseInspector, inspectorWidth = 320 }: { id: string; rail?: React.ReactNode; hideStandardRail?: boolean; noRail?: boolean; children: React.ReactNode; inspector?: React.ReactNode; inspectorOpen?: boolean; onCloseInspector?: () => void; inspectorWidth?: number }) {
  const wide = useIsWide();
  const overlay = !wide && inspector && inspectorOpen;
  return (
    <div className="flex h-full min-h-0">
      <ScreenId id={id} />
      {!noRail && <LeftRail hideStandard={hideStandardRail}>{rail}</LeftRail>}
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      {inspector && wide && (
        <aside className="flex h-full shrink-0 flex-col overflow-y-auto border-l border-border bg-surface" style={{ width: inspectorWidth }} aria-label="Inspector">
          {inspector}
        </aside>
      )}
      {overlay && (
        <>
          <div className="fixed inset-0 z-30 bg-[rgba(31,29,26,0.2)]" onClick={onCloseInspector} aria-hidden />
          <aside className="fixed inset-y-0 right-0 z-40 flex w-[360px] flex-col overflow-y-auto border-l border-border bg-surface shadow-dialog" aria-label="Inspector">
            <button type="button" aria-label="Close inspector" className="absolute right-2 top-2 rounded-md p-1 text-ink-2 hover:bg-tab-active" onClick={onCloseInspector}>
              ✕
            </button>
            {inspector}
          </aside>
        </>
      )}
    </div>
  );
}

export function Inspector({ title, meta, children, className }: { title?: string; meta?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-3.5 p-4", className)}>
      {(title || meta) && (
        <div className="flex items-center justify-between">
          <span className="label">{title}</span>
          <span className="meta">{meta}</span>
        </div>
      )}
      {children}
    </div>
  );
}

export function InspectorSection({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label">{title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Phone frame (§4.0.2): header (56 px) + scrolling content. */
export function PhonePage({ id, title, left, right, children, className }: { id: string; title?: React.ReactNode; left?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="sticky top-0 z-20 flex h-[56px] shrink-0 items-center gap-2 border-b border-border bg-surface px-4">
        {process.env.NEXT_PUBLIC_SHOW_SCREEN_IDS === "true" && <ScreenIdBadge id={id} />}
        {left}
        {title && <div className="min-w-0 flex-1 truncate font-serif text-[20px] font-semibold leading-tight">{title}</div>}
        {!title && <div className="flex-1" />}
        {right}
      </header>
      <div className={cx("min-h-0 flex-1", className)}>{children}</div>
    </div>
  );
}

export function CenterHeader({ title, meta, children, chip }: { title: React.ReactNode; meta?: React.ReactNode; children?: React.ReactNode; chip?: React.ReactNode }) {
  return (
    <div className="flex min-h-[48px] shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface/60 px-5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate font-serif text-[18px] font-semibold leading-tight">{title}</h2>
        {chip}
      </div>
      {meta && <span className="meta">{meta}</span>}
      <div className="flex-1" />
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
