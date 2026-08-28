// Seeds a realistic demo dataset: three groups with different shapes, so the
// balance simplification has something interesting to solve and the UI shows
// real variety rather than one rent payment.
//
//   node scripts/seed.mjs            add to whatever is already there
//   node scripts/seed.mjs --reset    wipe app data first
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { hash } from "bcryptjs";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: true },
});
const db = drizzle(pool);

const PASSWORD = "demo1234";

const PEOPLE = [
  { key: "maya", name: "Maya Okonkwo", email: "maya@squared.demo" },
  { key: "daniel", name: "Daniel Reyes", email: "daniel@squared.demo" },
  { key: "priya", name: "Priya Raman", email: "priya@squared.demo" },
  { key: "tom", name: "Tom Whitfield", email: "tom@squared.demo" },
  { key: "sofia", name: "Sofia Marchetti", email: "sofia@squared.demo" },
];

// Largest-remainder apportionment, matching src/lib/splits.ts so seeded rows
// are identical to what the app itself would have written.
function apportion(amountCents, weights) {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  const rows = weights.map(({ key, weight }, index) => {
    const exact = amountCents * weight;
    return {
      key,
      index,
      owed: Math.floor(exact / total),
      remainder: exact % total,
    };
  });
  let left = amountCents - rows.reduce((s, r) => s + r.owed, 0);
  for (const r of [...rows].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (left === 0) break;
    r.owed += 1;
    left -= 1;
  }
  return rows.sort((a, b) => a.index - b.index);
}

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

const GROUPS = [
  {
    name: "Lisbon, October",
    owner: "maya",
    members: ["maya", "daniel", "priya", "tom", "sofia"],
    expenses: [
      { desc: "Airbnb in Alfama (4 nights)", cents: 128_400, by: "maya", split: "equal", days: 21 },
      { desc: "Flights — group booking", cents: 214_500, by: "daniel", split: "equal", days: 20 },
      { desc: "Rental car + insurance", cents: 31_200, by: "tom", split: "equal", days: 18 },
      { desc: "Dinner at Time Out Market", cents: 18_640, by: "priya", split: "equal", days: 17 },
      // Sofia doesn't drink, so the bar tab is an exact split.
      { desc: "Bar tab, Bairro Alto", cents: 9_450, by: "sofia", split: "exact",
        exact: { maya: 2_400, daniel: 2_800, priya: 2_250, tom: 2_000, sofia: 0 }, days: 16 },
      { desc: "Sintra day trip tickets", cents: 14_000, by: "maya", split: "equal", days: 15 },
      { desc: "Groceries for the flat", cents: 8_730, by: "sofia", split: "equal", days: 14 },
      { desc: "Airport transfer home", cents: 6_800, by: "daniel", split: "equal", days: 13 },
    ],
    settlements: [
      { from: "tom", to: "daniel", cents: 40_000, status: "succeeded", days: 9 },
      { from: "priya", to: "maya", cents: 25_000, status: "succeeded", days: 7 },
      { from: "sofia", to: "daniel", cents: 15_000, status: "processing", days: 1 },
    ],
  },
  {
    name: "Apartment 4B",
    owner: "daniel",
    members: ["daniel", "priya", "tom"],
    expenses: [
      // Tom has the small room, so rent is split by percentage.
      { desc: "November rent", cents: 285_000, by: "daniel", split: "percentage",
        percent: { daniel: 37.5, priya: 37.5, tom: 25 }, days: 12 },
      { desc: "Electricity & gas", cents: 14_280, by: "priya", split: "equal", days: 11 },
      { desc: "Internet", cents: 5_500, by: "tom", split: "equal", days: 11 },
      { desc: "Costco run", cents: 21_365, by: "priya", split: "equal", days: 6 },
      { desc: "Plumber — kitchen sink", cents: 18_000, by: "daniel", split: "equal", days: 4 },
      { desc: "Cleaning supplies", cents: 4_215, by: "tom", split: "equal", days: 2 },
    ],
    settlements: [
      { from: "tom", to: "daniel", cents: 60_000, status: "succeeded", days: 5 },
    ],
  },
  {
    name: "Thursday Climbing",
    owner: "priya",
    members: ["priya", "maya", "sofia"],
    expenses: [
      { desc: "Day passes ×3", cents: 7_500, by: "priya", split: "equal", days: 8 },
      { desc: "Shoe rental", cents: 3_600, by: "maya", split: "equal", days: 8 },
      { desc: "Post-session tacos", cents: 5_240, by: "sofia", split: "equal", days: 8 },
      { desc: "Chalk + tape", cents: 1_875, by: "priya", split: "equal", days: 1 },
    ],
    settlements: [],
  },
];

