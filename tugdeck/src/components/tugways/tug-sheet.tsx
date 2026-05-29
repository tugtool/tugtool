/**
 * TugSheet — pane-modal dialog scoped to a single pane.
 *
 * Original component (not a Radix wrapper). Drops from the pane title bar
 * like a window shade. Uses Radix FocusScope for focus trapping. The
 * pane body gets `inert` for keyboard-routing scope; the pane's
 * built-in scrim layer (raised via `useTugPaneScrim()`) provides the
 * visual + pointer dead zone within the host pane. Peer panes remain
 * fully interactive.
 *
 * Compound API: TugSheet (Root) / TugSheetTrigger / TugSheetContent.
 * The panel + slide-in clip portal into the host pane's frame element
 * via `TugPaneFrameContext` so the panel sits inside the pane's
 * stacking context [D19, D20]. Peer panes z-stacked above paint above
 * the panel without manual z coordination — modal scope IS the pane.
 * Open state is internal — consumers open the sheet via
 * `TugSheetTrigger` (click-to-open), an imperative ref handle
 * (`TugSheetHandle.open()`), or the `useTugSheet()` hook's
 * `showSheet()` Promise API. There is no public `open`/`onOpenChange`
 * controlled-mode prop; the sheet owns its own open state and exposes
 * close as a chain action.
 *
 * Imperative hook: useTugSheet() — returns { showSheet, renderSheet }.
 * Call renderSheet() once in your component's JSX; call showSheet() anywhere
 * to present a sheet imperatively and await its result.
 *
 * ## Chain-native close path
 *
 * TugSheetContent registers itself as a responder via
 * `useOptionalResponder` with a `cancelDialog` handler that closes the
 * sheet through the internal context's onOpenChange. Inside the sheet,
 * Escape and Cmd+. dispatch `cancelDialog` through the chain and the
 * walk lands back on the sheet's own handler (routed via the input or
 * other focused-responder's parent chain — the sheet is the parent
 * via ResponderScope). Consumer Cancel/Save buttons inside a sheet
 * dispatch `cancelDialog` directly through the chain to close the
 * sheet, matching the pattern established by TugConfirmPopover and
 * TugAlert. [L11]
 *
 * Rendered outside a `ResponderChainProvider`, `useOptionalResponder`
 * no-ops and Escape/Cmd+. fall back to calling the context's
 * onOpenChange directly. Consumer buttons must provide their own
 * close path (e.g., via the imperative ref) in that case.
 *
 * ## No observeDispatch subscription — pane-modal semantics
 *
 * Like TugAlert, TugSheet is modal (pane-scoped via the pane's
 * built-in scrim and `inert` on the pane body). External chain
 * activity — including activity in other panes on the same canvas —
 * should not auto-dismiss a sheet the user has opened. The sheet
 * stays open until the user explicitly closes it via a Cancel
 * button, Save button, Escape, or Cmd+.
 *
 * Laws: [L06] appearance via CSS,
 *       [L11] controls emit actions; responders handle actions,
 *       [L16] pairings declared,
 *       [L19] component authoring guide,
 *       [L20] token sovereignty (composes child controls)
 *
 * @see ./internal/floating-surface-notes.ts for the cross-surface
 *      invariants table covering popover / confirm-popover / alert /
 *      sheet and the chain-reactive vs. modal semantic models.
 * @see `roadmap/tugplan-dev-overlay-framework.md` (#mental-model)
 *      for the system-level architecture covering portals, the
 *      responder chain, focus events, the pane focus controller,
 *      and focus-discipline markers — the five subsystems whose
 *      interaction defines this surface's contract.
 */

import "./tug-sheet.css";

import React, {
  createContext,
  useCallback,
  useContext,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import * as FocusScopeRadix from "@radix-ui/react-focus-scope";
import { TugPaneFrameContext, TugPanePortalContext } from "@/components/chrome/tug-pane";
import { CardIdContext } from "@/lib/card-id-context";
import { useSheetLifecycle } from "@/lib/sheet-lifecycle";
import { group } from "@/components/tugways/tug-animator";
import { useTugPaneScrim } from "@/components/tugways/use-tug-pane-scrim";
import { useResponderChain } from "./responder-chain-provider";
import { useOptionalResponder } from "./use-responder";
import { TUG_ACTIONS } from "./action-vocabulary";
import { suppressButtonFocusShift } from "./internal/safari-focus-shift";
import {
  useComponentStatePreservation,
  useSavedComponentState,
} from "./use-component-state-preservation";
import { TugSheetStackingContext } from "./tug-sheet-stacking-context";

/* ---------------------------------------------------------------------------
 * Presentation styles
 * ---------------------------------------------------------------------------*/

/**
 * Visual entrance/exit style for a TugSheet. Every style lands in the
 * *identical* fully-presented geometry (position, size, centering) —
 * the difference is purely the animated transition into and out of that
 * resting state [L06]. UX is the same across all three; this is a UI
 * affordance only.
 *
 *   - `"top"`        Window-shade drop from the title bar. The panel
 *                    slides down into place and slides back up on
 *                    dismiss. The original window-shade style.
 *   - `"bottom"`     Mirror of `"top"` from the opposite edge: the
 *                    panel slides up into place from below and slides
 *                    back down on dismiss.
 *   - `"scale-fade"` The panel fades in while scaling up from slightly
 *                    smaller, and fades out while scaling back down.
 *                    No directional slide. The default.
 *
 * The resting (pre-enter / post-exit) state for each style is declared
 * in `tug-sheet.css` keyed on `data-tug-sheet-presentation` so the
 * panel is correctly positioned before the JS enter animation runs —
 * no first-paint flash. The keyframes below must stay in sync with
 * those resting states.
 */
export type TugSheetPresentation = "top" | "bottom" | "scale-fade";

/**
 * How wide the sheet panel sits within its host pane.
 *
 *   - `"standard"` The default — a centered panel capped at a comfortable
 *                  reading width (≈460px). Right for confirmations, option
 *                  pickers, and short forms.
 *   - `"wide"`     The panel spans 90% of the host pane's width, for
 *                  information-rich surfaces — tabbed editors, multi-column
 *                  layouts, long lists — that the standard width would cramp.
 *
 * Both share the identical vertical placement and entrance motion; only the
 * resting width differs [L06]. Declared in `tug-sheet.css` keyed on
 * `data-display-width`.
 */
export type TugSheetDisplayWidth = "standard" | "wide";

/** Enter/exit keyframe pair for one presentation style. */
interface SheetPresentationMotion {
  enter: Keyframe[];
  exit: Keyframe[];
}

/**
 * Keyframes per presentation style. The first enter frame (and last
 * exit frame) must match the resting state declared in `tug-sheet.css`
 * for the same `data-tug-sheet-presentation` value, so the panel does
 * not jump when the JS animation takes over from the CSS resting state.
 *
 * Under reduced motion TugAnimator strips the spatial properties and
 * substitutes a short opacity fade; the CSS resting states are reset to
 * the presented geometry in that mode (see `tug-sheet.css`).
 */
const SHEET_PRESENTATION_MOTION: Record<TugSheetPresentation, SheetPresentationMotion> = {
  top: {
    enter: [{ transform: "translateY(-100%)" }, { transform: "translateY(0)" }],
    exit: [{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }],
  },
  bottom: {
    enter: [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }],
    exit: [{ transform: "translateY(0)" }, { transform: "translateY(100%)" }],
  },
  "scale-fade": {
    enter: [
      { transform: "scale(0.96)", opacity: 0 },
      { transform: "scale(1)", opacity: 1 },
    ],
    exit: [
      { transform: "scale(1)", opacity: 1 },
      { transform: "scale(0.96)", opacity: 0 },
    ],
  },
};

