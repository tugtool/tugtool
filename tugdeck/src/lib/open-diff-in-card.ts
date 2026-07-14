/**
 * open-diff-in-card.ts — the one implementation behind "pop this diff out
 * into its own card" ([P20]).
 *
 * Descriptor-keyed reuse (the mirror of `open-file-in-card.ts`'s path-keyed
 * reuse): opening a descriptor already shown by a Diff card activates that
 * card (raised + focus-claimed via `transferFocusForActivation`, so the
 * activation taxonomy matches every other route) and re-points it; otherwise
 * a fresh Diff card is created seeded with the descriptor through `addCard`'s
 * initial-content channel. Two cards showing the same diff would be pure
 * duplication.
 *
 * Callers: the `open-diff` action-dispatch handler (`dispatchAction` from the
 * changeset card's pop-out affordances).
 *
 * @module lib/open-diff-in-card
 */

import { transferFocusForActivation } from "@/focus-transfer";
import type { IDeckManagerStore } from "@/deck-manager-store";
import { diffDescriptorKey, type DiffDescriptor } from "./git-diff-store";
import { findDiffCardByKey } from "./diff-card-open-registry";

/** The Diff card's initial-content seed (its restore bag content). */
export interface DiffCardSeed {
  descriptor: DiffDescriptor;
}

export function openDiffInCard(
  store: IDeckManagerStore,
  descriptor: DiffDescriptor,
): void {
  const key = diffDescriptorKey(descriptor);
  const existing = findDiffCardByKey(key);
  if (existing) {
    transferFocusForActivation({
      outgoingCardId: store.getFirstResponderCardId(),
      incomingCardId: existing.cardId,
      store,
      commitMutation: () => store.activateCard(existing.cardId),
    });
    // Re-point defensively (a same-key open is a no-op re-request, which is
    // harmless and refreshes the diff).
    existing.entry.setDescriptor(descriptor);
    return;
  }
  const seed: DiffCardSeed = { descriptor };
  store.addCard("diff", seed);
}
