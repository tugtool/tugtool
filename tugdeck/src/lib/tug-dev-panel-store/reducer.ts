/**
 * Pure reducer for `TugDevPanelStore`. No side effects, no DOM, no
 * tugbank — the class wrapper drives persistence on top of this
 * reducer.
 *
 * Reference stability: when an event produces no state change, the
 * reducer returns the SAME state reference so `useSyncExternalStore`
 * consumers don't observe spurious notifications.
 *
 * @module lib/tug-dev-panel-store/reducer
 */

import {
  DEFAULT_DEV_PANEL_TAB,
  DEFAULT_DEV_PANEL_WIDTH_PX,
  MIN_DEV_PANEL_WIDTH_PX,
  VALID_DEV_PANEL_TABS,
  type TugDevPanelSnapshot,
  type TugDevPanelTabId,
} from "./types";

/**
 * Reducer-internal state. Currently identical to the public snapshot,
 * but kept distinct so future internal fields (e.g. a "last-rendered
 * at" diagnostic) can be added without leaking through `getSnapshot`.
 */
export interface TugDevPanelState {
  open: boolean;
  activeTab: TugDevPanelTabId;
  selectedCardId: string | null;
  widthPx: number;
}

export type TugDevPanelEvent =
  | { type: "toggle" }
  | { type: "set_open"; open: boolean }
  | { type: "select_tab"; tab: TugDevPanelTabId }
  | { type: "select_card"; cardId: string | null }
  | { type: "set_width"; widthPx: number }
  | {
      /**
       * Apply hydrated values from tugbank. Each field is optional —
       * a missing key keeps the existing in-state value. Invalid
       * values (e.g. an unrecognized tab id) are silently rejected
       * and the existing value is kept.
       */
      type: "hydrate";
      open?: boolean;
      activeTab?: string;
      selectedCardId?: string | null;
      widthPx?: number;
    }
  | {
      /**
       * The selected card disappeared (was closed). The reducer
       * clears `selectedCardId` only when it matches the gone id;
       * other selections are untouched.
       */
      type: "card_gone";
      cardId: string;
    };

export function createInitialState(): TugDevPanelState {
  return {
    open: false,
    activeTab: DEFAULT_DEV_PANEL_TAB,
    selectedCardId: null,
    widthPx: DEFAULT_DEV_PANEL_WIDTH_PX,
  };
}

/**
 * Clamp a candidate width to the floor; the ceiling depends on
 * `window.innerWidth` and is enforced at the consumer (component)
 * layer, not here — the reducer stays pure and viewport-agnostic.
 */
function clampWidthFloor(widthPx: number): number {
  if (!Number.isFinite(widthPx)) return DEFAULT_DEV_PANEL_WIDTH_PX;
  return widthPx < MIN_DEV_PANEL_WIDTH_PX ? MIN_DEV_PANEL_WIDTH_PX : widthPx;
}

/**
 * Pure reducer. Returns the same state reference when an event
 * produces no observable change.
 */
export function reduce(
  state: TugDevPanelState,
  event: TugDevPanelEvent,
): TugDevPanelState {
  switch (event.type) {
    case "toggle":
      return { ...state, open: !state.open };

    case "set_open":
      if (state.open === event.open) {
        return state;
      }
      return { ...state, open: event.open };

    case "select_tab":
      if (state.activeTab === event.tab) {
        return state;
      }
      return { ...state, activeTab: event.tab };

    case "select_card":
      if (state.selectedCardId === event.cardId) {
        return state;
      }
      return { ...state, selectedCardId: event.cardId };

    case "set_width": {
      const clamped = clampWidthFloor(event.widthPx);
      if (clamped === state.widthPx) return state;
      return { ...state, widthPx: clamped };
    }

    case "hydrate": {
      let next = state;
      if (event.open !== undefined && event.open !== state.open) {
        next = next === state ? { ...state } : next;
        next.open = event.open;
      }
      if (
        event.activeTab !== undefined &&
        isValidTab(event.activeTab) &&
        event.activeTab !== state.activeTab
      ) {
        next = next === state ? { ...state } : next;
        next.activeTab = event.activeTab;
      }
      if (
        event.selectedCardId !== undefined &&
        event.selectedCardId !== state.selectedCardId
      ) {
        next = next === state ? { ...state } : next;
        next.selectedCardId = event.selectedCardId;
      }
      if (event.widthPx !== undefined) {
        const clamped = clampWidthFloor(event.widthPx);
        if (clamped !== state.widthPx) {
          next = next === state ? { ...state } : next;
          next.widthPx = clamped;
        }
      }
      return next;
    }

    case "card_gone":
      if (state.selectedCardId !== event.cardId) {
        return state;
      }
      return { ...state, selectedCardId: null };

    default:
      return state;
  }
}

/**
 * Project the reducer state into the public snapshot. Returns the
 * same reference when the input reference is unchanged so
 * `useSyncExternalStore` consumers stay quiescent.
 */
export function toSnapshot(state: TugDevPanelState): TugDevPanelSnapshot {
  // Currently 1:1; reified as a helper so future internal fields
  // don't bleed through.
  return state;
}

// Re-export so the helper can be used at the consumer for the
// viewport-aware ceiling clamp.
export { clampWidthFloor };

function isValidTab(value: string): value is TugDevPanelTabId {
  return VALID_DEV_PANEL_TABS.has(value as TugDevPanelTabId);
}
