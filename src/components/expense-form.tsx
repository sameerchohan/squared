"use client";

import { useId, useMemo, useState } from "react";
import { Alert, Avatar, Button, Field, IconButton, Input, Select, cx } from "./ui";
import {
  AlertIcon,
  CheckIcon,
  ChevronDownIcon,
  PlusIcon,
  TrashIcon,
} from "./icons";
import { formatCents, parseDollarsToCents } from "@/lib/format";
import { MAX_SHARES_PER_PERSON } from "@/lib/coverage-rules";
import { splitReceipt, type SharedItem } from "@/lib/receipt-split";

/**
 * Percentages are summed as floats, so 33.33 + 33.33 + 33.34 lands on
 * 100.00000000000001. Trim that noise off anything shown to a person.
 */
function formatPercent(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

export type SplitType = "equal" | "exact" | "percentage";
/**
 * "itemized" is a way of filling the form in, not a way of storing it. What it
 * produces is an exact split, so nothing downstream needs to know it exists.
 */
type SplitMode = SplitType | "itemized";
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

/** One thing the table split, as it is being typed into the form. */
export type SharedDraft = {
  id: string;
  label: string;
  amount: string;
  /**
   * Who was in on it. Fixed when the item is added rather than derived as you
   * type: a default that keeps moving would quietly re-aim the appetisers at
   * whoever you happened to fill in last.
   */
  sharedBy: string[];
};

/**
 * The whole itemised bill, worked out from what has been typed: what everybody
 * ordered alone, what the table shared, and what each person therefore owes.
 *
 * Guests are people here too, so they can be down for a share of the
 * appetisers. Their money is moved onto whoever covers them only at the end,
 * once the arithmetic is done, because a guest has no row of their own to
 * hold it.
 *
 * Kept outside the component as a plain function of its inputs, so there is
 * one obvious place the arithmetic happens.
 */
function computeReceipt(
  members: FormMember[],
  guests: FormGuest[],
  orderAmounts: Record<string, string>,
  sharedDrafts: SharedDraft[],
  taxInput: string,
  tipInput: string,
  discountInput: string
) {
  const parse = (raw: string | undefined) => {
    const trimmed = (raw ?? "").trim();
    return trimmed === "" ? 0 : parseDollarsToCents(trimmed);
  };

  const tax = parse(taxInput);
  const tip = parse(tipInput);
  const discount = parse(discountInput);
  if (tax === null || tip === null || discount === null) {
    return { valid: false as const, reason: null };
  }

  // Members and guests alike are "people on the bill" until the very last step.
  const sponsorOf = new Map<string, string>();
  for (const m of members) sponsorOf.set(m.id, m.id);
  for (const g of guests) sponsorOf.set(g.id, g.sponsorUserId);

  const individual: { userId: string; subtotalCents: number }[] = [];
  for (const person of [...members, ...guests]) {
    const cents = parse(orderAmounts[person.id]);
    if (cents === null) return { valid: false as const, reason: null };
    individual.push({ userId: person.id, subtotalCents: cents });
  }

  const shared: SharedItem[] = [];
  for (const draft of sharedDrafts) {
    const cents = parse(draft.amount);
    if (cents === null) return { valid: false as const, reason: null };
    shared.push({
      label: draft.label.trim() || undefined,
      amountCents: cents,
      sharedBy: draft.sharedBy,
    });
  }

  let breakdown;
  try {
    breakdown = splitReceipt(individual, shared, tax, tip, discount);
  } catch (error) {
    return {
      valid: false as const,
      reason: error instanceof Error ? error.message : null,
    };
  }

  // Now fold guests onto whoever covers them. Doing it after the split rather
  // than before keeps every person's own figure visible on screen, and the
  // total is unchanged because it is only ever a regrouping of the same cents.
  const owedByMember = new Map<string, number>();
  for (const line of breakdown.lines) {
    const sponsor = sponsorOf.get(line.userId) ?? line.userId;
    owedByMember.set(sponsor, (owedByMember.get(sponsor) ?? 0) + line.owedCents);
  }

  const byPerson = new Map(breakdown.lines.map((l) => [l.userId, l]));
  const guestIds = guests
    .filter((g) => (byPerson.get(g.id)?.subtotalCents ?? 0) > 0)
    .map((g) => g.id);

  return {
    valid: true as const,
    reason: null,
    breakdown,
    byPerson,
    owedByMember,
    guestIds,
    food: breakdown.foodCents,
    tax: breakdown.taxCents,
    tip: breakdown.tipCents,
    discount: breakdown.discountCents,
    total: breakdown.totalCents,
  };
}

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
  const [splitType, setSplitType] = useState<SplitMode>(initial?.splitType ?? "equal");
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
  // Itemised entry: what each person's own order came to, plus the two numbers
  // at the bottom of the receipt. Keyed by member id or guest id, which are
  // both uuids and so cannot collide.
  const [orderAmounts, setOrderAmounts] = useState<Record<string, string>>({});
  // Optional: the total printed on the receipt. Typing it turns the form into
  // its own check, which is the only way to catch a line nobody entered.
  const [receiptTotalInput, setReceiptTotalInput] = useState("");
  const checkId = useId();
  const [sharedItems, setSharedItems] = useState<SharedDraft[]>([]);
  const [openSharers, setOpenSharers] = useState<string | null>(null);
  const [taxInput, setTaxInput] = useState("");
  const [tipInput, setTipInput] = useState("");
  const [discountInput, setDiscountInput] = useState("");
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
   * The whole itemised bill, worked out live: what everybody ordered, what the
   * tax and tip come to, and what each person therefore owes. A guest's order
   * is added to whoever covers them, because a guest has no row to own.
   */
  const receipt = useMemo(
    () =>
      splitType === "itemized"
        ? computeReceipt(
            members,
            guests,
            orderAmounts,
            sharedItems,
            taxInput,
            tipInput,
            discountInput
          )
        : null,
    [
      splitType,
      members,
      guests,
      orderAmounts,
      sharedItems,
      taxInput,
      tipInput,
      discountInput,
    ]
  );

  const billPeople = useMemo(
    () => [
      ...members.map((m) => ({
        id: m.id,
        name: m.id === meId ? "You" : m.name.split(" ")[0],
      })),
      ...guests.map((g) => ({ id: g.id, name: g.name.split(" ")[0] })),
    ],
    [members, guests, meId]
  );

  function clearSplitError() {
    if (errors.split) setErrors((p) => ({ ...p, split: undefined }));
  }

  function addSharedItem() {
    // Nobody is picked to start with, and the picker opens straight away. One
    // tap on a name makes it that person's; one tap on Everyone makes it the
    // table's. Guessing a default would be wrong half the time, and silently.
    const id = crypto.randomUUID();
    setSharedItems((prev) => [
      ...prev,
      { id, label: "", amount: "", sharedBy: [] },
    ]);
    setOpenSharers(id);
    clearSplitError();
  }

  function updateSharedItem(id: string, patch: Partial<SharedDraft>) {
    setSharedItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
    clearSplitError();
  }

  function removeSharedItem(id: string) {
    setSharedItems((prev) => prev.filter((item) => item.id !== id));
    if (openSharers === id) setOpenSharers(null);
    clearSplitError();
  }

  function toggleSharer(item: SharedDraft, personId: string) {
    updateSharedItem(item.id, {
      sharedBy: item.sharedBy.includes(personId)
        ? item.sharedBy.filter((id) => id !== personId)
        : [...item.sharedBy, personId],
    });
  }

  function setOrderAmount(id: string, value: string) {
    setOrderAmounts((prev) => ({ ...prev, [id]: value }));
    if (errors.split) setErrors((p) => ({ ...p, split: undefined }));
  }

  /** 15 / 18 / 20% of the food, which is what a tip line is asking for. */
  function applyTipPercent(percent: number) {
    if (!receipt?.valid || receipt.food === 0) return;
    setTipInput((Math.round((receipt.food * percent) / 100) / 100).toFixed(2));
    if (errors.split) setErrors((p) => ({ ...p, split: undefined }));
  }

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

    if (splitType === "itemized") {
      // The total is added up from the bill rather than typed, so there is no
      // amount field to complain about here.
      if (!receipt || !receipt.valid) {
        // The calculation says what is wrong when it can, and it is written to
        // be read by a person, so pass it straight through.
        next.split = receipt?.reason ?? "Use numbers like 24.50, with no symbols.";
      }
      return next;
    }

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

    // An itemised bill is submitted as the exact split it already is, with the
    // total added up from the receipt rather than typed at the top.
    const bill = splitType === "itemized" && receipt?.valid ? receipt : null;
    if (splitType === "itemized" && !bill) return;

    const split =
      bill !== null
        ? {
            type: "exact",
            shares: [...bill.owedByMember]
              .filter(([, cents]) => cents > 0)
              .map(([userId, amountCents]) => ({ userId, amountCents })),
            guestIds: bill.guestIds,
          }
        : splitType === "equal"
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
        amountCents: bill !== null ? bill.total : amountCents!,
        paidBy,
        split,
      });
      if (!initial) {
        setDescription("");
        setAmount("");
        setPerUser({});
        setOrderAmounts({});
        setSharedItems([]);
        setReceiptTotalInput("");
        setTaxInput("");
        setTipInput("");
        setDiscountInput("");
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

        {/* Itemising adds the bill up for you. Typing a total that has to
            match the receipt is exactly the arithmetic this is meant to
            spare you, so the field becomes a readout. */}
        {splitType === "itemized" ? (
          <Field label="Total" hint="Added up from the bill">
            {({ id }) => (
              <output
                id={id}
                className="tnum flex h-11 w-full items-center rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface-subtle)] px-3 text-[16px] font-medium"
              >
                {formatCents(receipt?.valid ? receipt.total : 0)}
              </output>
            )}
          </Field>
        ) : (
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
        )}
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
              <option value="itemized">By what each had</option>
              <option value="exact">Exact amounts</option>
              <option value="percentage">Percentages</option>
            </Select>
          )}
        </Field>
      </div>

      <fieldset className="rounded-lg border border-[var(--border)] p-4">
        <legend className="px-1.5 text-[13px] font-medium">
          {splitType === "equal"
            ? "Split between"
            : splitType === "itemized"
              ? "What each person had"
              : "Amount per person"}
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
              <details className="group rounded-lg border border-[var(--border)]">
                {/* Safari draws its own disclosure triangle unless the webkit
                    marker is hidden too, and list-none alone will not do it. */}
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 text-[13px] font-medium text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--text)] [&::-webkit-details-marker]:hidden">
                  <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 -rotate-90 transition-transform duration-200 group-open:rotate-0" />
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
                        // A name, a 170px select and a stepper do not fit
                        // across a phone, so below sm they stack instead of
                        // pushing the card past the viewport.
                        <div
                          key={m.id}
                          className="flex flex-col gap-2 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:border-0 sm:pb-0"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Avatar
                              name={m.name}
                              className="h-7 w-7 shrink-0 text-[11px]"
                            />
                            <span className="min-w-0 flex-1 truncate text-[14px]">
                              {m.id === meId ? "You" : m.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 sm:ml-auto">
                          {candidates.length > 0 && (
                            <Select
                              aria-label={`Who pays for ${m.name}`}
                              className="h-11 min-w-0 flex-1 text-[14px] sm:h-10 sm:w-[170px] sm:flex-none"
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
                        </div>
                      );
                    })}
                </div>
              </details>
            )}
          </div>
        ) : splitType === "itemized" ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-[var(--text-muted)]">
              Put in what each person had to themselves, and add anything the
              group shared below. Tax, fees and tip are shared out in
              proportion, so nobody pays them on somebody else&rsquo;s round.
            </p>

            <div className="flex flex-col gap-2.5">
              {members.map((m) => {
                const owed = receipt?.valid ? receipt.owedByMember.get(m.id) : undefined;
                return (
                  <div key={m.id} className="flex items-center gap-2 sm:gap-3">
                    {/* Decoration on a row this tight. The name is the thing
                        that identifies somebody, so it gets the width. */}
                    <span className="hidden sm:block">
                      <Avatar
                        name={m.name}
                        className="h-7 w-7 shrink-0 text-[11px]"
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px]">
                      {m.id === meId ? "You" : m.name}
                    </span>
                    <div className="relative w-[92px] shrink-0 sm:w-[104px]">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--text-faint)]">
                        $
                      </span>
                      <Input
                        inputMode="decimal"
                        aria-label={`What ${m.name} had`}
                        placeholder="0.00"
                        className="tnum h-10 pl-6 text-[16px]"
                        value={orderAmounts[m.id] ?? ""}
                        onChange={(e) => setOrderAmount(m.id, e.target.value)}
                      />
                    </div>
                    {/* Their real total, tax and tip folded in, right where
                        they typed. It answers "so what do I actually owe"
                        without anybody scrolling to a summary. */}
                    <span className="tnum w-[62px] shrink-0 text-right text-[13px] font-medium sm:w-[72px]">
                      {owed ? formatCents(owed) : ""}
                    </span>
                  </div>
                );
              })}

              {guests.map((g) => {
                const sponsor = members.find((m) => m.id === g.sponsorUserId);
                return (
                  <div key={g.id} className="flex items-center gap-2 sm:gap-3">
                    <span className="hidden sm:block">
                      <Avatar
                        name={g.name}
                        className="h-7 w-7 shrink-0 text-[11px]"
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px]">
                      {g.name}{" "}
                      <span className="text-[12px] text-[var(--text-muted)]">
                        guest
                      </span>
                    </span>
                    <div className="relative w-[92px] shrink-0 sm:w-[104px]">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--text-faint)]">
                        $
                      </span>
                      <Input
                        inputMode="decimal"
                        aria-label={`What ${g.name} had`}
                        placeholder="0.00"
                        className="tnum h-10 pl-6 text-[16px]"
                        value={orderAmounts[g.id] ?? ""}
                        onChange={(e) => setOrderAmount(g.id, e.target.value)}
                      />
                    </div>
                    <span className="w-[62px] shrink-0 truncate text-right text-[12px] text-[var(--text-muted)] sm:w-[72px]">
                      {sponsor
                        ? `on ${sponsor.id === meId ? "you" : sponsor.name.split(" ")[0]}`
                        : ""}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* A receipt lists items, not people, so working down it line by
                line has to be possible or the person holding it ends up doing
                the adding up in their head. An item put on one person is
                simply theirs; on several, it is split between them. One
                mechanism covers both, and the maths does not care which. */}
            <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-medium">Items</span>
                <button
                  type="button"
                  onClick={addSharedItem}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-strong)] px-2.5 text-[13px] font-medium text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-subtle)] hover:text-[var(--text)]"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Add
                </button>
              </div>

              {sharedItems.length === 0 ? (
                <p className="text-[12px] text-[var(--text-muted)]">
                  Work down the bill line by line, or just add what the group
                  shared: a lane, a bottle, a cart, an appetiser. Put each one
                  on one person or on several, and anything on several is
                  divided evenly between them.
                </p>
              ) : (
                sharedItems.map((item, index) => {
                  const sharers = item.sharedBy;
                  const parts = receipt?.valid
                    ? (receipt.breakdown.sharedSplits[index] ?? [])
                    : [];
                  const cents = parts.map((part) => part.cents);
                  const low = cents.length > 0 ? Math.min(...cents) : null;
                  const high = cents.length > 0 ? Math.max(...cents) : null;
                  const open = openSharers === item.id;

                  return (
                    <div
                      key={item.id}
                      className="rounded-lg border border-[var(--border)] p-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          aria-label="What it was"
                          placeholder="What it was"
                          maxLength={60}
                          className="h-10 min-w-0 flex-1 text-[16px]"
                          value={item.label}
                          onChange={(e) =>
                            updateSharedItem(item.id, { label: e.target.value })
                          }
                        />
                        <div className="relative w-[92px] shrink-0">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--text-faint)]">
                            $
                          </span>
                          <Input
                            inputMode="decimal"
                            aria-label="How much it came to"
                            placeholder="0.00"
                            className="tnum h-10 pl-6 text-[16px]"
                            value={item.amount}
                            onChange={(e) =>
                              updateSharedItem(item.id, { amount: e.target.value })
                            }
                          />
                        </div>
                        <IconButton
                          label={`Remove ${item.label.trim() || "item"}`}
                          onClick={() => removeSharedItem(item.id)}
                          className="hover:text-[var(--negative)]"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </IconButton>
                      </div>

                      <button
                        type="button"
                        onClick={() => setOpenSharers(open ? null : item.id)}
                        aria-expanded={open}
                        className="mt-1.5 flex w-full cursor-pointer items-center justify-between gap-2 text-left text-[12px] text-[var(--text-muted)] transition-colors duration-150 hover:text-[var(--text)]"
                      >
                        <span className="truncate">
                          {sharers.length === 0
                            ? "Whose was it?"
                            : `${sharers.length} way${sharers.length === 1 ? "" : "s"}: ${sharers
                                .map(
                                  (id) =>
                                    billPeople.find((person) => person.id === id)
                                      ?.name ?? "?"
                                )
                                .join(", ")}`}
                        </span>
                        <span className="tnum shrink-0">
                          {low === null
                            ? ""
                            : low === high
                              ? `${formatCents(low)} each`
                              : `${formatCents(low)} or ${formatCents(high!)} each`}
                        </span>
                      </button>

                      {open && (
                        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[var(--border)] pt-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateSharedItem(item.id, {
                                sharedBy: billPeople.map((person) => person.id),
                              })
                            }
                            className="inline-flex h-9 cursor-pointer items-center rounded-full border border-[var(--border-strong)] px-3 text-[13px] font-medium text-[var(--text-muted)] transition-colors duration-150 hover:bg-[var(--surface-subtle)] hover:text-[var(--text)]"
                          >
                            Everyone
                          </button>
                          {billPeople.map((person) => {
                            const on = sharers.includes(person.id);
                            return (
                              <button
                                key={person.id}
                                type="button"
                                aria-pressed={on}
                                onClick={() => toggleSharer(item, person.id)}
                                className={cx(
                                  "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors duration-150",
                                  on
                                    ? "border-[var(--brand)] bg-[var(--brand-subtle)] text-[var(--brand)]"
                                    : "border-[var(--border-strong)] text-[var(--text-muted)] hover:bg-[var(--surface-subtle)]"
                                )}
                              >
                                {on && <CheckIcon className="h-2.5 w-2.5" />}
                                {person.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="grid gap-3 border-t border-[var(--border)] pt-3 sm:grid-cols-2">
              <Field label="Tax or fees">
                {({ id }) => (
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-[var(--text-faint)]">
                      $
                    </span>
                    <Input
                      id={id}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="tnum pl-7"
                      value={taxInput}
                      onChange={(e) => {
                        setTaxInput(e.target.value);
                        if (errors.split) setErrors((p) => ({ ...p, split: undefined }));
                      }}
                    />
                  </div>
                )}
              </Field>

              <Field label="Tip">
                {({ id }) => (
                  <>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-[var(--text-faint)]">
                        $
                      </span>
                      <Input
                        id={id}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="tnum pl-7"
                        value={tipInput}
                        onChange={(e) => {
                          setTipInput(e.target.value);
                          if (errors.split) setErrors((p) => ({ ...p, split: undefined }));
                        }}
                      />
                    </div>
                    {/* Nobody wants to work out 18% of $214.60 at a table. */}
                    <div className="mt-2 flex gap-1.5">
                      {[15, 18, 20].map((percent) => (
                        <button
                          key={percent}
                          type="button"
                          onClick={() => applyTipPercent(percent)}
                          disabled={!receipt?.valid || receipt.food === 0}
                          className={cx(
                            "h-10 flex-1 cursor-pointer rounded-lg border border-[var(--border-strong)] text-[13px] font-medium",
                            "text-[var(--text-muted)] transition-colors duration-150",
                            "hover:bg-[var(--surface-subtle)] hover:text-[var(--text)]",
                            "disabled:cursor-not-allowed disabled:opacity-40"
                          )}
                        >
                          {percent}%
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </Field>

              <Field label="Discount" hint="A coupon, a comp, a group rate">
                {({ id }) => (
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-[var(--text-faint)]">
                      &minus;$
                    </span>
                    <Input
                      id={id}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="tnum pl-9"
                      value={discountInput}
                      onChange={(e) => {
                        setDiscountInput(e.target.value);
                        if (errors.split) setErrors((p) => ({ ...p, split: undefined }));
                      }}
                    />
                  </div>
                )}
              </Field>
            </div>

            {receipt?.valid && receipt.food > 0 && (
              <dl className="tnum flex flex-col gap-1 rounded-lg bg-[var(--surface-subtle)] p-3 text-[13px]">
                {(() => {
                  const sharedCents = receipt.breakdown.lines.reduce(
                    (sum, line) => sum + line.sharedCents,
                    0
                  );
                  return sharedCents > 0 ? (
                    <>
                      <div className="flex justify-between">
                        <dt className="text-[var(--text-muted)]">Own orders</dt>
                        <dd>{formatCents(receipt.food - sharedCents)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-[var(--text-muted)]">Shared</dt>
                        <dd>{formatCents(sharedCents)}</dd>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between">
                      <dt className="text-[var(--text-muted)]">Food</dt>
                      <dd>{formatCents(receipt.food)}</dd>
                    </div>
                  );
                })()}
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">Tax</dt>
                  <dd>{formatCents(receipt.tax)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">Tip</dt>
                  <dd>{formatCents(receipt.tip)}</dd>
                </div>
                {receipt.discount > 0 && (
                  <div className="flex justify-between text-[var(--positive)]">
                    <dt>Discount</dt>
                    <dd>&minus;{formatCents(receipt.discount)}</dd>
                  </div>
                )}
                <div className="mt-1 flex justify-between border-t border-[var(--border)] pt-1.5 font-semibold">
                  <dt>Total</dt>
                  <dd>{formatCents(receipt.total)}</dd>
                </div>
              </dl>
            )}

            {/* Everything above is only as right as what was typed in. Putting
                the printed total in makes the form check itself, which is how
                a line nobody entered gets caught before anyone is charged. */}
            {receipt?.valid && receipt.food > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <label
                    htmlFor={checkId}
                    className="min-w-0 flex-1 text-[12px] text-[var(--text-muted)]"
                  >
                    Check against the printed total
                  </label>
                  <div className="relative w-[104px] shrink-0">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[var(--text-faint)]">
                      $
                    </span>
                    <Input
                      id={checkId}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="tnum h-10 pl-6 text-[16px]"
                      value={receiptTotalInput}
                      onChange={(e) => setReceiptTotalInput(e.target.value)}
                    />
                  </div>
                </div>
                {(() => {
                  const typed = receiptTotalInput.trim();
                  if (typed === "") return null;
                  const printed = parseDollarsToCents(typed);
                  if (printed === null) {
                    return (
                      <p className="text-[12px] text-[var(--text-muted)]">
                        Use a number like 124.50, with no symbols.
                      </p>
                    );
                  }
                  const diff = printed - receipt.total;
                  if (diff === 0) {
                    return (
                      <p className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--positive)]">
                        <CheckIcon className="h-3 w-3 shrink-0" />
                        Matches the bill exactly.
                      </p>
                    );
                  }
                  return (
                    <p className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--warning)]">
                      <AlertIcon className="h-3.5 w-3.5 shrink-0" />
                      {diff > 0
                        ? `${formatCents(diff)} on the bill is not accounted for yet.`
                        : `${formatCents(-diff)} more than the bill says.`}
                    </p>
                  );
                })()}
              </div>
            )}

            {/* What is wrong, while it is wrong, rather than only on save. */}
            {receipt && !receipt.valid && receipt.reason && (
              <p className="text-[12px] text-[var(--text-muted)]">
                {receipt.reason}
              </p>
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
