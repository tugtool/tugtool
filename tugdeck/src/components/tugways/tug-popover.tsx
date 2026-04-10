/**
 * TugPopover — Anchored interactive popup wrapping @radix-ui/react-popover.
 *
 * Exposes a compound API: TugPopover (root), TugPopoverTrigger (trigger),
 * TugPopoverContent (styled chrome with portal, arrow, animation), and
 * TugPopoverClose (re-export of Radix Close). Focus is trapped inside the
 * popover; Escape closes it and returns focus to the trigger.
 *
 * ## Chain-native open state
 *
 * TugPopover owns its open state internally and exposes an imperative
 * handle (`TugPopoverHandle`) with `open()` / `close()` / `isOpen()` for
 * consumers (like `TugConfirmPopover`) that need to drive the popover
 * programmatically. There is no `open` / `onOpenChange` prop pair —
 * dismissal flows through the responder chain via `cancelDialog` /
 * `dismissPopover` rather than through a React callback. [L11]
 *
 * ## Responder registration lives on TugPopoverContent
 *
 * The chain responder is registered by `TugPopoverContentShell`, a
 * nested component rendered INSIDE `Popover.Content` and therefore
 * mounted only while Radix actually shows the popover. Two reasons:
 *
 * 1. `TugPopover` has no DOM node of its own — it's a state owner and
 *    Radix Root wrapper. The responder needs a DOM element to carry
 *    `data-responder-id`, and that element is the portaled content.
 * 2. The shell's lifecycle matches the popover's open lifecycle.
 *    Registering at mount and unregistering at unmount keeps the
 *    auto-first-responder promotion (see
 *    `ResponderChainManager.register`) from stealing focus from
 *    inner composites (e.g. `TugConfirmPopover`'s own inner
 *    responder) that mount in the same commit and expect to become
 *    first responder themselves. If the responder hook ran at
 *    `TugPopoverContent`'s outer level it would register even when
 *    `open=false` — the component function still evaluates to
 *    produce JSX for Radix's Presence wrapper — and the effect
 *    would auto-promote at initial mount, blocking the inner
 *    composite's walk forever.
 *
 * **This is a structural contract, not a code invariant.** The fix
 * relies on `Popover.Content` returning null when not open, so its
 * children (including our shell) are not in the React tree during
 * the closed state. If a future change makes `TugPopoverContent`
 * eagerly render its children (e.g. wrapping everything in
 * `<Popover.Content forceMount>` for custom exit animations), the
 * shell will start mounting at initial render, its responder will
 * auto-promote, and inner composites will break. The first
 * regression is visible in `tug-confirm-popover.test.tsx`'s
 * `dispatching confirmDialog resolves the promise with true` case —
 * the walk fails to reach the inner confirm handler and the test
 * resolves with `false`. Keep that test passing, and this structural
 * contract stays intact.
 *
 * The `cancelDialog` and `dismissPopover` handlers both close the
 * popover via a `close` callback passed through the
 * `TugPopoverInternalContext` from the root.
 *
 * ## Radix-level dismissal → chain dispatch
 *
 * When Radix's own DismissableLayer closes the popover (Escape,
 * click-outside, explicit `TugPopoverClose` activation), the internal
 * `handleOpenChange` on the root runs and:
 *
 * 1. Flips internal state to false so React re-renders Radix as closed.
 * 2. Dispatches `cancelDialog` through the responder chain so any inner
 *    composite (e.g. `TugConfirmPopover`) whose responder is registered
 *    under the popover content can observe the dismissal and resolve
 *    its pending promise. Without this re-emission, consumers would
 *    have no chain-native way to hear about Radix-initiated closes
 *    and their Promise adapters would hang.
 *
 * The dispatch carries the popover's own `senderId`, so the
 * `observeDispatch` subscription in `TugPopoverContent` filters it
 * out and does not schedule a second close.
 *
 * **Undocumented Radix assumption.** This design relies on Radix
 * firing `onOpenChange` ONLY in response to user-initiated DOM
 * dismissal (Escape, click-outside, TugPopoverClose activation), not
 * in response to our own controlled prop flipping from `true` to
 * `false`. This has held across the Radix versions we've shipped
 * on, but it is not an invariant Radix documents explicitly. If a
 * future Radix release starts firing `onOpenChange` on every
 * controlled close, every programmatic `close()` will cascade
 * through `handleOpenChange` and emit an extra `cancelDialog` — not
 * wrong semantically (both the shell's responder handler and any
 * inner resolver are idempotent once `resolverRef` is nulled), but
 * noisy. If the gallery starts showing duplicate close animations
 * or tests start seeing double-resolve warnings, check Radix's
 * release notes first.
 *
 * ## External dismissal via observeDispatch
 *
 * While the popover is open (i.e. `TugPopoverContent` is mounted), the
 * content subscribes to `manager.observeDispatch`. Any chain action
 * whose sender is not this popover closes the popover via the
 * context `close` callback. This matches the `tug-popup-menu` /
 * `tug-editor-context-menu` precedents for chain-reactive dismissal.
 *
 * Rendered outside a `ResponderChainProvider`, `useOptionalResponder`
 * no-ops, the `observeDispatch` subscription is skipped, and the
 * popover still works as a plain Radix popover — but consumers that
 * rely on chain-dispatched dismissal (e.g. `TugConfirmPopover`
 * resolving its promise on Escape) will silently degrade. Standalone
 * previews and unit tests should mount inside a provider to exercise
 * the chain-native paths.
 *
 * Laws: [L06] appearance via CSS/DOM, never React state,
 *       [L11] controls emit actions; responders handle actions,
 *       [L13] motion compliance — animation durations scale via --tug-timing,
 *       [L14] Radix Presence owns DOM lifecycle — use CSS keyframes,
 *       [L16] pairings declared,
 *       [L17] component aliases resolve to base tier in one hop,
 *       [L19] component authoring guide
 *
 * @see ./internal/floating-surface-notes.ts for the cross-surface
 *      invariants table (popover / confirm-popover / alert / sheet)
 *      and the chain-reactive vs. modal semantic models.
 */

