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
  },
  (t) => [
    unique("expense_shares_expense_user_unique").on(t.expenseId, t.userId),
    index("expense_shares_user_id_idx").on(t.userId),
    check("expense_shares_owed_non_negative_check", sql`${t.owedCents} >= 0`),
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
