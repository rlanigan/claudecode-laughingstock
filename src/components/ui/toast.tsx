"use client";
import { create } from "zustand";

export interface ToastItem {
  id: number;
  text: string;
  action?: { label: string; onClick: () => void };
  durationMs: number;
}

interface ToastState {
  toasts: ToastItem[];
  push: (text: string, opts?: { action?: ToastItem["action"]; durationMs?: number }) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (text, opts) => {
    const id = nextId++;
    const item: ToastItem = { id, text, action: opts?.action, durationMs: opts?.durationMs ?? (opts?.action ? 5000 : 2000) };
    set((s) => ({ toasts: [...s.toasts.slice(-2), item] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), item.durationMs);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (text: string, opts?: { action?: ToastItem["action"]; durationMs?: number }) => useToastStore.getState().push(text, opts);

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 md:bottom-6" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-center gap-3 rounded-lg border border-border bg-ink px-4 py-2.5 text-[13px] text-[#f1ece3] shadow-dialog">
          <span>{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="font-semibold text-[#f0a07f] underline-offset-2 hover:underline"
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
