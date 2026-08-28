"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cx } from "./ui";
import { LogOutIcon, SpinnerIcon, SquaredMark } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { api } from "@/lib/client";

/* The masthead spans the full viewport — the wordmark sits at the left edge
   and the account controls at the right — while everything below it stays in
   a measured column. A page whose chrome stops short of the window edge is
   the clearest sign of a container that was never designed, only defaulted. */
export function AppShell({
  user,
  hero,
  children,
}: {
  user: { name: string; email: string };
  hero: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch {
      setSigningOut(false);
    }
  }

  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--bg)]">
      <div className="relative bg-[var(--masthead)] text-[var(--on-masthead)]">
        <div className="masthead-texture pointer-events-none absolute inset-0" aria-hidden="true" />

        <header className="relative">
          <div className="flex h-16 w-full items-center justify-between gap-4 px-5 sm:px-8">
            <Link
              href="/"
              className="flex items-center gap-2.5 rounded-md transition-opacity duration-150 hover:opacity-85"
            >
              <SquaredMark className="h-8 w-8" />
              <span className="text-[16px] font-semibold tracking-tight">Squared</span>
            </Link>

            <div className="flex items-center gap-2 sm:gap-3">
              <ThemeToggle />
              <div className="hidden items-center gap-2.5 sm:flex">
                <span
                  aria-hidden="true"
                  className="grid h-8 w-8 place-items-center rounded-full bg-white/12 text-[12px] font-semibold ring-1 ring-white/20"
                >
                  {initials}
                </span>
                <span className="leading-tight">
                  <span className="block text-[13px] font-medium">{user.name}</span>
                  <span className="block text-[12px] text-[var(--on-masthead-muted)]">
                    {user.email}
                  </span>
                </span>
              </div>

              <button
                onClick={signOut}
                disabled={signingOut}
                aria-label="Sign out"
                className={cx(
                  "inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-[13px] font-medium",
                  "text-[var(--on-masthead-muted)] ring-1 ring-white/15 transition-colors duration-150",
                  "hover:bg-white/10 hover:text-[var(--on-masthead)] disabled:opacity-50"
                )}
              >
                {signingOut ? (
                  <SpinnerIcon className="h-4 w-4" />
                ) : (
                  <LogOutIcon className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          </div>
          <div className="h-px w-full bg-white/10" />
        </header>

        {/* The hero lives inside the dark band, so the page's most important
            number arrives before any card does. */}
        <div className="relative mx-auto w-full max-w-6xl px-5 pb-9 pt-7 sm:px-8">{hero}</div>
      </div>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">{children}</main>

      <footer className="border-t border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-5 sm:px-8">
          <p className="text-[12px] text-[var(--text-faint)]">
            Settlements are processed by Stripe. Squared never stores card or bank details.
          </p>
          <p className="text-[12px] text-[var(--text-faint)]">All amounts in USD</p>
        </div>
      </footer>
    </div>
  );
}

/* A figure with its label above it, used across both pages so the same number
   is always presented the same way. */
export function Stat({
  label,
  value,
  tone = "default",
  size = "md",
}: {
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative" | "muted";
  size?: "md" | "lg";
}) {
  return (
    <div>
      <p className="eyebrow text-[var(--on-masthead-muted)]">{label}</p>
      <p
        className={cx(
          "figure mt-1.5",
          size === "lg" ? "text-[40px] leading-none" : "text-[26px] leading-none",
          tone === "positive" && "text-[#7fe3b8]",
          tone === "negative" && "text-[#ffab94]",
          tone === "muted" && "text-[var(--on-masthead-muted)]",
          tone === "default" && "text-[var(--on-masthead)]"
        )}
      >
        {value}
      </p>
    </div>
  );
}
