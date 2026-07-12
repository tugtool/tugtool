/**
 * FindTargetRegistry — per-card registry of unfoldable / editor-backed find
 * targets inside transcript blocks.
 *
 * Transcript Find counts matches from the store index, but two content
 * shapes can hide a counted match from the paint surface:
 *
 *   - a `TerminalBlock` internal fold shows only the first
 *     `collapseThreshold` lines (the hidden remainder is a suffix, so the
 *     mounted hits stay a prefix of the projected hits);
 *   - a `FileBlock` internal fold unmounts its embedded CodeMirror editor
 *     entirely, and even when mounted, CM6 virtualizes its DOM — matches
 *     paint through the editor's OWN search, not the Custom-Highlight walk.
 *
 * Body kinds register here (keyed by their owning `toolUseId` /
 * `exchangeId`) so navigation can `unfold()` a hidden match's container on
 * demand and the highlighter can drive an embedded editor's search delegate.
 * Registration is [L03] `useLayoutEffect` plumbing with no visual footprint;
 * the registry instance is card-owned (the transcript host provides it) and
 * reference-stable [L07].
 *
 * @module components/tugways/cards/blocks/find-target-registry
 */

import * as React from "react";

import type { TugCodeViewDelegate } from "@/components/tugways/tug-code-view";

/** One registered target — what find navigation can do with the block. */
export interface FindTarget {
  /** Open the block's INTERNAL fold (idempotent; no-op when already open). */
  unfold: () => void;
  /**
   * Resolve the live embedded editor delegate, or `null` while the editor
   * is unmounted (internally folded). Present only for editor-backed
   * bodies (`FileBlock`).
   */
  codeView?: () => TugCodeViewDelegate | null;
}

export class FindTargetRegistry {
  private targets = new Map<string, FindTarget>();

  register(key: string, target: FindTarget): () => void {
    this.targets.set(key, target);
    return () => {
      // Guard the delete: a later mount for the same key (StrictMode
      // double-invoke, windowed remount) may have replaced the entry.
      if (this.targets.get(key) === target) this.targets.delete(key);
    };
  }

  resolve(key: string): FindTarget | null {
    return this.targets.get(key) ?? null;
  }
}

/**
 * Card-scoped registry context. `null` outside a transcript host (gallery,
 * standalone compositions) — registration is then a no-op.
 */
export const FindTargetRegistryContext =
  React.createContext<FindTargetRegistry | null>(null);

/**
 * Register `target` under `key` for the enclosing card's find navigation.
 * No-op when `key` is null/undefined or no registry is in scope. The
 * `target` is read through a ref at resolve time, so callers may pass a
 * fresh object literal per render without re-registering.
 */
export function useFindTargetRegistration(
  key: string | null | undefined,
  target: FindTarget,
): void {
  const registry = React.useContext(FindTargetRegistryContext);
  const targetRef = React.useRef(target);
  targetRef.current = target;
  React.useLayoutEffect(() => {
    if (registry === null || key === null || key === undefined || key === "") {
      return;
    }
    return registry.register(key, {
      unfold: () => targetRef.current.unfold(),
      codeView: () => targetRef.current.codeView?.() ?? null,
    });
  }, [registry, key]);
}