import "./tug-popover.css";

import React from "react";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";
import { useResponderChain } from "./responder-chain-provider";
import { useOptionalResponder } from "./use-responder";
import { TUG_ACTIONS } from "./action-vocabulary";
import { suppressButtonFocusShift } from "./internal/safari-focus-shift";

/* ---------------------------------------------------------------------------
 * TugPopoverHandle
 * ---------------------------------------------------------------------------*/

/** Imperative handle for TugPopover. */
export interface TugPopoverHandle {
  /** Open the popover. */
  open(): void;
  /** Close the popover. Does not emit a chain action. */
  close(): void;
  /** Whether the popover is currently open. */
  isOpen(): boolean;
}

/* ---------------------------------------------------------------------------
 * Internal context (TugPopover ↔ TugPopoverContent)
 * ---------------------------------------------------------------------------*/

interface TugPopoverInternalContextValue {
  /** Close the popover. Called by chain action handlers and observeDispatch. */
  close: () => void;
  /** Stable sender id used by the root when re-emitting cancelDialog from Radix dismissal. */
  senderId: string;
}

const TugPopoverInternalContext =
  React.createContext<TugPopoverInternalContextValue | null>(null);

/* ---------------------------------------------------------------------------
 * TugPopover
 * ---------------------------------------------------------------------------*/

/** TugPopover props. */
export interface TugPopoverProps {
  /** Default open state. */
  defaultOpen?: boolean;
  /**
   * Whether popover is modal (traps focus, dims outside).
   * @default false
   */
  modal?: boolean;
  /**
   * Stable opaque sender id for chain dispatches. Auto-derived via
   * `useId()` if omitted. Disambiguates multi-popover pages when a
   * parent responder observes dispatches by sender. [L11]
   */
  senderId?: string;
  children: React.ReactNode;
}