/* ---------------------------------------------------------------------------
 * Internal context
 * ---------------------------------------------------------------------------*/

interface TugSheetContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentId: string;
  /**
   * Responder id the <TugSheetContent> registers under. Carried on the
   * context so consumer children can target dispatches directly at the
   * sheet via `manager.sendToTarget(responderId, ...)` — critical for
   * the close path, which must not depend on the sheet being first
   * responder (see `useTugSheetClose` for the canonical usage).
   */
  responderId: string;
}

const TugSheetContext = createContext<TugSheetContextValue | null>(null);

function useTugSheetContext(): TugSheetContextValue {
  const ctx = useContext(TugSheetContext);
  if (!ctx) {
    throw new Error("TugSheet sub-components must be used within <TugSheet>.");
  }
  return ctx;
}

/* ---------------------------------------------------------------------------
 * TugSheetHandle
 * ---------------------------------------------------------------------------*/

/** Imperative handle for TugSheet. */
export interface TugSheetHandle {
  /** Opens the sheet. */
  open(): void;
  /** Closes the sheet. */
  close(): void;
}

/* ---------------------------------------------------------------------------
 * TugSheet (Root)
 * ---------------------------------------------------------------------------*/

/** TugSheet root props. */
export interface TugSheetProps {
  /**
   * Seed the initial open state. Primarily an internal affordance for
   * the `useTugSheet()` hook, which mounts a sheet in an already-open
   * state instead of synthesizing an immediate trigger click. Defaults
   * to false; most consumers never set this and open the sheet via
   * `TugSheetTrigger` or the imperative ref handle.
   */
  defaultOpen?: boolean;
  /**
   * Override the auto-generated responder id. Primarily an internal
   * affordance for `useTugSheet()`, which needs to know the responder
   * id up-front so its close callback can dispatch `cancelDialog` via
   * `sendToTarget` without a context round-trip.
   *
   * Regular consumers never set this; TugSheet auto-generates a stable
   * id via `useId()`.
   */
  responderId?: string;
  /** Trigger + Content children. */
  children: React.ReactNode;
  /**
   * Opt the sheet into the Component State Preservation Protocol
   * ([D13], [A9]). When provided (and rendered inside a card), the
   * open state is captured into
   * `bag.components[componentStatePreservationKey]` at every save
   * trigger and reapplied on the next mount — so a sheet the user
   * opened (and was interacting with) re-opens after reload or
   * cmd-tab. Per-surface payloads (form values inside the sheet,
   * scroll position, etc.) are owned by the consumer's own
   * components, which ride their own `bag.components` keys.
   *
   * `tug-sheet` is uncontrolled-only — open state lives in this
   * component's `useState`, so `restoreState` writes through
   * `setOpen` directly. Marked state-preserving per [A9] / [AT0026].
   */
  componentStatePreservationKey?: string;
}

/** Serialized shape of `TugSheet`'s preserved state. */
interface TugSheetState {
  open: boolean;
}

/**
 * TugSheet root — manages open/close state and provides context.
 *
 * Compose with TugSheetTrigger and TugSheetContent:
 * ```tsx
 * <TugSheet>
 *   <TugSheetTrigger asChild><TugPushButton>Open</TugPushButton></TugSheetTrigger>
 *   <TugSheetContent title="Settings">…</TugSheetContent>
 * </TugSheet>
 * ```
 */
export const TugSheet = React.forwardRef<TugSheetHandle, TugSheetProps>(
  function TugSheet({ defaultOpen = false, responderId: responderIdProp, children, componentStatePreservationKey }, ref) {
    const savedSheetState = useSavedComponentState<TugSheetState>(
      componentStatePreservationKey,
    );
    const [open, setOpen] = useState<boolean>(() =>
      typeof savedSheetState?.open === "boolean"
        ? savedSheetState.open
        : defaultOpen,
    );
    const contentId = useId();
    const fallbackResponderId = useId();
    const responderId = responderIdProp ?? fallbackResponderId;

    const handleOpenChange = useCallback((next: boolean) => {
      setOpen(next);
    }, []);

    // Opt-in Component State Preservation Protocol. Hook no-ops when
    // `componentStatePreservationKey` is undefined or rendered outside
    // a card. The mount-in-saved-state half lives above in `useState`'s
    // initializer. [AT0026] state-preserving classification.
    useComponentStatePreservation<TugSheetState>({
      componentStatePreservationKey,
      captureState: () => ({ open }),
    });

    useImperativeHandle(ref, () => ({
      open() {
        handleOpenChange(true);
      },
      close() {
        handleOpenChange(false);
      },
    }));

    return (
      <TugSheetContext value={{ open, onOpenChange: handleOpenChange, contentId, responderId }}>
        {children}
      </TugSheetContext>
    );
  },
);

