/**
 * Wrapping a run of text in place — how an entity found *inside* a longer
 * string becomes its own element.
 *
 * Whole-element annotation is the easy case: an inline `<code>` span that
 * is entirely one path gets the marks stamped on the span it already has.
 * But the shapes that matter most in real ink are not their own element —
 * a filename in the middle of a sentence, a path buried in a command line
 * — and marking those means splitting the text node they live in and
 * giving the run an element of its own.
 *
 * Wrappers are marked `data-tugx-wrapped` so a later pass can tell the
 * elements this pass created from the ones the renderer did. That
 * matters because a verdict can change: a wrapper whose entity no longer
 * resolves is unwrapped and its text folded back into its neighbours, so
 * the DOM stays a function of what is currently known rather than an
 * accumulation of everything ever believed.
 *
 * @module lib/annotator/wrap-matches
 */

import { stampAnnotation } from "./annotation-element";
import type { AnnotationPayload } from "./payloads";
import { ANNOTATION_CLASS } from "./types";

/** Marks an element this pass created, rather than the renderer. */
export const WRAPPED_ATTRIBUTE = "data-tugx-wrapped";

/** A run of a text node that should become its own element. */
export interface TextRunMatch {
  /** Index of the run's first character in the text node's data. */
  start: number;
  /** Index one past the run's last character. */
  end: number;
  /** What the run is. */
  payload: AnnotationPayload;
}

/** A text node to scan, and how much license the scan has over it. */
export interface TextNodeSite {
  node: Text;
  /**
   * Whether the text is code — an inline `<code>` span, or an element a
   * component handed the annotator directly (a tool-call header). Code is
   * where a reference is a reference; running prose is where a word that
   * looks like a filename is usually just a word.
   */
  inCode: boolean;
}

/**
 * Every text node under `root` that entity detection should look at.
 *
 * Collected up front, because wrapping replaces nodes as it goes and a
 * live walk would trip over its own edits. The skipped subtrees are the
 * ones where a match would be wrong rather than merely redundant:
 *
 *  - `<a>` — already a link; a path inside its label is not a second one.
 *  - `<pre>` — fenced code is content being shown, not references being
 *    made. (Inline `<code>` is *not* skipped: that is where paths live.)
 *  - anything already annotated — including this pass's own wrappers, so
 *    re-running never nests a wrapper inside a wrapper.
 */
export function collectTextNodes(root: HTMLElement): TextNodeSite[] {
  const found: TextNodeSite[] = [];
  // A component that hands its own `<code>` to the annotator is asking
  // for the whole of it to be read as code, so the root counts too.
  const rootInCode =
    root.tagName === "CODE" || root.closest?.("code") !== null;
  const visit = (node: Node, inCode: boolean): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        found.push({ node: child as Text, inCode });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as HTMLElement;
      if (element.tagName === "A" || element.tagName === "PRE") continue;
      if (element.classList.contains(ANNOTATION_CLASS)) continue;
      visit(element, inCode || element.tagName === "CODE");
    }
  };
  visit(root, rootInCode);
  return found;
}

/**
 * Replace `node` with its text split around `matches`, each match wrapped
 * in an annotated `<span>`.
 *
 * Matches must be sorted by `start`; any that overlaps one already taken
 * is skipped, so a caller that produces two readings of the same run gets
 * the first rather than a corrupted node.
 */
export function wrapMatchesInTextNode(
  node: Text,
  matches: readonly TextRunMatch[],
): void {
  const parent = node.parentNode;
  if (parent === null || matches.length === 0) return;
  const document = node.ownerDocument;
  const text = node.data;
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor || match.end > text.length) continue;
    if (match.start > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, match.start)));
    }
    const span = document.createElement("span");
    span.setAttribute(WRAPPED_ATTRIBUTE, "");
    span.textContent = text.slice(match.start, match.end);
    stampAnnotation(span, match.payload);
    fragment.appendChild(span);
    cursor = match.end;
  }
  if (cursor === 0) return;
  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }
  parent.replaceChild(fragment, node);
}

/**
 * Undo one wrapper, folding its text back into the surrounding prose.
 * Normalizing the parent merges the neighbouring text nodes, so the next
 * pass sees one run again and can find a match that spans what used to be
 * the boundary.
 */
export function unwrapMatch(element: HTMLElement): void {
  const parent = element.parentNode;
  if (parent === null) return;
  const text = element.textContent ?? "";
  parent.replaceChild(element.ownerDocument.createTextNode(text), element);
  parent.normalize();
}
