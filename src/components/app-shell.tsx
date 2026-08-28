"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar, Button } from "./ui";
import { LogOutIcon, SquaredMark } from "./icons";
import { api } from "@/lib/client";

/* A persistent header on every signed-in screen: the wordmark always returns
   home, and the account action never moves between pages. */
export function AppShell({
  user,
  children,
}: {
  user: { name: string; email: string };
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

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)]/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-5">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-md font-semibold tracking-tight"
          >
            <SquaredMark className="h-7 w-7" />
            <span className="text-[15px]">Squared</span>
          </Link>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2.5 sm:flex">
              <Avatar name={user.name} />
              <div className="leading-tight">
                <p className="text-[13px] font-medium">{user.name}</p>
                <p className="text-[12px] text-[var(--text-muted)]">{user.email}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              loading={signingOut}
              aria-label="Sign out"
            >
              <LogOutIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">{children}</main>

      <footer className="border-t border-[var(--border)] py-6">
        <p className="mx-auto max-w-5xl px-5 text-[12px] text-[var(--text-faint)]">
          Settlements are processed by Stripe. Squared never stores card or bank details.
        </p>
      </footer>
    </div>
  );
}
