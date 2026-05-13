/**
 * ComponentStatePreservationRegistry — per-card registry of opt-in
 * component state preservation entries.
 *
 * Foundational plumbing for the Component State Preservation Protocol
 * ([D13], architecture piece [A9]). Stateful `tugways` components opt
 * into state preservation by registering a `componentStatePreservationKey`
 * plus capture/restore closures via `useComponentStatePreservation`.
 * The registry holds one entry per scoped key and exposes a
 * parent-first iteration order so the framework can harvest the full
 * component tree into a single `bag.components` axis at capture time
 * and restore it in the same order.
 *
 * One registry instance is created per card on first `register` call and
 * cleared / discarded when the card is destroyed (see
 * `deck-manager.ts` lifecycle hooks). This module owns only the registry's
 * data structure and iteration semantics; the framework orchestration
 * (`captureCardState` / `restoreCardState`) lives elsewhere and consumes
 * this registry.
 *
 * References: [D13] component state preservation protocol, [A9a] hook
 * registration, [A9b] scope nesting, [A9c] framework orchestration.
 */

import type { RefObject } from "react";
import { isDevEnv } from "../../lib/dev-env";

/**
 * A single entry in the registry.
 *
 * The closures are held as refs so `useComponentStatePreservation` can
 * sync the latest render's closures on every render without tearing
 * down the registration. The framework reads `captureRef.current` /
 * `restoreRef.current` at harvest time, so a stale closure never enters
 * the bag.
 *
 * `treePath` records the component's position in the card's React tree as
 * a sequence of child indices from the card root down. It is the sort key
 * for parent-first iteration (lexicographic on the index arrays). A
 * shorter path is always sorted before any longer path that extends it,
 * which is exactly parent-first order.
 */
export interface RegistryEntry {
  captureRef: RefObject<() => unknown>;
  restoreRef: RefObject<(saved: unknown) => void>;
  treePath: readonly number[];
}

/**
 * Compare two tree paths lexicographically. A shorter path that is a prefix
 * of a longer path compares as less-than (parent before child).
 */
function compareTreePaths(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

/**
 * Observer signature for the registry's `observeRegister` channel.
 * Receives the scoped key plus the freshly-installed entry; fires
 * synchronously inside `register`, immediately after the entry lands
 * in the internal map.
 */
export type RegistryRegisterObserver = (
  scopedKey: string,
  entry: RegistryEntry,
) => void;

/**
 * Per-card registry of opt-in component state preservation entries.
 *
 * Each scoped key maps to one `RegistryEntry`. Keys are the product of
 * any enclosing `<ComponentStatePreservationScope prefix>` context and
 * the component's own `componentStatePreservationKey` prop; uniqueness
 * at card scope is a dev-only invariant enforced here (duplicates throw
 * in dev, silently overwrite in prod to keep the app alive if a bug
 * slips through).
 */
export class ComponentStatePreservationRegistry {
  private readonly entries: Map<string, RegistryEntry> = new Map();
  private readonly registerObservers: Set<RegistryRegisterObserver> = new Set();

  /**
   * Register a component for state preservation.
   *
   * `scopedKey` is the fully-qualified key (after
   * `<ComponentStatePreservationScope>` prefixing). `treePath` records
   * the registrant's position in the card's React tree so iteration can
   * walk parent-first.
   *
   * Dev-only: throws if `scopedKey` is already registered. In production
   * the new entry replaces the old silently — the alternative (throwing
   * in prod) would kill the card on a late-mount collision that a dev
   * build would have caught.
   *
   * Fires every `observeRegister` subscriber synchronously after the
   * entry lands. A throwing observer is logged in dev and swallowed in
   * prod so a misbehaving subscriber never breaks the registration
   * itself ([A9c] — the orchestrator's late-mount apply path subscribes
   * here, and a registration must always complete).
   */
  register(
    scopedKey: string,
    captureRef: RefObject<() => unknown>,
    restoreRef: RefObject<(saved: unknown) => void>,
    treePath: readonly number[],
  ): void {
    if (this.entries.has(scopedKey)) {
      if (isDevEnv()) {
        throw new Error(
          `[A9] duplicate componentStatePreservationKey within card scope: "${scopedKey}"`,
        );
      }
    }
    const entry: RegistryEntry = {
      captureRef,
      restoreRef,
      treePath,
    };
    this.entries.set(scopedKey, entry);
    for (const observer of this.registerObservers) {
      try {
        observer(scopedKey, entry);
      } catch (e) {
        if (isDevEnv()) {
          console.warn(
            `[A9] observeRegister callback threw for "${scopedKey}":`,
            e,
          );
        }
      }
    }
  }

  /**
   * Subscribe to registration events. The callback fires synchronously
   * inside `register` after the entry has been installed in the
   * internal map — the same call stack as the `useLayoutEffect` that
   * triggered the registration, so any work the observer schedules
   * (e.g., `entry.restoreRef.current?.(savedValue)`) lands in the same
   * React commit as the registration ([L03]).
   *
   * Returns an unsubscribe function that removes the observer; safe to
   * call more than once. Multiple observers are supported; each is
   * notified in insertion order.
   *
   * Modeled on the framework's existing `card-lifecycle.ts` observer
   * channels (`observeCardWillActivate` and siblings) so the
   * architecture stays coherent — see `tuglaws/state-preservation.md`
   * for how the orchestrator uses this to apply saved state to
   * late-mounting components.
   */
  observeRegister(callback: RegistryRegisterObserver): () => void {
    this.registerObservers.add(callback);
    return () => {
      this.registerObservers.delete(callback);
    };
  }

  /**
   * Unregister the entry for `scopedKey`. No-op if the key is absent.
   * Called from `useComponentStatePreservation`'s cleanup.
   */
  unregister(scopedKey: string): void {
    this.entries.delete(scopedKey);
  }

  /**
   * Iterate entries in parent-first tree order. Sort key is the `treePath`
   * (lexicographic); parents sort before descendants. Ties on `treePath`
   * (e.g. same mount point when registration happens before React has
   * assigned a useful path) fall back to insertion order via a stable sort.
   */
  entriesInTreeOrder(): Array<[string, RegistryEntry]> {
    const items = Array.from(this.entries.entries());
    items.sort((a, b) => compareTreePaths(a[1].treePath, b[1].treePath));
    return items;
  }

  /** The full set of currently-registered scoped keys. */
  keys(): Set<string> {
    return new Set(this.entries.keys());
  }

  /**
   * Remove every entry. Called when the owning card is destroyed.
   * Also drops every `observeRegister` subscriber — the orchestrator's
   * late-mount subscription closure captures the per-card cache and
   * must not outlive the card itself ([A9c] / [L23]).
   */
  clear(): void {
    this.entries.clear();
    this.registerObservers.clear();
  }
}