/* ---------------------------------------------------------------------------
 * TugSheetTrigger
 * ---------------------------------------------------------------------------*/

/** TugSheetTrigger props. */
export interface TugSheetTriggerProps {
  /**
   * Render as child element, merging ARIA + click handler onto it.
   * @default true
   */
  asChild?: boolean;
  children: React.ReactNode;
}

/**
 * TugSheetTrigger — wraps a single child, merging ARIA attributes and open handler.
 *
 * Defaults to asChild so the caller's element is used directly.
 */
export function TugSheetTrigger({ asChild = true, children }: TugSheetTriggerProps) {
  const { open, onOpenChange, contentId } = useTugSheetContext();

  if (!asChild) {
    return (
      <button
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? contentId : undefined}
        onClick={() => onOpenChange(true)}
      >
        {children}
      </button>
    );
  }

  // asChild: merge props onto the single child element.
  const child = React.Children.only(children) as React.ReactElement<
    React.HTMLAttributes<HTMLElement> & {
      "aria-haspopup"?: string;
      "aria-expanded"?: boolean;
      "aria-controls"?: string;
    }
  >;

  return React.cloneElement(child, {
    "aria-haspopup": "dialog",
    "aria-expanded": open,
    "aria-controls": open ? contentId : undefined,
    onClick: (e: React.MouseEvent) => {
      // Call original onClick if present.
      const original = child.props.onClick as ((e: React.MouseEvent) => void) | undefined;
      original?.(e);
      onOpenChange(true);
    },
  });
}

/* ---------------------------------------------------------------------------
 * TugSheetContent
 * ---------------------------------------------------------------------------*/

/** TugSheetContent props. */
export interface TugSheetContentProps {
  /**
   * Sheet title (required — renders in header row, wired to aria-labelledby).
   */
  title: string;
  /**
   * Optional description text (wired to aria-describedby).
   */
  description?: string;
  /**
   * Override initial focus target. Call event.preventDefault() to manage manually.
   */
  onOpenAutoFocus?: (event: Event) => void;
  /**
   * Optional supplier of the close-result, read at the moment
   * `mounted` transitions to false (sheet fully torn down). When
   * provided, the sheet emits `sheetLifecycle.notifySheetDidReturnResult(cardId, getResult())`
   * immediately after `sheetDidHide`, so consumers subscribed via
   * `useSheetDelegate({ sheetDidReturnResult })` receive the
   * result alongside the structural transition.
   *
   * Hook-driven sheets (`useTugSheet`) supply this automatically
   * by closing over the hook's `lastResultRef`. Direct
   * `<TugSheetContent>` consumers that don't track a result omit
   * it; in that case `sheetDidReturnResult` does not fire (only
   * the structural `sheetDidHide` does).
   *
   * The closure-based `onClosed(result)` callback that older code
   * used has been removed in favor of this lifecycle event — a
   * single, observable, per-card pipe replaces N closure-handler
   * threads. See `lib/sheet-lifecycle.ts` for the full contract.
   */
  getResult?: () => string | undefined;
  /**
   * Stable opaque sender id for chain dispatches. Auto-derived via
   * `useId()` if omitted. Parent responders disambiguate multi-sheet
   * pages when observing dispatches by sender. [L11]
   */
  senderId?: string;
  /**
   * Visual entrance/exit style. All styles share the identical
   * fully-presented geometry — only the animated transition differs
   * [L06]. Defaults to `"scale-fade"` (fade in while scaling up). See
   * {@link TugSheetPresentation}.
   */
  presentation?: TugSheetPresentation;
  /**
   * Resting width of the panel within the host pane. Defaults to
   * `"standard"`. See {@link TugSheetDisplayWidth}.
   */
  displayWidth?: TugSheetDisplayWidth;
  /** Arbitrary content. */
  children?: React.ReactNode;
}

/**
 * TugSheetContent — the sheet panel, focus scope, and portal logic.
 *
 * Portals into the pane frame element (from `TugPaneFrameContext`),
 * which is the `.tug-pane` outer frame and its own stacking context.
 * The panel paints inside the pane's stacking context — peer panes
 * z-stacked above paint above the panel automatically [D19, D20].
 *
 * Visual scrim is provided by the pane's built-in scrim layer raised
 * via `useTugPaneScrim()`; this component does not own a scrim
 * element of its own. `inert` is applied to `.tug-pane-body` (read
 * from `TugPanePortalContext`) for keyboard-routing scope. Restores
 * focus to the trigger element on close.
 */
