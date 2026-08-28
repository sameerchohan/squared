"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppShell, Stat } from "@/components/app-shell";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Skeleton,
  cx,
} from "@/components/ui";
import { ExpenseForm } from "@/components/expense-form";
import {
  AlertIcon,
  ArrowRightIcon,
  CheckIcon,
  PencilIcon,
  PlusIcon,
  ReceiptIcon,
  ScalesIcon,
  TrashIcon,
  UsersIcon,
  XIcon,
} from "@/components/icons";
import { api, UnauthorizedError } from "@/lib/client";
import { formatCents } from "@/lib/format";

type Me = { id: string; name: string; email: string };
type Member = {
  id: string;
  name: string;
  email: string;
  stripeOnboardingStatus: string;
};
type Group = { id: string; name: string; createdBy: string };
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
      <div>
        <div className="h-16 w-full bg-[var(--masthead)]" />
        <div className="bg-[var(--masthead)] pb-9 pt-7">
          <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
            <Skeleton className="h-4 w-24 bg-white/10" />
            <Skeleton className="mt-3 h-9 w-64 bg-white/10" />
          </div>
        </div>
        <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8">
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }

  const myBalance =
    balances.balances.find((b) => b.userId === me.id)?.netCents ?? 0;

  const totalSpend = expenses.reduce((sum, e) => sum + e.amountCents, 0);

  return (
    <AppShell
      user={me}
      hero={
        <div className="animate-in">
          <Link
            href="/"
            className="eyebrow inline-flex items-center gap-1.5 rounded-md text-[var(--on-masthead-muted)] transition-colors duration-150 hover:text-[var(--on-masthead)]"
          >
            <ArrowRightIcon className="h-3.5 w-3.5 rotate-180" />
            All groups
          </Link>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
            <div className="min-w-0">
              <h1 className="truncate text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">
                {group.name}
              </h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-[var(--on-masthead-muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <UsersIcon className="h-4 w-4" />
                  {members.length} member{members.length === 1 ? "" : "s"}
                </span>
                <span aria-hidden="true">·</span>
                <span>{expenses.length} expense{expenses.length === 1 ? "" : "s"}</span>
                <span aria-hidden="true">·</span>
                <span className="tnum">{formatCents(totalSpend)} tracked</span>
              </p>
            </div>

            {/* The one figure the page exists to answer, sized so it is read
                first and never confused with a button. */}
            <div className="flex flex-wrap gap-x-10 gap-y-5">
              <Stat
                label={
                  myBalance === 0
                    ? "Settled up"
                    : myBalance > 0
                      ? "You are owed"
                      : "You owe"
                }
                value={formatCents(Math.abs(myBalance))}
                size="lg"
                tone={
                  myBalance === 0 ? "muted" : myBalance > 0 ? "positive" : "negative"
                }
              />
              {balances.suggestedTransfers.length > 0 && (
                <Stat
                  label="Transfers to clear"
                  value={String(balances.suggestedTransfers.length)}
                  tone="muted"
                />
              )}
            </div>
          </div>
        </div>
      }
    >
      <div className="animate-in">
        {error && (
          <div className="mb-6">
            <Alert>{error}</Alert>
          </div>
        )}

        <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
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
            <ExpenseList
              groupId={groupId}
              expenses={expenses}
              members={members}
              nameOf={nameOf}
              meId={me.id}
              onChanged={reload}
            />
            <SettlementHistory settlements={settlements} nameOf={nameOf} meId={me.id} />
          </div>

          <div className="flex flex-col gap-6">
            <BalancesCard balances={balances} meId={me.id} />
            <MembersCard
              groupId={groupId}
              members={members}
              meId={me.id}
              createdBy={group.createdBy}
              onChanged={reload}
              onLeft={() => router.push("/")}
            />
          </div>
        </div>
      </div>
    </AppShell>
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
  groupId,
  expenses,
  members,
  nameOf,
  meId,
  onChanged,
}: {
  groupId: string;
  expenses: Expense[];
  members: Member[];
  nameOf: (id: string) => string;
  meId: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/groups/${groupId}/expenses/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete that expense.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
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
            {expenses.map((expense) => {
              const mine = expense.paidBy === meId;
              return (
                <li key={expense.id} className="group/row px-5 py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 flex-1 truncate text-[15px] font-medium">
                      {expense.description}
                    </p>
                    <p className="figure shrink-0 text-[16px]">
                      {formatCents(expense.amountCents)}
                    </p>
                    {/* Actions belong to whoever paid; they stay dim until the
                        row is hovered or a control inside takes focus. */}
                    {mine && (
                      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/row:opacity-100">
                        <IconButton label="Edit expense" onClick={() => setEditing(expense)}>
                          <PencilIcon className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          label="Delete expense"
                          onClick={() => setDeleting(expense)}
                          className="hover:text-[var(--negative)]"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </IconButton>
                      </div>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[var(--text-muted)]">
                    <span>{mine ? "You" : nameOf(expense.paidBy)} paid</span>
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
                    {expense.shares.map((sh) => (
                      <li key={sh.userId} className="tnum">
                        {sh.userId === meId ? "You" : nameOf(sh.userId)}{" "}
                        <span className="font-medium text-[var(--text)]">
                          {formatCents(sh.owedCents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit expense"
        description="Shares are recalculated and balances update on save."
      >
        {editing && (
          <ExpenseForm
            members={members}
            meId={meId}
            submitLabel="Save changes"
            onCancel={() => setEditing(null)}
            initial={{
              description: editing.description,
              amountCents: editing.amountCents,
              paidBy: editing.paidBy,
              splitType: editing.splitType as "equal" | "exact" | "percentage",
              shares: editing.shares,
            }}
            onSubmit={async (payload) => {
              await api(`/api/groups/${groupId}/expenses/${editing.id}`, {
                method: "PATCH",
                body: payload,
              });
              setEditing(null);
              onChanged();
            }}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => {
          setDeleting(null);
          setError(null);
        }}
        onConfirm={confirmDelete}
        title="Delete this expense?"
        body={
          deleting
            ? `"${deleting.description}" for ${formatCents(deleting.amountCents)} will be removed and everyone's balance recalculated. This can't be undone.`
            : ""
        }
        confirmLabel="Delete expense"
        loading={busy}
        error={error}
      />
    </>
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
  createdBy,
  onChanged,
  onLeft,
}: {
  groupId: string;
  members: Member[];
  meId: string;
  createdBy: string;
  onChanged: () => void;
  onLeft: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const isOwner = createdBy === meId;

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

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      const res = await api<{ left: boolean }>(
        `/api/groups/${groupId}/members/${removing.id}`,
        { method: "DELETE" }
      );
      setRemoving(null);
      if (res.left) onLeft();
      else onChanged();
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : "Couldn't remove them.");
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <>
      <Card className="h-fit">
        <CardHeader title="Members" description="Everyone splitting costs here." />
        <ul className="divide-y divide-[var(--border)]">
          {members.map((m) => {
            const self = m.id === meId;
            // You can always leave; only the owner can remove someone else.
            const canRemove = self || isOwner;
            return (
              <li key={m.id} className="group/member flex items-center gap-3 px-5 py-3">
                <Avatar name={m.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">
                    {m.name}
                    {self && (
                      <span className="ml-1.5 text-[12px] font-normal text-[var(--text-faint)]">
                        you
                      </span>
                    )}
                    {m.id === createdBy && (
                      <span className="ml-1.5 text-[12px] font-normal text-[var(--text-faint)]">
                        owner
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
                {canRemove && members.length > 1 && (
                  <IconButton
                    label={self ? "Leave this group" : `Remove ${m.name}`}
                    onClick={() => setRemoving(m)}
                    className="opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/member:opacity-100 hover:text-[var(--negative)]"
                  >
                    <XIcon className="h-4 w-4" />
                  </IconButton>
                )}
              </li>
            );
          })}
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

      <ConfirmDialog
        open={removing !== null}
        onClose={() => {
          setRemoving(null);
          setRemoveError(null);
        }}
        onConfirm={confirmRemove}
        title={removing?.id === meId ? "Leave this group?" : "Remove this member?"}
        body={
          removing?.id === meId
            ? "You'll lose access to this group's expenses and balances. You can only leave once you're settled up."
            : `${removing?.name} will be removed from the group. This is only possible once they're settled up.`
        }
        confirmLabel={removing?.id === meId ? "Leave group" : "Remove member"}
        loading={removeBusy}
        error={removeError}
      />
    </>
  );
}

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
  const [saved, setSaved] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader title="Add an expense" description="Balances update the moment you save." />
      {saved && (
        <div className="mx-5 mt-5 flex items-center gap-2 rounded-lg border border-[var(--positive)]/25 bg-[var(--positive-subtle)] px-3 py-2 text-[13px] text-[var(--positive)]">
          <CheckIcon className="h-4 w-4 shrink-0" />
          Added &ldquo;{saved}&rdquo; and updated balances.
        </div>
      )}
      <ExpenseForm
        members={members}
        meId={meId}
        submitLabel="Add expense"
        onSubmit={async (payload) => {
          await api(`/api/groups/${groupId}/expenses`, { method: "POST", body: payload });
          onChanged();
          setSaved(payload.description);
          setTimeout(() => setSaved(null), 3000);
        }}
      />
    </Card>
  );
}