/**
 * Thin wrapper on Radix Popover.Root. Place TugPopoverTrigger and
 * TugPopoverContent as direct children.
 *
 * Use `ref.current.open()` / `.close()` / `.isOpen()` to drive the
 * popover imperatively; dismissal otherwise flows through the responder
 * chain via `cancelDialog` / `dismissPopover`.
 */
export const TugPopover = React.forwardRef<TugPopoverHandle, TugPopoverProps>(
  function TugPopover(
    { defaultOpen = false, modal = false, senderId: senderIdProp, children },
    ref,
  ) {
    const [open, setOpen] = React.useState(defaultOpen);

    // Chain manager — null when rendered outside a ResponderChainProvider
    // (standalone previews, unit tests). Dismissal re-emission below
    // only fires when a manager is in scope.
    const manager = useResponderChain();

    const fallbackSenderId = React.useId();
    const senderId = senderIdProp ?? fallbackSenderId;

    // Track current open state in a ref so the imperative handle's
    // isOpen() closure reads the latest value without needing `open`
    // in the useImperativeHandle dependency array.
    const openRef = React.useRef(open);
    openRef.current = open;

    const close = React.useCallback(() => {
      setOpen(false);
    }, []);

    React.useImperativeHandle(
      ref,
      () => ({
        open() {
          setOpen(true);
        },
        close() {
          setOpen(false);
        },
        isOpen() {
          return openRef.current;
        },
      }),
      [],
    );

    // Radix-level dismissal (Escape via DismissableLayer, click-outside
    // via DismissableLayer, explicit TugPopoverClose activation). Flip
    // internal state AND dispatch cancelDialog through the chain so
    // inner composites (e.g. TugConfirmPopover) can observe the
    // dismissal and resolve their pending promises. The dispatch
    // carries our own senderId so the observeDispatch subscription
    // in TugPopoverContent filters it out.
    function handleOpenChange(nextOpen: boolean) {
      if (!nextOpen) {
        setOpen(false);
        if (manager) {
          manager.dispatch({
            action: TUG_ACTIONS.CANCEL_DIALOG,
            sender: senderId,
            phase: "discrete",
          });
        }
        return;
      }
      setOpen(nextOpen);
    }

    const contextValue = React.useMemo<TugPopoverInternalContextValue>(
      () => ({ close, senderId }),
      [close, senderId],
    );

    return (
      <TugPopoverInternalContext.Provider value={contextValue}>
        <Popover.Root open={open} onOpenChange={handleOpenChange} modal={modal}>
          {children}
        </Popover.Root>
      </TugPopoverInternalContext.Provider>
    );
  },
);

/* ---------------------------------------------------------------------------
 * TugPopoverTrigger
 * ---------------------------------------------------------------------------*/

/** TugPopoverTrigger props. */
export interface TugPopoverTriggerProps {
  /**
   * Render as child element, merging Radix behavior onto it.
   * @default true
   */
  asChild?: boolean;
  children: React.ReactNode;
}

/**
 * Thin wrapper on Radix Popover.Trigger. Defaults to asChild so the caller's
 * element is used directly as the trigger without a wrapper button.
 */
export function TugPopoverTrigger({ asChild = true, children }: TugPopoverTriggerProps) {
  return <Popover.Trigger asChild={asChild}>{children}</Popover.Trigger>;
}

/* ---------------------------------------------------------------------------
 * TugPopoverContent
 * ---------------------------------------------------------------------------*/

