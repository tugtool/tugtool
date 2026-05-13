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

// Phase E.7 diagnostic. Enable from DevTools with
// `window.__tugTraceComponentStateRestore = true` and reproduce the
// reload to see every save/restore/observer event in the console. Off
// by default to keep production noise-free. Dev-only toggle; the
// global is untyped to avoid widening the public window surface.
function isTraceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return (window as unknown as { __tugTraceComponentStateRestore?: boolean })
    .__tugTraceComponentStateRestore === true;
}
function traceLog(...args: unknown[]): void {
  if (isTraceEnabled()) {
    console.log("[A9c trace]", ...args);
  }
}

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
  if (!registry) {
    traceLog("harvestComponents: no registry");
    return undefined;
  }
  const entries = registry.entriesInTreeOrder();
  if (entries.length === 0) {
    traceLog("harvestComponents: registry empty");
    return undefined;
  }
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
  traceLog("harvestComponents: captured", Object.keys(out), out);
  return out;
}

/**
 * Apply the saved value for a single registered entry. Shared by the
 * synchronous-mount iteration path and the late-mount observer path so
 * both flow through one error-handling shape.
 *
 * Returns `true` when a restore closure ran (whether it threw or not);
 * `false` when the entry held no live `restoreState` closure (the hook
 * registers but the consumer never finished mounting), so the caller
 * can decide whether to mark the key as applied.
 */
function applyRestoreToEntry(
  scopedKey: string,
  entry: { restoreRef: { readonly current: ((saved: unknown) => void) | null } },
  savedValue: unknown,
): boolean {
  const restore = entry.restoreRef.current;
  if (!restore) return false;
  try {
    restore(savedValue);
  } catch (e) {
    if (isDevEnv()) {
      console.warn(`[A9c] restoreState threw for "${scopedKey}":`, e);
    }
  }
  return true;
}

/**
 * Framework orchestrator for per-card capture and restore. Owns the
 * map of card-level assemblers; defers component-level state to the
 * caller-injected registry lookup.
 *
 * Late-mount restore. `restoreCardState` is called from `CardHost`'s
 * mount effect, by which time React has already run every descendant's
 * `useLayoutEffect` (child-before-parent). For components that mount
 * synchronously, every registration is in place before the orchestrator
 * iterates. But for async-mounted content — most importantly tide-card's
 * transcript body kinds, which mount after the session-resume feed
 * populates — registrations land AFTER the one-shot restore has already
 * run. To plug that hole, the orchestrator caches `bag.components` on
 * the first restore per card and subscribes to the registry's
 * `observeRegister` channel: every late registration receives its saved
 * value synchronously inside the `useLayoutEffect` that triggered the
 * registration, so first paint reflects the restore ([L03]).
 *
 * Re-apply on remount. The contract is "apply on every mount that
 * registers a key the cache holds," not "apply once per card lifecycle."
 * The earlier draft of this orchestrator tracked per-key applied state
 * and skipped re-application on remount; that broke tide-card's
 * `TideRestoring` overlay path, where the transcript's body kinds
 * unmount-and-remount across a transient transport-restoring window
 * within the same card lifecycle. On the remount, React's `useState`
 * initializer fires fresh (defaults), the body kind registers, and the
 * framework MUST re-apply the cached bag value or the user sees the
 * default state (the regression that motivated this fix).
 *
 * The "user might have edited between save and unmount, then we'd
 * clobber" concern was bogus: an edit between save and unmount is
 * already lost when React resets the component's state on unmount.
 * Re-applying the last-saved value on remount is strictly better than
 * falling back to defaults — same edit is lost either way, but the
 * remount lands at a state the user actually saw at some point rather
 * than the initial default. [L23] is satisfied: the user-visible state
 * tracks the framework's last save.
 */
