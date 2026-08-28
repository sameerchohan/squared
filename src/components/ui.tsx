"use client";

import { forwardRef, useId } from "react";
import { AlertIcon, SpinnerIcon } from "./icons";

/* -------------------------------------------------------------------------
   Primitives shared across every screen. Centralising them is what keeps the
   app from looking assembled out of unrelated parts: one focus ring, one
   radius scale, one disabled treatment, one way to report an error.
------------------------------------------------------------------------- */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
};

const BUTTON_BASE =
  "relative inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap " +
  // Press feedback is a 1% scale rather than a translate: it reads as physical
  // without nudging neighbouring layout.
  "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out " +
  "active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 cursor-pointer";

const BUTTON_VARIANTS: Record<string, string> = {
  primary:
    "bg-[var(--brand)] text-[var(--on-brand)] shadow-[var(--shadow-sm)] hover:bg-[var(--brand-hover)]",
  secondary:
    "border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-subtle)]",
  ghost: "text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text)]",
  danger:
    "bg-[var(--negative)] text-white shadow-[var(--shadow-sm)] hover:brightness-110",
};

const BUTTON_SIZES: Record<string, string> = {
  // Heights meet the 44px touch-target floor on the primary size.
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary", size = "md", loading, children, className, disabled, ...rest },
    ref
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        // The label keeps its position while loading so the button doesn't
        // resize mid-click; the spinner overlays instead of replacing.
        className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
        {...rest}
      >
        {loading && (
          <span className="absolute inset-0 grid place-items-center">
            <SpinnerIcon className="h-4 w-4" />
          </span>
        )}
        <span className={cx("inline-flex items-center gap-2", loading && "invisible")}>
          {children}
        </span>
      </button>
    );
  }
);

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]",
        className
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/* A labelled field with helper text and an error slot directly beneath the
   input — never a summary far from the control that caused it. */
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-[var(--text)]">
        {label}
        {required && (
          <span className="ml-0.5 text-[var(--negative)]" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        // role="alert" so a screen reader announces the failure immediately.
        <p id={errorId} role="alert" className="flex items-center gap-1.5 text-[13px] text-[var(--negative)]">
          <AlertIcon className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-[13px] text-[var(--text-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL_BASE =
  "h-11 w-full rounded-lg border bg-[var(--surface)] px-3 text-[15px] text-[var(--text)] " +
  "placeholder:text-[var(--text-faint)] transition-colors duration-150 " +
  "focus:border-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-60";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ invalid, className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(
        CONTROL_BASE,
        invalid ? "border-[var(--negative)]" : "border-[var(--border-strong)]",
        className
      )}
      {...rest}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cx(CONTROL_BASE, "cursor-pointer border-[var(--border-strong)] pr-8", className)}
      {...rest}
    >
      {children}
    </select>
  );
});

/* A form-level banner for failures that aren't tied to one field. */
export function Alert({
  tone = "error",
  children,
}: {
  tone?: "error" | "warning" | "success";
  children: React.ReactNode;
}) {
  const tones = {
    error: "border-[var(--negative)]/25 bg-[var(--negative-subtle)] text-[var(--negative)]",
    warning: "border-[var(--warning)]/25 bg-[var(--warning-subtle)] text-[var(--warning)]",
    success: "border-[var(--positive)]/25 bg-[var(--positive-subtle)] text-[var(--positive)]",
  };
  return (
    <div
      role="alert"
      className={cx(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed",
        tones[tone]
      )}
    >
      <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "positive" | "negative" | "warning" | "brand";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-[var(--surface-subtle)] text-[var(--text-muted)]",
    positive: "bg-[var(--positive-subtle)] text-[var(--positive)]",
    negative: "bg-[var(--negative-subtle)] text-[var(--negative)]",
    warning: "bg-[var(--warning-subtle)] text-[var(--warning)]",
    brand: "bg-[var(--brand-subtle)] text-[var(--brand)]",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}

/* Empty space is never left blank — it explains what goes here and offers
   the action that fills it. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="grid h-11 w-11 place-items-center rounded-full bg-[var(--surface-subtle)] text-[var(--text-faint)]">
        {icon}
      </div>
      <h3 className="mt-3 text-[15px] font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-[var(--text-muted)]">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* Skeletons rather than a spinner: the page keeps its shape while loading,
   so nothing jumps when the data lands. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cx("animate-pulse rounded-md bg-[var(--surface-subtle)]", className)}
      aria-hidden="true"
    />
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid shrink-0 place-items-center rounded-full bg-[var(--brand-subtle)] text-[12px] font-semibold text-[var(--brand)]",
        className ?? "h-8 w-8"
      )}
    >
      {initials}
    </span>
  );
}
