"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
} from "react";
import { AlertIcon, ChevronDownIcon, SpinnerIcon, XIcon } from "./icons";

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

/* Which cards a person has folded away, kept in localStorage and read through
   useSyncExternalStore so the server render (nothing remembered) and the
   client render (whatever this device remembers) can disagree safely. */
const cardListeners = new Set<() => void>();

function cardStorageKey(key: string) {
  return `squared.card.${key}`;
}

function subscribeToCardState(onChange: () => void) {
  cardListeners.add(onChange);
  // Another tab folding the same card should be reflected here too.
  window.addEventListener("storage", onChange);
  return () => {
    cardListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function setCardState(key: string, open: boolean) {
  try {
    window.localStorage.setItem(cardStorageKey(key), open ? "open" : "closed");
  } catch {
    // Private mode or storage disabled. Not being able to remember the choice
    // is not a reason to refuse to make it, so fall through and notify anyway.
  }
  for (const onChange of cardListeners) onChange();
}

/**
 * A card whose body can be folded away, remembering the choice on this device.
 *
 * Most of this page is reference material: a payment log, a member list, the
 * Stripe machinery you are not using today. On a phone all of it sits between
 * you and the one thing you opened the app to do. Collapsing is per person and
 * per device rather than saved to the group, because it is a preference about
 * a screen, not a fact about the trip.
 *
 * A closed card still shows `summary`, so folding something away never costs
 * you the number that would have made you open it.
 */
export function CollapsibleCard({
  title,
  description,
  summary,
  storageKey,
  defaultOpen = true,
  children,
  className,
}: {
  title: string;
  description?: string;
  summary?: React.ReactNode;
  storageKey: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const bodyId = useId();
  const remembered = useSyncExternalStore(
    subscribeToCardState,
    () => {
      try {
        return window.localStorage.getItem(cardStorageKey(storageKey));
      } catch {
        return null;
      }
    },
    () => null
  );
  const open = remembered === null ? defaultOpen : remembered === "open";

  return (
    <Card className={className}>
      <h2>
        <button
          type="button"
          onClick={() => setCardState(storageKey, !open)}
          aria-expanded={open}
          aria-controls={bodyId}
          className={cx(
            // The whole header is the target. On a phone a lone chevron is a
            // miss waiting to happen, and there is nothing else here to hit.
            "flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left",
            "transition-colors duration-150 hover:bg-[var(--surface-subtle)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-ring)]",
            open && "border-b border-[var(--border)]"
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold tracking-tight">
              {title}
            </span>
            {open && description && (
              <span className="mt-0.5 block text-[13px] font-normal text-[var(--text-muted)]">
                {description}
              </span>
            )}
            {!open && summary && (
              <span className="mt-0.5 block truncate text-[13px] font-normal text-[var(--text-muted)]">
                {summary}
              </span>
            )}
          </span>
          <ChevronDownIcon
            className={cx(
              "h-4 w-4 shrink-0 text-[var(--text-faint)] transition-transform duration-200",
              !open && "-rotate-90"
            )}
          />
        </button>
      </h2>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </Card>
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

// 16px is not a taste decision: iOS Safari zooms the whole page in when a
// focused control's text is smaller, and never zooms back out. Every control
// in the app inherits this, so no field can reintroduce the bug locally.
const CONTROL_BASE =
  "h-11 w-full rounded-lg border bg-[var(--surface)] px-3 text-[16px] text-[var(--text)] " +
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

/* -------------------------------------------------------------------------
   Dialog

   Escape closes it, clicking outside the panel closes it, focus moves
   inside on open and returns to the trigger on close, and Tab cycles within
   — a modal that leaks focus to the page behind it is unusable with a
   keyboard.

   The panel is never height-constrained and never has its own inner scroll
   region. Everything — header, fields, Save and Cancel — lives in exactly
   one scrolling container, the full-screen overlay itself. That is a
   deliberate reaction to two real bugs this dialog shipped with: a
   percentage-height chain that could resolve to zero in an unusual
   rendering context, and `align-items: center` on an overflowing flex
   child, which clips the end that overflows first rather than making it
   reachable by scrolling. One container, sized in plain CSS with nothing
   for either of those to happen to, can't fail either way — however tall
   the form gets, you reach the rest of it exactly the way you'd scroll a
   page: wheel, trackpad, touch drag, Page Down, all of it.
------------------------------------------------------------------------- */

/**
 * The frame the user can actually see — used only to *nudge a focused field
 * back into view* when the on-screen keyboard opens, never to size or place
 * the dialog itself.
 *
 * It used to do the latter too: the overlay's own top/height came from this
 * hook, on the reasoning that `inset-0`'s default containing block is the
 * *layout* viewport, which includes the strip behind the browser's URL bar
 * and doesn't shrink for the keyboard. True, but it made the dialog's basic
 * visibility depend on a browser API that isn't reliable everywhere it
 * renders — an embedded webview reporting a degenerate visualViewport
 * collapsed the positioning container to nothing, pinning the panel to the
 * very top of the screen instead of centering it, on both phone and
 * desktop. `100dvh`, plain CSS with no JS in the loop, already covers the
 * URL-bar case correctly and cannot fail this way; the dialog is sized with
 * that now. What dvh does not reliably cover is the keyboard specifically,
 * which is what this hook still helps with, as an enhancement layered on
 * top of a layout that already works without it.
 */
function useVisualViewportFrame(open: boolean) {
  // While closed, nothing is subscribed: visualViewport's scroll event fires
  // continuously as the page moves, and a dialog that isn't on screen has no
  // business re-rendering on every one of them.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const viewport = window.visualViewport;
      if (!open || !viewport) return () => {};
      viewport.addEventListener("resize", onChange);
      viewport.addEventListener("scroll", onChange);
      return () => {
        viewport.removeEventListener("resize", onChange);
        viewport.removeEventListener("scroll", onChange);
      };
    },
    [open]
  );

  // The snapshot is a string rather than an object because
  // useSyncExternalStore compares snapshots with Object.is, and a fresh
  // object on every read would re-render forever.
  const getSnapshot = useCallback(() => {
    const viewport = window.visualViewport;
    if (!open || !viewport) return "";
    return `${viewport.offsetTop}:${viewport.height}`;
  }, [open]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => "");
  if (!snapshot) return null;

  const [top, height] = snapshot.split(":").map(Number);
  // Nothing downstream should act on a reading that isn't a real,
  // positive size — this is exactly the kind of value that broke the
  // dialog when it drove layout directly, and the nudge effect deserves
  // the same guard even though a bad read there only costs the nudge.
  if (!Number.isFinite(top) || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  return { top, height };
}

/**
 * Holds the page still behind the dialog.
 *
 * `overflow: hidden` on the body is enough on a desktop browser and is
 * ignored by iOS Safari, which keeps scrolling the page and drags the fixed
 * overlay along with it. Pinning the body at its current offset does work;
 * restoring the offset afterwards is what stops the page jumping to the top
 * when the dialog closes.
 */
function useBodyScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const { body } = document;
    const scrollY = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";

    return () => {
      Object.assign(body.style, previous);
      window.scrollTo(0, scrollY);
    };
  }, [open]);
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  const frame = useVisualViewportFrame(open);
  useBodyScrollLock(open);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // Focus starts on the panel itself, which is not in the list. Without
      // this, Shift+Tab from there would walk backwards out of the dialog.
      if (!active || focusable.indexOf(active) === -1) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", handleKeyDown);

    // The panel takes focus rather than the first input. Focusing an input
    // would open the on-screen keyboard the instant the dialog appears,
    // which halves the visible area before the user has read the title —
    // and it is the dialog, not one of its fields, that a screen reader
    // should announce first.
    const timer = window.setTimeout(() => panelRef.current?.focus(), 20);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.clearTimeout(timer);
      restoreRef.current?.focus?.();
    };
  }, [open, handleKeyDown]);

  // When the keyboard opens it shrinks the frame under whatever the user just
  // tapped. Following the focused field keeps it in sight instead of leaving
  // the user typing into a field hidden behind the keys.
  //
  // Only on a shrink, and only on the height rather than the frame object:
  // the frame changes identity on every render and its offset changes
  // throughout a scroll, and scrolling the field back into view on either of
  // those would fight the user for control of the panel.
  const previousHeightRef = useRef<number | null>(null);
  const frameHeight = frame?.height ?? null;

  useEffect(() => {
    if (!open) {
      previousHeightRef.current = null;
      return;
    }
    const previous = previousHeightRef.current;
    previousHeightRef.current = frameHeight;
    if (previous === null || frameHeight === null || frameHeight >= previous) {
      return;
    }

    const active = document.activeElement as HTMLElement | null;
    if (active && panelRef.current?.contains(active)) {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [open, frameHeight]);

  if (!open) return null;

  return (
    <div
      // The overlay is the scrim, the scroll container, and the click-outside
      // target, all in one element rather than three layered ones — which is
      // what makes "click outside the panel to close" actually work: a
      // separate scrim sitting *under* a full-screen positioning wrapper
      // never receives the click, because the wrapper — even where it's
      // visually empty — is what's on top and catches it first.
      //
      // h-[100dvh] rather than inset-0's default (the *large* viewport,
      // which includes the space behind a collapsed mobile URL bar): plain
      // CSS, resolved by the browser's own layout, so it can't collapse the
      // way a JS-computed value can in an environment where visualViewport
      // behaves unexpectedly. overflow-y-auto on this same fixed-size box is
      // the dialog's one and only scroll region.
      className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] justify-center overflow-y-auto overscroll-contain bg-[#100f0c]/55 backdrop-blur-[2px] sm:px-4 sm:py-10"
      onClick={onClose}
    >
      {/* A sheet rising from the bottom edge on a phone, a centred panel
          from sm up — in both cases via auto margins on the panel itself,
          never align-items: center. Centering a flex item with align-items
          clips whichever end overflows first when the item is taller than
          its container; an auto margin simply resolves to zero once there's
          no space left to give it, so the panel always settles flush against
          the top of the scrollable area instead, with nothing hidden. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        // Stops a click anywhere inside the panel from bubbling up to the
        // overlay's own onClose — without this, using the dialog would
        // close it.
        onClick={(event) => event.stopPropagation()}
        // The safe-area padding lives here, on the panel's own content, not
        // on the outer container: the panel's rounded-top sheet is meant to
        // sit flush against the true bottom edge on a phone, and pushing the
        // whole panel up to clear the home indicator would leave a gap of
        // bare scrim showing underneath it. Padding the content instead
        // keeps the background flush and just gives the last field or
        // button room to clear the indicator.
        className="dialog-panel mt-auto w-full overflow-hidden rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] pb-[env(safe-area-inset-bottom,0px)] shadow-[var(--shadow-lg)] outline-none sm:my-auto sm:max-w-lg sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[16px] font-semibold tracking-tight">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-0.5 text-[13px] text-[var(--text-muted)]">
                {description}
              </p>
            )}
          </div>
          {/* Scrolling past the panel's edges no longer exposes a scrim to
              tap, so the way out has to live inside the dialog. */}
          <IconButton label="Close" onClick={onClose} className="-mr-1.5 shrink-0">
            <XIcon className="h-4 w-4" />
          </IconButton>
        </div>

        {children}
      </div>
    </div>
  );
}

/* Destructive actions always confirm, and the confirmation names what will
   happen rather than asking "are you sure?". */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  loading,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: string;
  confirmLabel: string;
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4 p-5">
        <p className="text-[14px] leading-relaxed text-[var(--text-muted)]">{body}</p>
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="h-11 sm:h-9"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            className="h-11 sm:h-9"
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function IconButton({
  label,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        // 40px on a phone, where the finger is the pointer; 32px from the
        // small breakpoint up, where a cursor makes that unnecessarily heavy.
        "grid h-10 w-10 cursor-pointer place-items-center rounded-lg text-[var(--text-faint)] sm:h-8 sm:w-8",
        "transition-colors duration-150 hover:bg-[var(--surface-subtle)] hover:text-[var(--text)]",
        "disabled:pointer-events-none disabled:opacity-40",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
