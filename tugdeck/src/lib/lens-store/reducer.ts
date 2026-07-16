/**
 * Pure reducer for the Lens store. No side effects, no DOM, no
 * tugbank — the class wrapper drives persistence on top of this
 * reducer.
 *
 * Reference stability: when an event produces no observable change the
 * reducer returns the SAME state reference (and each list keeps its own
 * reference) so `useSyncExternalStore` consumers don't observe spurious
 * notifications.
 *
 * @module lib/lens-store/reducer
 */

import {
  DEFAULT_LENS_ANCHOR_SIDE,
  DEFAULT_LENS_WIDTH_PX,
  MIN_LENS_WIDTH_PX,
  type LensAnchorSide,
  type LensSnapshot,
} from "./types";

/**
 * Reducer-internal state. Currently identical to the public snapshot,
 * kept distinct so future internal fields don't leak through
 * `getSnapshot`.
 */
export interface LensState {
  widthPx: number;
  sectionOrder: readonly string[];
  hiddenSections: readonly string[];
  collapsedSections: readonly string[];
  anchorSide: LensAnchorSide;
}

export type LensEvent =
  | { type: "set_width"; widthPx: number }
  | { type: "set_section_order"; order: readonly string[] }
  | { type: "set_hidden"; kind: string; hidden: boolean }
  | { type: "set_collapsed"; kind: string; collapsed: boolean }
  | { type: "set_anchor_side"; side: LensAnchorSide }
  | {
      /**
       * Apply hydrated values from tugbank. Each field is optional — a
       * missing key keeps the existing in-state value. Malformed values
       * (e.g. a non-array `sectionOrder`) are rejected by the reader
       * before reaching here.
       */
      type: "hydrate";
      widthPx?: number;
      sectionOrder?: readonly string[];
      hiddenSections?: readonly string[];
      collapsedSections?: readonly string[];
      anchorSide?: LensAnchorSide;
    };

export function createInitialState(): LensState {
  return {
    widthPx: DEFAULT_LENS_WIDTH_PX,
    sectionOrder: [],
    hiddenSections: [],
    collapsedSections: [],
    anchorSide: DEFAULT_LENS_ANCHOR_SIDE,
  };
}

/**
 * Clamp a candidate width to the floor; the ceiling depends on
 * `window.innerWidth` and is enforced at the consumer layer, not here —
 * the reducer stays pure and viewport-agnostic.
 */
function clampWidthFloor(widthPx: number): number {
  if (!Number.isFinite(widthPx)) return DEFAULT_LENS_WIDTH_PX;
  return widthPx < MIN_LENS_WIDTH_PX ? MIN_LENS_WIDTH_PX : widthPx;
}

/** Shallow value-equality for two string lists. */
function listsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Toggle a kind's membership in a list. Returns the SAME reference when
 * the membership already matches the desired state.
 */
function withMembership(
  list: readonly string[],
  kind: string,
  member: boolean,
): readonly string[] {
  const present = list.includes(kind);
  if (present === member) return list;
  if (member) return [...list, kind];
  return list.filter((k) => k !== kind);
}

/**
 * Pure reducer. Returns the same state reference when an event
 * produces no observable change.
 */
export function reduce(state: LensState, event: LensEvent): LensState {
  switch (event.type) {
    case "set_width": {
      const clamped = clampWidthFloor(event.widthPx);
      if (clamped === state.widthPx) return state;
      return { ...state, widthPx: clamped };
    }

    case "set_section_order": {
      if (listsEqual(state.sectionOrder, event.order)) return state;
      return { ...state, sectionOrder: [...event.order] };
    }

    case "set_hidden": {
      const next = withMembership(state.hiddenSections, event.kind, event.hidden);
      if (next === state.hiddenSections) return state;
      return { ...state, hiddenSections: next };
    }

    case "set_collapsed": {
      const next = withMembership(
        state.collapsedSections,
        event.kind,
        event.collapsed,
      );
      if (next === state.collapsedSections) return state;
      return { ...state, collapsedSections: next };
    }

    case "set_anchor_side": {
      if (event.side === state.anchorSide) return state;
      return { ...state, anchorSide: event.side };
    }

    case "hydrate": {
      let next = state;
      const bump = (): void => {
        next = next === state ? { ...state } : next;
      };
      if (event.widthPx !== undefined) {
        const clamped = clampWidthFloor(event.widthPx);
        if (clamped !== state.widthPx) {
          bump();
          next.widthPx = clamped;
        }
      }
      if (
        event.sectionOrder !== undefined &&
        !listsEqual(state.sectionOrder, event.sectionOrder)
      ) {
        bump();
        next.sectionOrder = [...event.sectionOrder];
      }
      if (
        event.hiddenSections !== undefined &&
        !listsEqual(state.hiddenSections, event.hiddenSections)
      ) {
        bump();
        next.hiddenSections = [...event.hiddenSections];
      }
      if (
        event.collapsedSections !== undefined &&
        !listsEqual(state.collapsedSections, event.collapsedSections)
      ) {
        bump();
        next.collapsedSections = [...event.collapsedSections];
      }
      if (
        event.anchorSide !== undefined &&
        event.anchorSide !== state.anchorSide
      ) {
        bump();
        next.anchorSide = event.anchorSide;
      }
      return next;
    }

    default:
      return state;
  }
}

/**
 * Project the reducer state into the public snapshot. Returns the same
 * reference when the input is unchanged so `useSyncExternalStore`
 * consumers stay quiescent.
 */
export function toSnapshot(state: LensState): LensSnapshot {
  return state;
}

export { clampWidthFloor };