/** TugPopoverContent props. */
export interface TugPopoverContentProps {
  /**
   * Which side of the trigger to place the popover.
   * @selector [data-side="top"] | [data-side="bottom"] | [data-side="left"] | [data-side="right"]
   * @default "bottom"
   */
  side?: "top" | "bottom" | "left" | "right";
  /**
   * Alignment along the side axis.
   * @selector [data-align="start"] | [data-align="center"] | [data-align="end"]
   * @default "center"
   */
  align?: "start" | "center" | "end";
  /**
   * Distance from trigger in px.
   * @default 6
   */
  sideOffset?: number;
  /**
   * Show the arrow pointer.
   * @default false
   */
  arrow?: boolean;
  /** Additional CSS class names. */
  className?: string;
  children: React.ReactNode;
}

/**
 * Styled wrapper on Radix Portal + Content + optional Arrow. Owns the
 * popover chrome: background, border, shadow, border-radius, and
 * enter/exit animations. Internal spacing is left to the caller.
 *
 * The chain responder is registered by the nested `TugPopoverContentShell`
 * which is only mounted when Radix actually renders the popover content.
 * This keeps the responder lifecycle locked to the popover's open state
 * and prevents the chain's auto-promotion logic (fired on any
 * parentId===null registration while `firstResponderId===null`) from
 * stealing first responder from inner composites that mount earlier
 * in the React tree (e.g. `TugConfirmPopover`'s own inner responder,
 * which mounts at the TugConfirmPopover component level regardless of
 * open state). See the docstring on this file for the full rationale.
 */
export const TugPopoverContent = React.forwardRef<HTMLDivElement, TugPopoverContentProps>(
  function TugPopoverContent(
    { side = "bottom", align = "center", sideOffset = 6, arrow = false, className, children },
    forwardedRef,
  ) {
    return (
      <Popover.Portal>
        <Popover.Content
          ref={forwardedRef}
          data-slot="tug-popover"
          className={cn("tug-popover-content", className)}
          side={side}
          align={align}
          sideOffset={sideOffset}
        >
          <TugPopoverContentShell>{children}</TugPopoverContentShell>
          {arrow && <Popover.Arrow className="tug-popover-arrow" />}
        </Popover.Content>
      </Popover.Portal>
    );
  },
);

/**
 * Inner shell mounted only when Radix's Popover.Content actually renders
 * its children (i.e., while the popover is open or during its exit
 * animation). This is where `useOptionalResponder` is called, so the
 * responder registers on open and unregisters on close — matching the
 * popover's open lifecycle exactly.
 *
 * Renders a `display: contents` div so the wrapper has no layout box
 * but still carries `data-responder-id`, captures `onMouseDown` for
 * the Safari focus-shift fix, and receives the ref for
 * `findResponderForTarget` walks.
 */
