/**
 * CardStateOrchestrator — the framework's single entry point for
 * capture and restore of a card's full state bag ([D13], [A9c]).
 *
 * Before this module, every save trigger (will-phase subscribers,
 * close-before-destroy flush, `saveState` RPC) dispatched to a card's
 * own save callback ad hoc. Each callback built its own bag from
 * framework-owned axes; component-level state had no place to land.
 * The orchestrator routes every trigger through a single pair:
 *
 *   - `captureCardState(cardId)` — invokes the card's registered
 *     assembler (framework axes + `bag.content`) and walks the per-card
 *     `ComponentStatePreservationRegistry` parent-first, merging
 *     harvested component state into `bag.components`.
 *
 *   - `restoreCardState(cardId, bag)` — walks the per-card registry
 *     parent-first and applies `bag.components`; silently drops
 *     componentStatePreservationKeys the card no longer registers
 *     (dev-warn lists the orphans, per [D13] / Q5 resolution). Content
 *     and framework-axis
 *     restore continue to be driven by the existing CardHost triggers
 *     (child-registered callbacks + mount useLayoutEffect); the
 *     orchestrator adds component-state restore as a new pass that
 *     fires alongside.
 *
 * An **assembler** is the per-card capture closure CardHost supplies —
 * the code that today lives in `saveCurrentCardStateRef.current` but
 * without the `store.setCardState` write and without `bag.components`.
 * Registering it with the orchestrator is the moral equivalent of
 * `registerSaveCallback`: the orchestrator owns the reference so any
 * trigger can invoke the assembler's `capture()` uniformly.
 *
 * The orchestrator is instance-scoped (not a module-level singleton)
 * so tests can construct their own without polluting other tests, and
 * DeckManager owns the production instance.
 */

import type { CardStateBag } from "./layout-tree";
import type { ComponentStatePreservationRegistry } from "./components/tugways/component-state-preservation-registry";
import { isDevEnv } from "./lib/dev-env";

/**
 * Per-card assembler handle. Supplied by `CardHost` on mount and
 * discarded on unmount. `capture` returns the framework-axes bag (every
 * axis except `components`, which the orchestrator layers on top).
 */
export interface CardAssembler {
  capture: () => CardStateBag;
}

/**
 * Minimal shape the orchestrator needs for registry lookups. Keeping
 * this to a function parameter keeps the orchestrator free of a
 * concrete `IDeckManagerStore` dependency so tests can inject a plain
 * `Map`-backed lookup.
 */
export type ComponentStatePreservationRegistryLookup = (
  cardId: string,
) => ComponentStatePreservationRegistry | undefined;

/**
 * Harvest every registered component's `captureState` output in
 * parent-first tree order. Returns `undefined` when the registry is
 * absent or empty so `bag.components` stays `undefined` on cards that
 * do not participate — no empty objects in the round-trip.
 *
 * Dev-only: a throwing `captureState` is logged and skipped. Production
 * swallows silently; the component's slot is missing from the bag,
 * which is the best outcome when the alternative is a full-card save
 * failure.
 */
function harvestComponents(
  registry: ComponentStatePreservationRegistry | undefined,
): Record<string, unknown> | undefined {
  if (!registry) return undefined;
  const entries = registry.entriesInTreeOrder();
  if (entries.length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    const capture = entry.captureRef.current;
    if (!capture) continue;
    try {
      out[key] = capture();
    } catch (e) {
      if (isDevEnv()) {
        console.warn(`[A9c] captureState threw for "${key}":`, e);
      }
    }
  }
  return out;
}

/**
 * Apply each registered component's `restoreState(saved)` in
 * parent-first tree order. Orphan componentStatePreservationKeys
 * (present in `saved` but not registered) are silently dropped with a
 * single dev-warn listing the dropped keys (per [D13] / Q5 resolution,
 * symmetric with [D12]).
 *
 * Dev-only: a throwing `restoreState` is logged and skipped. Production
 * swallows silently.
 */
function restoreComponents(
  registry: ComponentStatePreservationRegistry,
  saved: Record<string, unknown>,
): void {
  if (isDevEnv()) {
    const registered = registry.keys();
    const orphans = Object.keys(saved).filter((k) => !registered.has(k));
    if (orphans.length > 0) {
      console.warn("[A9c] orphan componentStatePreservationKeys dropped:", orphans);
    }
  }
  for (const [key, entry] of registry.entriesInTreeOrder()) {
    if (!(key in saved)) continue;
    const restore = entry.restoreRef.current;
    if (!restore) continue;
    try {
      restore(saved[key]);
    } catch (e) {
      if (isDevEnv()) {
        console.warn(`[A9c] restoreState threw for "${key}":`, e);
      }
    }
  }
}

/**
 * Framework orchestrator for per-card capture and restore. Owns the
 * map of card-level assemblers; defers component-level state to the
 * caller-injected registry lookup.
 */
export class CardStateOrchestrator {
  private readonly assemblers: Map<string, CardAssembler> = new Map();
  private readonly getRegistry: ComponentStatePreservationRegistryLookup;

  constructor(getRegistry: ComponentStatePreservationRegistryLookup) {
    this.getRegistry = getRegistry;
  }

  /**
   * Register a card's assembler. Returns an unregister function so the
   * caller can wire cleanup into a `useLayoutEffect` return.
   *
   * A second register for the same `cardId` replaces the first — this
   * mirrors `registerSaveCallback`'s behavior and lets `CardHost`
   * re-register across renders without explicit unregister calls.
   */
  registerAssembler(cardId: string, assembler: CardAssembler): () => void {
    this.assemblers.set(cardId, assembler);
    return () => {
      // Only delete if the slot still holds *our* registration; a later
      // `registerAssembler` with the same id has replaced us.
      if (this.assemblers.get(cardId) === assembler) {
        this.assemblers.delete(cardId);
      }
    };
  }

  /**
   * Assemble the full bag for `cardId`. If the card has no registered
   * assembler, returns the component-harvest alone (an empty bag when
   * no components are registered either). Callers that care about the
   * "card not known" case should check the registry themselves.
   */
  captureCardState(cardId: string): CardStateBag {
    const assembler = this.assemblers.get(cardId);
    const base: CardStateBag = assembler ? assembler.capture() : {};
    const components = harvestComponents(this.getRegistry(cardId));
    if (components === undefined) return base;
    return { ...base, components };
  }

  /**
   * Apply `bag.components` to the card's registered components. No-op
   * when the card has no component registry or `bag.components` is
   * absent. Framework-axis restore (content / scroll / DOM selection /
   * focus / form controls / region scroll) is not the orchestrator's
   * responsibility; those remain triggered by CardHost's existing
   * lifecycle hooks.
   */
  restoreCardState(cardId: string, bag: CardStateBag): void {
    if (!bag.components) return;
    const registry = this.getRegistry(cardId);
    if (!registry) {
      if (isDevEnv()) {
        const keys = Object.keys(bag.components);
        if (keys.length > 0) {
          console.warn(
            `[A9c] restoreCardState: card "${cardId}" has no component ` +
              `state preservation registry; dropping ${keys.length} ` +
              `componentStatePreservationKey(s):`,
            keys,
          );
        }
      }
      return;
    }
    restoreComponents(registry, bag.components);
  }
}
