import { describe, expect, it } from "vitest";
import {
  processEventOnce,
  type IdempotencyDeps,
  type WebhookEvent,
} from "./webhook-idempotency";

// In-memory stand-in for Postgres with real transaction semantics: writes go
// to a staging set that is only merged into the ledger on commit and thrown
// away on rollback — the exact behavior the idempotency guarantee relies on.
type FakeTx = { staged: Set<string> };

function makeFakeDb() {
  const ledger = new Set<string>();
  const deps: IdempotencyDeps<FakeTx> = {
    async withTransaction(fn) {
      const tx: FakeTx = { staged: new Set() };
      const result = await fn(tx); // a throw skips the commit below
      for (const id of tx.staged) ledger.add(id);
      return result;
    },
    async recordEventOnce(tx, event) {
      if (ledger.has(event.id) || tx.staged.has(event.id)) return false;
      tx.staged.add(event.id);
      return true;
    },
  };
  return { ledger, deps };
}

const event = (id: string): WebhookEvent => ({ id, type: "account.updated" });

describe("processEventOnce", () => {
  it("processes a new event and records it", async () => {
    const { ledger, deps } = makeFakeDb();
    let handled = 0;

    const result = await processEventOnce(deps, event("evt_1"), async () => {
      handled++;
    });

    expect(result).toBe("processed");
    expect(handled).toBe(1);
    expect(ledger.has("evt_1")).toBe(true);
  });

  it("skips the handler entirely on a duplicate delivery", async () => {
    const { deps } = makeFakeDb();
    let handled = 0;
    const handle = async () => {
      handled++;
    };

    await processEventOnce(deps, event("evt_1"), handle);
    const second = await processEventOnce(deps, event("evt_1"), handle);

    expect(second).toBe("duplicate");
    expect(handled).toBe(1);
  });

  it("does not mark a failed event as processed, so a retry succeeds", async () => {
    const { ledger, deps } = makeFakeDb();
    let attempts = 0;
    const flakyHandler = async () => {
      attempts++;
      if (attempts === 1) throw new Error("db hiccup");
    };

    // First delivery fails; the rollback must also discard the ledger entry.
    await expect(
      processEventOnce(deps, event("evt_1"), flakyHandler)
    ).rejects.toThrow("db hiccup");
    expect(ledger.has("evt_1")).toBe(false);

    // Stripe retries the same event id: it must be processed, not skipped.
    const retry = await processEventOnce(deps, event("evt_1"), flakyHandler);
    expect(retry).toBe("processed");
    expect(attempts).toBe(2);
    expect(ledger.has("evt_1")).toBe(true);
  });

  it("treats distinct event ids independently", async () => {
    const { deps } = makeFakeDb();
    const seen: string[] = [];

    for (const id of ["evt_a", "evt_b", "evt_a"]) {
      await processEventOnce(deps, event(id), async () => {
        seen.push(id);
      });
    }

    expect(seen).toEqual(["evt_a", "evt_b"]);
  });
});
