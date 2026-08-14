/**
 * plan-review-controller — borrow a model for one review turn, and give it back.
 *
 * After `devise` writes a plan it signals the card, and the card runs the
 * review as a second turn in the same session on the review model. This
 * controller is the machine that does it: it reads the latched request
 * ([plan-review-request-store.ts]), waits for the turn in flight to settle,
 * borrows the model without touching persistence, submits
 * `/tugplug:review-plan <path>` as a command atom, and releases on that turn's
 * settle — completed, errored, interrupted, or unmounted.
 *
 * **The request arrives mid-turn, always.** `devise` fires the signal from
 * inside its own turn, so the frame lands while `canSubmit` is false. That is
 * the happy path, not a gate failure: the request parks and acts when the turn
 * settles. It is also the only ordering that works with the model gate, since
 * `useModel`'s `setModel` declines mid-turn by design ([L28] — a control acts
 * on a lifecycle by subscribing to its published state, never by reaching into
 * a running turn).
 *
 * **Three beats, not two.** There is no turn-settled event to subscribe to;
 * `CodeSessionStore` publishes a phase, and at the instant `send()` returns
 * that phase has not moved. A machine that released on "next idle" would give
 * the model back milliseconds after taking it and run the whole review on the
 * model it just returned. So `armed` (submitted, turn not yet observed) →
 * `running` (the turn started) → release on the transition out of `running`.
 *
 * Laws: [L02] every reader goes through the subscribable snapshot; [L27] every
 * subscription taken here is returned by `dispose()`; [L28] the borrow acts on
 * the turn lifecycle only by observing what the session publishes.
 *
 * @module lib/plan-review-controller
 */

import type { CodeSessionStore } from "@/lib/code-session-store";
import type {
  CapabilityModel,
  SessionMetadataStore,
} from "@/lib/session-metadata-store";
import type { CodeSessionPhase } from "@/lib/code-session-store/types";
import { buildCommandSubmission } from "@/lib/slash-commands";
import { knownModelRows } from "@/lib/model-label";
import { readModelCatalog } from "@/lib/model-catalog";
import { resolveCatalogSelector } from "@/lib/model-selector";
import {
  DEFAULT_PLAN_REVIEW_SELECTOR,
  PLAN_REVIEW_DOMAIN,
  PLAN_REVIEW_MODEL_KEY,
} from "@/lib/model-domains";
import { getTugbankClient } from "@/lib/tugbank-singleton";
import {
  borrowModel,
  currentModelSelector,
  releaseModel,
  resolvesToSameModel,
  type ModelBorrow,
} from "@/lib/use-model";
import { planReviewRequestStore } from "@/lib/plan-review-request-store";

/** The skill the review turn invokes. */
export const REVIEW_PLAN_COMMAND = "tugplug:review-plan";

/**
 * Where the machine is. `borrowedFrom` is the **selector** captured before the
 * borrow — `null` when no borrow happened, which is either "the session was
 * already on the review model's catalog row" or "the catalog could not resolve
 * the review selector at all".
 */
export type PlanReviewPhase =
  | { kind: "idle" }
  | { kind: "parked"; planPath: string }
  | { kind: "armed"; planPath: string; borrowedFrom: string | null }
  | { kind: "running"; planPath: string; borrowedFrom: string | null };

/** Why a review request was refused. */
export type PlanReviewGate =
  | { ok: true }
  | { ok: false; reason: "already-reviewing" | "model-unknown" };

/**
 * Whether a review request may act, and if not, why.
 *
 * Two inputs an earlier shape carried are deliberately absent. A turn in
 * flight is not a reason: it is the *expected* state when the request arrives,
 * so it parks rather than failing. Nor is an unresolvable review selector —
 * that means "run the review without borrowing", plus a one-time notice, not
 * "do not review".
 *
 * The controller runs this on arrival, against the phase the card is already
 * in. It is not re-run when a parked request submits: the only phase in the
 * way at that point is that request's own park.
 */