export function TugSheetContent({
  title,
  description,
  onOpenAutoFocus,
  getResult,
  senderId: senderIdProp,
  presentation = "scale-fade",
  displayWidth = "standard",
  children,
}: TugSheetContentProps) {
  const { open, onOpenChange, contentId, responderId } = useTugSheetContext();
  // Chrome ref drives the inert effect (`inert` on `.tug-pane-body`).
  const cardEl = useContext(TugPanePortalContext);
  // Frame ref is the portal target. Pane-modal surfaces portal here so
  // they paint inside the pane's stacking context [D19, D20]; standalone
  // consumers (no TugPane ancestor) fall back to document.body.
  const paneFrameEl = useContext(TugPaneFrameContext);
  // Pane's built-in scrim layer. Show on open, hide on close — the
  // pane's CSS handles the fade transition. [D18]
  const paneScrim = useTugPaneScrim();

  const titleId = `${contentId}-title`;
  const descriptionId = `${contentId}-desc`;

  // Chain manager — null when rendered outside a ResponderChainProvider.
  // Escape / Cmd+. fall back to calling onOpenChange directly in that
  // case; otherwise they dispatch cancelDialog via sendToTarget at the
  // sheet's own responder id so the walk starts inside the sheet
  // regardless of current first-responder state.
  const manager = useResponderChain();

  const fallbackSenderId = useId();
  const senderId = senderIdProp ?? fallbackSenderId;

  // Stable primary close action. Kept here and referenced by both the
  // cancelDialog chain handler and the no-provider keydown fallback so
  // a single function owns the "close the sheet" semantics.
  const closeSheet = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Register the sheet content as a chain responder. The cancelDialog
  // handler closes the sheet; there is no confirmDialog handler (a
  // sheet's "confirm" is the consumer's responsibility — their save
  // logic runs first, then they dispatch cancelDialog to close).
  // Tolerant of no-provider contexts.
  const { ResponderScope, responderRef } = useOptionalResponder({
    id: responderId,
    actions: {
      [TUG_ACTIONS.CANCEL_DIALOG]: closeSheet,
    },
  });

  // Composed ref callback for the sheet content div. Writes to the
  // internal sheetContentRef (used by the enter/exit animation
  // effects) AND hands the element to responderRef which writes
  // data-responder-id. useCallback-stabilized so React doesn't
  // toggle data-responder-id off and on every render.
  const composedContentRef = useCallback(
    (el: HTMLDivElement | null) => {
      sheetContentRef.current = el;
      responderRef(el);
    },
    [responderRef],
  );

  // Presence: keep the portal mounted during the exit animation.
  // `mounted` becomes true when open goes true, and false only after the exit animation completes.
  const [mounted, setMounted] = useState(false);
  const sheetContentRef = useRef<HTMLDivElement | null>(null);

  // ---- Sheet-lifecycle event emission ----
  //
  // Per-card scope: the cardId comes from `CardIdContext` (provided
  // by `CardHost`). When the sheet mounts outside a card host
  // (gallery previews, standalone tests), cardId is null and
  // emission is skipped silently — there is no subscriber that
  // cares about non-card sheets.
  //
  // Four events fire at the structural transitions of the sheet's
  // lifecycle, plus a result-bearing `sheetDidReturnResult`:
  //   - sheetWillShow:        `open` first becomes true.
  //   - sheetDidShow:         enter animation finishes (sheet fully
  //                           presented; inert set on `.tug-pane-body`).
  //   - sheetWillHide:        `open` flips from true to false (close
  //                           initiated; exit animation pending).
  //   - sheetDidHide:         `mounted` transitions from true to
  //                           false (exit animation done, portaled
  //                           DOM removed, inert cleared, FocusScope
  //                           teardown done). This is the focus-
  //                           claim signal.
  //   - sheetDidReturnResult: fires *after* sheetDidHide, carrying
  //                           the close-result returned by `close(result)`.
  //                           Hook-driven sheets (`useTugSheet`)
  //                           supply `getResult` to surface the
  //                           result; direct `<TugSheetContent>`
  //                           consumers without `getResult` skip
  //                           this event.
  const cardIdForLifecycle = useContext(CardIdContext);
  const sheetLifecycle = useSheetLifecycle();

  // Effect 1: state mutation. When `open` flips true, promote
  // `mounted` so the portal is in the DOM for the enter animation.
  // No event emission here — that responsibility lives in effect 2.
  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
    }
    // When open goes false, mounted stays true — exit animation will set it false.
  }, [open]);

  // Effect 2: emit will-show / will-hide on `open` transitions
  // (including the first-render `open=true` case, where prevOpen
  // starts false). Pure event emission — no React state mutation.
  const prevOpenForLifecycleRef = useRef(false);
  useLayoutEffect(() => {
    if (cardIdForLifecycle !== null && sheetLifecycle !== null) {
      const prev = prevOpenForLifecycleRef.current;
      if (open && !prev) {
        sheetLifecycle.notifySheetWillShow(cardIdForLifecycle);
      } else if (!open && prev) {
        sheetLifecycle.notifySheetWillHide(cardIdForLifecycle);
      }
    }
    prevOpenForLifecycleRef.current = open;
  }, [open, cardIdForLifecycle, sheetLifecycle]);

  // Effect 3: emit did-hide / did-return-result when `mounted`
  // transitions from true to false. By this point the exit animation
  // has completed, the portaled DOM has been removed, the inert
  // effect's cleanup has cleared the attribute, and Radix's
  // FocusScope unmount-autofocus has run. Body interactivity is
  // restored.
  //
  // **`sheetDidHide` is load-bearing for editor focus restoration.**
  // The sheet sets `inert` on `.tug-pane-body` while open, which
  // strips DOM focus from anything inside (including CodeMirror's
  // contentDOM). When the sheet exits, the editor is reachable again
  // but unfocused — Radix's `onUnmountAutoFocus` returns focus to
  // the trigger element, but Dev's editor is not the trigger here.
  // `DevCardBody` subscribes to `sheetDidHide` and re-focuses the
  // prompt-entry editor, gated on first-responder state. Per the
  // contract documented in `dev-card.tsx` (the focus-claim handlers
  // block) and pinned by
  // `tests/app-test/at0051-dev-mount-focus.test.ts`: any modal-class
  // surface that portals into the pane chrome and sets `inert` on
  // the pane body MUST emit a per-card `didHide` lifecycle event
  // after `inert` clears, mirroring this emission. Removing or
  // gating this emission breaks at0051 — that's intentional.
  //
  // `sheetDidHide` fires first (structural-only, all subscribers).
  // `sheetDidReturnResult` fires immediately after (carries the
  // close-result), only when `getResult` is provided by the consumer
  // — it's the result-bearing layer that knows the result. No-op
  // when `getResult` is omitted (direct `<TugSheetContent>` users
  // that don't track results).
  const prevMountedRef = useRef(false);
  useLayoutEffect(() => {
    if (prevMountedRef.current && !mounted) {
      if (cardIdForLifecycle !== null && sheetLifecycle !== null) {
        sheetLifecycle.notifySheetDidHide(cardIdForLifecycle);
        if (getResult !== undefined) {
          sheetLifecycle.notifySheetDidReturnResult(
            cardIdForLifecycle,
            getResult(),
          );
        }
      }
    }
    prevMountedRef.current = mounted;
  }, [mounted, cardIdForLifecycle, sheetLifecycle, getResult]);

  // Enter animation: runs after mount when open && mounted (DOM is present).
  // The scrim animates separately via the pane's CSS transition (driven
  // by the `data-scrim` attribute toggled in the show/hide effect below).
  // Both transitions use `--tug-motion-duration-moderate`, so they finish
  // visually together without explicit synchronization. [L13, D18]
  useLayoutEffect(() => {
    if (!open || !mounted) return;
    const contentEl = sheetContentRef.current;
    if (!contentEl) return;

    const g = group({ duration: "--tug-motion-duration-moderate" });
    g.animate(contentEl, SHEET_PRESENTATION_MOTION[presentation].enter, {
      key: "sheet-content",
      easing: "ease-out",
    });
    // Fire `sheetDidShow` after the enter animation completes — the
    // sheet is fully presented and any subscriber that wants to
    // capture pre-modal state ("what was focused before this sheet
    // took over?") has its signal.
    g.finished.then(() => {
      if (cardIdForLifecycle !== null && sheetLifecycle !== null) {
        sheetLifecycle.notifySheetDidShow(cardIdForLifecycle);
      }
    }).catch(() => {
      // Animation interrupted (a rapid close-then-open or the sheet
      // unmounting during enter). The transition to "fully shown"
      // didn't complete; subscribers will hear about the next
      // transition (will-hide / did-hide) instead.
    });
  }, [open, mounted, cardIdForLifecycle, sheetLifecycle, presentation]);

  // Exit animation: runs when !open && mounted (DOM still present for animation).
  useLayoutEffect(() => {
    if (open || !mounted) return;
    const contentEl = sheetContentRef.current;
    if (!contentEl) {
      setMounted(false);
      return;
    }

    const g = group({ duration: "--tug-motion-duration-moderate" });
    g.animate(contentEl, SHEET_PRESENTATION_MOTION[presentation].exit, {
      key: "sheet-content",
      easing: "ease-in",
    });
    g.finished.then(() => {
      setMounted(false);
    }).catch(() => {
      // Animation interrupted — unmount anyway to avoid stuck state.
      setMounted(false);
    });
  }, [open, mounted, presentation]);

  // Scrim show/hide: raise the host pane's built-in scrim while the
  // sheet is open. The cleanup return guarantees a balanced decrement
  // when the sheet closes (open transitions true→false) and on
  // unmount-while-open (e.g. cross-pane card move with sheet up). The
  // pane-scrim registry's ref-count handles overlapping consumers
  // (multiple sheets, future modal-class surfaces sharing the chrome).
  // No-op fallback when no TugPane ancestor is in scope. [D18]
  useLayoutEffect(() => {
    if (!open) return;
    paneScrim.show();
    return () => paneScrim.hide();
  }, [open, paneScrim]);

  // Dev warning: aria-labelledby requires a target.
  if (process.env.NODE_ENV !== "production" && !title) {
    console.warn("[TugSheetContent] `title` prop is required for aria-labelledby.");
  }

  // Track trigger element for focus restoration on close.
  const triggerElRef = useRef<Element | null>(null);

  // No anchor applier: the panel's clip is positioned by pure CSS in
  // `tug-sheet.css` (`position: absolute` inside the pane frame). The
  // canvas-tier wrapper, scrim, ResizeObserver, MutationObserver, and
  // window-resize listener are gone — when the pane moves or resizes,
  // the panel follows via the frame's own layout. [D19]

  // Inertness management: set/remove `inert` on .tug-pane-body synchronized with open state [L03].
  useLayoutEffect(() => {
    if (!cardEl) return;
    const body = cardEl.querySelector(".tug-pane-body");
    if (!body) return;

    if (open) {
      // Capture trigger before body becomes inert.
      triggerElRef.current = document.activeElement;
      body.setAttribute("inert", "");
    } else {
      body.removeAttribute("inert");
    }

    return () => {
      // Cleanup on unmount: always ensure inert is removed.
      body.removeAttribute("inert");
    };
  }, [open, cardEl]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" || (e.metaKey && e.key === ".")) {
      e.preventDefault();
      // Route via sendToTarget at the sheet's own responder id so the
      // dispatch reaches this sheet regardless of who is currently
      // first responder. First-responder walks are the wrong tool for
      // a modal close — the sheet owns its cancelDialog handler by
      // identity, not by focus position. Fallback: no provider → call
      // closeSheet directly.
      if (manager) {
        manager.sendToTarget(responderId, {
          action: TUG_ACTIONS.CANCEL_DIALOG,
          sender: senderId,
          phase: "discrete",
        });
      } else {
        closeSheet();
      }
    }
  }

  function handleMountAutoFocus(e: Event) {
    if (onOpenAutoFocus) {
      onOpenAutoFocus(e);
    }
    // Default: allow FocusScope to focus first tabbable element (don't preventDefault).
  }

  function handleUnmountAutoFocus(e: Event) {
    // Restore focus to trigger element on close.
    if (triggerElRef.current && "focus" in triggerElRef.current) {
      e.preventDefault();
      (triggerElRef.current as HTMLElement).focus();
    }
  }

  if (!mounted) return null;

  return createPortal(
    // Single clip element positioned by CSS inside the pane frame.
    // `overflow: hidden` clips the panel during the
    // `translateY(-100%) → 0` enter animation; `pointer-events: none`
    // makes the empty clip area pass clicks through to the (inert)
    // pane body, while the panel itself absorbs interaction via
    // `pointer-events: auto`. The clip extends below the chrome so
    // a tall panel can paint into the canvas grid without being
    // clipped by the chrome's overflow:hidden.
    <TugSheetStackingContext.Provider value={true}>
      <div className="tug-sheet-clip">
        {/* FocusScope wraps content to trap Tab/Shift-Tab */}
        <FocusScopeRadix.FocusScope
          trapped={open}
          loop
          onMountAutoFocus={handleMountAutoFocus}
          onUnmountAutoFocus={handleUnmountAutoFocus}
        >
          <div
            ref={composedContentRef}
            id={contentId}
            className="tug-sheet-content"
            role="dialog"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            data-slot="tug-sheet"
            data-tug-sheet-presentation={presentation}
            data-display-width={displayWidth}
            onKeyDown={handleKeyDown}
            onMouseDown={suppressButtonFocusShift}
          >
            <ResponderScope>
              {/* Sheet header: title only — no close button, sheets dismiss via Cancel/Escape */}
              <div className="tug-sheet-header">
                <h2 id={titleId} className="tug-sheet-title">{title}</h2>
              </div>

              {/* Optional description */}
              {description && (
                <p id={descriptionId} className="tug-sheet-description">{description}</p>
              )}

              {/* Sheet body: arbitrary content */}
              <div className="tug-sheet-body">{children}</div>
            </ResponderScope>
          </div>
        </FocusScopeRadix.FocusScope>
      </div>
    </TugSheetStackingContext.Provider>,
    paneFrameEl ?? document.body,
  );
}

