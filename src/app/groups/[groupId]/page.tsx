"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  cx,
} from "@/components/ui";
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  PlusIcon,
  ReceiptIcon,
  ScalesIcon,
  UsersIcon,
} from "@/components/icons";
import { api, UnauthorizedError } from "@/lib/client";
import { formatCents, parseDollarsToCents } from "@/lib/format";

type Me = { id: string; name: string; email: string };
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
type Transfer = { fromUser: string; toUser: string; amountCents: number };
type Balances = {
  balances: { userId: string; name: string; netCents: number }[];
  suggestedTransfers: Transfer[];
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

  const [me, setMe] = useState<Me | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Every mutation calls this. One fetch of all four resources keeps the
  // balances, the expense list, and the settle-up plan from ever disagreeing
  // with each other on screen.
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ user: Me }>("/api/auth/me"),
      api<{ group: Group; members: Member[] }>(`/api/groups/${groupId}`),
      api<{ expenses: Expense[] }>(`/api/groups/${groupId}/expenses`),
      api<Balances>(`/api/groups/${groupId}/balances`),
      api<{ settlements: Settlement[] }>(`/api/groups/${groupId}/settlements`),
    ])
      .then(([meRes, detail, expensesRes, balancesRes, settlementsRes]) => {
        if (cancelled) return;
        setMe(meRes.user);
        setGroup(detail.group);
        setMembers(detail.members);
        setExpenses(expensesRes.expenses);
        setBalances(balancesRes);
        setSettlements(settlementsRes.settlements);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof UnauthorizedError) {
          router.push("/login");
          return;
        }
        setError(e instanceof Error ? e.message : "Couldn't load this group.");
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, reloadKey, router]);

  const nameOf = useCallback(
    (userId: string) => members.find((m) => m.id === userId)?.name ?? "Unknown",
    [members]
  );

  if (error && !group) {
    return (
      <div className="mx-auto w-full max-w-5xl px-5 py-16">
        <Card className="p-8">
          <EmptyState
            icon={<AlertIcon className="h-5 w-5" />}
            title="This group isn't available"
            description={error}
            action={
              <Link href="/">
                <Button variant="secondary" size="sm">
                  Back to your groups
                </Button>
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  if (!me || !group || !balances) {
    return (
      <div className="mx-auto w-full max-w-5xl px-5 py-8">
        <Skeleton className="h-8 w-56" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }

  const myBalance =
    balances.balances.find((b) => b.userId === me.id)?.netCents ?? 0;

  return (
    <AppShell user={me}>
      <div className="animate-in">
        <nav aria-label="Breadcrumb" className="mb-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          >
            <ArrowRightIcon className="h-3.5 w-3.5 rotate-180" />
            All groups
          </Link>
        </nav>

        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight">{group.name}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-[14px] text-[var(--text-muted)]">
              <UsersIcon className="h-4 w-4" />
              {members.length} member{members.length === 1 ? "" : "s"}
              <span aria-hidden="true">·</span>
              {expenses.length} expense{expenses.length === 1 ? "" : "s"}
            </p>
          </div>
          <YourPosition cents={myBalance} />
        </header>

        {error && (
          <div className="mt-5">
            <Alert>{error}</Alert>
          </div>
        )}

        <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-6">
            <SettleUpCard
              groupId={groupId}
              balances={balances}
              members={members}
              meId={me.id}
              nameOf={nameOf}
              onChanged={reload}
            />
            <AddExpenseCard
              groupId={groupId}
              members={members}
              meId={me.id}
              onChanged={reload}
            />
            <ExpenseList expenses={expenses} nameOf={nameOf} meId={me.id} />
            <SettlementHistory settlements={settlements} nameOf={nameOf} meId={me.id} />
          </div>

          <div className="flex flex-col gap-6">
            <BalancesCard balances={balances} meId={me.id} />
            <MembersCard
              groupId={groupId}
              members={members}
              meId={me.id}
              onChanged={reload}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/* The single number the user came to see, stated in words as well as color. */
function YourPosition({ cents }: { cents: number }) {
  const settled = cents === 0;
  return (
    <div
      className={cx(
        "rounded-xl border px-4 py-3 text-right",
        settled && "border-[var(--border)] bg-[var(--surface)]",
        cents > 0 && "border-[var(--positive)]/25 bg-[var(--positive-subtle)]",
        cents < 0 && "border-[var(--negative)]/25 bg-[var(--negative-subtle)]"
      )}
    >
      <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {settled ? "You're settled up" : cents > 0 ? "You are owed" : "You owe"}
      </p>
      <p
        className={cx(
          "tnum mt-0.5 text-[24px] font-semibold leading-none",
          settled && "text-[var(--text-muted)]",
          cents > 0 && "text-[var(--positive)]",
          cents < 0 && "text-[var(--negative)]"
        )}
      >
        {formatCents(Math.abs(cents))}
      </p>
    </div>
  );
}

function BalancesCard({
  balances,
  meId,
}: {
  balances: Balances;
  meId: string;
}) {
  const settled = balances.balances.every((b) => b.netCents === 0);

  return (
    <Card>
      <CardHeader title="Balances" description="Net position per member." />
      {settled ? (
        <EmptyState
          icon={<ScalesIcon className="h-5 w-5" />}
          title="Everyone's square"
          description="No one owes anyone anything in this group right now."
        />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {balances.balances.map((b) => (
            <li key={b.userId} className="flex items-center gap-3 px-5 py-3">
              <Avatar name={b.name} />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
                {b.name}
                {b.userId === meId && (
                  <span className="ml-1.5 text-[12px] font-normal text-[var(--text-faint)]">
                    you
                  </span>
                )}
              </span>
              <span className="text-right">
                <span
                  className={cx(
                    "tnum block text-[14px] font-semibold",
                    b.netCents > 0 && "text-[var(--positive)]",
                    b.netCents < 0 && "text-[var(--negative)]",
                    b.netCents === 0 && "text-[var(--text-faint)]"
                  )}
                >
                  {formatCents(Math.abs(b.netCents))}
                </span>
                <span className="block text-[12px] text-[var(--text-muted)]">
                  {b.netCents > 0 ? "is owed" : b.netCents < 0 ? "owes" : "settled"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SettleUpCard({
  groupId,
  balances,
  members,
  meId,
  nameOf,
  onChanged,
}: {
  groupId: string;
  balances: Balances;
  members: Member[];
  meId: string;
  nameOf: (id: string) => string;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [payingTo, setPayingTo] = useState<string | null>(null);

  const mine = balances.suggestedTransfers.filter((t) => t.fromUser === meId);
  const others = balances.suggestedTransfers.filter((t) => t.fromUser !== meId);

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
      setError(e instanceof Error ? e.message : "Couldn't start the payment.");
      setPayingTo(null);
      onChanged();
    }
  }

  if (balances.suggestedTransfers.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Settle up"
        description={`${balances.suggestedTransfers.length} transfer${
          balances.suggestedTransfers.length === 1 ? "" : "s"
        } clears the whole group.`}
      />
      <div className="p-5">
        {error && (
          <div className="mb-4">
            <Alert>{error}</Alert>
          </div>
        )}

        <ul className="flex flex-col gap-2.5">
          {mine.map((t, i) => {
            const recipient = members.find((m) => m.id === t.toUser);
            const canReceive = recipient?.stripeOnboardingStatus === "active";
            return (
              <li
                key={`mine-${i}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--brand)]/20 bg-[var(--brand-subtle)] px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium">
                    Pay {nameOf(t.toUser)}{" "}
                    <span className="tnum font-semibold">
                      {formatCents(t.amountCents)}
                    </span>
                  </p>
                  {!canReceive && (
                    <p className="mt-0.5 text-[12px] text-[var(--warning)]">
                      {nameOf(t.toUser)} hasn&apos;t finished setting up payments yet.
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  disabled={!canReceive || payingTo !== null}
                  loading={payingTo === t.toUser}
                  onClick={() => settleUp(t.toUser, t.amountCents)}
                >
                  Pay now
                </Button>
              </li>
            );
          })}

          {others.map((t, i) => (
            <li
              key={`other-${i}`}
              className="flex items-center gap-2 px-1 text-[13px] text-[var(--text-muted)]"
            >
              <Avatar name={nameOf(t.fromUser)} className="h-6 w-6 text-[10px]" />
              <span>
                {nameOf(t.fromUser)} pays {nameOf(t.toUser)}{" "}
                <span className="tnum font-medium text-[var(--text)]">
                  {formatCents(t.amountCents)}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-4 border-t border-[var(--border)] pt-3 text-[12px] leading-relaxed text-[var(--text-faint)]">
          Payments go through Stripe directly to the recipient&apos;s connected
          account. Balances update automatically once a payment completes.
        </p>
      </div>
    </Card>
  );
}

const SPLIT_LABEL: Record<string, string> = {
  equal: "Split equally",
  exact: "Exact amounts",
  percentage: "By percentage",
};

function ExpenseList({
  expenses,
  nameOf,
  meId,
}: {
  expenses: Expense[];
  nameOf: (id: string) => string;
  meId: string;
}) {
  return (
    <Card>
      <CardHeader title="Expenses" description="Most recent first." />
      {expenses.length === 0 ? (
        <EmptyState
          icon={<ReceiptIcon className="h-5 w-5" />}
          title="No expenses yet"
          description="Add the first shared cost above and everyone's balance updates immediately."
        />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {expenses.map((expense) => (
            <li key={expense.id} className="px-5 py-4">
              <div className="flex items-baseline justify-between gap-4">
                <p className="min-w-0 truncate text-[15px] font-medium">
                  {expense.description}
                </p>
                <p className="tnum shrink-0 text-[15px] font-semibold">
                  {formatCents(expense.amountCents)}
                </p>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[var(--text-muted)]">
                <span>
                  {expense.paidBy === meId ? "You" : nameOf(expense.paidBy)} paid
                </span>
                <span aria-hidden="true">·</span>
                <Badge>{SPLIT_LABEL[expense.splitType] ?? expense.splitType}</Badge>
                <span aria-hidden="true">·</span>
                <time dateTime={expense.createdAt}>
                  {new Date(expense.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--text-muted)]">
                {expense.shares.map((s) => (
                  <li key={s.userId} className="tnum">
                    {s.userId === meId ? "You" : nameOf(s.userId)}{" "}
                    <span className="font-medium text-[var(--text)]">
                      {formatCents(s.owedCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const SETTLEMENT_STATUS: Record<
  string,
  { label: string; tone: "neutral" | "positive" | "negative" | "warning" }
> = {
  pending: { label: "Awaiting payment", tone: "warning" },
  processing: { label: "Processing", tone: "warning" },
  succeeded: { label: "Paid", tone: "positive" },
  failed: { label: "Failed", tone: "negative" },
};

function SettlementHistory({
  settlements,
  nameOf,
  meId,
}: {
  settlements: Settlement[];
  nameOf: (id: string) => string;
  meId: string;
}) {
  if (settlements.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Payments" description="Settlements in this group." />
      <ul className="divide-y divide-[var(--border)]">
        {settlements.map((s) => {
          const status = SETTLEMENT_STATUS[s.status] ?? {
            label: s.status,
            tone: "neutral" as const,
          };
          return (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px]">
                  {s.fromUser === meId ? "You" : nameOf(s.fromUser)}
                  <ArrowRightIcon className="mx-1.5 inline h-3.5 w-3.5 text-[var(--text-faint)]" />
                  {s.toUser === meId ? "you" : nameOf(s.toUser)}
                </p>
                <time
                  dateTime={s.createdAt}
                  className="text-[12px] text-[var(--text-muted)]"
                >
                  {new Date(s.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </time>
              </div>
              <span className="tnum text-[14px] font-semibold">
                {formatCents(s.amountCents)}
              </span>
              <Badge tone={status.tone}>
                {s.status === "succeeded" && <CheckIcon className="h-3 w-3" />}
                {status.label}
              </Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function MembersCard({
  groupId,
  members,
  meId,
  onChanged,
}: {
  groupId: string;
  members: Member[];
  meId: string;
  onChanged: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const value = email.trim();
    if (!value) {
      setFieldError("Enter an email address.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      setFieldError("That doesn't look like a valid email address.");
      return;
    }
    setFieldError(undefined);
    setSubmitting(true);
    try {
      await api(`/api/groups/${groupId}/members`, {
        method: "POST",
        body: { email: value },
      });
      setEmail("");
      onChanged();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't add that member.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="h-fit">
      <CardHeader title="Members" description="Everyone splitting costs here." />
      <ul className="divide-y divide-[var(--border)]">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-5 py-3">
            <Avatar name={m.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">
                {m.name}
                {m.id === meId && (
                  <span className="ml-1.5 text-[12px] font-normal text-[var(--text-faint)]">
                    you
                  </span>
                )}
              </p>
              <p className="truncate text-[12px] text-[var(--text-muted)]">{m.email}</p>
            </div>
            {m.stripeOnboardingStatus === "active" ? (
              <Badge tone="positive">
                <CheckIcon className="h-3 w-3" />
                Can receive
              </Badge>
            ) : (
              <Badge tone="neutral">No payouts</Badge>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={addMember} noValidate className="flex flex-col gap-3 border-t border-[var(--border)] p-5">
        {formError && <Alert>{formError}</Alert>}
        <Field label="Add a member" error={fieldError} hint="They need a Squared account.">
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="email"
              inputMode="email"
              placeholder="friend@example.com"
              value={email}
              invalid={invalid}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldError) setFieldError(undefined);
              }}
            />
          )}
        </Field>
        <Button type="submit" variant="secondary" loading={submitting} className="w-full">
          <PlusIcon className="h-4 w-4" />
          Add member
        </Button>
      </form>
    </Card>
  );
}

type ExpenseErrors = {
  description?: string;
  amount?: string;
  split?: string;
  perUser?: Record<string, string>;
};

function AddExpenseCard({
  groupId,
  members,
  meId,
  onChanged,
}: {
  groupId: string;
  members: Member[];
  meId: string;
  onChanged: () => void;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState(meId);
  const [splitType, setSplitType] = useState<SplitType>("equal");
  // null means "everyone", so a member added later is included automatically
  // without syncing state back to props.
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [perUser, setPerUser] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<ExpenseErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);

  const participants = useMemo(
    () => selected ?? new Set(members.map((m) => m.id)),
    [selected, members]
  );

  const amountCents = parseDollarsToCents(amount);

  // A running total so a mismatched exact/percentage split is visible before
  // submitting rather than coming back as a server error.
  const allocated = useMemo(() => {
    if (splitType === "equal") return null;
    let total = 0;
    for (const m of members) {
      const raw = perUser[m.id]?.trim();
      if (!raw) continue;
      const value = splitType === "exact" ? parseDollarsToCents(raw) : Number(raw);
      if (value === null || Number.isNaN(value)) return null;
      total += value;
    }
    return total;
  }, [splitType, perUser, members]);

  function toggleParticipant(id: string) {
    const next = new Set(participants);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function validate(): ExpenseErrors {
    const next: ExpenseErrors = {};
    if (!description.trim()) next.description = "What was this for?";
    if (!amount.trim()) next.amount = "Enter an amount.";
    else if (amountCents === null)
      next.amount = "Use a number like 24.50 — no symbols.";
    else if (amountCents === 0) next.amount = "Amount must be more than zero.";

    if (splitType === "equal") {
      if (participants.size === 0) next.split = "Pick at least one person.";
    } else if (allocated === null) {
      next.split = "Every value must be a number.";
    } else if (splitType === "exact" && amountCents !== null && allocated !== amountCents) {
      const diff = amountCents - allocated;
      next.split =
        diff > 0
          ? `${formatCents(diff)} still unallocated.`
          : `${formatCents(-diff)} over the total.`;
    } else if (splitType === "percentage" && Math.abs(allocated - 100) > 0.001) {
      next.split = `Percentages add up to ${allocated}%, not 100%.`;
    }
    return next;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const split =
      splitType === "equal"
        ? { type: "equal" as const, participants: [...participants] }
        : splitType === "exact"
          ? {
              type: "exact" as const,
              shares: members
                .filter((m) => perUser[m.id]?.trim())
                .map((m) => ({
                  userId: m.id,
                  amountCents: parseDollarsToCents(perUser[m.id].trim())!,
                })),
            }
          : {
              type: "percentage" as const,
              shares: members
                .filter((m) => perUser[m.id]?.trim())
                .map((m) => ({ userId: m.id, percent: Number(perUser[m.id].trim()) })),
            };

    setSubmitting(true);
    try {
      await api(`/api/groups/${groupId}/expenses`, {
        method: "POST",
        body: {
          description: description.trim(),
          amountCents: amountCents!,
          paidBy,
          split,
        },
      });
      const label = description.trim();
      setDescription("");
      setAmount("");
      setPerUser({});
      setErrors({});
      // Refetch balances, expenses, and the settle-up plan together.
      onChanged();
      setSavedLabel(label);
      setTimeout(() => setSavedLabel(null), 3000);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't add the expense.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Add an expense" description="Balances update the moment you save." />
      {/* noValidate is deliberate: the browser's native bubbles block submit
          silently and can't be styled, which reads to the user as a dead
          button. All validation is ours, and every message is visible. */}
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 p-5">
        {formError && <Alert>{formError}</Alert>}
        {savedLabel && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--positive)]/25 bg-[var(--positive-subtle)] px-3 py-2 text-[13px] text-[var(--positive)]">
            <CheckIcon className="h-4 w-4 shrink-0" />
            Added &ldquo;{savedLabel}&rdquo; and updated balances.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
          <Field label="Description" error={errors.description} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                placeholder="Groceries"
                maxLength={200}
                value={description}
                invalid={invalid}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (errors.description)
                    setErrors((p) => ({ ...p, description: undefined }));
                }}
              />
            )}
          </Field>

          <Field label="Amount" error={errors.amount} required>
            {({ id, describedBy, invalid }) => (
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-[var(--text-faint)]">
                  $
                </span>
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="tnum pl-7"
                  value={amount}
                  invalid={invalid}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    if (errors.amount) setErrors((p) => ({ ...p, amount: undefined }));
                  }}
                />
              </div>
            )}
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Paid by">
            {({ id }) => (
              <Select id={id} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id === meId ? "You" : m.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="How to split">
            {({ id }) => (
              <Select
                id={id}
                value={splitType}
                onChange={(e) => {
                  setSplitType(e.target.value as SplitType);
                  setErrors((p) => ({ ...p, split: undefined }));
                }}
              >
                <option value="equal">Equally</option>
                <option value="exact">Exact amounts</option>
                <option value="percentage">Percentages</option>
              </Select>
            )}
          </Field>
        </div>

        <fieldset className="rounded-lg border border-[var(--border)] p-4">
          <legend className="px-1.5 text-[13px] font-medium">
            {splitType === "equal" ? "Split between" : "Amount per person"}
          </legend>

          {splitType === "equal" ? (
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const on = participants.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleParticipant(m.id)}
                    className={cx(
                      "inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-[13px] font-medium transition-colors duration-150",
                      on
                        ? "border-[var(--brand)] bg-[var(--brand-subtle)] text-[var(--brand)]"
                        : "border-[var(--border-strong)] text-[var(--text-muted)] hover:bg-[var(--surface-subtle)]"
                    )}
                  >
                    <span
                      className={cx(
                        "grid h-4 w-4 place-items-center rounded-full border",
                        on
                          ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)]"
                          : "border-[var(--border-strong)]"
                      )}
                    >
                      {on && <CheckIcon className="h-2.5 w-2.5" />}
                    </span>
                    {m.id === meId ? "You" : m.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-3">
                  <Avatar name={m.name} className="h-7 w-7 text-[11px]" />
                  <span className="flex-1 truncate text-[14px]">
                    {m.id === meId ? "You" : m.name}
                  </span>
                  <div className="relative w-28">
                    {splitType === "exact" && (
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--text-faint)]">
                        $
                      </span>
                    )}
                    <Input
                      inputMode="decimal"
                      aria-label={`${splitType === "exact" ? "Amount" : "Percentage"} for ${m.name}`}
                      placeholder={splitType === "exact" ? "0.00" : "0"}
                      className={cx("tnum h-9 text-[14px]", splitType === "exact" && "pl-6")}
                      value={perUser[m.id] ?? ""}
                      onChange={(e) => {
                        setPerUser((prev) => ({ ...prev, [m.id]: e.target.value }));
                        if (errors.split) setErrors((p) => ({ ...p, split: undefined }));
                      }}
                    />
                    {splitType === "percentage" && (
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--text-faint)]">
                        %
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {/* Live running total: the mismatch is visible before submit. */}
              {allocated !== null && (
                <p className="tnum mt-1 flex justify-between border-t border-[var(--border)] pt-2.5 text-[13px]">
                  <span className="text-[var(--text-muted)]">Allocated</span>
                  <span
                    className={cx(
                      "font-medium",
                      splitType === "exact"
                        ? amountCents !== null && allocated === amountCents
                          ? "text-[var(--positive)]"
                          : "text-[var(--text)]"
                        : Math.abs(allocated - 100) < 0.001
                          ? "text-[var(--positive)]"
                          : "text-[var(--text)]"
                    )}
                  >
                    {splitType === "exact"
                      ? `${formatCents(allocated)}${amountCents !== null ? ` of ${formatCents(amountCents)}` : ""}`
                      : `${allocated}% of 100%`}
                  </span>
                </p>
              )}
            </div>
          )}

          {errors.split && (
            <p role="alert" className="mt-3 flex items-center gap-1.5 text-[13px] text-[var(--negative)]">
              <AlertIcon className="h-3.5 w-3.5 shrink-0" />
              {errors.split}
            </p>
          )}
        </fieldset>

        <Button type="submit" loading={submitting} className="self-start">
          <PlusIcon className="h-4 w-4" />
          Add expense
        </Button>
      </form>
    </Card>
  );
}
