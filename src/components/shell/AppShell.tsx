"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useIsPhone, useMounted } from "@/lib/hooks";
import { startOutboxSync } from "@/lib/offline/outbox";
import { qk } from "@/lib/query-keys";
import { DesktopShell } from "./DesktopShell";
import { PhoneShell } from "./PhoneShell";
import { CommandPalette } from "@/components/search/CommandPalette";
import { CaptureDialog } from "@/components/capture/CaptureDialog";
import { create } from "zustand";

interface ShellState {
  paletteOpen: boolean;
  captureOpen: boolean;
  setPalette: (o: boolean) => void;
  setCapture: (o: boolean) => void;
}
export const useShell = create<ShellState>((set) => ({
  paletteOpen: false,
  captureOpen: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setCapture: (captureOpen) => set({ captureOpen }),
}));

export function AppShell({ children }: { children: React.ReactNode }) {
  const phone = useIsPhone();
  const mounted = useMounted();
  const qc = useQueryClient();
  const [shortcutHelp, setShortcutHelp] = useState(false);

  useEffect(() => {
    startOutboxSync(() => {
      qc.invalidateQueries({ queryKey: ["cards"] });
      qc.invalidateQueries({ queryKey: qk.me });
    });
  }, [qc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const editable = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useShell.getState().setPalette(true);
      } else if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        useShell.getState().setCapture(true);
      } else if (!editable && e.key === "?" ) {
        setShortcutHelp((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!mounted) {
    return <div className="min-h-screen bg-bg" aria-busy="true" />;
  }
  return (
    <>
      {phone ? <PhoneShell>{children}</PhoneShell> : <DesktopShell>{children}</DesktopShell>}
      <CommandPalette />
      <CaptureDialog />
      {shortcutHelp && (
        <div role="dialog" aria-label="Keyboard shortcuts" className="fixed bottom-4 right-4 z-50 w-[300px] rounded-[10px] border border-border bg-surface p-4 text-[12px] shadow-dialog">
          <div className="mb-2 flex items-center justify-between">
            <span className="label">Shortcuts</span>
            <button type="button" className="text-ink-2" onClick={() => setShortcutHelp(false)} aria-label="Close">
              ✕
            </button>
          </div>
          <ul className="space-y-1">
            <li><span className="key-hint">⌘K</span> search · <span className="key-hint">⌘N</span> capture</li>
            <li><span className="key-hint">J</span>/<span className="key-hint">K</span> next/previous card</li>
            <li><span className="key-hint">T</span> tag · <span className="key-hint">B</span> board · <span className="key-hint">W</span> workshop</li>
            <li><span className="key-hint">E</span> edit · <span className="key-hint">X</span> kill · <span className="key-hint">U</span> undo kill</li>
            <li><span className="key-hint">?</span> toggle this help</li>
          </ul>
        </div>
      )}
    </>
  );
}
