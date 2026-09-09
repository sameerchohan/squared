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
  CollapsibleCard,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
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
import type { StoredItemization } from "@/db/schema";
import { formatCents } from "@/lib/format";

type Me = { id: string; name: string; email: string };
type Member = {
  id: string;
  name: string;
  email: string;
  stripeOnboardingStatus: string;
};
type Group = { id: string; name: string; createdBy: string };
type Guest = {
  id: string;
  name: string;
  sponsorUserId: string;
  sponsorName: string;
};
type Expense = {
  id: string;
  paidBy: string;
  description: string;
  amountCents: number;
  splitType: string;
  createdAt: string;
  shares: {
    userId: string;
    owedCents: number;
    shareCount: number;
    coveredBy: string | null;
  }[];
  guests: { guestId: string; name: string; sponsorUserId: string }[];
  itemization: StoredItemization | null;
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
  method: string;
  status: string;
  createdAt: string;
};

export default function GroupPage() {
  const router = useRouter();
  const { groupId } = useParams<{ groupId: string }>();

  const [me, setMe] = useState<Me | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
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
      api<{ guests: Guest[] }>(`/api/groups/${groupId}/guests`),
      api<{ expenses: Expense[] }>(`/api/groups/${groupId}/expenses`),
      api<Balances>(`/api/groups/${groupId}/balances`),
      api<{ settlements: Settlement[] }>(`/api/groups/${groupId}/settlements`),
    ])
      .then(([meRes, detail, guestsRes, expensesRes, balancesRes, settlementsRes]) => {
        if (cancelled) return;
        setMe(meRes.user);
        setGroup(detail.group);
        setMembers(detail.members);
        setGuests(guestsRes.guests);
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

        {/* min-w-0 on both columns: without it a grid track sizes to its
            content's min-content width, and one nowrap control inside a card
            silently widens the whole page past the viewport on a phone. */}
        <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-6">
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
              guests={guests}
              meId={me.id}
              onChanged={reload}
            />
            <ExpenseList
              groupId={groupId}
              expenses={expenses}
              members={members}
              groupGuests={guests}
              nameOf={nameOf}
              meId={me.id}
              onChanged={reload}
            />
            <SettlementHistory settlements={settlements} nameOf={nameOf} meId={me.id} />
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <BalancesCard balances={balances} meId={me.id} />
            <MembersCard
              groupId={groupId}
              members={members}
              meId={me.id}
              createdBy={group.createdBy}
              onChanged={reload}
              onLeft={() => router.push("/")}
            />
            <GuestsCard
              groupId={groupId}
              guests={guests}
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

function BalancesCard({
  balances,
  meId,
}: {
  balances: Balances;
  meId: string;
}) {
  const unsettled = balances.balances.filter((b) => b.netCents !== 0).length;
  const settled = unsettled === 0;

  return (
    <CollapsibleCard
      title="Balances"
      description="Net position per member."
      storageKey="balances"
      summary={
        unsettled === 0
          ? "Everyone's square"
          : `${unsettled} ${unsettled === 1 ? "person is" : "people are"} not square yet`
      }
    >
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
              <span className="shrink-0 text-right">
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
    </CollapsibleCard>
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
  // Recording a payment Squared didn't process is a claim about the real
  // world that everyone else in the group has to take at face value, so it
  // goes through a confirmation rather than a single click.
  const [confirming, setConfirming] = useState<Transfer | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

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

  async function recordCash(transfer: Transfer) {
    setConfirmError(null);
    setRecording(true);
    try {
      await api(`/api/groups/${groupId}/settlements`, {
        method: "POST",
        body: {
          toUser: transfer.toUser,
          amountCents: transfer.amountCents,
          method: "cash",
        },
      });
      setConfirming(null);
      onChanged();
    } catch (e) {
      setConfirmError(
        e instanceof Error ? e.message : "Couldn't record that payment."
      );
    } finally {
      setRecording(false);
    }
  }

  if (balances.suggestedTransfers.length === 0) return null;

  return (
    <CollapsibleCard
      title="Settle up"
      description={`${balances.suggestedTransfers.length} transfer${
        balances.suggestedTransfers.length === 1 ? "" : "s"
      } clears the whole group.`}
      storageKey="settle-up"
      summary={`${balances.suggestedTransfers.length} transfer${
        balances.suggestedTransfers.length === 1 ? "" : "s"
      } would clear the group`}
    >
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
                    <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                      {nameOf(t.toUser)} can&apos;t take card payments here yet.
                      Pay them however you normally do, then mark it paid.
                    </p>
                  )}
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-11 flex-1 sm:h-9 sm:flex-none"
                    disabled={payingTo !== null}
                    onClick={() => {
                      setConfirmError(null);
                      setConfirming(t);
                    }}
                  >
                    Mark as paid
                  </Button>
                  {canReceive && (
                    <Button
                      size="sm"
                      className="h-11 flex-1 sm:h-9 sm:flex-none"
                      disabled={payingTo !== null}
                      loading={payingTo === t.toUser}
                      onClick={() => settleUp(t.toUser, t.amountCents)}
                    >
                      Pay now
                    </Button>
                  )}
                </div>
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
          Card payments go through Stripe directly to the recipient&apos;s
          connected account. Paid another way? Mark it as paid and everyone
          in the group sees it settled.
        </p>
      </div>

      <Dialog
        open={confirming !== null}
        onClose={() => {
          if (recording) return;
          setConfirming(null);
          setConfirmError(null);
        }}
        title="Mark this as paid?"
      >
        <div className="flex flex-col gap-4 p-5">
          <p className="text-[14px] leading-relaxed text-[var(--text-muted)]">
            {confirming
              ? `This records that you already sent ${nameOf(confirming.toUser)} ${formatCents(confirming.amountCents)} outside Squared. Their balance clears too, and everyone in the group sees the payment.`
              : ""}
          </p>
          {confirmError && <Alert>{confirmError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => {
                setConfirming(null);
                setConfirmError(null);
              }}
              disabled={recording}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-11 sm:h-9"
              loading={recording}
              onClick={() => confirming && recordCash(confirming)}
            >
              Yes, I paid them
            </Button>
          </div>
        </div>
      </Dialog>
    </CollapsibleCard>
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
  groupGuests,
  nameOf,
  meId,
  onChanged,
}: {
  groupId: string;
  expenses: Expense[];
  members: Member[];
  groupGuests: Guest[];
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
      <CollapsibleCard
        title="Expenses"
        description="Most recent first."
        storageKey="expenses"
        summary={
          expenses.length === 0
            ? "Nothing logged yet"
            : `${expenses.length} logged \u00b7 ${formatCents(
                expenses.reduce((sum, e) => sum + e.amountCents, 0)
              )} tracked`
        }
      >
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
                  {/* The description wraps rather than truncating: on a
                      phone a clipped "Dinner at El F…" is the one thing in
                      the row you cannot reconstruct from context. */}
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 flex-1 text-[15px] font-medium break-words">
                      {expense.description}
                    </p>
                    <p className="figure shrink-0 text-[16px]">
                      {formatCents(expense.amountCents)}
                    </p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[var(--text-muted)]">
                    <span>{mine ? "You" : nameOf(expense.paidBy)} paid</span>
                    <span aria-hidden="true">·</span>
                    <Badge>
                      {expense.itemization
                        ? "Itemised"
                        : (SPLIT_LABEL[expense.splitType] ?? expense.splitType)}
                    </Badge>
                    <span aria-hidden="true">·</span>
                    <time dateTime={expense.createdAt}>
                      {new Date(expense.createdAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                    {/* Actions belong to whoever paid, and sit at the end of
                        the meta line so they never eat the description's
                        width. On a pointer device they stay hidden until the
                        row is hovered or focused; on a touch screen, where
                        neither happens, they are always visible. */}
                    {mine && (
                      <div className="-my-2 ml-auto flex shrink-0 gap-0.5 transition-opacity duration-150 focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100">
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
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--text-muted)]">
                    {expense.shares.map((sh) => {
                      const who = sh.userId === meId ? "You" : nameOf(sh.userId);
                      // Somebody else picked this up. Their row stays so the
                      // expense still shows they were there, owing nothing.
                      if (sh.coveredBy) {
                        return (
                          <li key={sh.userId}>
                            {who} covered by{" "}
                            {sh.coveredBy === meId ? "you" : nameOf(sh.coveredBy)}
                          </li>
                        );
                      }
                      return (
                        <li key={sh.userId} className="tnum">
                          {who}
                          {sh.shareCount > 1 && (
                            <span className="ml-1 font-medium text-[var(--brand)]">
                              &times;{sh.shareCount}
                            </span>
                          )}{" "}
                          <span className="font-medium text-[var(--text)]">
                            {formatCents(sh.owedCents)}
                          </span>
                        </li>
                      );
                    })}
                    {expense.guests.map((g) => (
                      <li key={g.guestId}>
                        {g.name} (guest) covered by{" "}
                        {g.sponsorUserId === meId ? "you" : nameOf(g.sponsorUserId)}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </CollapsibleCard>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit expense"
        description="Shares are recalculated and balances update on save."
      >
        {editing && (
          <ExpenseForm
            members={members}
            // Guests this expense used may since have been archived, and an
            // archived guest is no longer in the group's live list. Merging
            // them back in is what lets an old bill still open and save.
            guests={[
              ...groupGuests,
              ...editing.guests
                .filter((g) => !groupGuests.some((live) => live.id === g.guestId))
                .map((g) => ({
                  id: g.guestId,
                  name: g.name,
                  sponsorUserId: g.sponsorUserId,
                })),
            ]}
            meId={meId}
            submitLabel="Save changes"
            onCancel={() => setEditing(null)}
            initial={{
              description: editing.description,
              amountCents: editing.amountCents,
              paidBy: editing.paidBy,
              splitType: editing.splitType as "equal" | "exact" | "percentage",
              shares: editing.shares,
              guests: editing.guests,
              itemization: editing.itemization,
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
    <CollapsibleCard
      title="Payments"
      description="Settlements in this group."
      storageKey="payments"
      defaultOpen={false}
      summary={
        settlements.length === 0
          ? "Nothing paid yet"
          : `${settlements.length} recorded`
      }
    >
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
                <p className="text-[12px] text-[var(--text-muted)]">
                  <time dateTime={s.createdAt}>
                    {new Date(s.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </time>
                  {s.method === "cash" && <span> · Paid outside Squared</span>}
                </p>
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
    </CollapsibleCard>
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
      <CollapsibleCard
        className="h-fit"
        title="Members"
        description="Everyone splitting costs here."
        storageKey="members"
        defaultOpen={false}
        summary={`${members.length} ${members.length === 1 ? "person" : "people"}`}
      >
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
                  {/* basis-36 rather than a breakpoint: the badge drops to
                      its own line exactly when the email would otherwise be
                      squeezed to nothing, which depends on the card's width,
                      not the window's. */}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="min-w-0 flex-1 basis-36 truncate text-[12px] text-[var(--text-muted)]">
                      {m.email}
                    </p>
                    {m.stripeOnboardingStatus === "active" && (
                      <span className="shrink-0">
                        <Badge tone="positive">
                          <CheckIcon className="h-3 w-3" />
                          Can receive
                        </Badge>
                      </span>
                    )}
                  </div>
                </div>
                {canRemove && members.length > 1 && (
                  <IconButton
                    label={self ? "Leave this group" : `Remove ${m.name}`}
                    onClick={() => setRemoving(m)}
                    className="transition-opacity duration-150 focus-within:opacity-100 hover:text-[var(--negative)] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/member:opacity-100"
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
      </CollapsibleCard>

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

/**
 * Guests are people on the trip with no Squared account: a partner, a kid, a
 * friend who never signed up. They hold no balance of their own, because they
 * have no way to pay one. Their share of an expense is charged to whoever
 * covers them, which is why every guest must name a sponsor.
 */
function GuestsCard({
  groupId,
  guests,
  members,
  meId,
  onChanged,
}: {
  groupId: string;
  guests: Guest[];
  members: Member[];
  meId: string;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [sponsorUserId, setSponsorUserId] = useState(meId);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState<Guest | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function addGuest(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const value = name.trim();
    if (!value) {
      setFieldError("Give them a name.");
      return;
    }
    setFieldError(undefined);
    setSubmitting(true);
    try {
      await api(`/api/groups/${groupId}/guests`, {
        method: "POST",
        body: { name: value, sponsorUserId },
      });
      setName("");
      onChanged();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't add that guest.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await api(`/api/groups/${groupId}/guests/${removing.id}`, {
        method: "DELETE",
      });
      setRemoving(null);
      onChanged();
    } catch (e) {
      setRemoveError(
        e instanceof Error ? e.message : "Couldn't remove that guest."
      );
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <CollapsibleCard
      title="Guests"
      description="People here without an account. Their share is paid by whoever covers them."
      storageKey="guests"
      summary={
        guests.length === 0
          ? "None yet"
          : guests.map((g) => g.name).join(", ")
      }
    >

      {guests.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="h-5 w-5" />}
          title="No guests yet"
          description="Add someone along for the trip who isn't on Squared, like a partner or a kid."
        />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {guests.map((g) => (
            <li key={g.id} className="flex items-center gap-3 px-5 py-3">
              <Avatar name={g.name} className="h-8 w-8 shrink-0 text-[12px]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{g.name}</p>
                <p className="truncate text-[12px] text-[var(--text-muted)]">
                  Covered by{" "}
                  {g.sponsorUserId === meId ? "you" : g.sponsorName}
                </p>
              </div>
              <IconButton
                label={`Remove ${g.name}`}
                onClick={() => setRemoving(g)}
                className="hover:text-[var(--negative)]"
              >
                <TrashIcon className="h-4 w-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={addGuest}
        noValidate
        className="flex flex-col gap-3 border-t border-[var(--border)] p-5"
      >
        {formError && <Alert>{formError}</Alert>}
        <Field label="Name" error={fieldError}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              placeholder="Sara"
              maxLength={80}
              value={name}
              invalid={invalid}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldError) setFieldError(undefined);
              }}
            />
          )}
        </Field>
        <Field label="Covered by">
          {({ id }) => (
            <Select
              id={id}
              value={sponsorUserId}
              onChange={(e) => setSponsorUserId(e.target.value)}
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id === meId ? "You" : m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" variant="secondary" loading={submitting}>
          Add guest
        </Button>
      </form>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => {
          setRemoving(null);
          setRemoveError(null);
        }}
        onConfirm={confirmRemove}
        title="Remove this guest?"
        body={
          removing
            ? `${removing.name} will stop appearing when you add an expense. Expenses they were already part of keep their record exactly as it is.`
            : ""
        }
        confirmLabel="Remove guest"
        loading={removeBusy}
        error={removeError}
      />
    </CollapsibleCard>
  );
}

function AddExpenseCard({
  groupId,
  members,
  guests,
  meId,
  onChanged,
}: {
  groupId: string;
  members: Member[];
  guests: Guest[];
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
        guests={guests}
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
