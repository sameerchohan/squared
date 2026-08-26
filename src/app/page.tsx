"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, UnauthorizedError } from "@/lib/client";

type Me = {
  id: string;
  email: string;
  name: string;
  stripeOnboardingStatus: string;
};
type GroupSummary = {
  id: string;
  name: string;
  createdAt: string;
  memberCount: number;
};

export default function HomePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ user: Me }>("/api/auth/me"),
      api<{ groups: GroupSummary[] }>("/api/groups"),
    ])
      .then(([meRes, groupsRes]) => {
        if (cancelled) return;
        setMe(meRes.user);
        setGroups(groupsRes.groups);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setError(e instanceof Error ? e.message : "Something went wrong");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, router]);

  async function createGroup(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api("/api/groups", {
        method: "POST",
        body: { name: newGroupName },
      });
      setNewGroupName("");
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  if (!me || groups === null) {
    return <main className="p-8 opacity-60">Loading…</main>;
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Squared</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="opacity-70">{me.name}</span>
          <button onClick={logout} className="underline opacity-70">
            Sign out
          </button>
        </div>
      </header>

      <PaymentSetupCard status={me.stripeOnboardingStatus} />

      <section className="mt-8">
        <h2 className="text-lg font-medium">Your groups</h2>
        {groups.length === 0 ? (
          <p className="mt-3 text-sm opacity-60">
            No groups yet — create one below.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-black/10 rounded-xl border border-black/10 dark:divide-white/15 dark:border-white/15">
            {groups.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/groups/${g.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="font-medium">{g.name}</span>
                  <span className="text-sm opacity-60">
                    {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <form onSubmit={createGroup} className="flex gap-2">
          <input
            required
            maxLength={100}
            placeholder="New group name"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            className="flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          />
          <button
            type="submit"
            className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            Create group
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </section>
    </main>
  );
}

const STATUS_COPY: Record<
  string,
  { label: string; detail: string; action: string | null }
> = {
  not_started: {
    label: "Payments not set up",
    detail:
      "Set up payments to receive money when someone settles up with you. You can still add expenses and pay others without it.",
    action: "Set up payments",
  },
  pending: {
    label: "Payment setup in progress",
    detail:
      "Stripe still needs some details before you can receive money. Picking up where you left off takes a minute.",
    action: "Finish setup",
  },
  restricted: {
    label: "Payments restricted",
    detail:
      "Stripe needs more information before you can receive money. Until that's resolved, others can't settle up with you.",
    action: "Review with Stripe",
  },
  active: {
    label: "Payments active",
    detail: "You're all set to receive money when someone settles up with you.",
    action: null,
  },
};

function PaymentSetupCard({ status }: { status: string }) {
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const copy = STATUS_COPY[status] ?? STATUS_COPY.not_started;

  async function startOnboarding() {
    setError(null);
    setStarting(true);
    try {
      const { url } = await api<{ url: string }>("/api/stripe/onboard", {
        method: "POST",
      });
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStarting(false);
    }
  }

  return (
    <section
      className={`mt-6 rounded-xl border p-4 ${
        status === "active"
          ? "border-green-600/30 bg-green-600/5"
          : "border-amber-500/40 bg-amber-500/5"
      }`}
    >
      <h2 className="text-sm font-medium">{copy.label}</h2>
      <p className="mt-1 text-sm opacity-70">{copy.detail}</p>
      {copy.action && (
        <button
          onClick={startOnboarding}
          disabled={starting}
          className="mt-3 rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
        >
          {starting ? "Opening Stripe…" : copy.action}
        </button>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
