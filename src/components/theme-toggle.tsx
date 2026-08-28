"use client";

import { useSyncExternalStore } from "react";
import { cx } from "./ui";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";

export type Theme = "system" | "light" | "dark";
const STORAGE_KEY = "squared-theme";

/* localStorage is external state, so it is read through useSyncExternalStore
   rather than copied into React state inside an effect. That keeps the
   server snapshot ("system") separate from the client's, so hydration
   matches and there is no cascading render on mount. */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Also reacts to another tab changing the preference.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Private browsing and blocked site data both throw; "system" is the
    // right answer in that case, so there is nothing to recover.
  }
  return "system";
}

function getServerSnapshot(): Theme {
  return "system";
}

function setTheme(next: Theme) {
  const root = document.documentElement;
  // "system" removes the attribute entirely, so color-scheme falls back to
  // the bare :root rule and follows the operating system again.
  if (next === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", next);

  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // A preference that will not persist still beats a dead click.
  }
  listeners.forEach((notify) => notify());
}

const OPTIONS: { value: Theme; label: string; Icon: typeof SunIcon }[] = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
];

/* Three states rather than two: a binary switch silently overrides the
   operating system forever, with no way back to following it. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="flex items-center gap-0.5 rounded-lg p-0.5 ring-1 ring-white/15"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            onClick={() => setTheme(value)}
            className={cx(
              "grid h-7 w-7 cursor-pointer place-items-center rounded-md transition-colors duration-150",
              active
                ? "bg-white/15 text-[var(--on-masthead)]"
                : "text-[var(--on-masthead-muted)] hover:bg-white/10 hover:text-[var(--on-masthead)]"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
