/**
 * TugSheet — Card-modal dialog scoped to a single card.
 *
 * Original component (not a Radix wrapper). Drops from the card title bar
 * like a window shade. Uses Radix FocusScope for focus trapping. Card body
 * gets `inert` attribute for card-scoped blocking. Other cards remain
 * fully interactive.
 *
 * Compound API: TugSheet (Root) / TugSheetTrigger / TugSheetContent.
 * Portals into the card root element via TugcardPortalContext. Open
 * state is internal — consumers open the sheet via `TugSheetTrigger`
 * (click-to-open), an imperative ref handle (`TugSheetHandle.open()`),
 * or the `useTugSheet()` hook's `showSheet()` Promise API. There is no
 * public `open`/`onOpenChange` controlled-mode prop; the sheet owns
 * its own open state and exposes close as a chain action.
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
 * ## No observeDispatch subscription — card-modal semantics
 *
 * Like TugAlert, TugSheet is modal (card-scoped via `inert` on the
 * card body). External chain activity — including activity in other
 * cards on the same canvas — should not auto-dismiss a sheet the user
 * has opened. The sheet stays open until the user explicitly closes
 * it via a Cancel button, Save button, Escape, or Cmd+.
 *
 * Laws: [L06] appearance via CSS,
 *       [L11] controls emit actions; responders handle actions,
 *       [L16] pairings declared,
 *       [L19] component authoring guide,
 *       [L20] token sovereignty (composes child controls)
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
import { TugcardPortalContext } from "./tug-card";
import { group } from "@/components/tugways/tug-animator";
import { useResponderChain } from "./responder-chain-provider";
import { useOptionalResponder } from "./use-responder";
import { suppressButtonFocusShift } from "./internal/safari-focus-shift";

/* ---------------------------------------------------------------------------
 * Internal context
 * ---------------------------------------------------------------------------*/

