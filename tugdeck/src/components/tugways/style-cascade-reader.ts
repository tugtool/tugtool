/**
 * style-cascade-reader.ts -- StyleCascadeReader utility for read-only style
 * introspection.
 *
 * Provides a stateless interface to determine where a CSS property value
 * originates in the cascade: from an active preview transaction, an inline
 * style, a class rule, or a design token on the document root.
 *
 * Design decisions:
 *   [D03] StyleCascadeReader is a stateless utility
 *
 * Spec S03
 *
 * See also: tugplan-tugways-phase-5d3-mutation-transactions.md
 */

import {
  MutationTransactionManager,
  mutationTransactionManager,
} from "./mutation-transaction";

// ---------------------------------------------------------------------------
// StyleLayer interface
// ---------------------------------------------------------------------------

/**
 * The value and origin layer for a CSS property as reported by
 * `StyleCascadeReader.getDeclared()`.
 *
 * Source layers (highest to lowest priority):
 *   - `preview`  -- actively being changed by a MutationTransaction
 *   - `inline`   -- set via element.style (no active transaction)
 *   - `token`    -- custom property (--prefixed) inherited from document root
 *   - `class`    -- computed value from a class rule or element-scoped custom property
 *
 * Spec S03 (#s03-cascade-reader)
 */
export interface StyleLayer {
  value: string;
  source: "token" | "class" | "inline" | "preview";
}

// ---------------------------------------------------------------------------
// GetComputedStyleFn type (for testability)
// ---------------------------------------------------------------------------

/**
 * Type alias for the `getComputedStyle` function signature.
 * Injected via constructor to allow test mocking without relying on
 * global spy patching (which is unreliable in bun test worker contexts).
 */
export type GetComputedStyleFn = (elt: Element) => CSSStyleDeclaration;

// ---------------------------------------------------------------------------
// StyleCascadeReader class
// ---------------------------------------------------------------------------

/**
 * Read-only style introspection utility.
 *
 * Methods are stateless: they query the DOM and the MutationTransactionManager
 * on each call and carry no internal state of their own. The manager reference
 * and `getComputedStyle` function are injected via the constructor for
 * testability.
 *
 * [D03] StyleCascadeReader is a stateless utility
 * Spec S03 (#s03-cascade-reader)
 */
export class StyleCascadeReader {
  private _manager: MutationTransactionManager;
  private _getComputedStyle: GetComputedStyleFn;

  /**
   * @param manager - The MutationTransactionManager to consult for active
   *   preview transactions. Defaults to the module-level singleton but can be
   *   overridden in tests.
   * @param getComputedStyleFn - The `getComputedStyle` implementation to use.
   *   Defaults to the global `getComputedStyle`. Injectable for testing in
   *   environments (e.g., bun/happy-dom) where global spy patching is
   *   unreliable.
   */
  constructor(
    manager: MutationTransactionManager,
    getComputedStyleFn?: GetComputedStyleFn
  ) {
    this._manager = manager;
    // Default lazily to globalThis.getComputedStyle at call time (not at
    // construction time) to avoid module-level evaluation failures in test
    // environments where the DOM global is installed after module load.
    this._getComputedStyle =
      getComputedStyleFn ??
      ((elt: Element) => globalThis.getComputedStyle(elt));
  }

  /**
   * Determine the declared source layer for a CSS property on an element.
   *
   * Follows the Table T01 detection algorithm (highest priority first):
   *
   * 1. **preview** -- `manager.isPreviewProperty(element, property)` is true.
   *    Value comes from `element.style.getPropertyValue(property)` (the
   *    currently previewed inline value set by the transaction).
   *
   * 2. **inline** -- `element.style.getPropertyValue(property)` is non-empty
   *    (no active transaction for this property).
   *
   * 3. **token** -- Property name starts with `--`, the computed value on the
   *    element equals the computed value on `document.documentElement` (the
   *    element inherits the root-level custom property, not a class-scoped
   *    override).
   *
   * 4. **class** -- `getComputedStyle(element).getPropertyValue(property)` is
   *    non-empty (value comes from a class rule or element-local custom
   *    property override).
   *
   * Returns `null` if no value is found at any layer.
   *
   * **Heuristic limitations (Risk R01):**
   *   - (1) If an inline style was explicitly set to `inherit`, `initial`, or
   *     `unset`, `element.style.getPropertyValue()` returns that keyword as a
   *     non-empty string and this method reports `source: 'inline'` -- which is
   *     technically correct. However, if the property was not set inline but
   *     the computed value happens to equal an `initial` browser default, the
   *     method may still correctly report `class`. The edge case arises only
   *     when an inline style is *explicitly* set to `initial`/`unset` -- in
   *     that case the reported source is `inline` (correct), but the value
   *     may look like a class value to callers who inspect it.
   *   - (2) If a class rule sets a custom property to the same value as the
   *     root token, `getDeclared` will misreport `source: 'token'` instead of
   *     `'class'` because the element-vs-root value comparison produces a
   *     match. The conservative fallback is to report `token` in the ambiguous
   *     case; callers should treat `token` as "probably a token" rather than
   *     a guaranteed guarantee.
   *
   * Spec S03 (#s03-cascade-reader), Table T01 (#t01-source-detection)
   */
  getDeclared(element: HTMLElement, property: string): StyleLayer | null {
    // Priority 1: active preview transaction
    if (this._manager.isPreviewProperty(element, property)) {
      const value = element.style.getPropertyValue(property);
      return { value, source: "preview" };
    }

    // Priority 2: inline style (no active preview)
    const inlineValue = element.style.getPropertyValue(property);
    if (inlineValue !== "") {
      return { value: inlineValue, source: "inline" };
    }

    // Priority 3 & 4: computed style
    const computedValue = this._getComputedStyle(element)
      .getPropertyValue(property)
      .trim();
    if (computedValue === "") {
      return null;
    }

    // Priority 3: token -- custom property that matches the document root value
    if (property.startsWith("--")) {
      const rootValue = this._getComputedStyle(document.documentElement)
        .getPropertyValue(property)
        .trim();
      if (rootValue !== "" && computedValue === rootValue) {
        return { value: computedValue, source: "token" };
      }
    }

    // Priority 4: class (computed from stylesheet rules or element-local custom
    // property override)
    return { value: computedValue, source: "class" };
  }

  /**
   * Return the computed style value for `property` on `element`.
   *
   * A thin wrapper around `getComputedStyle(element).getPropertyValue(property)`.
   * Returns an empty string if the property has no computed value.
   *
   * Spec S03 (#s03-cascade-reader)
   */
  getComputed(element: HTMLElement, property: string): string {
    return this._getComputedStyle(element).getPropertyValue(property);
  }

  /**
   * Return the value of a design token (custom property) from the document
   * root element.
   *
   * Reads from `getComputedStyle(document.documentElement)`. Returns an empty
   * string if the token is not defined.
   *
   * Spec S03 (#s03-cascade-reader)
   */
  getTokenValue(tokenName: string): string {
    return this._getComputedStyle(document.documentElement).getPropertyValue(tokenName);
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton ([D03])
// ---------------------------------------------------------------------------

/**
 * Module-level singleton instance of StyleCascadeReader.
 *
 * Constructed with the `mutationTransactionManager` singleton so that preview
 * source detection is wired automatically. Tests that need to inject a custom
 * manager or `getComputedStyle` implementation should construct their own
 * `StyleCascadeReader` instance directly.
 *
 * [D03] StyleCascadeReader is a stateless utility
 * Spec S03 (#s03-cascade-reader)
 */
export const styleCascadeReader = new StyleCascadeReader(mutationTransactionManager);
