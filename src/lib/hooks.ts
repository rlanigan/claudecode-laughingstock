"use client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "./api-client";
import { qk } from "./query-keys";
import type { MeDTO } from "@/types/dto";

const PHONE_QUERY = "(max-width: 767px)";

function subscribe(query: string, cb: () => void) {
  const mql = window.matchMedia(query);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

/** Server-safe media query: desktop on the server, real value after mount. */
export function useMediaQuery(query: string, serverDefault = false): boolean {
  return useSyncExternalStore(
    (cb) => subscribe(query, cb),
    () => window.matchMedia(query).matches,
    () => serverDefault,
  );
}

export const useIsPhone = () => useMediaQuery(PHONE_QUERY, false);
export const useIsWide = () => useMediaQuery("(min-width: 1280px)", true);

export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: () => api.get<MeDTO>("/me"), staleTime: 60_000 });
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** Global keyboard shortcut helper. Ignores events from editable targets unless `allowInInputs`. */
export function useShortcut(key: string, handler: (e: KeyboardEvent) => void, opts: { meta?: boolean; shift?: boolean; allowInInputs?: boolean } = {}) {
  const cb = useRef(handler);
  useEffect(() => { cb.current = handler; }, [handler]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editable = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (editable && !opts.allowInInputs) return;
      const meta = e.metaKey || e.ctrlKey;
      if (!!opts.meta !== meta) return;
      if (!!opts.shift !== e.shiftKey) return;
      if (e.key.toLowerCase() !== key.toLowerCase()) return;
      e.preventDefault();
      cb.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, opts.meta, opts.shift, opts.allowInInputs]);
}

/** Debounced value. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Toggles `keyboard-open` on <html> while an input is focused on phones (hides bottom tabs). */
export function useKeyboardOpenClass(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const on = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) document.documentElement.classList.add("keyboard-open");
    };
    const off = () => document.documentElement.classList.remove("keyboard-open");
    document.addEventListener("focusin", on);
    document.addEventListener("focusout", off);
    return () => {
      document.removeEventListener("focusin", on);
      document.removeEventListener("focusout", off);
      off();
    };
  }, [enabled]);
}
