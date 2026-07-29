/**
 * Measuring text against the face that will actually render it.
 *
 * Two traps this module exists to close.
 *
 * **`document.fonts.ready` is not "the fonts are loaded".** It resolves when
 * the loads that are *currently pending* finish. A face declared in
 * `@font-face` is not fetched until layout asks for it, so code that awaits
 * `ready` early — during mount, before the run it cares about has been laid
 * out — is awaiting an empty queue. It resolves immediately, the run is still
 * showing its fallback, and anything measured then reports the fallback's
 * width with complete confidence. {@link whenFaceLoaded} instead *requests*
 * the element's own face and waits for that specific face, which is a promise
 * about the thing being measured rather than about the document.
 *
 * **Canvas measurement needs the same face the element has.**
 * {@link textMeasurer} builds its context font from the element's computed
 * style, so the two cannot drift apart.
 */

/** The CSS `font` shorthand for `el`'s computed type. */
function fontShorthand(style: CSSStyleDeclaration): string {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

/**
 * Resolves once the face `el` renders in is available for `text` — having
 * asked for it first, rather than assuming something else already did.
 *
 * Never rejects: a face that fails to load leaves the element on its
 * fallback, which is a legitimate thing to measure and better than a caller
 * that never runs at all.
 */
export function whenFaceLoaded(el: HTMLElement, text: string): Promise<void> {
  const shorthand = fontShorthand(window.getComputedStyle(el));
  return document.fonts
    .load(shorthand, text)
    .then(() => undefined)
    .catch(() => undefined);
}

/** A width function for `el`'s exact rendered type, or null with no canvas. */
export function textMeasurer(el: HTMLElement): ((s: string) => number) | null {
  const ctx = document.createElement("canvas").getContext("2d");
  if (ctx === null) return null;
  const style = window.getComputedStyle(el);
  ctx.font = fontShorthand(style);
  const tracking = parseFloat(style.letterSpacing);
  const perChar = Number.isFinite(tracking) ? tracking : 0;
  return (s: string) => ctx.measureText(s).width + perChar * s.length;
}
