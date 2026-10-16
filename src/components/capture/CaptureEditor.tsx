"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { cx } from "@/components/ui/primitives";

export interface CaptureEditorHandle {
  focus: () => void;
}

/**
 * The capture text box. The first line is styled as the title (it becomes `title` on save, §7.3).
 * Implemented as a textarea with a mirrored overlay so the first line can be bold without a rich editor.
 */
export const CaptureEditor = forwardRef<CaptureEditorHandle, { value: string; onChange: (v: string) => void; onSubmit?: () => void; placeholder?: string; autoFocus?: boolean; minHeight?: number; size?: "phone" | "desktop"; className?: string; submitOnEnter?: boolean }>(function CaptureEditor({ value, onChange, onSubmit, placeholder = "Dump it here. Half a thought is fine.", autoFocus, minHeight = 260, size = "phone", className, submitOnEnter }, ref) {
  const ta = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => ta.current?.focus() }), []);
  useEffect(() => {
    if (autoFocus) ta.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`;
  }, [value, minHeight]);

  const nl = value.indexOf("\n");
  const title = nl >= 0 ? value.slice(0, nl) : value;
  const rest = nl >= 0 ? value.slice(nl) : "";
  const hasTitle = nl >= 0 && title.trim().length > 0 && rest.trim().length > 0 && title.length <= 200;
  const titleCls = size === "phone" ? "text-[20px] font-semibold leading-[1.3]" : "text-[16px] font-semibold leading-[1.3]";
  const bodyCls = size === "phone" ? "text-[17px] leading-[1.45]" : "text-[16px] leading-[1.45]";

  return (
    <div className={cx("relative rounded-[10px] border-[1.5px] border-accent bg-card md:rounded-[8px]", className)}>
      {/* Mirror layer: renders the text with the first line bold; the textarea on top is transparent. */}
      <div aria-hidden className={cx("pointer-events-none absolute inset-0 whitespace-pre-wrap break-words px-4 py-3 text-ink", bodyCls)} style={{ minHeight }}>
        {value.length === 0 ? (
          <span className="text-ink-2">{placeholder}</span>
        ) : hasTitle ? (
          <>
            <span className={titleCls}>{title}</span>
            {rest}
          </>
        ) : (
          value
        )}
        {"​"}
      </div>
      <textarea
        ref={ta}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (submitOnEnter && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit?.();
          }
        }}
        aria-label="Note"
        className={cx("relative block w-full resize-none bg-transparent px-4 py-3 text-transparent caret-ink outline-none", bodyCls)}
        style={{ minHeight }}
        spellCheck
      />
    </div>
  );
});