interface TugSheetContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentId: string;
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
  /** Trigger + Content children. */
  children: React.ReactNode;
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
  function TugSheet({ defaultOpen = false, children }, ref) {
    const [open, setOpen] = useState(defaultOpen);
    const contentId = useId();

    const handleOpenChange = useCallback((next: boolean) => {
      setOpen(next);
    }, []);

    useImperativeHandle(ref, () => ({
      open() {
        handleOpenChange(true);
      },
      close() {
        handleOpenChange(false);
      },
    }));

    return (
      <TugSheetContext value={{ open, onOpenChange: handleOpenChange, contentId }}>
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
   * Stable opaque sender id for chain dispatches. Auto-derived via
   * `useId()` if omitted. Parent responders disambiguate multi-sheet
   * pages when observing dispatches by sender. [L11]
   */
  senderId?: string;
  /** Arbitrary content. */
  children?: React.ReactNode;
}

/**
 * TugSheetContent — the sheet panel, overlay, focus scope, and portal logic.
 *
 * Portals into the card root element (from TugcardPortalContext). Sets `inert`
 * on `.tugcard-body` for card-scoped modality. Restores focus to the trigger
 * element on close.
 */
export function TugSheetContent({
  title,
  description,
  onOpenAutoFocus,
  senderId: senderIdProp,
  children,
}: TugSheetContentProps) {
  const { open, onOpenChange, contentId } = useTugSheetContext();
  const cardEl = useContext(TugcardPortalContext);

  const titleId = `${contentId}-title`;
  const descriptionId = `${contentId}-desc`;

  // Chain manager — null when rendered outside a ResponderChainProvider.
  // Escape / Cmd+. fall back to calling onOpenChange directly in that
  // case; otherwise they dispatch cancelDialog through the chain and
  // the walk lands back on our own registered handler.
  const manager = useResponderChain();

  const fallbackResponderId = useId();
  const fallbackSenderId = useId();
  const responderId = fallbackResponderId;
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
      cancelDialog: closeSheet,
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
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const sheetContentRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
    }
    // When open goes false, mounted stays true — exit animation will set it false.
  }, [open]);

  // Enter animation: runs after mount when open && mounted (DOM is present).
  useLayoutEffect(() => {
    if (!open || !mounted) return;
    const overlayEl = overlayRef.current;
    const contentEl = sheetContentRef.current;
    if (!overlayEl || !contentEl) return;

    const g = group({ duration: "--tug-motion-duration-moderate" });
    g.animate(overlayEl, [{ opacity: 0 }, { opacity: 1 }], { key: "sheet-overlay" });
    g.animate(contentEl, [{ transform: "translateY(-100%)" }, { transform: "translateY(0)" }], {
      key: "sheet-content",
      easing: "ease-out",
    });
  }, [open, mounted]);

  // Exit animation: runs when !open && mounted (DOM still present for animation).
  useLayoutEffect(() => {
    if (open || !mounted) return;
    const overlayEl = overlayRef.current;
    const contentEl = sheetContentRef.current;
    if (!overlayEl && !contentEl) {
      setMounted(false);
      return;
    }

    const g = group({ duration: "--tug-motion-duration-moderate" });
    if (overlayEl) {
      g.animate(overlayEl, [{ opacity: 1 }, { opacity: 0 }], { key: "sheet-overlay" });
    }
    if (contentEl) {
      g.animate(contentEl, [{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }], {
        key: "sheet-content",
        easing: "ease-in",
      });
    }
    g.finished.then(() => {
      setMounted(false);
    }).catch(() => {
      // Animation interrupted — unmount anyway to avoid stuck state.
      setMounted(false);
    });
  }, [open, mounted]);

  // Dev warning: aria-labelledby requires a target.
  if (process.env.NODE_ENV !== "production" && !title) {
    console.warn("[TugSheetContent] `title` prop is required for aria-labelledby.");
  }

  // Track trigger element for focus restoration on close.
  const triggerElRef = useRef<Element | null>(null);

  // Inertness management: set/remove `inert` on .tugcard-body synchronized with open state [L03].
  useLayoutEffect(() => {
    if (!cardEl) return;
    const body = cardEl.querySelector(".tugcard-body");
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
      // Route through the chain so the sheet's own cancelDialog
      // handler closes it. The walk starts from the focused element
      // (whatever has focus inside the sheet — an input, a button)
      // and walks up via parentId to this sheet's responder node
      // (the sheet wraps its children in ResponderScope so the
      // parent chain is correctly set). Fallback: no provider → call
      // closeSheet directly.
      if (manager) {
        manager.dispatch({
          action: "cancelDialog",
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

  if (!mounted || !cardEl) return null;

  return createPortal(
    <>
      {/* Overlay (scrim) — positioned absolute within the card, below title bar.
           No click-to-dismiss: sheets are card-modal and require explicit dismissal
           via Cancel button, Escape, or Cmd+.
           onPointerDown preventDefault stops the browser from clearing selection
           or moving focus — the scrim is a dead zone that swallows all pointer events. */}
      <div
        ref={overlayRef}
        className="tug-sheet-overlay"
        onPointerDown={(e) => e.preventDefault()}
      />

      {/* Clip container: overflow hidden at title bar edge so sheet
           visually emerges from UNDER the title bar, not above it */}
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
    </>,
    cardEl,
  );
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
 * Must be called from within a Tugcard (requires TugcardPortalContext).
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
  const cardEl = useContext(TugcardPortalContext);

  if (process.env.NODE_ENV !== "production" && !cardEl) {
    console.warn("[useTugSheet] called outside a Tugcard — TugcardPortalContext is null. Sheet will not render.");
  }

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
  const manager = useResponderChain();

  // Stable senderId scoped to this hook call. Passed down to the
  // TugSheetContent rendered by `renderSheet`, and used as the filter
  // key for the observeDispatch subscription below so the hook only
  // reacts to its own sheet's chain-driven dismissals.
  const senderId = useId();

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
      if (event.action !== "cancelDialog") return;
      if (event.sender !== senderId) return;
      if (resolverRef.current === null) return;
      resolveHook(undefined);
    });
  }, [state, manager, senderId, resolveHook]);

  const showSheet = useCallback((options: ShowSheetOptions): Promise<string | undefined> => {
    return new Promise<string | undefined>((resolve) => {
      resolverRef.current = resolve;
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
      resolveHook(result);
      if (manager) {
        manager.dispatch({
          action: "cancelDialog",
          sender: senderId,
          phase: "discrete",
        });
      } else {
        setState(null);
      }
    };

    return (
      <TugSheet key={callId} defaultOpen>
        <TugSheetContent
          title={options.title}
          description={options.description}
          onOpenAutoFocus={options.onOpenAutoFocus}
          senderId={senderId}
        >
          {options.content(close)}
        </TugSheetContent>
      </TugSheet>
    );
  }, [state, senderId, resolveHook, manager]);

  return { showSheet, renderSheet };
}