/* ---------------------------------------------------------------------------
 * useTugSheetClose — consumer-facing close hook
 * ---------------------------------------------------------------------------*/

/**
 * Returns a stable `close()` function that dismisses the nearest
 * ancestor `<TugSheet>`. Intended for Cancel / Save / Apply buttons
 * inside a sheet's content — they call `close()` on click and the sheet
 * closes via the chain-native path (`sendToTarget` at the sheet's
 * responder id, which routes to the sheet's own `cancelDialog` handler).
 *
 * Must be called from a component rendered inside a `<TugSheet>` — the
 * hook reads the enclosing sheet's responder id from `TugSheetContext`.
 * Outside a TugSheet the returned function is a no-op (with a dev
 * warning) so standalone previews / tests can render the same button
 * components without crashing.
 *
 * Outside a `ResponderChainProvider` the function falls back to
 * `onOpenChange(false)` on the sheet context, matching the
 * no-provider fallbacks elsewhere in the sheet.
 */
export function useTugSheetClose(): () => void {
  const ctx = useContext(TugSheetContext);
  const manager = useResponderChain();
  const fallbackSenderId = useId();

  return useCallback(() => {
    if (!ctx) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          "[useTugSheetClose] called outside <TugSheet>. No-op.",
        );
      }
      return;
    }
    if (manager) {
      manager.sendToTarget(ctx.responderId, {
        action: TUG_ACTIONS.CANCEL_DIALOG,
        sender: fallbackSenderId,
        phase: "discrete",
      });
    } else {
      ctx.onOpenChange(false);
    }
  }, [ctx, manager, fallbackSenderId]);
}

