/**
 * `ToolBlockExpansionState` — per-card expansion overrides for
 * history-collapsed tool blocks.
 *
 * Replayed (historical) tool blocks default to collapsed; the user's
 * expand/collapse choices are the only state worth keeping. This
 * class holds those choices SPARSELY — a `toolUseId` appears only
 * while its resolved value differs from its default — so a
 * 900-block transcript carries just the handful of user-touched keys.
 *
 * Ownership and persistence: ONE instance per card, owned by the
 * transcript host (which never unmounts under windowed mounting —
 * that is the point). The host registers the instance under a single
 * [A9] `componentStatePreservationKey` so the overrides survive cold
 * boot / pane restore, and seeds it from the saved value at mount.
 * Individual blocks read through `resolve` in their `useState`
 * initializer and write through `set` on toggle, so an expansion
 * survives the block's own windowed unmount → remount within the
 * session ([L23]) — per-block [A9] keys could NOT provide that
 * (capture harvests only currently-mounted components; a windowed-out
 * block's key would silently drop from the bag at the next save).
 *
 * Pure module — no DOM, no React.
 *
 * @module components/tugways/cards/blocks/expansion-state
 */

/** Serialized shape on the [A9] axis: only the overrides. */
export interface PersistedExpansionState {
  /** `toolUseId` → collapsed, recorded only where it differs from the default. */
  overrides: Record<string, boolean>;
}

export class ToolBlockExpansionState {
  private overrides = new Map<string, boolean>();

  /** Resolved collapsed value for a block: override wins, else default. */
  resolve(toolUseId: string, defaultCollapsed: boolean): boolean {
    return this.overrides.get(toolUseId) ?? defaultCollapsed;
  }

  /**
   * Record a toggle. Values equal to the block's default are DELETED
   * rather than stored — sparseness is the contract.
   */
  set(toolUseId: string, collapsed: boolean, defaultCollapsed: boolean): void {
    if (collapsed === defaultCollapsed) {
      this.overrides.delete(toolUseId);
    } else {
      this.overrides.set(toolUseId, collapsed);
    }
  }

  /** Number of live overrides (test/diagnostic surface). */
  get size(): number {
    return this.overrides.size;
  }

  /**
   * Serialize for [A9] capture. Returns `undefined` when no overrides
   * exist so the bag carries no entry at all for the untouched case.
   */
  toPersisted(): PersistedExpansionState | undefined {
    if (this.overrides.size === 0) return undefined;
    return { overrides: Object.fromEntries(this.overrides) };
  }

  /** Seed from a saved [A9] value. Ignores malformed input. */
  seed(saved: PersistedExpansionState | undefined): void {
    if (saved === undefined || typeof saved !== "object") return;
    const overrides = saved.overrides;
    if (overrides === null || typeof overrides !== "object") return;
    for (const [key, value] of Object.entries(overrides)) {
      if (typeof value === "boolean") this.overrides.set(key, value);
    }
  }
}
