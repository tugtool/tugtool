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
    this.entries.set(scopedKey, {
      captureRef,
      restoreRef,
      treePath,
    });
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

  /** Remove every entry. Called when the owning card is destroyed. */
  clear(): void {
    this.entries.clear();
  }
}