/* ---------------------------------------------------------------------------
 * useTugSheet — imperative hook
 * ---------------------------------------------------------------------------*/

/**
 * Options for showSheet() returned by useTugSheet().
 */
export interface ShowSheetOptions {
  /** Sheet title (required — wired to aria-labelledby). */
  title: string;
  /** Optional description (wired to aria-describedby). */
  description?: string;
  /**
   * Content render function. Receives a `close` callback.
   * Call close(result?) to dismiss the sheet and resolve the promise.
   */
  content: (close: (result?: string) => void) => React.ReactNode;
  /** Override initial focus target. */
  onOpenAutoFocus?: (event: Event) => void;
  /**
   * Visual entrance/exit style. Forwarded to the rendered
   * `TugSheetContent`. Defaults to `"scale-fade"`. See
   * {@link TugSheetPresentation}.
   */
  presentation?: TugSheetPresentation;
  /**
   * Resting width of the panel within the host pane. Defaults to
   * `"standard"`. See {@link TugSheetDisplayWidth}.
   */
  displayWidth?: TugSheetDisplayWidth;
  /**
   * Cascade-target responder id captured at sheet-open time.
   *
   * Per `tugplan-dev-overlay-framework.md` [D02]
   * (#sheet-cascade-rationale), modal surfaces that need a follow-up
   * chain dispatch on close (e.g., dispatching `CLOSE` to dismiss the
   * host card after a picker cancel) capture the dispatch's target
   * id at open time rather than relying on `firstResponderId` at
   * close time. First-responder state is the product of multiple
   * racing inputs (registration order, focus events, FocusScope
   * mount/unmount, unregister fallback) and is fragile after a
   * portaled modal closes — using it as the cascade dispatch target
   * is a known bug class.
   *
   * The hook stores this value on its internal state for parity with
   * the other `ShowSheetOptions` fields. It does not itself dispatch
   * with the value: per [D02], the canonical pattern is for the
   * consumer to capture the id in the same closure where they call
   * `showSheet`, then read it from that closure inside their
   * `onClosed` callback and dispatch via
   * `manager.sendToTarget(cascadeTargetId, ...)`. The value travels
   * with the rest of the options for the lifetime of the open sheet
   * (and through the exit animation, since hook state is preserved
   * until the next `showSheet()` call).
   *
   * Optional — sheets without a cascade need (most pickers, settings
   * dialogs that don't dismiss their host card) leave it undefined.
   */
  cascadeTargetId?: string;
}

interface UseTugSheetState {
  options: ShowSheetOptions;
  resolve: (result: string | undefined) => void;
  /**
   * Monotonic id incremented per `showSheet()` call. Used as the
   * React `key` on the rendered <TugSheet> so each new call mounts a
   * fresh component instance, letting `defaultOpen` re-fire and the
   * enter animation replay cleanly.
   */
  callId: number;
}