function TugPopoverContentShell({ children }: { children: React.ReactNode }) {
  const ctx = React.useContext(TugPopoverInternalContext);
  const manager = useResponderChain();
  const responderId = React.useId();

  // Local ref to the shell's root div. Used by observeDispatch to
  // check whether the currently focused element is inside the
  // popover before dismissing — dispatches originating from form
  // controls inside the popover should not dismiss their own
  // containing popover.
  const contentElRef = React.useRef<HTMLDivElement | null>(null);

  const handleClose = React.useCallback(() => {
    ctx?.close();
  }, [ctx]);

  const { responderRef } = useOptionalResponder({
    id: responderId,
    actions: {
      [TUG_ACTIONS.CANCEL_DIALOG]: handleClose,
      [TUG_ACTIONS.DISMISS_POPOVER]: handleClose,
    },
  });

  const composedShellRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      contentElRef.current = el;
      responderRef(el);
    },
    [responderRef],
  );

  // External dismissal: chain activity while the popover is open
  // closes it — with two filters:
  //
  // 1. Self-dispatches (the cancelDialog re-emission from the root's
  //    handleOpenChange) carry the root's senderId and are filtered
  //    so we do not schedule a redundant close.
  //
  // 2. Dispatches originating from inside the popover (e.g. a
  //    TugSwitch toggle or TugInput commit dispatched from a form
  //    control nested within the popover content) should not dismiss
  //    their own container. We detect this by checking whether
  //    `document.activeElement` is inside our content element — if
  //    the user's focus is on a control inside the popover, the
  //    dispatch was their interaction with the popover, not a
  //    signal to close it. Without this filter, the Form Content
  //    gallery example (popover containing an input, a switch, and
  //    a save button) would self-dismiss on every field change.
  //
  // **The focus-inside filter is a heuristic.** It assumes that
  // `document.activeElement` accurately reflects "the user is
  // interacting with the popover", which is true for the cases we
  // care about (text input focused, Safari's click-without-focus
  // on buttons leaving focus on the last field) but can be fooled
  // by a programmatic dispatch that happens to run while focus is
  // inside the popover — e.g. a timer firing a shortcut action
  // while the user is typing. The filter will skip such a
  // dispatch and keep the popover open, even though the dispatch
  // may have represented a legitimate "close now" signal. This is
  // an acceptable trade-off for now: keeping form-content popovers
  // usable is more important than dismissing on weird background
  // traffic, and users can always press Escape or click outside.
  // Revisit if a concrete use case surfaces where this trade-off
  // goes the wrong way.
  //
  // Subscribe via useLayoutEffect so the subscription is in place
  // before any paint that could deliver an event through the chain.
  // [L03]
  React.useLayoutEffect(() => {
    if (!manager || !ctx) return;
    const selfSenderId = ctx.senderId;
    return manager.observeDispatch((event) => {
      if (event.sender === selfSenderId) return;
      const contentEl = contentElRef.current;
      if (contentEl && typeof document !== "undefined") {
        const activeEl = document.activeElement;
        if (
          activeEl &&
          activeEl !== document.body &&
          contentEl.contains(activeEl)
        ) {
          return;
        }
      }
      ctx.close();
    });
  }, [manager, ctx]);

  return (
    <div
      ref={composedShellRef}
      onMouseDown={suppressButtonFocusShift}
      style={{ display: "contents" }}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * TugPopoverClose
 * ---------------------------------------------------------------------------*/

/**
 * Re-export of Radix Popover.Close. Renders a button that closes the popover
 * when activated. Use with asChild to render a custom element.
 */
export const TugPopoverClose = Popover.Close;

/* ---------------------------------------------------------------------------
 * useTugPopoverClose
 * ---------------------------------------------------------------------------*/

/**
 * Hook that returns a function closing the nearest enclosing TugPopover.
 *
 * Call this from any component nested inside a `TugPopoverContent` when
 * you need to dismiss the popover from a control that isn't a Cancel
 * button — e.g. a "Save Changes" button in a form-content popover, a
 * custom confirmation flow, or any imperative "close now" trigger.
 *
 * The returned function dispatches `cancelDialog` through the responder
 * chain with the popover's own senderId. The walk reaches
 * `TugPopoverContentShell`'s registered handler, which closes the
 * popover via the internal context. If the dispatch isn't handled (no
 * chain-native responder in scope), the function falls back to calling
 * the context `close` callback directly so the popover still closes in
 * no-provider contexts.
 *
 * When called outside a TugPopover context, the returned function is a
 * no-op.
 *
 * Distinct from the `focus-inside-popover` filter that protects
 * ordinary form controls (switches, inputs, sliders) from dismissing
 * their own container: that filter operates on `observeDispatch`
 * traffic, whereas this hook drives an intentional dismissal through
 * the responder's own `cancelDialog` handler path.
 */
export function useTugPopoverClose(): () => void {
  const ctx = React.useContext(TugPopoverInternalContext);
  const manager = useResponderChain();
  return React.useCallback(() => {
    if (!ctx) return;
    if (manager) {
      const handled = manager.dispatch({
        action: TUG_ACTIONS.CANCEL_DIALOG,
        sender: ctx.senderId,
        phase: "discrete",
      });
      if (handled) return;
    }
    ctx.close();
  }, [ctx, manager]);
}