export class CardStateOrchestrator {
  private readonly assemblers: Map<string, CardAssembler> = new Map();
  private readonly getRegistry: ComponentStatePreservationRegistryLookup;
  // Per-card cache of the last `bag.components` payload seen on
  // restoreCardState. Late registrations consult this map.
  private readonly lastBagComponents: Map<string, Record<string, unknown>> =
    new Map();
  // Per-card set of registries we've already attached the
  // `observeRegister` subscription to. The subscription itself is held
  // by the registry instance, so when the registry is `clear()`-ed at
  // card destruction the closure becomes unreachable; this map only
  // exists to avoid double-subscribing on a second `restoreCardState`
  // call for the same card.
  private readonly registryObserverInstalled: WeakSet<ComponentStatePreservationRegistry> =
    new WeakSet();

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
   *
   * Late-mount restore. The first call per card caches `bag.components`
   * and installs an `observeRegister` subscription on the registry so
   * registrations that arrive after this call also receive their saved
   * value (the typical shape for tide-card body kinds, which mount
   * after session resume populates the transcript feed). Subsequent
   * calls update the cached components without re-subscribing.
   */
  restoreCardState(cardId: string, bag: CardStateBag): void {
    traceLog("restoreCardState", cardId, "bag.components keys:",
      bag.components ? Object.keys(bag.components) : "(undefined)");
    if (!bag.components) {
      traceLog("restoreCardState: early-return, bag.components undefined", cardId);
      return;
    }
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

    // Cache the current bag.components for current and future
    // registering keys to pull from. A second `restoreCardState` for
    // the same card replaces the cache — the most recent saved bag
    // wins.
    this.lastBagComponents.set(cardId, bag.components);

    if (isDevEnv()) {
      // Orphan diagnostic for keys present in the bag with no live
      // registration. Suppressed when the registry hasn't received
      // any registrations yet (the typical shape for cards whose
      // content mounts behind an async gate — late-mount will deliver
      // them via the observer below).
      const registered = registry.keys();
      const cached = bag.components;
      const orphans = Object.keys(cached).filter((k) => !registered.has(k));
      if (orphans.length > 0 && registered.size > 0) {
        console.warn(
          "[A9c] orphan componentStatePreservationKeys dropped:",
          orphans,
        );
      }
    }

    // Synchronous-mount iteration: apply the cached bag value to every
    // currently-registered key. Each `restoreCardState` call re-runs
    // this — an HMR remount or a deck-state replay with an updated bag
    // re-applies the freshest values, exactly the behavior the
    // framework's HMR remount path depends on.
    const cached = bag.components;
    const currentRegistered = registry.keys();
    traceLog("restoreCardState: registry at restore time has keys:",
      Array.from(currentRegistered));
    for (const [key, entry] of registry.entriesInTreeOrder()) {
      if (!(key in cached)) continue;
      traceLog("restoreCardState: sync-iteration apply", key, "←", cached[key]);
      applyRestoreToEntry(key, entry, cached[key]);
    }

    // Install the registry observer once per card lifecycle. The
    // subscription closure captures the cardId and pulls the cached
    // bag at notification time (not capture time) so a later
    // `restoreCardState` call's updated bag wins. The observer fires
    // on EVERY `register` call (including remount of a previously-
    // unmounted component), so a body kind whose React state was reset
    // by an unmount gets its saved value re-applied on the next mount.
    if (!this.registryObserverInstalled.has(registry)) {
      this.registryObserverInstalled.add(registry);
      traceLog("restoreCardState: installing observeRegister for", cardId);
      registry.observeRegister((scopedKey, entry) => {
        const liveCache = this.lastBagComponents.get(cardId);
        traceLog("observeRegister fired", cardId, scopedKey,
          "cache:", liveCache ? Object.keys(liveCache) : "(none)");
        if (!liveCache) return;
        if (!(scopedKey in liveCache)) {
          traceLog("observeRegister: key not in cache", scopedKey);
          return;
        }
        traceLog("observeRegister: applying", scopedKey, "←", liveCache[scopedKey]);
        applyRestoreToEntry(scopedKey, entry, liveCache[scopedKey]);
      });
    } else {
      traceLog("restoreCardState: observeRegister already installed for", cardId);
    }
  }

  /**
   * Drop per-card orchestrator state for `cardId`. Called from the deck
   * manager's card-destruction path alongside the registry discard so
   * the orchestrator's late-mount cache doesn't outlive the card.
   *
   * The registry's own `clear()` (called by `discardComponentStatePreservationRegistry`)
   * drops the `observeRegister` subscription captured inside the
   * registry instance; this method only cleans up the orchestrator-side
   * cache so the WeakSet's allowing-GC contract isn't relied on for
   * correctness, just for memory.
   */
  discardCardState(cardId: string): void {
    this.lastBagComponents.delete(cardId);
  }
}