/**
 * useTugSheet — imperative Promise-based sheet hook.
 *
 * Returns `{ showSheet, renderSheet }`:
 * - `showSheet(options)` opens a sheet and returns a Promise that resolves
 *   when the sheet is closed (via the `close` callback, Escape, or Cmd+.).
 * - `renderSheet()` must be called once in the component's JSX to render
 *   the sheet portal. Returns null when no sheet is open.
 *
 * Must be called from within a TugPane (requires TugPanePortalContext).
 *
 * ## State machine
 *
 * The hook juggles five pieces of state (`state`, `resolverRef`,
 * `callIdRef`, the mounted `<TugSheet>` instance, and the chain's
 * `observeDispatch` subscription) across four transition paths. The
 * tricky invariant is that the exit animation must play on close,
 * which requires the `<TugSheet>` to stay mounted across the
 * unmount-decision boundary. The diagram below traces each path.
 *
 * ```
 *                     ┌─────────────────┐
 *                     │      idle       │
 *                     │ state = null    │
 *                     │ resolverRef:0   │
 *                     └────────┬────────┘
 *                              │
 *               showSheet() ───┤  callIdRef++, setState({options, callId})
 *                              ▼
 *   ┌──────────────────────────────────────────────────┐
 *   │                     open                        │
 *   │  state = {options, resolve, callId}              │
 *   │  resolverRef = resolve  ← promise pending        │
 *   │  <TugSheet key={callId} defaultOpen> mounted     │
 *   │  observeDispatch subscription active             │
 *   └────────────┬─────────────────────────┬───────────┘
 *                │                         │
 *     close(r) ──┤            chain────────┤  Escape / Cmd+.
 *                │         cancelDialog    │  dispatches cancelDialog
 *                │       (from any source) │  with sender=this hook's id
 *                ▼                         ▼
 *   ┌────────────────────────┐  ┌────────────────────────┐
 *   │ resolveHook(r):        │  │ observer fires:        │
 *   │   resolver?(r); ref=0  │  │   if resolverRef≠null  │
 *   │ then dispatch          │  │   resolveHook(undef)   │
 *   │   cancelDialog         │  └───────────┬────────────┘
 *   │   (sender=hook id)     │              │
 *   └───────────┬────────────┘              │
 *               │                           │
 *               ▼                           ▼
 *   ┌──────────────────────────────────────────────────┐
 *   │               closing (exit animation)          │
 *   │  state = {…same…, callId unchanged}              │
 *   │  resolverRef = null  ← promise already resolved  │
 *   │  <TugSheet> internal open=false, animating out   │
 *   │  observer is still mounted but guarded on        │
 *   │    resolverRef === null → no-op                  │
 *   └────────────────┬─────────────────────────────────┘
 *                    │
 *      showSheet() ──┤  callIdRef++
 *                    │  setState → new callId → new key
 *                    ▼
 *                  (back to "open" with a fresh <TugSheet>;
 *                   the old one unmounts, the new one's
 *                   defaultOpen fires and enter animation plays)
 * ```
 *
 * ### Load-bearing ordering rules
 *
 * - `close(r)` **must** null `resolverRef` before dispatching
 *   `cancelDialog`. The dispatch re-enters the observer subscription,
 *   which would otherwise see the still-set resolver and call
 *   `resolveHook(undefined)` — double-resolving the promise with a
 *   wrong result.
 *
 * - The hook deliberately does **not** clear `state` on close. The
 *   old `<TugSheet>` stays mounted, animating out internally, until
 *   the next `showSheet()` call swaps it for a fresh instance via
 *   `key={callId}`. Clearing state would unmount the sheet mid-
 *   animation and skip the exit.
 *
 * - `callIdRef++` before `setState` ensures each `showSheet()` gets
 *   a unique React key, forcing remount instead of reuse. Without
 *   this, a rapid `close() → showSheet()` sequence would try to
 *   "reopen" the same instance whose `defaultOpen` has already
 *   fired once.
 *
 * ## Cascade-target pattern (modal close → follow-up chain dispatch)
 *
 * When a sheet's consumer needs to dispatch a follow-up action
 * through the responder chain — for example, the Dev picker
 * canceling and dismissing its host card — it must capture the
 * cascade dispatch's target id at sheet-open time, not at close time.
 * Per `tugplan-dev-overlay-framework.md` [D02]
 * (#sheet-cascade-rationale), `firstResponderId` at close time is
 * fragile (it settles via the unregister fallback after FocusScope
 * unmount, focusin handlers, etc.) and using
 * `manager.sendToFirstResponder(...)` from a close handler is a
 * known bug class.
 *
 * The canonical pattern subscribes to the sheet's
 * `sheetDidReturnResult` lifecycle event (per
 * `lib/sheet-lifecycle.ts`) — fires after the exit animation
 * completes and carries the close-result. The consumer's own
 * closure holds the captured cascade target id, so the dispatch is
 * robust regardless of focus settling:
 *
 * ```ts
 * const senderId = useId();
 * const presentSheet = useCallback(() => {
 *   void showSheet({
 *     title: "Open Project",
 *     content: (close) => (...),
 *     cascadeTargetId: hostStackId,         // stored on hook state
 *   });
 * }, [showSheet, hostStackId]);
 *
 * useSheetDelegate(cardId, {
 *   sheetDidReturnResult: (_id, result) => {
 *     if (result === "open") return;        // user did the thing
 *     manager?.sendToTarget(hostStackId, {  // captured in closure
 *       action: TUG_ACTIONS.CLOSE,
 *       sender: senderId,
 *       phase: "discrete",
 *     });
 *   },
 * });
 * ```
 *
 * The hook stores `cascadeTargetId` on its active state for parity
 * with the other `ShowSheetOptions` fields; `useTugSheet` itself does
 * NOT dispatch with the value. The consumer's own closure is where
 * the id lives — that's why the pattern is robust regardless of
 * focus settling. See [D02] for the rationale and (#mental-model)
 * for the broader five-subsystem architecture this pattern lives in.
 *
 * ## Example
 *
 * @example
 * ```tsx
 * function MyCardContent() {
 *   const { showSheet, renderSheet } = useTugSheet();
 *   return (
 *     <>
 *       <TugPushButton onClick={async () => {
 *         const result = await showSheet({
 *           title: "Settings",
 *           content: (close) => (
 *             <>
 *               <form>...</form>
 *               <div className="tug-sheet-actions">
 *                 <TugPushButton onClick={() => close()}>Cancel</TugPushButton>
 *                 <TugPushButton onClick={() => close("save")}>Save</TugPushButton>
 *               </div>
 *             </>
 *           ),
 *         });
 *         if (result === "save") { ... }
 *       }}>Open Settings</TugPushButton>
 *       {renderSheet()}
 *     </>
 *   );
 * }
 * ```
 */
