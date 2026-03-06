/**
 * mutation-transaction.ts -- MutationTransaction class and MutationTransactionManager singleton.
 *
 * Provides snapshot/preview/commit/cancel semantics for live-preview editing
 * in the appearance zone. Transactions capture CSS inline style values at
 * begin() time and restore them on cancel(), enabling gesture-driven preview
 * without permanent mutations until the user commits.
 *
 * Pattern:
 *   1. Call `mutationTransactionManager.beginTransaction(target, properties)`
 *      to snapshot the target element's current inline style values for the
 *      named properties and open a new transaction.
 *   2. Call `transaction.preview(property, value)` (or use the manager's
 *      active transaction via `getActiveTransaction`) during the gesture's
 *      `change` phase to apply intermediate values directly to the DOM.
 *   3. Call `mutationTransactionManager.commitTransaction(target)` to finalize
 *      (leave values in place) or `mutationTransactionManager.cancelTransaction(target)`
 *      to restore original values.
 *
 * Design decisions:
 *   [D01] MutationTransaction is a class with snapshot map
 *   [D02] MutationTransactionManager is a module-level singleton
 *
 * Spec S01, Spec S02
 *
 * See also: tugplan-tugways-phase-5d3-mutation-transactions.md
 */

// ---------------------------------------------------------------------------
// MutationTransaction
// ---------------------------------------------------------------------------

/**
 * A snapshot-based transaction for live-preview CSS mutations on a single
 * HTMLElement.
 *
 * The transaction captures inline style values at `begin()` time so that
 * `cancel()` can restore them exactly. Preview mutations are applied via
 * `element.style.setProperty()` -- no React state changes occur during a
 * transaction.
 *
 * Callers must not call `commit()` or `cancel()` directly. Use the manager's
 * `commitTransaction()` / `cancelTransaction()` methods instead, which
 * delegate to these methods and then remove the transaction from the manager's
 * Map. This ensures the manager's bookkeeping stays consistent.
 *
 * [D01] MutationTransaction is a class with snapshot map
 * Spec S01 (#s01-mutation-transaction)
 */
export class MutationTransaction {
  /** Unique transaction identifier (e.g., "tx-1"). */
  readonly id: string;

  /** The element being mutated. Set once at construction time. */
  readonly target: HTMLElement;

  /**
   * True after `begin()` is called and before `commit()` or `cancel()`.
   */
  get isActive(): boolean {
    return this._isActive;
  }

  /**
   * The set of property names that have been `preview()`-ed at least once.
   * Only properties declared in `begin()` can appear here.
   */
  get previewedProperties(): ReadonlySet<string> {
    return this._previewedProperties;
  }

  private _isActive = false;
  private _snapshot: Map<string, string> = new Map();
  private _previewedProperties: Set<string> = new Set();

  constructor(id: string, target: HTMLElement) {
    this.id = id;
    this.target = target;
  }

  /**
   * Snapshot the current inline style values for the given properties and
   * mark the transaction as active.
   *
   * Each property's current `element.style.getPropertyValue()` result is
   * stored, including empty string for properties not currently set inline.
   * Callers must declare all properties they intend to preview upfront so the
   * snapshot is complete.
   *
   * Spec S01 (#s01-mutation-transaction)
   */
  begin(properties: string[]): void {
    this._snapshot.clear();
    this._previewedProperties.clear();
    for (const prop of properties) {
      this._snapshot.set(prop, this.target.style.getPropertyValue(prop));
    }
    this._isActive = true;
  }

  /**
   * Apply a preview value to the target element's inline style.
   *
   * Throws an Error if the property was not declared in `begin()`. Callers
   * must declare all properties upfront so the snapshot is complete and
   * `cancel()` can restore all mutations.
   *
   * Spec S01 (#s01-mutation-transaction)
   */
  preview(property: string, value: string): void {
    if (!this._snapshot.has(property)) {
      throw new Error(
        `MutationTransaction.preview: property "${property}" was not declared in begin(). ` +
          `Declared properties: [${[...this._snapshot.keys()].join(", ")}]`
      );
    }
    this.target.style.setProperty(property, value);
    this._previewedProperties.add(property);
  }

  /**
   * Finalize the transaction. The previewed values remain on the element.
   *
   * This is a no-op on the DOM -- preview values are already in place.
   * Sets `isActive` to false. The manager removes the transaction from its
   * Map after calling this.
   *
   * Spec S01 (#s01-mutation-transaction)
   */
  commit(): void {
    this._isActive = false;
  }

  /**
   * Cancel the transaction by restoring all snapshotted property values.
   *
   * Iterates the snapshot map and calls `element.style.setProperty()` for
   * each entry. Properties that were originally unset (empty string snapshot)
   * are restored by removing the inline declaration via `removeProperty()`.
   * Sets `isActive` to false. The manager removes the transaction from its
   * Map after calling this.
   *
   * Spec S01 (#s01-mutation-transaction)
   */
  cancel(): void {
    for (const [prop, originalValue] of this._snapshot) {
      if (originalValue === "") {
        this.target.style.removeProperty(prop);
      } else {
        this.target.style.setProperty(prop, originalValue);
      }
    }
    this._isActive = false;
  }
}

