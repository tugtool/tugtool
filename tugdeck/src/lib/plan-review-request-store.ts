/**
 * plan-review-request-store.ts — the latch a broadcast `plan_review_request`
 * lands in, keyed by card.
 *
 * The signal is a server broadcast, and a broadcast reaches a card exactly one
 * way here: a dispatch-time handler in `action-dispatch.ts` resolves the
 * session id to a card and writes a store, which the card reads. The card
 * never subscribes to a frame. That indirection is not ceremony — the request
 * routinely arrives while the devise turn is still running, and it must
 * survive being latched before the card's controller exists to see it.
 *
 * At most one request per card: a second signal replaces the first, because
 * two plans cannot both be the one the next turn reviews.
 *
 * @module lib/plan-review-request-store
 */

/** A plan waiting for its review turn. */
export interface PlanReviewRequest {
  /** Absolute path to the plan, as the CLI resolved it. */
  readonly planPath: string;
  /** Bumped on every latch, so two requests for the same path still notify. */
  readonly seq: number;
}

class PlanReviewRequestStore {
  private _requests = new Map<string, PlanReviewRequest>();
  private _listeners: Array<() => void> = [];
  private _seq = 0;

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.push(listener);
    return () => {
      const i = this._listeners.indexOf(listener);
      if (i >= 0) this._listeners.splice(i, 1);
    };
  };

  /** The pending request for `cardId`, or null. Does not clear it. */
  requestFor = (cardId: string): PlanReviewRequest | null =>
    this._requests.get(cardId) ?? null;

  /** Park a request for `cardId` and wake the readers. */
  latch = (cardId: string, planPath: string): void => {
    this._seq += 1;
    this._requests.set(cardId, { planPath, seq: this._seq });
    this._notify();
  };

  /** Read and clear — the controller taking ownership of the request. */
  take = (cardId: string): PlanReviewRequest | null => {
    const request = this._requests.get(cardId) ?? null;
    if (request !== null) {
      this._requests.delete(cardId);
      this._notify();
    }
    return request;
  };

  /** Drop a request without acting on it. */
  clear = (cardId: string): void => {
    if (this._requests.delete(cardId)) this._notify();
  };

  private _notify(): void {
    for (const listener of [...this._listeners]) listener();
  }
}

export const planReviewRequestStore = new PlanReviewRequestStore();

/** Test-only: forget every latched request so suites run hermetically. */
export function _resetPlanReviewRequestStoreForTest(): void {
  for (const cardId of [...(planReviewRequestStore as never as {
    _requests: Map<string, PlanReviewRequest>;
  })._requests.keys()]) {
    planReviewRequestStore.clear(cardId);
  }
}
