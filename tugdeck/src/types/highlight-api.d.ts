/**
 * Ambient TypeScript declarations for the CSS Custom Highlight API.
 *
 * The CSS Custom Highlight API (CSS.highlights, Highlight constructor,
 * ::highlight()) is not included in the default ES2020 lib. These ambient
 * declarations extend the global environment so TypeScript recognizes the API
 * without requiring a newer lib target.
 *
 * This file is automatically included by the "include": ["src/ ** /*.ts"]
 * glob in tsconfig.json.
 *
 * Authoritative references:
 *   - Phase 5f2 Step 2 [D03] CSS Custom Highlight API, Spec S02
 *   - https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API
 */

/**
 * A CSS Custom Highlight — a named set of Range objects painted with
 * ::highlight(<name>) in CSS. Independent of the browser's global Selection.
 *
 * The Highlight object has a Set-like interface: use add(range) to add
 * a Range, delete(range) to remove one, and clear() to remove all.
 */
declare class Highlight {
  constructor(...ranges: Range[]);
  add(range: Range): this;
  delete(range: Range): boolean;
  clear(): void;
  has(range: Range): boolean;
  readonly size: number;
  [Symbol.iterator](): Iterator<Range>;
}

/**
 * The HighlightRegistry maps highlight names to Highlight objects.
 * Accessed via CSS.highlights.
 */
interface HighlightRegistry {
  set(name: string, highlight: Highlight): this;
  get(name: string): Highlight | undefined;
  delete(name: string): boolean;
  has(name: string): boolean;
  clear(): void;
}

/**
 * Extend the global CSS namespace to include highlights.
 *
 * The CSS global is declared in lib.dom.d.ts as an interface CSS and
 * namespace typeof CSS. We extend the CSS interface here. Because TypeScript
 * merges interface declarations, this adds highlights to the existing CSS
 * type without conflicting with any existing members.
 */
interface CSS {
  highlights: HighlightRegistry;
}