export function useTugSheet(): {
  showSheet: (options: ShowSheetOptions) => Promise<string | undefined>;
  renderSheet: () => React.ReactNode;
} {
  // TugPanePortalContext is consumed downstream by TugSheetContent,
  // which returns null when the portal target isn't attached yet. A
  // dev-time "you're outside a TugPane" warning here fires on every
  // first render of a card body (TugPane populates `cardEl` via a
  // `useState` ref callback that commits one render after mount), so
  // we rely on the defensive null handling in TugSheetContent and
  // skip the warning.

  // State tracks the current active sheet's options plus a monotonically
  // increasing callId. The callId is used as the React `key` on the
  // rendered <TugSheet> so each `showSheet()` call mounts a fresh
  // component instance: defaultOpen fires on the new mount, the enter
  // animation plays, and the previous sheet's React subtree is cleanly
  // replaced (rather than re-used, which would skip defaultOpen and
  // prevent a mid-animation interrupt from re-opening cleanly).
  const [state, setState] = useState<UseTugSheetState | null>(null);
  const callIdRef = useRef(0);
  const resolverRef = useRef<((result: string | undefined) => void) | null>(null);
  // The last value passed to `close(result)` on the currently active
  // sheet, captured so `options.onClosed` can receive it after the
  // exit animation completes. Reset to undefined on every new
  // `showSheet()` call; set explicitly by the `close` callback handed
  // to the consumer's content render function. Escape / Cmd+. paths
  // leave it at its reset value (undefined), matching the "no explicit
  // result" semantics of a keyboard dismissal.
  const lastResultRef = useRef<string | undefined>(undefined);
  const manager = useResponderChain();

  // Stable senderId scoped to this hook call. Passed down to the
  // TugSheetContent rendered by `renderSheet`, and used as the filter
  // key for the observeDispatch subscription below so the hook only
  // reacts to its own sheet's chain-driven dismissals.
  const senderId = useId();

  // Stable responder id the hook's <TugSheet> registers under. Held
  // here so the close callback can dispatch `cancelDialog` via
  // `sendToTarget(responderId, ...)` — a first-responder walk is
  // unsafe because the sheet may not be first responder at close time
  // (e.g., after the user focused another card and returned).
  const responderId = useId();

  // Resolve the pending promise without touching the hook's local
  // state. Used by both the explicit `close(result)` callback and the
  // observeDispatch subscription for Escape / Cmd+. dismissal. We
  // deliberately do NOT clear `state` here — that would unmount the
  // <TugSheet> immediately and interrupt its exit animation. The old
  // sheet stays mounted in the React tree, internally animating out;
  // on the next `showSheet()` call, a new callId forces a remount via
  // `key` and the stale sheet is replaced.
  const resolveHook = useCallback((result: string | undefined) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
  }, []);

  // While a hook-rendered sheet is mounted, observe the chain for a
  // cancelDialog dispatch carrying this hook's senderId. This catches
  // the Escape / Cmd+. path: the sheet's own handler fires first and
  // closes internal state (triggering the exit animation), then this
  // observer runs and resolves the pending promise with undefined.
  //
  // Explicit consumer-driven closes via the `close(result)` callback
  // null `resolverRef` BEFORE dispatching cancelDialog, so the observer
  // sees `null` and skips its resolve path — the explicit close's
  // `resolveHook(result)` has already happened.
  useLayoutEffect(() => {
    if (!state || !manager) return;
    return manager.observeDispatch((event) => {
      if (event.action !== "cancel-dialog") return;
      if (event.sender !== senderId) return;
      if (resolverRef.current === null) return;
      resolveHook(undefined);
    });
  }, [state, manager, senderId, resolveHook]);

  const showSheet = useCallback((options: ShowSheetOptions): Promise<string | undefined> => {
    return new Promise<string | undefined>((resolve) => {
      resolverRef.current = resolve;
      lastResultRef.current = undefined;
      callIdRef.current += 1;
      setState({ options, resolve, callId: callIdRef.current });
    });
  }, []);

  const renderSheet = useCallback((): React.ReactNode => {
    if (!state) return null;

    const { options, callId } = state;

    // close(result) — the callback handed to consumer content. Resolve
    // the pending promise immediately (so `await showSheet(...)` yields
    // the result the user just picked), then dispatch cancelDialog
    // through the chain. The sheet's own cancelDialog handler catches
    // it and flips internal open state false, triggering the exit
    // animation. Nulling resolverRef before the dispatch is load-
    // bearing: the observeDispatch subscription above is guarded on
    // resolverRef being non-null, so it will no-op for this dispatch
    // and not try to resolve the promise a second time.
    //
    // No-provider fallback: without a chain manager the dispatch path
    // is unavailable, so we fall back to the pre-migration behavior
    // of clearing hook state synchronously. This unmounts the sheet
    // without an exit animation — acceptable for tests and isolated
    // previews that don't mount a ResponderChainProvider.
    const close = (result?: string) => {
      lastResultRef.current = result;
      resolveHook(result);
      if (manager) {
        manager.sendToTarget(responderId, {
          action: TUG_ACTIONS.CANCEL_DIALOG,
          sender: senderId,
          phase: "discrete",
        });
      } else {
        setState(null);
      }
    };

    // Surface the close-result to TugSheetContent's didReturnResult
    // emitter. `getResult` is read at the moment the sheet's
    // `mounted` flips false (post exit animation, post inert clear)
    // and the resulting `notifySheetDidReturnResult(cardId, result)`
    // event reaches subscribers via `useSheetDelegate({ sheetDidReturnResult })`.
    // Reads `lastResultRef.current` — set by `close(result)` above
    // or left at its showSheet-reset `undefined` for Escape /
    // Cmd+. dismissals.
    const getResultForContent = (): string | undefined =>
      lastResultRef.current;

    return (
      <TugSheet key={callId} defaultOpen responderId={responderId}>
        <TugSheetContent
          title={options.title}
          description={options.description}
          onOpenAutoFocus={options.onOpenAutoFocus}
          getResult={getResultForContent}
          senderId={senderId}
          presentation={options.presentation}
          displayWidth={options.displayWidth}
        >
          {options.content(close)}
        </TugSheetContent>
      </TugSheet>
    );
  }, [state, senderId, responderId, resolveHook, manager]);

  return { showSheet, renderSheet };
}
