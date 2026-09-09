import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// All money values are integer cents (USD only for now). Floats never touch
// monetary math anywhere in the codebase.

export const SPLIT_TYPES = ["equal", "exact", "percentage"] as const;
export type SplitType = (typeof SPLIT_TYPES)[number];

export const ONBOARDING_STATUSES = [
  "not_started",
  "pending",
  "active",
  "restricted",
] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const SETTLEMENT_STATUSES = [
  "pending",
  "processing",
  "succeeded",
  "failed",
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

// How the money actually moved. "stripe" settlements are created pending and
// only reach succeeded when a webhook says the charge cleared. "cash" ones
// record a transfer that happened somewhere Squared cannot observe (Venmo,
// notes, a bank app), so they are recorded already succeeded on the word of
// the payer.
export const SETTLEMENT_METHODS = ["stripe", "cash"] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    stripeAccountId: text("stripe_account_id").unique(),
    stripeOnboardingStatus: text("stripe_onboarding_status")
      .notNull()
      .default("not_started"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "users_onboarding_status_check",
      sql`${t.stripeOnboardingStatus} IN ('not_started', 'pending', 'active', 'restricted')`
    ),
  ]
);

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index("group_members_user_id_idx").on(t.userId),
  ]
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    paidBy: uuid("paid_by")
      .notNull()
      .references(() => users.id),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    splitType: text("split_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("expenses_group_id_idx").on(t.groupId),
    check("expenses_amount_positive_check", sql`${t.amountCents} > 0`),
    check(
      "expenses_split_type_check",
      sql`${t.splitType} IN ('equal', 'exact', 'percentage')`
    ),
  ]
);

export const expenseShares = pgTable(
  "expense_shares",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    owedCents: integer("owed_cents").notNull(),
    // How many shares of an equal split this row pays for: their own, plus
    // one for every guest they sponsor and every member they cover. Stored
    // rather than inferred, because rounding means a doubled share is not
    // exactly twice a single one and the edit form has to round-trip.
    // Always 1 for exact and percentage splits, where it carries no meaning.
    shareCount: integer("share_count").notNull().default(1),
    // Set when another member is paying this member's share. The row stays so
    // the expense still shows they were there, owing nothing.
    coveredBy: uuid("covered_by").references(() => users.id),
  },
  (t) => [
    unique("expense_shares_expense_user_unique").on(t.expenseId, t.userId),
    index("expense_shares_user_id_idx").on(t.userId),
    check("expense_shares_owed_non_negative_check", sql`${t.owedCents} >= 0`),
    check(
      "expense_shares_share_count_non_negative_check",
      sql`${t.shareCount} >= 0`
    ),
    check(
      "expense_shares_covered_not_self_check",
      sql`${t.coveredBy} IS NULL OR ${t.coveredBy} <> ${t.userId}`
    ),
    // A covered member pays nothing, by definition. Enforced here so no code
    // path can leave a row that claims to be covered and still owes money.
    check(
      "expense_shares_covered_pays_nothing_check",
      sql`${t.coveredBy} IS NULL OR (${t.shareCount} = 0 AND ${t.owedCents} = 0)`
    ),
  ]
);

// Someone on the trip who has no Squared account. A guest never owes money
// themselves — they have no way to pay it — so their portion of an expense is
// folded into their sponsor's expense_shares row. That is what keeps the
// balance engine, debt simplification and Stripe payouts untouched by this:
// downstream, a sponsor simply owes more.
export const groupGuests = pgTable(
  "group_guests",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sponsorUserId: uuid("sponsor_user_id")
      .notNull()
      .references(() => users.id),
    // Guests are archived, never deleted. Their share is already baked into
    // the owed_cents of past expenses, and the name is the only thing that
    // makes those rows readable a month later.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("group_guests_group_id_idx").on(t.groupId),
    index("group_guests_sponsor_user_id_idx").on(t.sponsorUserId),
  ]
);

// Which guests were counted in a given expense. Needed so editing an expense
// round-trips, and so the expense detail can name who the extra shares were
// for instead of showing a bare multiplier.
export const expenseGuestShares = pgTable(
  "expense_guest_shares",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    guestId: uuid("guest_id")
      .notNull()
      .references(() => groupGuests.id),
    // Snapshot of who covered this guest when the expense was recorded. A
    // guest's sponsor can be reassigned later; what the ledger charged then
    // must not move with it.
    sponsorUserId: uuid("sponsor_user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    unique("expense_guest_shares_expense_guest_unique").on(
      t.expenseId,
      t.guestId
    ),
    index("expense_guest_shares_guest_id_idx").on(t.guestId),
  ]
);

// group_id intentionally does NOT cascade: settlements are money-movement
// records and must survive attempts to delete their group.
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id),
    fromUser: uuid("from_user")
      .notNull()
      .references(() => users.id),
    toUser: uuid("to_user")
      .notNull()
      .references(() => users.id),
    amountCents: integer("amount_cents").notNull(),
    method: text("method").notNull().default("stripe"),
    // The Checkout session is created with the settlement and is the
    // correlation key for webhooks; the payment intent and transfer ids only
    // become known once the payer completes checkout.
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
    stripeTransferId: text("stripe_transfer_id").unique(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("settlements_group_id_idx").on(t.groupId),
    index("settlements_from_user_idx").on(t.fromUser),
    index("settlements_to_user_idx").on(t.toUser),
    check("settlements_amount_positive_check", sql`${t.amountCents} > 0`),
    check("settlements_distinct_parties_check", sql`${t.fromUser} <> ${t.toUser}`),
    check(
      "settlements_status_check",
      sql`${t.status} IN ('pending', 'processing', 'succeeded', 'failed')`
    ),
    check("settlements_method_check", sql`${t.method} IN ('stripe', 'cash')`),
  ]
);

// Idempotency ledger for Stripe webhooks. Handlers INSERT ... ON CONFLICT DO
// NOTHING on the event id and skip processing when the row already existed.
//
// Only the id and type are stored. Event payloads carry personal data
// (names, addresses, bank details) that Stripe already retains and exposes in
// its dashboard, so copying them here would add compliance surface without
// adding capability.
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
