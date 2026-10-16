"use client";
import * as RD from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { Button, cx } from "./primitives";
import { useIsPhone } from "@/lib/hooks";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  /** Render as a bottom sheet on phones (default true). */
  sheetOnPhone?: boolean;
  screenId?: string;
  preventEscape?: boolean;
}

/** Desktop: centered dialog (§5.11). Phone: bottom sheet with grab handle. */
export function Dialog({ open, onOpenChange, title, description, children, footer, width = 480, sheetOnPhone = true, screenId, preventEscape }: DialogProps) {
  const phone = useIsPhone();
  const sheet = phone && sheetOnPhone;
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-[rgba(31,29,26,0.35)] data-[state=open]:animate-[fade_180ms_var(--ease)]" />
        <RD.Content
          onEscapeKeyDown={(e) => preventEscape && e.preventDefault()}
          className={cx(
            "fixed z-50 flex flex-col bg-surface shadow-dialog focus:outline-none",
            sheet ? "inset-x-0 bottom-0 max-h-[90vh] rounded-t-[14px] pb-[env(safe-area-inset-bottom)]" : "left-1/2 top-1/2 max-h-[85vh] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 rounded-[10px]",
          )}
          style={sheet ? undefined : { maxWidth: width }}
        >
          {sheet && <div aria-hidden className="mx-auto mt-2 h-1 w-10 rounded-full bg-border-strong" />}
          <div className={cx("flex items-start justify-between gap-3", sheet ? "px-5 pt-3" : "px-6 pt-6")}>
            <div className="min-w-0">
              {screenId && process.env.NEXT_PUBLIC_SHOW_SCREEN_IDS === "true" && <span className="meta mb-1 block">{screenId}</span>}
              <RD.Title className="font-serif text-[18px] font-semibold leading-tight text-ink">{title}</RD.Title>
              {description && <RD.Description className="mt-1 text-[13px] text-ink-2">{description}</RD.Description>}
            </div>
            <RD.Close asChild>
              <button type="button" aria-label="Close" className="rounded-md p-1 text-ink-2 hover:bg-tab-active">
                ✕
              </button>
            </RD.Close>
          </div>
          <div className={cx("min-h-0 flex-1 overflow-y-auto", sheet ? "px-5 py-4" : "px-6 py-4")}>{children}</div>
          {footer && <div className={cx("flex flex-wrap justify-end gap-2 border-t border-divider", sheet ? "px-5 py-3" : "px-6 py-4")}>{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

/** M9-style destructive confirmation. Focus starts on Cancel. */
export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel, onConfirm, danger = true, requireText, screenId = "M9" }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; body?: React.ReactNode; confirmLabel: string; onConfirm: () => void | Promise<void>; danger?: boolean; requireText?: string; screenId?: string }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);
  const ok = !requireText || typed === requireText;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={body}
      screenId={screenId}
      preventEscape={!!requireText && typed.length > 0}
      footer={
        <>
          <Button autoFocus onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            className={danger ? "!bg-danger-text !text-white" : undefined}
            disabled={!ok || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {requireText && (
        <label className="block text-[13px]">
          <span className="label mb-1 block">Type {requireText} to confirm</span>
          <input className="field" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </label>
      )}
    </Dialog>
  );
}
