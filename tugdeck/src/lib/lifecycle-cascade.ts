/**
 * lifecycle-cascade.ts — Couples `AppLifecycle` to `CardLifecycle`.
 *
 * The one place where app-level events drive card-level events.
 * Per D8 of the lifecycle-delegates plan, this module lives
 * separately (imports both lifecycles; neither imports this) so
 * the cascade rules have a single readable home and there's no
 * circular-import risk.
 *
 * Cascade rules (per D4):
 *   - On `applicationWillResignActive` or `applicationWillHide`:
 *       If an active card exists and is not already in the
 *       "deactivated-by-app" state, fire
 *       `cardWillDeactivate(activeId)` → `cardDidDeactivate(activeId)`.
 *       Record `activeId` as `deactivatedByAppCardId`.
 *   - On `applicationDidBecomeActive` or `applicationDidUnhide`:
 *       If `deactivatedByAppCardId` is set, fire
 *       `cardWillActivate(id)` → `cardDidActivate(id)`. Clear the
 *       field.
 *
 * Idempotency (per D10 — trust AppKit's will/did pairing):
 *   - `applicationWillResignActive` followed by `applicationWillHide`
 *     produces exactly one deactivation cascade; the guard field
 *     makes the second will-event a no-op.
 *   - `applicationDidBecomeActive` followed by `applicationDidUnhide`
 *     produces exactly one reactivation cascade; the guard field
 *     is cleared on the first and the second sees nothing to do.
 *
 * The module is non-React, non-singleton, and has no global state
 * beyond the cascade handle returned to its caller (DeckManager).
 * Install once; dispose on deck teardown.
 */

import type { CardLifecycle } from "./card-lifecycle";
import type { AppLifecycle } from "./app-lifecycle";

/** Opaque handle returned by `installLifecycleCascade`. */
export interface LifecycleCascadeHandle {
  /** Release all observer subscriptions installed by the cascade. */
  dispose(): void;
}

/**
 * Install the app → card cascade between two lifecycle instances.
 * Subscribes the cascade callbacks to `appLifecycle` and fires the
 * matching `cardLifecycle` notifications. Returns a handle whose
 * `dispose()` removes all subscriptions.
 */
export function installLifecycleCascade(
  cardLifecycle: CardLifecycle,
  appLifecycle: AppLifecycle,
): LifecycleCascadeHandle {
  // The card id that was active at the moment of the last
  // deactivation cascade. `null` means no cascade is currently
  // holding a deferred reactivation. Reset on every full
  // deactivate→reactivate cycle.
  let deactivatedByAppCardId: string | null = null;

  // ---- Deactivation cascade (resign-active OR hide) ----

  const deactivateIfNeeded = (trigger: string): void => {
    // Idempotent: if a prior will-event in the same cycle already
    // fired the cascade, the second will-event is a no-op.
    if (deactivatedByAppCardId !== null) return;
    // 11.6.1b: the cascade targets the composite first responder
    // (the active stack's active card) — that's the card whose UI
    // focus/blur behavior tracks the app's active/hidden state.
    // Reading `getFocusedCardId` (top of z-order) could pick a
    // different card when `activeStackId` does not match the top
    // stack (post-detach or post-move edge cases).
    const activeId = cardLifecycle.getFirstResponderCardId();
    if (activeId === null) return;
    console.log(
      `[CardLifecycle] cascade from ${trigger} → cardWillDeactivate/cardDidDeactivate id=${activeId}`,
    );
    deactivatedByAppCardId = activeId;
    cardLifecycle.notifyCardWillDeactivate(activeId);
    cardLifecycle.notifyCardDidDeactivate(activeId);
  };

  // ---- Reactivation cascade (become-active OR unhide) ----

  const reactivateIfNeeded = (trigger: string): void => {
    const cardId = deactivatedByAppCardId;
    if (cardId === null) return;
    console.log(
      `[CardLifecycle] cascade from ${trigger} → cardWillActivate/cardDidActivate id=${cardId}`,
    );
    // Clear the guard BEFORE firing, so observers that trigger
    // nested app events during the cascade don't see a stale flag.
    deactivatedByAppCardId = null;
    cardLifecycle.notifyCardWillActivate(cardId);
    cardLifecycle.notifyCardDidActivate(cardId);
  };

  // ---- Subscribe ----

  const unsubs: Array<() => void> = [
    appLifecycle.observeApplicationWillResignActive(() =>
      deactivateIfNeeded("applicationWillResignActive"),
    ),
    appLifecycle.observeApplicationWillHide(() =>
      deactivateIfNeeded("applicationWillHide"),
    ),
    appLifecycle.observeApplicationDidBecomeActive(() =>
      reactivateIfNeeded("applicationDidBecomeActive"),
    ),
    appLifecycle.observeApplicationDidUnhide(() =>
      reactivateIfNeeded("applicationDidUnhide"),
    ),
  ];

  return {
    dispose() {
      for (const unsub of unsubs) unsub();
    },
  };
}