async function main() {
  const reset = process.argv.includes("--reset");
  if (reset) {
    // Order matters: children before parents, and settlements before groups
    // since that foreign key deliberately has no cascade.
    await db.execute(sql`DELETE FROM stripe_events`);
    await db.execute(sql`DELETE FROM settlements`);
    await db.execute(sql`DELETE FROM expense_shares`);
    await db.execute(sql`DELETE FROM expenses`);
    await db.execute(sql`DELETE FROM group_members`);
    await db.execute(sql`DELETE FROM groups`);
    await db.execute(sql`DELETE FROM users`);
    console.log("cleared existing data");
  }

  const passwordHash = await hash(PASSWORD, 10);
  const ids = {};
  for (const person of PEOPLE) {
    const rows = await db.execute(sql`
      INSERT INTO users (email, password_hash, name, stripe_onboarding_status)
      VALUES (${person.email}, ${passwordHash}, ${person.name}, 'not_started')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `);
    ids[person.key] = rows.rows[0].id;
  }
  console.log(`${PEOPLE.length} people`);

  for (const group of GROUPS) {
    const g = await db.execute(sql`
      INSERT INTO groups (name, created_by, created_at)
      VALUES (${group.name}, ${ids[group.owner]}, ${daysAgo(30)})
      RETURNING id
    `);
    const groupId = g.rows[0].id;

    for (const key of group.members) {
      await db.execute(sql`
        INSERT INTO group_members (group_id, user_id, joined_at)
        VALUES (${groupId}, ${ids[key]}, ${daysAgo(30)})
        ON CONFLICT DO NOTHING
      `);
    }

    for (const e of group.expenses) {
      const rows =
        e.split === "equal"
          ? apportion(e.cents, group.members.map((key) => ({ key, weight: 1 })))
          : e.split === "percentage"
            ? apportion(
                e.cents,
                group.members.map((key) => ({ key, weight: Math.round(e.percent[key] * 100) }))
              )
            : group.members.map((key) => ({ key, owed: e.exact[key] ?? 0 }));

      const ex = await db.execute(sql`
        INSERT INTO expenses (group_id, paid_by, description, amount_cents, split_type, created_at)
        VALUES (${groupId}, ${ids[e.by]}, ${e.desc}, ${e.cents}, ${e.split}, ${daysAgo(e.days)})
        RETURNING id
      `);
      const expenseId = ex.rows[0].id;

      for (const row of rows) {
        await db.execute(sql`
          INSERT INTO expense_shares (expense_id, user_id, owed_cents)
          VALUES (${expenseId}, ${ids[row.key]}, ${row.owed})
        `);
      }
    }

    for (const s of group.settlements) {
      await db.execute(sql`
        INSERT INTO settlements (group_id, from_user, to_user, amount_cents, status, created_at, updated_at)
        VALUES (${groupId}, ${ids[s.from]}, ${ids[s.to]}, ${s.cents}, ${s.status},
                ${daysAgo(s.days)}, ${daysAgo(s.days)})
      `);
    }

    console.log(
      `${group.name}: ${group.members.length} members, ${group.expenses.length} expenses, ${group.settlements.length} settlements`
    );
  }

  console.log(`\nSign in as any of these — password: ${PASSWORD}`);
  for (const p of PEOPLE) console.log(`  ${p.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
