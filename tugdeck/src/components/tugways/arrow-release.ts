/**
 * arrow-release — when a DOM-focused text surface gives an arrow back to the
 * spatial plane ([P03]).
 *
 * A focused text-editing host normally owns every arrow for its caret. Two things
 * override that:
 *
 *  - an explicit `data-tug-arrow-release` attribute on the focused element, a
 *    space-separated list of `up`/`down`/`left`/`right` — the substrate channel
 *    (the text editor projects its emptiness and its boundary latch into it);
 *  - the automatic rule for a single-line field: an EMPTY textual `<input>` that
 *    sits inside the engine's current key view has no caret motion to protect, so
 *    it releases all four directions. That is what makes a filter field
 *    transparent to arrows without any per-component wiring.
 *
 * The policy is a pure function over a plain structural value, and the single DOM
 * read that builds that value is a separate adapter. tugdeck's `bun test` runs
 * DOM-free, so the policy is unit-testable and the adapter is covered end-to-end
 * by the app-tests (the Lens and picker traversals fail outright if its
 * `inKeyView` read is wrong).
 */

import type { SpatialDirection } from "./spatial-order";

/** The structural view of a focused element the release policy reads. */
export interface ArrowReleaseSubject {
  /** Uppercased `tagName`. */
  tag: string;
  contentEditable: boolean;
  /** The `type` attribute, or `null` when absent. */
  inputType: string | null;
  /** The input's value; `null` for non-inputs. */
  value: string | null;
  /** `data-tug-arrow-release`, or `null` when the attribute is absent. */
  releaseAttr: string | null;
  /** Whether the element is, or is contained in, the `[data-key-view]` element. */
  inKeyView: boolean;
}

/** `<input>` types that hold prose, and so behave like a text field. */
const TEXTUAL_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel"]);

/**
 * Read the one DOM fact the policy needs from the currently focused element.
 * Returns `null` when there is no active element.
 *
 * `inKeyView` is a **containment** test, deliberately: the projection stamps
 * `data-key-view` on the element resolved from `[data-responder-id]` /
 * `[data-tug-focusable]`, which for a composite field (a `TugFilterField`) is the
 * wrapper — while `document.activeElement` is the inner `<input>`. An
 * attribute-on-the-active-element test would therefore never match, and every
 * filter field in the app would silently hold its arrows.
 */
export function arrowReleaseSubject(active: Element | null): ArrowReleaseSubject | null {
  if (active === null) return null;
  const html = active instanceof HTMLElement ? active : null;
  const input = active instanceof HTMLInputElement ? active : null;
  return {
    tag: active.tagName.toUpperCase(),
    contentEditable: html?.isContentEditable ?? false,
    inputType: active.getAttribute("type"),
    value: input === null ? null : input.value,
    releaseAttr: active.getAttribute("data-tug-arrow-release"),
    inKeyView: active.closest("[data-key-view]") !== null,
  };
}

/**
 * Whether a focused surface keeps this arrow for its caret, releases it to the
 * spatial plane, or is not a text surface at all (in which case the caller's own
 * gate decides — the arrow was never the surface's to keep).
 *
 * Callers must apply the repeat rule themselves: a `"released"` verdict on
 * `event.repeat` is treated as `"held"`, so crossing out of a text surface is
 * always a discrete press.
 */
export function resolveArrowRelease(
  subject: ArrowReleaseSubject | null,
  direction: SpatialDirection,
): "not-text" | "released" | "held" {
  if (subject === null) return "not-text";
  const isText =
    subject.contentEditable || subject.tag === "INPUT" || subject.tag === "TEXTAREA";
  if (!isText) return "not-text";
  // The attribute is authoritative wherever it is present — including as the empty
  // string, which releases nothing. A substrate that projects it owns every one of
  // its exits, and the automatic rule must not second-guess it.
  if (subject.releaseAttr !== null) {
    return subject.releaseAttr.split(/\s+/).includes(direction) ? "released" : "held";
  }
  // Automatic release: a single-line textual field with no text has no caret motion
  // to protect, in any direction ([Q03]). Multi-line surfaces (TEXTAREA,
  // contentEditable) own their emptiness semantics through the attribute instead.
  if (subject.tag !== "INPUT") return "held";
  if (subject.inputType !== null && !TEXTUAL_INPUT_TYPES.has(subject.inputType)) {
    return "held";
  }
  if (subject.value !== "") return "held";
  // The key-view gate keeps a plain non-engine form untouched, and stops a stale
  // engine key view from being walked while an unrelated input holds focus.
  return subject.inKeyView ? "released" : "held";
}
