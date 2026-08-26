"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, UnauthorizedError } from "@/lib/client";
import { formatCents, parseDollarsToCents } from "@/lib/format";

type Member = {
  id: string;
  name: string;
  email: string;
  stripeOnboardingStatus: string;
};
type Group = { id: string; name: string };
type Expense = {
  id: string;
  paidBy: string;
  description: string;
  amountCents: number;
  splitType: string;
  createdAt: string;
  shares: { userId: string; owedCents: number }[];
};
type Balances = {
  balances: { userId: string; name: string; netCents: number }[];
  suggestedTransfers: { fromUser: string; toUser: string; amountCents: number }[];
};
type Settlement = {
  id: string;
  fromUser: string;
  toUser: string;
  amountCents: number;
  status: string;
  createdAt: string;
};
type SplitType = "equal" | "exact" | "percentage";

export default function GroupPage() {
  const router = useRouter();
  const { groupId } = useParams<{ groupId: string }>();

  const [meId, setMeId] = useState<string | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ user: { id: string } }>("/api/auth/me"),
      api<{ group: Group; members: Member[] }>(`/api/groups/${groupId}`),
      api<{ expenses: Expense[] }>(`/api/groups/${groupId}/expenses`),
      api<Balances>(`/api/groups/${groupId}/balances`),
      api<{ settlements: Settlement[] }>(`/api/groups/${groupId}/settlements`),
    ])
      .then(([meRes, detail, expensesRes, balancesRes, settlementsRes]) => {
        if (cancelled) return;
        setMeId(meRes.user.id);
        setGroup(detail.group);
        setMembers(detail.members);
        setExpenses(expensesRes.expenses);
        setBalances(balancesRes);
        setSettlements(settlementsRes.settlements);
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
  }, [groupId, reloadKey, router]);

  if (error) {
    return (
      <main className="mx-auto w-full max-w-3xl p-6">
        <p className="text-sm text-red-600">{error}</p>
        <Link href="/" className="mt-2 inline-block text-sm underline">
          Back to groups
        </Link>
      </main>
    );
  }
  if (!group || !balances || !meId) {
    return <main className="p-8 opacity-60">Loading…</main>;
  }

  const nameOf = (userId: string) =>
    members.find((m) => m.id === userId)?.name ?? "Unknown";

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{group.name}</h1>
        <Link href="/" className="text-sm underline opacity-70">
          All groups
        </Link>
      </header>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <BalancesCard
          groupId={groupId}
          balances={balances}
          members={members}
          meId={meId}
          nameOf={nameOf}
        />
        <MembersCard groupId={groupId} members={members} onChanged={reload} />
      </div>

      <AddExpenseCard groupId={groupId} members={members} onChanged={reload} />

      <section className="mt-6">
        <h2 className="text-lg font-medium">Expenses</h2>
        {expenses.length === 0 ? (
          <p className="mt-2 text-sm opacity-60">No expenses yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-black/10 rounded-xl border border-black/10 dark:divide-white/15 dark:border-white/15">
            {expenses.map((expense) => (
              <li key={expense.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{expense.description}</span>
                  <span>{formatCents(expense.amountCents)}</span>
                </div>
                <div className="mt-1 text-sm opacity-60">
                  Paid by {nameOf(expense.paidBy)} · {expense.splitType} split ·{" "}
                  {expense.shares
                    .map((s) => `${nameOf(s.userId)} ${formatCents(s.owedCents)}`)
                    .join(", ")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SettlementHistory settlements={settlements} nameOf={nameOf} />
    </main>
  );
}

function BalancesCard({
  groupId,
  balances,
  members,
  meId,
  nameOf,
}: {
  groupId: string;
  balances: Balances;
  members: Member[];
  meId: string;
  nameOf: (id: string) => string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [payingTo, setPayingTo] = useState<string | null>(null);

  async function settleUp(toUser: string, amountCents: number) {
    setError(null);
    setPayingTo(toUser);
    try {
      const { checkoutUrl } = await api<{ checkoutUrl: string }>(
        `/api/groups/${groupId}/settlements`,
        { method: "POST", body: { toUser, amountCents } }
      );
      window.location.assign(checkoutUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPayingTo(null);
    }
  }

  return (
    <section className="rounded-xl border border-black/10 p-4 dark:border-white/15">
      <h2 className="text-lg font-medium">Balances</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {balances.balances.map((b) => (
          <li key={b.userId} className="flex justify-between">
            <span>{b.name}</span>
            <span
              className={
                b.netCents > 0
                  ? "text-green-600"
                  : b.netCents < 0
                    ? "text-red-600"
                    : "opacity-60"
              }
            >
              {b.netCents > 0 ? "is owed " : b.netCents < 0 ? "owes " : ""}
              {formatCents(Math.abs(b.netCents))}
            </span>
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-sm font-medium">Suggested settle-up</h3>
      {balances.suggestedTransfers.length === 0 ? (
        <p className="mt-1 text-sm opacity-60">All settled up 🎉</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {balances.suggestedTransfers.map((t, i) => {
            const isMine = t.fromUser === meId;
            const recipient = members.find((m) => m.id === t.toUser);
            const canReceive = recipient?.stripeOnboardingStatus === "active";

            return (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="opacity-80">
                  {isMine ? "You pay" : `${nameOf(t.fromUser)} pays`}{" "}
                  {isMine ? nameOf(t.toUser) : nameOf(t.toUser)}{" "}
                  <span className="font-medium">
                    {formatCents(t.amountCents)}
                  </span>
                </span>
                {isMine &&
                  (canReceive ? (
                    <button
                      onClick={() => settleUp(t.toUser, t.amountCents)}
                      disabled={payingTo !== null}
                      className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background disabled:opacity-50"
                    >
                      {payingTo === t.toUser ? "Opening…" : "Pay now"}
                    </button>
                  ) : (
                    <span className="rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-500">
                      {nameOf(t.toUser)} hasn&apos;t set up payments yet
                    </span>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <p className="mt-3 text-xs opacity-50">
        Payments are real Stripe transfers to the recipient&apos;s connected
        account.
      </p>
    </section>
  );
}

const SETTLEMENT_STATUS_COPY: Record<string, string> = {
  pending: "awaiting payment",
  processing: "processing",
  succeeded: "paid",
  failed: "failed",
};

function SettlementHistory({
  settlements,
  nameOf,
}: {
  settlements: Settlement[];
  nameOf: (id: string) => string;
}) {
  if (settlements.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="text-lg font-medium">Settlements</h2>
      <ul className="mt-2 divide-y divide-black/10 rounded-xl border border-black/10 text-sm dark:divide-white/15 dark:border-white/15">
        {settlements.map((s) => (
          <li key={s.id} className="flex justify-between px-4 py-2.5">
            <span>
              {nameOf(s.fromUser)} → {nameOf(s.toUser)}
            </span>
            <span className="flex gap-3">
              <span>{formatCents(s.amountCents)}</span>
              <span
                className={
                  s.status === "succeeded"
                    ? "text-green-600"
                    : s.status === "failed"
                      ? "text-red-600"
                      : "opacity-60"
                }
              >
                {SETTLEMENT_STATUS_COPY[s.status] ?? s.status}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MembersCard({
  groupId,
  members,
  onChanged,
}: {
  groupId: string;
  members: Member[];
  onChanged: () => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api(`/api/groups/${groupId}/members`, {
        method: "POST",
        body: { email },
      });
      setEmail("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <section className="rounded-xl border border-black/10 p-4 dark:border-white/15">
      <h2 className="text-lg font-medium">Members</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {members.map((m) => (
          <li key={m.id} className="flex justify-between">
            <span>{m.name}</span>
            <span className="opacity-60">{m.email}</span>
          </li>
        ))}
      </ul>
      <form onSubmit={addMember} className="mt-3 flex gap-2">
        <input
          type="email"
          required
          placeholder="Add member by email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20"
        />
        <button
          type="submit"
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background"
        >
          Add
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

function AddExpenseCard({
  groupId,
  members,
  onChanged,
}: {
  groupId: string;
  members: Member[];
  onChanged: () => void;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [splitType, setSplitType] = useState<SplitType>("equal");
  // null means "everyone" so newly added members are included by default
  // without needing to sync state to the members prop.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [perUser, setPerUser] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const participants = selected ?? new Set(members.map((m) => m.id));

  function toggleParticipant(id: string) {
    const next = new Set(participants);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const amountCents = parseDollarsToCents(amount);
    if (amountCents === null || amountCents === 0) {
      setError("Enter a valid amount, e.g. 12.50");
      return;
    }

    let split;
    if (splitType === "equal") {
      split = { type: "equal" as const, participants: [...participants] };
    } else if (splitType === "exact") {
      const shares = [];
      for (const m of members) {
        const raw = perUser[m.id]?.trim();
        if (!raw) continue;
        const cents = parseDollarsToCents(raw);
        if (cents === null) {
          setError(`Invalid amount for ${m.name}`);
          return;
        }
        shares.push({ userId: m.id, amountCents: cents });
      }
      split = { type: "exact" as const, shares };
    } else {
      const shares = [];
      for (const m of members) {
        const raw = perUser[m.id]?.trim();
        if (!raw) continue;
        const percent = Number(raw);
        if (!Number.isFinite(percent) || percent < 0) {
          setError(`Invalid percentage for ${m.name}`);
          return;
        }
        shares.push({ userId: m.id, percent });
      }
      split = { type: "percentage" as const, shares };
    }

    setSubmitting(true);
    try {
      await api(`/api/groups/${groupId}/expenses`, {
        method: "POST",
        body: {
          description,
          amountCents,
          paidBy: paidBy || undefined,
          split,
        },
      });
      setDescription("");
      setAmount("");
      setPerUser({});
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-black/10 p-4 dark:border-white/15">
      <h2 className="text-lg font-medium">Add expense</h2>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <input
            required
            maxLength={200}
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-w-40 flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          />
          <input
            required
            inputMode="decimal"
            placeholder="Amount ($)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-32 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          />
          <select
            value={paidBy}
            onChange={(e) => setPaidBy(e.target.value)}
            className="rounded-md border border-black/15 bg-transparent px-2 py-2 text-sm dark:border-white/20"
          >
            <option value="">Paid by me</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                Paid by {m.name}
              </option>
            ))}
          </select>
          <select
            value={splitType}
            onChange={(e) => setSplitType(e.target.value as SplitType)}
            className="rounded-md border border-black/15 bg-transparent px-2 py-2 text-sm dark:border-white/20"
          >
            <option value="equal">Split equally</option>
            <option value="exact">Exact amounts</option>
            <option value="percentage">Percentages</option>
          </select>
        </div>

        {splitType === "equal" ? (
          <fieldset className="flex flex-wrap gap-3 text-sm">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={participants.has(m.id)}
                  onChange={() => toggleParticipant(m.id)}
                />
                {m.name}
              </label>
            ))}
          </fieldset>
        ) : (
          <fieldset className="flex flex-wrap gap-3 text-sm">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-1.5">
                {m.name}
                <input
                  placeholder={splitType === "exact" ? "$" : "%"}
                  value={perUser[m.id] ?? ""}
                  onChange={(e) =>
                    setPerUser((prev) => ({ ...prev, [m.id]: e.target.value }))
                  }
                  className="w-20 rounded-md border border-black/15 bg-transparent px-2 py-1 dark:border-white/20"
                />
              </label>
            ))}
          </fieldset>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="self-start rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add expense"}
        </button>
      </form>
    </section>
  );
}
