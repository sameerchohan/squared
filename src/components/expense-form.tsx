"use client";

import { useMemo, useState } from "react";
import { Alert, Avatar, Button, Field, Input, Select, cx } from "./ui";
import { AlertIcon, CheckIcon } from "./icons";
import { formatCents, parseDollarsToCents } from "@/lib/format";

export type SplitType = "equal" | "exact" | "percentage";
export type FormMember = { id: string; name: string };

export type ExpenseDraft = {
  description: string;
  amountCents: number;
  paidBy: string;
  splitType: SplitType;
  shares: { userId: string; owedCents: number }[];
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
  meId,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  members: FormMember[];
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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const split =
      splitType === "equal"
        ? { type: "equal", participants: [...participants] }
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
