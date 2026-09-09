"use client";

import { useMemo, useState } from "react";
import { Alert, Avatar, Button, Field, IconButton, Input, Select, cx } from "./ui";
import { AlertIcon, CheckIcon } from "./icons";
import { formatCents, parseDollarsToCents } from "@/lib/format";
import { MAX_SHARES_PER_PERSON } from "@/lib/coverage-rules";

/**
 * Percentages are summed as floats, so 33.33 + 33.33 + 33.34 lands on
 * 100.00000000000001. Trim that noise off anything shown to a person.
 */
function formatPercent(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

export type SplitType = "equal" | "exact" | "percentage";
export type FormMember = { id: string; name: string };
/** Somebody on the trip with no account, whose share lands on their sponsor. */
export type FormGuest = { id: string; name: string; sponsorUserId: string };

export type ExpenseDraft = {
  description: string;
  amountCents: number;
  paidBy: string;
  splitType: SplitType;
  shares: {
    userId: string;
    owedCents: number;
    shareCount?: number;
    coveredBy?: string | null;
  }[];
  guests?: { guestId: string; sponsorUserId: string }[];
};

type Errors = {
  description?: string;
  amount?: string;
  split?: string;
};

/**
 * One form for creating and editing, so the two can never drift apart in
 * validation or behaviour. All validation is ours — every form using it sets
 * noValidate, because the browser's native bubbles block submission silently
 * and read to the user as a dead button.
 */
export function ExpenseForm({
  members,
  guests = [],
  meId,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  members: FormMember[];
  guests?: FormGuest[];
  meId: string;
  initial?: ExpenseDraft;
  submitLabel: string;
  onSubmit: (payload: {
    description: string;
    amountCents: number;
    paidBy: string;
    split: unknown;
  }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [description, setDescription] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(
    initial ? (initial.amountCents / 100).toFixed(2) : ""
  );
  const [paidBy, setPaidBy] = useState(initial?.paidBy ?? meId);
  const [splitType, setSplitType] = useState<SplitType>(initial?.splitType ?? "equal");
  const [selected, setSelected] = useState<Set<string> | null>(
    initial?.splitType === "equal"
      ? new Set(initial.shares.map((s) => s.userId))
      : null
  );
  const [perUser, setPerUser] = useState<Record<string, string>>(() => {
    if (!initial || initial.splitType === "equal") return {};
    if (initial.splitType === "exact") {
      return Object.fromEntries(
        initial.shares.map((s) => [s.userId, (s.owedCents / 100).toFixed(2)])
      );
    }
    return Object.fromEntries(
      initial.shares.map((s) => [
        s.userId,
        ((s.owedCents / initial.amountCents) * 100).toFixed(2),
      ])
    );
  });
  // Covering state for equal splits. Held apart from `selected` so toggling
  // somebody out of an expense and back does not lose who they were covering.
  const [selectedGuests, setSelectedGuests] = useState<Set<string>>(
    () => new Set((initial?.guests ?? []).map((g) => g.guestId))
  );
  const [coveredBy, setCoveredBy] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const share of initial?.shares ?? []) {
      if (share.coveredBy) out[share.userId] = share.coveredBy;
    }
    return out;
  });
  const [ownShares, setOwnShares] = useState<Record<string, number>>(() => {
    // Recover each person's own share count from what was stored: their total
    // less the guests they sponsored and the members they covered.
    const out: Record<string, number> = {};
    if (!initial || initial.splitType !== "equal") return out;
    for (const share of initial.shares) {
      if (share.coveredBy) continue;
      const covering = initial.shares.filter(
        (o) => o.coveredBy === share.userId
      ).length;
      const sponsoring = (initial.guests ?? []).filter(
        (g) => g.sponsorUserId === share.userId
      ).length;
      out[share.userId] = Math.max(
        0,
        (share.shareCount ?? 1) - covering - sponsoring
      );
    }
    return out;
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const participants = useMemo(
    () => selected ?? new Set(members.map((m) => m.id)),
    [selected, members]
  );
  const amountCents = parseDollarsToCents(amount);

  // A live total so a mismatched split is visible while typing rather than
  // arriving as a server error after submitting.
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

  // What is still unassigned, in whatever unit this split is expressed in.
  // Null when there is nothing to measure against: an equal split, a field
  // that will not parse, or an exact split before a total has been typed.
  const remaining = useMemo(() => {
    if (allocated === null) return null;
    if (splitType === "percentage") return Number((100 - allocated).toFixed(2));
    if (amountCents === null) return null;
    return amountCents - allocated;
  }, [allocated, splitType, amountCents]);

  /**
   * What each member is paying for: their own shares, plus one for every guest
   * they sponsor and every member they cover. The total is the number of ways
   * the expense divides, which is the number people count on their fingers.
   */
  const weights = useMemo(() => {
    const out = new Map<string, number>();
    for (const id of participants) {
      out.set(id, coveredBy[id] ? 0 : (ownShares[id] ?? 1));
    }
    for (const id of participants) {
      const coverer = coveredBy[id];
      if (coverer && out.has(coverer)) {
        out.set(coverer, (out.get(coverer) ?? 0) + 1);
      }
    }
    for (const guest of guests) {
      if (!selectedGuests.has(guest.id)) continue;
      out.set(
        guest.sponsorUserId,
        (out.get(guest.sponsorUserId) ?? 0) + 1
      );
    }
    return out;
  }, [participants, coveredBy, ownShares, guests, selectedGuests]);

  const totalShares = useMemo(
    () => [...weights.values()].reduce((sum, w) => sum + w, 0),
    [weights]
  );

  // Somebody covering a guest at something they skipped themselves. They are
  // not "in" the expense, but they still have to be listed so the guest's
  // share has a row to land on.
  const absentSponsors = useMemo(
    () =>
      [
        ...new Set(
          guests
            .filter(
              (g) => selectedGuests.has(g.id) && !participants.has(g.sponsorUserId)
            )
            .map((g) => g.sponsorUserId)
        ),
      ],
    [guests, selectedGuests, participants]
  );

  function toggleGuest(id: string) {
    setSelectedGuests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (errors.split) setErrors((p) => ({ ...p, split: undefined }));
  }

  function setOwnShareCount(id: string, count: number) {
    setOwnShares((prev) => ({
      ...prev,
      [id]: Math.min(MAX_SHARES_PER_PERSON, Math.max(0, count)),
    }));
  }

  /** Who may cover this member: anyone else here who is not covered already. */
  function coverCandidates(forId: string) {
    return members.filter(
      (m) => m.id !== forId && participants.has(m.id) && !coveredBy[m.id]
    );
  }

  function toggleParticipant(id: string) {
    const next = new Set(participants);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function validate(): Errors {
    const next: Errors = {};
    if (!description.trim()) next.description = "What was this for?";
    if (!amount.trim()) next.amount = "Enter an amount.";
    else if (amountCents === null) next.amount = "Use a number like 24.50 — no symbols.";
    else if (amountCents === 0) next.amount = "Amount must be more than zero.";

    if (splitType === "equal") {
      if (participants.size === 0 && selectedGuests.size === 0) {
        next.split = "Pick at least one person.";
      } else if (totalShares === 0) {
        next.split = "Nobody is paying for this yet.";
      }
    } else if (allocated === null) {
      next.split = "Every value must be a number.";
    } else if (splitType === "exact" && amountCents !== null && allocated !== amountCents) {
      const diff = amountCents - allocated;
      next.split =
        diff > 0
          ? `${formatCents(diff)} still unallocated.`
          : `${formatCents(-diff)} over the total.`;
    } else if (splitType === "percentage" && Math.abs(allocated - 100) > 0.001) {
      next.split = `Percentages add up to ${formatPercent(allocated)}, not 100%.`;
    }
    return next;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const split =
      splitType === "equal"
        ? {
            type: "equal",
            participants: [
              ...[...participants].map((id) =>
                coveredBy[id]
                  ? { userId: id, coveredBy: coveredBy[id] }
                  : { userId: id, shares: ownShares[id] ?? 1 }
              ),
              ...absentSponsors.map((id) => ({ userId: id, shares: 0 })),
            ],
            guestIds: [...selectedGuests],
          }
        : splitType === "exact"
          ? {
              type: "exact",
              shares: members
                .filter((m) => perUser[m.id]?.trim())
                .map((m) => ({
                  userId: m.id,
                  amountCents: parseDollarsToCents(perUser[m.id].trim())!,
                })),
            }
          : {
              type: "percentage",
              shares: members
                .filter((m) => perUser[m.id]?.trim())
                .map((m) => ({ userId: m.id, percent: Number(perUser[m.id].trim()) })),
            };

    setSubmitting(true);
    try {
      await onSubmit({
        description: description.trim(),
        amountCents: amountCents!,
        paidBy,
        split,
      });
      if (!initial) {
        setDescription("");
        setAmount("");
        setPerUser({});
        setSelectedGuests(new Set());
        setCoveredBy({});
        setOwnShares({});
        setErrors({});
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 p-5">
      {formError && <Alert>{formError}</Alert>}

      <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
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
                if (errors.description) setErrors((p) => ({ ...p, description: undefined }));
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
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const on = participants.has(m.id);
                const share = weights.get(m.id) ?? 0;
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleParticipant(m.id)}
                    className={cx(
                      "inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-[14px] font-medium transition-colors duration-150",
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
                    {on && share !== 1 && (
                      <span className="tnum rounded-full bg-[var(--brand)] px-1.5 text-[11px] font-semibold text-[var(--on-brand)]">
                        &times;{share}
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Guests sit in the same row of pills, because on the night that
                  is what they are: another head at the table. The dashed edge
                  is the only thing marking that they have no account. */}
              {guests.map((g) => {
                const on = selectedGuests.has(g.id);
                const sponsor = members.find((m) => m.id === g.sponsorUserId);
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleGuest(g.id)}
                    title={sponsor ? `Covered by ${sponsor.name}` : undefined}
                    className={cx(
                      "inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-dashed px-3.5 text-[14px] font-medium transition-colors duration-150",
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
                    {g.name}
                    <span className="text-[11px] font-normal opacity-70">
                      guest
                    </span>
                  </button>
                );
              })}
            </div>

            {/* The denominator, said out loud. Covering is easy to get subtly
                wrong, and reading "7 ways" is how you catch it before saving. */}
            {totalShares > 0 && (
              <p className="tnum text-[13px] text-[var(--text-muted)]">
                Split {totalShares} way{totalShares === 1 ? "" : "s"}
                {amountCents !== null && amountCents > 0 && (
                  <>
                    {" \u00b7 "}
                    <span className="font-medium text-[var(--text)]">
                      {formatCents(Math.round(amountCents / totalShares))}
                    </span>{" "}
                    per share
                  </>
                )}
              </p>
            )}

            {absentSponsors.length > 0 && (
              <p className="text-[13px] text-[var(--text-muted)]">
                {absentSponsors
                  .map((id) => members.find((m) => m.id === id)?.name ?? "Someone")
                  .join(", ")}{" "}
                {absentSponsors.length === 1 ? "is" : "are"} not in this expense
                but still paying for a guest.
              </p>
            )}

            {participants.size > 0 && (
              <details className="rounded-lg border border-[var(--border)]">
                <summary className="cursor-pointer list-none px-3 py-2 text-[13px] font-medium text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--text)]">
                  Is anyone covering someone else?
                </summary>
                <div className="flex flex-col gap-2.5 border-t border-[var(--border)] p-3">
                  {members
                    .filter((m) => participants.has(m.id))
                    .map((m) => {
                      const covered = coveredBy[m.id];
                      const own = ownShares[m.id] ?? 1;
                      const candidates = coverCandidates(m.id);
                      return (
                        <div key={m.id} className="flex items-center gap-2">
                          <Avatar
                            name={m.name}
                            className="h-7 w-7 shrink-0 text-[11px]"
                          />
                          <span className="min-w-0 flex-1 truncate text-[14px]">
                            {m.id === meId ? "You" : m.name}
                          </span>

                          {candidates.length > 0 && (
                            <Select
                              aria-label={`Who pays for ${m.name}`}
                              className="h-9 w-[170px] shrink-0 text-[13px]"
                              value={covered ?? ""}
                              onChange={(e) => {
                                const value = e.target.value;
                                setCoveredBy((prev) => {
                                  const next = { ...prev };
                                  if (value) next[m.id] = value;
                                  else delete next[m.id];
                                  return next;
                                });
                                if (errors.split) {
                                  setErrors((p) => ({ ...p, split: undefined }));
                                }
                              }}
                            >
                              <option value="">Pays their own way</option>
                              {candidates.map((c) => (
                                <option key={c.id} value={c.id}>
                                  Covered by {c.id === meId ? "you" : c.name}
                                </option>
                              ))}
                            </Select>
                          )}

                          {/* Unnamed heads: the cousin who came along and is
                              not worth adding to the trip as a guest. */}
                          {!covered && (
                            <div className="flex shrink-0 items-center">
                              <IconButton
                                label={`One less share for ${m.name}`}
                                disabled={own <= 0}
                                onClick={() => setOwnShareCount(m.id, own - 1)}
                              >
                                <span aria-hidden="true">&minus;</span>
                              </IconButton>
                              <span className="tnum w-5 text-center text-[13px] font-medium">
                                {own}
                              </span>
                              <IconButton
                                label={`One more share for ${m.name}`}
                                disabled={own >= MAX_SHARES_PER_PERSON}
                                onClick={() => setOwnShareCount(m.id, own + 1)}
                              >
                                <span aria-hidden="true">+</span>
                              </IconButton>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </details>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-3">
                <Avatar name={m.name} className="h-7 w-7 text-[11px]" />
                <span className="flex-1 truncate text-[14px]">
                  {m.id === meId ? "You" : m.name}
                </span>
                <div className="relative w-32">
                  {splitType === "exact" && (
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--text-faint)]">
                      $
                    </span>
                  )}
                  <Input
                    inputMode="decimal"
                    aria-label={`${splitType === "exact" ? "Amount" : "Percentage"} for ${m.name}`}
                    placeholder={splitType === "exact" ? "0.00" : "0"}
                    className={cx("tnum h-10 text-[16px]", splitType === "exact" && "pl-6")}
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

            {allocated !== null && (
              <div className="tnum mt-1 border-t border-[var(--border)] pt-2.5 text-[13px]">
                <p className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Allocated</span>
                  <span className="font-medium text-[var(--text)]">
                    {splitType === "exact"
                      ? `${formatCents(allocated)}${amountCents !== null ? ` of ${formatCents(amountCents)}` : ""}`
                      : `${formatPercent(allocated)} of 100%`}
                  </span>
                </p>

                {/* The number people are actually solving for while they type:
                    what is still loose, or how far past the total they went. */}
                {remaining !== null && (
                  <p
                    className={cx(
                      "mt-1.5 flex justify-between font-semibold",
                      remaining === 0
                        ? "text-[var(--positive)]"
                        : remaining > 0
                          ? "text-[var(--warning)]"
                          : "text-[var(--negative)]"
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {remaining === 0 && <CheckIcon className="h-3 w-3 shrink-0" />}
                      {remaining === 0
                        ? "Fully allocated"
                        : remaining > 0
                          ? "Left to allocate"
                          : "Over the total by"}
                    </span>
                    {remaining !== 0 && (
                      <span>
                        {splitType === "exact"
                          ? formatCents(Math.abs(remaining))
                          : formatPercent(Math.abs(remaining))}
                      </span>
                    )}
                  </p>
                )}
              </div>
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

      <div className="flex gap-2">
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
