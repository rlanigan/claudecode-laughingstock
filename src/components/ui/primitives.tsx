"use client";
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "text" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-accent border border-accent-border text-white font-semibold hover:bg-accent-hover active:bg-accent-active",
  secondary: "bg-field border border-border-strong text-ink hover:bg-surface",
  text: "border border-transparent text-accent-dark font-semibold hover:underline",
  danger: "bg-field border border-danger-text text-danger-text hover:bg-danger-bg",
  ghost: "border border-transparent text-ink-2 hover:bg-tab-active hover:text-ink",
};
const sizeClass: Record<ButtonSize, string> = {
  sm: "text-[12px] px-2 py-1 min-h-[28px] md:min-h-[26px]",
  md: "text-[13px] px-2.5 py-1.5 min-h-[44px] md:min-h-[30px] md:text-[12px]",
  lg: "text-[15px] px-3 py-2.5 min-h-[48px] md:min-h-[34px] md:text-[13px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", full, className, type = "button", ...rest }, ref) {
  return <button ref={ref} type={type} className={cx("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md transition-colors duration-[120ms] md:rounded-[6px]", variantClass[variant], sizeClass[size], full && "w-full", className)} {...rest} />;
});

export type ChipVariant = "neutral" | "version" | "status" | "theme" | "dashed" | "success" | "dark" | "danger" | "accent";

const chipClass: Record<ChipVariant, string> = {
  neutral: "bg-chip-bg text-chip-text",
  version: "bg-accent-tint text-accent-dark",
  status: "bg-field border border-border text-ink-2",
  theme: "bg-transparent border border-accent text-accent-dark",
  dashed: "bg-transparent border border-dashed border-dashed text-ink-2",
  success: "bg-success-bg text-success-text",
  dark: "bg-ink text-[#f1ece3]",
  danger: "bg-danger-bg text-danger-text",
  accent: "bg-accent text-white",
};

export function Chip({ variant = "neutral", className, children, onClick, pressed, title, ...rest }: { variant?: ChipVariant; className?: string; children: React.ReactNode; onClick?: () => void; pressed?: boolean; title?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "title">) {
  const cls = cx("inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-[3px] font-mono text-[10px] leading-none md:text-[10px] text-[11px]", chipClass[variant], onClick && "cursor-pointer hover:brightness-95", className);
  if (onClick) {
    return (
      <button type="button" className={cx(cls, "min-h-[28px] md:min-h-[22px]")} onClick={onClick} aria-pressed={pressed} title={title} {...rest}>
        {children}
      </button>
    );
  }
  return (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}

export function VersionChip({ label, className }: { label: string; className?: string }) {
  return (
    <Chip variant="version" className={className}>
      {label}
    </Chip>
  );
}

export function SectionLabel({ children, className, htmlFor }: { children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={cx("label block", className)}>
      {children}
    </label>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function TextInput({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={cx("field", className)} aria-invalid={invalid || undefined} {...rest} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; autoGrow?: boolean }>(function TextArea({ className, invalid, autoGrow = true, onInput, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx("field", className)}
      aria-invalid={invalid || undefined}
      rows={rest.rows ?? 2}
      onInput={(e) => {
        if (autoGrow) {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight}px`;
        }
        onInput?.(e);
      }}
      {...rest}
    />
  );
});

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="mt-1 flex items-center gap-1 text-[12px] text-danger-text">
      <span aria-hidden>⚠</span>
      {children}
    </p>
  );
}

export function SegmentedControl<T extends string>({ value, options, onChange, ariaLabel, size = "md" }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; ariaLabel: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex overflow-hidden rounded-md border border-border-strong bg-field">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("px-3 font-sans transition-colors", size === "sm" ? "py-1 text-[11px]" : "py-1.5 text-[12px] md:py-1", value === o.value ? "bg-ink font-semibold text-[#f1ece3]" : "text-ink hover:bg-surface")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action, className }: { title: string; body?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center justify-center gap-2 px-6 py-14 text-center", className)}>
      <p className="font-serif text-[18px] font-semibold text-ink">{title}</p>
      {body && <p className="max-w-[360px] text-[13px] text-ink-2">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-md bg-divider", className)} />;
}

export function SkeletonRows({ n = 3 }: { n?: number }) {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-[56px] w-full" />
      ))}
    </div>
  );
}

export function ScreenIdBadge({ id }: { id: string }) {
  if (process.env.NEXT_PUBLIC_SHOW_SCREEN_IDS !== "true") return null;
  return (
    <span className="inline-flex items-center rounded-[5px] bg-ink px-1.5 py-[3px] font-mono text-[11px] font-semibold leading-none text-white" title="Screen ID">
      {id}
    </span>
  );
}

export function InlineBanner({ children, action, tone = "warn" }: { children: React.ReactNode; action?: React.ReactNode; tone?: "warn" | "info" }) {
  return (
    <div role={tone === "warn" ? "alert" : "status"} className={cx("flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-[12px]", tone === "warn" ? "border-accent bg-accent-wash text-accent-dark" : "border-border bg-surface text-ink-2")}>
      <span>{children}</span>
      {action}
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cx("border-0 border-t border-divider", className)} />;
}

export function KeyHint({ children }: { children: React.ReactNode }) {
  return <kbd className="key-hint">{children}</kbd>;
}