export function evaluatePlanReviewGate(input: {
  /** The card's current phase. */
  phase: PlanReviewPhase;
  /** Whether the session's current model is knowable at all. */
  sessionModelKnown: boolean;
}): PlanReviewGate {
  if (input.phase.kind !== "idle") {
    return { ok: false, reason: "already-reviewing" };
  }
  if (!input.sessionModelKnown) return { ok: false, reason: "model-unknown" };
  return { ok: true };
}

/**
 * Whether the session's current model is knowable — either the live capability
 * list is up (a new session, on the account default) or a model id has
 * resolved (a resume replayed). The same readiness the mount-restore waits on.
 */
export function sessionModelKnown(snapshot: {
  models: CapabilityModel[];
  model: string | null;
}): boolean {
  return snapshot.models.length > 0 || snapshot.model !== null;
}

/** A turn is over — completed, or ended in an error. */
function isSettledPhase(phase: CodeSessionPhase): boolean {
  return phase === "idle" || phase === "errored";
}

/** The selector a review borrows: the tugbank default, else the shipped seed. */
export function readPlanReviewSelector(): string {
  const entry = getTugbankClient()?.get(PLAN_REVIEW_DOMAIN, PLAN_REVIEW_MODEL_KEY);
  if (entry?.kind === "string" && typeof entry.value === "string") {
    const trimmed = entry.value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return DEFAULT_PLAN_REVIEW_SELECTOR;
}

/** What the card is told, so it can put it on a pane bulletin ([L06]). */
export interface PlanReviewNotice {
  kind: "announce" | "caution";
  message: string;
  detail?: string;
}

export interface PlanReviewControllerDeps {
  /** The card whose session runs the review. */
  cardId: string;
  codeSessionStore: CodeSessionStore;
  sessionMetadataStore: SessionMetadataStore;
  /** Overridable for tests; defaults to the tugbank value. */
  reviewSelector?: () => string;
}

export class PlanReviewController {
  private readonly deps: PlanReviewControllerDeps;
  private readonly borrow: ModelBorrow;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribes: (() => void)[] = [];

  private phase: PlanReviewPhase = { kind: "idle" };
  private notifier: ((notice: PlanReviewNotice) => void) | null = null;
  private disposed = false;
  /**
   * Whether this park has already seen a settled beat it did not act on.
   *
   * A park normally begins mid-turn and ends at the first settled beat, which
   * submits — so this stays false. It flips only when the session settles
   * while `canSubmit` is false, which `canSubmit`'s definition makes precise:
   * settled **and offline**. From there a later unsettled beat is a turn
   * somebody else started, and the review must not ride in behind it.
   */
  private parkSawSettled = false;

  constructor(deps: PlanReviewControllerDeps) {
    this.deps = deps;
    this.borrow = {
      cardId: deps.cardId,
      codeSessionStore: deps.codeSessionStore,
      sessionMetadataStore: deps.sessionMetadataStore,
    };
    this.unsubscribes.push(
      planReviewRequestStore.subscribe(() => this.readRequest()),
    );
    this.unsubscribes.push(
      deps.codeSessionStore.subscribe(() => this.observeSession()),
    );
    // A request may already be latched — it is written the moment the frame
    // lands, which can be before this controller existed ([P04]).
    this.readRequest();
  }

  // ── Store surface ([L02]) ──────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PlanReviewPhase => this.phase;

  /**
   * Install (or clear with `null`) the card's notice sink. The announcement
   * and every caution go through it onto a pane bulletin — appearance, so it
   * never round-trips through React state ([L06]).
   */
  setNotifier(notifier: ((notice: PlanReviewNotice) => void) | null): void {
    this.notifier = notifier;
  }

  // ── The machine ────────────────────────────────────────────────────────

  /** A request landed in the store (or was already there). */
  private readRequest(): void {
    if (this.disposed) return;
    const pending = planReviewRequestStore.requestFor(this.deps.cardId);
    if (pending === null) return;

    const gate = evaluatePlanReviewGate({
      phase: this.phase,
      sessionModelKnown: sessionModelKnown(
        this.deps.sessionMetadataStore.getSnapshot(),
      ),
    });
    if (!gate.ok) {
      planReviewRequestStore.take(this.deps.cardId);
      this.notify({
        kind: "caution",
        message:
          gate.reason === "already-reviewing"
            ? "A plan review is already under way"
            : "Can't review the plan yet — this session's model isn't known",
        detail: pending.planPath,
      });
      return;
    }

    planReviewRequestStore.take(this.deps.cardId);
    this.parkSawSettled = false;
    this.setPhase({ kind: "parked", planPath: pending.planPath });
    // The turn that fired the signal is normally still running, but the frame
    // can also land after it settled — in which case there is nothing to wait
    // for.
    this.observeSession();
  }

  /** Every beat the session publishes runs through here ([L28]). */
  private observeSession(): void {
    if (this.disposed) return;
    const session = this.deps.codeSessionStore.getSnapshot();

    if (this.phase.kind === "parked") {
      // The user moved on: something they typed is queued to run next, so the
      // review would land after a turn they did not connect it to.
      if (session.queuedSends.length > 0) {
        this.abandonPark();
        return;
      }
      if (session.canSubmit) {
        this.submit(this.phase.planPath);
        return;
      }
      // A queue is not the only way the user gets ahead of a park. Submitting
      // from a settled session sends straight out rather than queueing, so a
      // turn can start while `queuedSends` stays empty — and the review would
      // then ride in behind a turn nobody connected it to. A park that has
      // already sat through a settled beat treats the next unsettled one as
      // exactly that.
      if (isSettledPhase(session.phase)) {
        this.parkSawSettled = true;
        return;
      }
      if (this.parkSawSettled) this.abandonPark();
      return;
    }

    if (this.phase.kind === "armed") {
      if (!isSettledPhase(session.phase)) {
        this.setPhase({ ...this.phase, kind: "running" });
      }
      return;
    }

    if (this.phase.kind === "running" && isSettledPhase(session.phase)) {
      this.release();
    }
  }

  /**
   * Capture the current selector, borrow when the rows differ, announce, and
   * send.
   *
   * `armed` is entered **first**, before the borrow and before `send()`,
   * because both notify the session store re-entrantly. Leaving the phase at
   * `parked` across the borrow means the borrow's own `model_change` re-enters
   * {@link observeSession} on a still-parked, still-submittable session — and
   * submits the review a second time. Arming first makes the machine's own
   * work invisible to itself.
   */
  private submit(planPath: string): void {
    const { codeSessionStore, sessionMetadataStore } = this.deps;
    const meta = sessionMetadataStore.getSnapshot();
    this.setPhase({ kind: "armed", planPath, borrowedFrom: null });
    if (!sessionModelKnown(meta)) {
      this.setPhase({ kind: "idle" });
      this.notify({
        kind: "caution",
        message: "Can't review the plan — this session's model isn't known",
        detail: planPath,
      });
      return;
    }

    const rows = knownModelRows(meta.models, readModelCatalog());
    const wanted = (this.deps.reviewSelector ?? readPlanReviewSelector)();
    const reviewRow = resolveCatalogSelector(wanted, rows);
    const current = currentModelSelector(meta);

    let borrowedFrom: string | null = null;
    if (reviewRow === null) {
      // Not a gate failure — the review still runs, on whatever is loaded.
      this.notify({
        kind: "caution",
        message: `Reviewing on the current model — ${wanted} isn't available`,
      });
    } else if (resolvesToSameModel(current, reviewRow.value, rows)) {
      // Same catalog row: the session already IS the review model, so a borrow
      // would flicker the chip through two pointless control requests ([P03]).
      this.notify({
        kind: "announce",
        message: `Reviewing the plan on ${modelLabel(reviewRow)}`,
      });
    } else {
      borrowedFrom = current;
      borrowModel(this.borrow, reviewRow.value);
      this.notify({
        kind: "announce",
        message: `Reviewing the plan on ${modelLabel(reviewRow)}`,
        detail: "The model goes back when the review turn ends.",
      });
    }

    if (borrowedFrom !== null) {
      this.setPhase({ kind: "armed", planPath, borrowedFrom });
    }
    const submission = buildCommandSubmission(REVIEW_PLAN_COMMAND, planPath);
    codeSessionStore.send(submission.text, submission.atoms);

    // A submission that never became a turn must not strand the borrow: if the
    // session is still settled with nothing running, there is no turn coming.
    if (
      this.phase.kind === "armed" &&
      isSettledPhase(codeSessionStore.getSnapshot().phase)
    ) {
      this.release();
    }
  }

  /** Drop a park without acting on it, and say why. Nothing was borrowed. */
  private abandonPark(): void {
    if (this.phase.kind !== "parked") return;
    const { planPath } = this.phase;
    this.parkSawSettled = false;
    this.setPhase({ kind: "idle" });
    this.notify({
      kind: "caution",
      message: "Skipped the plan review — you submitted something else",
      detail: planPath,
    });
  }

  /** Give the model back. Idempotent — a second settle sends nothing. */
  private release(): void {
    if (this.phase.kind !== "armed" && this.phase.kind !== "running") return;
    const { borrowedFrom } = this.phase;
    this.setPhase({ kind: "idle" });
    releaseModel(this.borrow, borrowedFrom);
  }

  private setPhase(next: PlanReviewPhase): void {
    this.phase = next;
    for (const listener of [...this.listeners]) listener();
  }

  private notify(notice: PlanReviewNotice): void {
    this.notifier?.(notice);
  }

  /**
   * Give the model back at the first moment the session can take it.
   *
   * `CodeSessionStore.setModel` carries no `canSubmit` gate of its own — the
   * gate lives in `useModel`, which this path deliberately does not go
   * through — so releasing into a running turn puts a `model_change` on the
   * wire mid-flight and depends on claude honoring it there. Rather than rest
   * on that, a release that arrives mid-turn rides a one-shot subscription
   * that fires on the turn's settle and then unregisters itself ([L27], and
   * [L28] again: the release acts on the lifecycle by observing it).
   *
   * The subscription is deliberately detached from this controller. It has to
   * outlive it — an unmount mid-review is precisely the case — and the session
   * store outlives the card in both shapes that reach here: a session swap
   * leaves the old store running its turn, and a disposed store makes both
   * `subscribe` and `setModel` no-ops. The borrow registration is left in
   * place until the release actually fires, so a remount's mount-restore
   * stands down instead of racing it.
   */
  private releaseWhenSettled(): void {
    if (this.phase.kind !== "armed" && this.phase.kind !== "running") return;
    const { borrowedFrom } = this.phase;
    const store = this.deps.codeSessionStore;
    this.setPhase({ kind: "idle" });
    if (borrowedFrom === null || isSettledPhase(store.getSnapshot().phase)) {
      releaseModel(this.borrow, borrowedFrom);
      return;
    }
    const borrow = this.borrow;
    let unsubscribe: (() => void) | null = null;
    let released = false;
    const settleRelease = (): void => {
      if (released || !isSettledPhase(store.getSnapshot().phase)) return;
      released = true;
      unsubscribe?.();
      releaseModel(borrow, borrowedFrom);
    };
    unsubscribe = store.subscribe(settleRelease);
    // The turn may have settled between the snapshot read and the subscribe.
    settleRelease();
  }

  /**
   * Tear down. An unmount mid-review is a terminal outcome like any other, so
   * the model goes back before the subscriptions do ([L27]) — or as soon as
   * the turn it was borrowed for is over, when one is still running.
   */
  dispose(): void {
    this.releaseWhenSettled();
    this.disposed = true;
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;
    this.listeners.clear();
    this.notifier = null;
  }
}

/** The row's own title, for the announcement. */
function modelLabel(row: CapabilityModel): string {
  return row.displayName.trim().length > 0 ? row.displayName : row.value;
}