// ---------------------------------------------------------------------------
// MutationTransactionManager
// ---------------------------------------------------------------------------

/**
 * Manages active MutationTransactions on a per-element basis.
 *
 * At most one transaction is active per HTMLElement at a time. Starting a new
 * transaction on an element that already has an active transaction
 * automatically cancels (and restores) the previous one.
 *
 * This is a plain TypeScript class -- not React state -- consistent with
 * `ResponderChainManager` and `SelectionGuard`. Transaction state is
 * imperative DOM bookkeeping and must not trigger React re-renders.
 *
 * Export as a module-level singleton: `mutationTransactionManager`.
 *
 * [D02] MutationTransactionManager is a module-level singleton
 * Spec S02 (#s02-transaction-manager)
 */
export class MutationTransactionManager {
  private _transactions: Map<HTMLElement, MutationTransaction> = new Map();
  private _counter = 0;

  /**
   * Begin a new transaction on `target` for the given `properties`.
   *
   * If an active transaction already exists for `target`, it is automatically
   * cancelled (restoring original values) before the new transaction begins.
   * Auto-generates a unique transaction ID via an incrementing counter.
   *
   * Returns the new transaction object. Callers should use the manager's
   * commit/cancel methods rather than calling the transaction's methods directly.
   *
   * Spec S02 (#s02-transaction-manager)
   */
  beginTransaction(
    target: HTMLElement,
    properties: string[]
  ): MutationTransaction {
    // Auto-cancel any existing transaction on this element
    const existing = this._transactions.get(target);
    if (existing) {
      existing.cancel();
      this._transactions.delete(target);
    }

    this._counter += 1;
    const id = `tx-${this._counter}`;
    const tx = new MutationTransaction(id, target);
    tx.begin(properties);
    this._transactions.set(target, tx);
    return tx;
  }

  /**
   * Commit the active transaction for `target`.
   *
   * Delegates to `transaction.commit()` and removes the transaction from the
   * Map. No-op if no active transaction exists for `target`.
   *
   * Spec S02 (#s02-transaction-manager)
   */
  commitTransaction(target: HTMLElement): void {
    const tx = this._transactions.get(target);
    if (!tx) return;
    tx.commit();
    this._transactions.delete(target);
  }

  /**
   * Cancel the active transaction for `target`, restoring original values.
   *
   * Delegates to `transaction.cancel()` and removes the transaction from the
   * Map. No-op if no active transaction exists for `target`.
   *
   * Spec S02 (#s02-transaction-manager)
   */
  cancelTransaction(target: HTMLElement): void {
    const tx = this._transactions.get(target);
    if (!tx) return;
    tx.cancel();
    this._transactions.delete(target);
  }

  /**
   * Return the active transaction for `target`, or `null` if none exists.
   *
   * Spec S02 (#s02-transaction-manager)
   */
  getActiveTransaction(target: HTMLElement): MutationTransaction | null {
    return this._transactions.get(target) ?? null;
  }

  /**
   * Return `true` if `property` is currently being previewed in an active
   * transaction on `element`.
   *
   * Used by `StyleCascadeReader` to identify the `preview` source layer.
   *
   * Spec S02 (#s02-transaction-manager)
   */
  isPreviewProperty(element: HTMLElement, property: string): boolean {
    const tx = this._transactions.get(element);
    if (!tx) return false;
    return tx.previewedProperties.has(property);
  }

  /**
   * Cancel all active transactions across all tracked elements.
   *
   * Each transaction is cancelled (restoring original values) and removed
   * from the Map.
   *
   * Spec S02 (#s02-transaction-manager)
   */
  cancelAll(): void {
    for (const [element, tx] of this._transactions) {
      tx.cancel();
      this._transactions.delete(element);
    }
  }

  /**
   * Clear all active transactions and reset the ID counter.
   *
   * Cancels (and restores) all active transactions, clears the Map, and
   * resets the internal counter to 0. The next `beginTransaction()` call will
   * produce `"tx-1"`.
   *
   * For test cleanup only.
   *
   * Spec S02 (#s02-transaction-manager)
   */
  reset(): void {
    for (const [, tx] of this._transactions) {
      tx.cancel();
    }
    this._transactions.clear();
    this._counter = 0;
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton ([D02])
// ---------------------------------------------------------------------------

/**
 * Module-level singleton instance of MutationTransactionManager.
 *
 * Import this in components and action handlers to begin, commit, or cancel
 * transactions. Tests call `.reset()` between cases to clear state.
 *
 * [D02] MutationTransactionManager is a module-level singleton
 * Spec S02 (#s02-transaction-manager)
 */
export const mutationTransactionManager = new MutationTransactionManager();
