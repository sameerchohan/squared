// Exactly-once webhook processing, independent of Stripe and the database so
// the guarantee itself is unit-testable.
//
// The invariant: recording the event id and applying the event's side effects
// happen in ONE transaction.
//
// - Duplicate delivery: the ledger insert hits the primary key
//   (INSERT ... ON CONFLICT DO NOTHING inserts no row), so the handler is
//   skipped entirely and the webhook returns 200.
// - Handler failure: the transaction rolls back, which also removes the
//   ledger row — so Stripe's retry finds an unrecorded event and processing
//   runs again. Recording the event outside the transaction would instead
//   mark a failed event as done and silently drop it.

export type WebhookEvent = { id: string; type: string };

export type IdempotencyDeps<Tx> = {
  /** Run `fn` in a transaction; throwing must roll everything back. */
  withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /**
   * Record the event id inside `tx`; returns false if it was already
   * recorded (i.e. this delivery is a duplicate).
   */
  recordEventOnce(tx: Tx, event: WebhookEvent): Promise<boolean>;
};

export async function processEventOnce<Tx>(
  deps: IdempotencyDeps<Tx>,
  event: WebhookEvent,
  handle: (tx: Tx) => Promise<void>
): Promise<"processed" | "duplicate"> {
  return deps.withTransaction(async (tx) => {
    const isNew = await deps.recordEventOnce(tx, event);
    if (!isNew) {
      return "duplicate";
    }
    await handle(tx);
    return "processed";
  });
}
