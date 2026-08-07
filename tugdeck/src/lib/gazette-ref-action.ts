/**
 * gazette-ref-action.ts — what a Gazette ref chip does when it is clicked.
 *
 * A ref is provenance: the post says something happened, and the chip is the
 * way to go look. Each kind reaches an existing verb rather than a new
 * mechanism — a path opens the way every other path in the app opens, a sha
 * opens the diff the annotator's commit chips open, and a session raises its
 * card through the deck's ordinary activation path.
 *
 * The decision is separated from the doing: {@link gazetteRefIntent} is a pure
 * function from a ref to what should happen, which is what the tests read, and
 * {@link runGazetteRefIntent} is the side-effecting half. A ref that has
 * nowhere to go resolves to an `inert` intent carrying the reason, so the chip
 * can say why instead of looking clickable and doing nothing.
 *
 * @module lib/gazette-ref-action
 */

import { dispatchCommand } from "@/command-dispatch";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";
import { cardSessionBindingStore } from "@/lib/card-session-binding-store";
import { transferFocusForActivation } from "@/focus-transfer";
import type { IDeckManagerStore } from "@/deck-manager-store";
import type { GazetteRef } from "@/protocol";

/** What clicking a ref chip should do. */
export type GazetteRefIntent =
  /** Send an existing command with this payload. */
  | { kind: "dispatch"; action: string; payload: Record<string, unknown> }
  /** Raise the deck card with this id and hand it focus. */
  | { kind: "raise-card"; cardId: string }
  /** Nothing to do, and this is why — the chip renders disabled with it. */
  | { kind: "inert"; reason: string };

/** The card currently bound to `sessionId`, or null if none is open. */
export function cardIdForSession(sessionId: string): string | null {
  for (const [cardId, binding] of cardSessionBindingStore.getSnapshot()) {
    if (binding.tugSessionId === sessionId) return cardId;
  }
  return null;
}

/**
 * Resolve a ref to what clicking it should do.
 *
 * `lookupSession` is injected rather than reached for, so the decision stays a
 * function of its inputs — the tests supply their own deck.
 */
export function gazetteRefIntent(
  ref: GazetteRef,
  lookupSession: (sessionId: string) => string | null = cardIdForSession,
): GazetteRefIntent {
  if (ref.target.length === 0) {
    return { kind: "inert", reason: "This ref names nothing." };
  }
  switch (ref.kind) {
    case "session": {
      const cardId = lookupSession(ref.target);
      return cardId !== null
        ? { kind: "raise-card", cardId }
        : { kind: "inert", reason: "This session has no card open." };
    }
    case "commit":
      // No `root`: the diff store falls back to the card's project dir, which
      // is the repo the Reporter was narrating.
      return {
        kind: "dispatch",
        action: TUG_ACTIONS.OPEN_DIFF,
        payload: { descriptor: { kind: "commit", sha: ref.target } },
      };
    // A plan and a brief are files; they carry their own kinds so a post can
    // say what it is pointing at, not so they open differently.
    case "file":
    case "plan":
    case "brief":
      return {
        kind: "dispatch",
        action: TUG_ACTIONS.OPEN_FILE,
        payload: { path: ref.target },
      };
  }
}

/**
 * Perform an intent. `store` is needed only by `raise-card`; a caller with no
 * deck store to hand simply cannot raise a card, which is the same outcome as
 * the session having no card open.
 */
export function runGazetteRefIntent(
  intent: GazetteRefIntent,
  store: IDeckManagerStore | null,
): void {
  if (intent.kind === "dispatch") {
    dispatchCommand(intent.action, intent.payload);
    return;
  }
  if (intent.kind === "raise-card" && store !== null) {
    // The real z-raise: activation carries focus, so the raised card also
    // becomes the one the keyboard is talking to.
    transferFocusForActivation({
      outgoingCardId: store.getFirstResponderCardId(),
      incomingCardId: intent.cardId,
      store,
      commitMutation: () => store.activateCard(intent.cardId),
    });
  }
}
