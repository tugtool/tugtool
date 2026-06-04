/**
 * TugAccordion — Collapsible content sections.
 *
 * Wraps @radix-ui/react-accordion. Supports single and multiple open modes,
 * chevron rotation indicator, variant-driven border styles (separator, outline,
 * inset, plain), and TugBox disabled cascade. Animation uses CSS keyframes
 * with Radix's content-height variable.
 *
 * Per [L11], TugAccordion is a control: when the user expands or collapses
 * an item, it dispatches a `toggleSection` action through the responder
 * chain. The payload's `value` is `string` for `type="single"` and
 * `string[]` for `type="multiple"`; the responder handler narrows on the
 * shape. Uncontrolled accordions still dispatch — Radix's internal state
 * stays in sync regardless of whether anyone observes the dispatch.
 *
 * ## Single-mode collapse-all sentinel
 *
 * For `type="single" collapsible`, when the user collapses the currently
 * open item (closing all items), Radix reports the new value as an empty
 * string `""`. TugAccordion forwards that sentinel verbatim in the
 * `toggleSection` dispatch, so handlers bound via
 * `useResponderForm.toggleSectionSingle` must treat `""` as "no open
 * section." This is a deliberate passthrough of Radix's convention —
 * don't map it to `null` or `undefined` at the dispatch layer, because
 * doing so would lose the ability to represent the distinct "user
 * explicitly collapsed the section" event.
 *
 * Laws: [L06] appearance via CSS, [L11] controls emit actions; responders
 *       handle actions, [L14] Radix Presence owns DOM lifecycle — use
 *       CSS keyframes, [L16] pairings declared, [L19] component authoring guide
 */

import "./tug-accordion.css";

import React, {
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import * as Accordion from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import { useControlDispatch } from "./use-control-dispatch";
import { TUG_ACTIONS } from "./action-vocabulary";
import {
  useComponentStatePreservation,
  useSavedComponentState,
} from "./use-component-state-preservation";
import { useRovingFocusable } from "./use-focusable";
import type { FocusPolicy } from "./focus-manager";

// ---- Focus engine context ([P01], [P02]) ----

/**
 * Threads the roving-focus cursor from `TugAccordion` (which owns the engine
 * registration and the Tab-walk arrow handler) down to each `TugAccordionItem`
 * trigger, mirroring the `TugRadioGroup`/`TugRadioItem` split. Inert (engine
 * off) unless the accordion was authored into a `focusGroup`.
 */
interface AccordionFocusContextValue {
  /** True when the accordion is registered as an engine focus stop. */
  focusEngineActive: boolean;
  /** Item value carrying the roving cursor (`tabIndex=0`); others are `-1`. */
  focusedValue: string;
  /** Move the cursor (e.g. a pointer click on a header). */
  notifyCursor: (value: string, keyboard: boolean) => void;
}

const AccordionFocusContext = React.createContext<AccordionFocusContextValue>({
  focusEngineActive: false,
  focusedValue: "",
  notifyCursor: () => {},
});

// ---- TugAccordion Props (discriminated union) ----

/** Single-mode accordion: one item open at a time. */
export interface TugAccordionSingleProps {
  /** One item open at a time. */
  type: "single";
  /**
   * Currently open item (controlled).
   * @selector [data-state="open"] on the matching item
   */
  value?: string;
  /** Initial open item (uncontrolled). */
  defaultValue?: string;
  /**
   * Allow all items to be closed simultaneously.
   * @default false
   */
  collapsible?: boolean;
}

/** Multiple-mode accordion: any combination of items may be open. */
export interface TugAccordionMultipleProps {
  /** Any combination of items open simultaneously. */
  type: "multiple";
  /**
   * Currently open items (controlled).
   * @selector [data-state="open"] on matching items
   */
  value?: string[];
  /** Initial open items (uncontrolled). */
  defaultValue?: string[];
}

/** Border variant for the accordion. */
export type TugAccordionVariant = "separator" | "outline" | "inset" | "plain";

/** Shared props merged with the discriminated union. */
export interface TugAccordionSharedProps {
  /**
   * Border style for items.
   * - "separator" — divider lines between items (default)
   * - "outline" — single border around the entire group
   * - "inset" — each item has its own border with rounded corners, gap between
   * - "plain" — no borders
   * @selector .tug-accordion-separator | .tug-accordion-outline | .tug-accordion-inset | .tug-accordion-plain
   * @default "separator"
   */
  variant?: TugAccordionVariant;
  /**
   * Disables all items. Merges with TugBox disabled cascade.
   * @selector [data-disabled]
   * @default false
   */
  disabled?: boolean;
  /**
   * Stable opaque sender id for chain dispatches. Auto-derived via `useId()`
   * if omitted. Parent responders disambiguate multi-accordion forms by
   * matching this id in their `toggleSection` handler bindings. [L11]
   */
  senderId?: string;
  /** Additional CSS class names. */
  className?: string;
  /** TugAccordionItem children. */
  children: React.ReactNode;
  /**
   * Opt the accordion into the Component State Preservation Protocol
   * ([D13], [A9]). When provided (and rendered inside a card), the
   * open section value is captured into
   * `bag.components[componentStatePreservationKey]` at every save
   * trigger and reapplied on the next mount.
   *
   * Controlled (`value` prop provided): restore dispatches a
   * `toggleSection` action through the responder chain so the
   * parent state owner updates — best-effort, since the parent is
   * the source of truth. In uncontrolled mode, the accordion mirrors
   * Radix's open value in its own `useState` so restore can
   * programmatically update it.
   *
   * Preserved shape: `{ value: string }` for `type="single"`,
   * `{ value: string[] }` for `type="multiple"`. Restore validates
   * the shape against the current `props.type` and silently drops
   * mismatches (a payload from a re-typed accordion).
   *
   * Absence of `componentStatePreservationKey` means "not preserved"
   * — gallery demos and tests that render the accordion outside a
   * card stay unaffected.
   */
  componentStatePreservationKey?: string;

  // ---- Focus engine ([P01], [P02]) ----

  /**
   * Focus group this accordion is authored into ([P02]). When set, the accordion
   * registers as a **single roving stop** in the engine's Tab walk: Tab lands on
   * the cursor header and Up/Down/Home/End move between headers locally (the
   * engine's arrow handling replaces Radix's built-in version); Space/Enter still
   * expand/collapse. When omitted, the headers stay plain native Tab stops with
   * Radix's own arrow roving. Supplied by the surface that owns the Tab order.
   */
  focusGroup?: string;
  /** Order within {@link focusGroup}. Defaults to 0 (registration order breaks ties). */
  focusOrder?: number;
  /**
   * Walk policy when registered: `accept` (default) is an ordinary Tab stop;
   * `skip` is reachable only in accessibility mode.
   */
  focusPolicy?: FocusPolicy;
}

/** TugAccordion props — discriminated union of single/multiple modes plus shared props. */
export type TugAccordionProps = (TugAccordionSingleProps | TugAccordionMultipleProps) &
  TugAccordionSharedProps;

/** Serialized shape of `TugAccordion`'s preserved open value. */
interface TugAccordionState {
  /** Open section id for `type="single"` (or `""` collapsed-all);
   *  array of open section ids for `type="multiple"`. */
  value: string | string[];
}

// ---- TugAccordion ----

export const TugAccordion = React.forwardRef<HTMLDivElement, TugAccordionProps>(
  function TugAccordion(props, ref) {
    const {
      variant = "separator",
      disabled = false,
      senderId,
      className,
      children,
      componentStatePreservationKey,
      focusGroup,
      focusOrder = 0,
      focusPolicy,
      ...rest
    } = props;

    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // Chain dispatch [L11]: targeted dispatch of `toggleSection` to
    // the parent responder. Single-mode payload is `string` (the open
    // item id, or "" when collapsed); multi-mode payload is `string[]`.
    // Uncontrolled accordions still dispatch — Radix tracks the open
    // set internally and we just notify the chain.
    const { dispatch: controlDispatch } = useControlDispatch();
    const fallbackSenderId = useId();
    const effectiveSenderId = senderId ?? fallbackSenderId;

    // When the parent supplies `value`, it owns the source of truth
    // (classic controlled mode). When it doesn't, Radix normally owns
    // internal state via `defaultValue` — but that state is opaque
    // to us, so we can't programmatically restore it. To keep opt-in
    // state preservation working cleanly in the uncontrolled case,
    // mirror Radix's value in our own `useState` and pass it back to
    // Radix as `value`. The user still clicks the same elements;
    // `handleValueChange` keeps the mirror in sync.
    //
    // The discriminated union (`type="single"` vs `"multiple"`) gives
    // the preserved shape two variants. Mirror it as
    // `string | string[]` and narrow at each access site by
    // `props.type`. [L11]
    const isExternallyControlled = props.value !== undefined;
    const savedAccordionState = useSavedComponentState<TugAccordionState>(
      componentStatePreservationKey,
    );
    const [internalValue, setInternalValue] = useState<string | string[]>(
      () => {
        if (props.type === "single") {
          if (typeof savedAccordionState?.value === "string") {
            return savedAccordionState.value;
          }
          return props.defaultValue ?? "";
        }
        if (
          Array.isArray(savedAccordionState?.value) &&
          savedAccordionState.value.every((v) => typeof v === "string")
        ) {
          return savedAccordionState.value as string[];
        }
        return props.defaultValue ?? [];
      },
    );
    const effectiveValue = isExternallyControlled
      ? (props.value as string | string[])
      : internalValue;

    const handleSingleValueChange = useCallback(
      (value: string) => {
        if (!isExternallyControlled) {
          setInternalValue(value);
        }
        controlDispatch({
          action: TUG_ACTIONS.TOGGLE_SECTION,
          value,
          sender: effectiveSenderId,
          phase: "discrete",
        });
      },
      [controlDispatch, effectiveSenderId, isExternallyControlled],
    );
    const handleMultiValueChange = useCallback(
      (value: string[]) => {
        if (!isExternallyControlled) {
          setInternalValue(value);
        }
        controlDispatch({
          action: TUG_ACTIONS.TOGGLE_SECTION,
          value,
          sender: effectiveSenderId,
          phase: "discrete",
        });
      },
      [controlDispatch, effectiveSenderId, isExternallyControlled],
    );

    // Opt-in Component State Preservation Protocol. The hook no-ops
    // when `componentStatePreservationKey` is undefined, so standalone
    // / gallery uses remain unaffected. Capture reads the
    // `effectiveValue` source of truth; the mount-in-saved-state half
    // lives above in `useState`'s initializer. [D13] / [A9].
    useComponentStatePreservation<TugAccordionState>({
      componentStatePreservationKey,
      captureState: () => ({ value: effectiveValue }),
    });

    // ---- Roving focus ([P01], [P02]) ----
    //
    // When authored into a focus group, the accordion is one stop in the engine
    // Tab walk: a single header carries `tabIndex=0` (the cursor), Up/Down/Home/
    // End move it locally, and the engine ring follows. Radix accordion has no
    // roving `tabIndex` (every trigger would be a Tab stop) and runs its own
    // arrow handler on the root; we add the roving cursor and replace the arrow
    // handler — `preventDefault()` on a handled key skips Radix's composed
    // handler. Expand/collapse stays Radix's job — we never touch Space/Enter.
    const focusEngineActive = focusGroup !== undefined;
    const autoFocusId = useId();
    const { setRovedElement } = useRovingFocusable({
      id: autoFocusId,
      group: focusGroup ?? "",
      order: focusOrder,
      policy: focusPolicy,
      register: focusEngineActive,
    });
    // Roving cursor: which header carries `tabIndex=0`. Local data ([L24]).
    const [focusedValue, setFocusedValue] = useState<string>("");
    // Whether the last cursor move was the keyboard (arrows) vs a pointer
    // (header click), so the projection effect picks the right ring modality.
    const lastKeyboardRef = useRef(false);

    const rootRef = useRef<HTMLDivElement | null>(null);
    const setRootRef = useCallback(
      (node: HTMLDivElement | null) => {
        rootRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref !== null && ref !== undefined) {
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
      },
      [ref],
    );

    // Enabled trigger headers in DOM order (each carries `data-accordion-value`).
    const enabledTriggers = useCallback((): HTMLElement[] => {
      const root = rootRef.current;
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>("[data-accordion-value]"),
      ).filter(
        (el) =>
          !(el as HTMLButtonElement).disabled &&
          el.getAttribute("aria-disabled") !== "true",
      );
    }, []);
    const valueOf = (el: HTMLElement): string =>
      el.getAttribute("data-accordion-value") ?? "";

    // Up/Down/Home/End roving over the enabled headers. `preventDefault()` on a
    // handled key both stops page scroll AND skips Radix's own arrow handler
    // (Radix composes `props.onKeyDown` ahead of its handler with
    // `checkForDefaultPrevented`). Space/Enter fall through to the native
    // trigger so expand/collapse is unchanged.
    const handleFocusKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (!focusEngineActive) return;
        const key = e.key;
        if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "Home" && key !== "End") {
          return;
        }
        const items = enabledTriggers();
        if (items.length === 0) return;
        const values = items.map(valueOf);
        const cur = values.indexOf(focusedValue);
        let nextIdx: number;
        switch (key) {
          case "ArrowUp":
            nextIdx = cur <= 0 ? values.length - 1 : cur - 1;
            break;
          case "ArrowDown":
            nextIdx = cur >= values.length - 1 ? 0 : cur + 1;
            break;
          case "Home":
            nextIdx = 0;
            break;
          case "End":
            nextIdx = values.length - 1;
            break;
          default:
            return;
        }
        e.preventDefault();
        lastKeyboardRef.current = true;
        setFocusedValue(values[nextIdx]);
        items[nextIdx].focus();
      },
      [focusEngineActive, focusedValue, enabledTriggers],
    );

    // A pointer click on a header moves the cursor. Supplied to items via
    // context; the engine clears the ring in keyboard-only modality.
    const notifyCursor = useCallback((value: string, keyboard: boolean) => {
      lastKeyboardRef.current = keyboard;
      setFocusedValue(value);
    }, []);

    // Keep the cursor on a real enabled header and project the engine ring onto
    // it. Appearance-zone DOM only ([L06]); the keyboard flag picks whether the
    // ring follows (arrow) or clears (pointer). Resolution: the current cursor
    // if still valid, else the first enabled header.
    const childCount = React.Children.count(children);
    useLayoutEffect(() => {
      if (!focusEngineActive) return;
      const items = enabledTriggers();
      if (items.length === 0) {
        setRovedElement(null, lastKeyboardRef.current);
        return;
      }
      const values = items.map(valueOf);
      let target = focusedValue;
      if (!values.includes(target)) {
        target = values[0] ?? "";
        if (target !== focusedValue) {
          setFocusedValue(target);
          return; // re-run after the cursor state settles
        }
      }
      const el = items.find((e) => valueOf(e) === target) ?? null;
      setRovedElement(el, lastKeyboardRef.current);
    }, [focusEngineActive, focusedValue, childCount, setRovedElement, enabledTriggers]);

    const focusCtx: AccordionFocusContextValue = {
      focusEngineActive,
      focusedValue,
      notifyCursor,
    };

    // Build Radix-compatible props with effectiveDisabled, our internal
    // onValueChange, and the controlled `value` injected. The
    // discriminated union is preserved via `props.type` so the right
    // callback shape and value type go to Radix.
    //
    // `defaultValue` is intentionally dropped from the spread when
    // `componentStatePreservationKey` is set — Radix would otherwise
    // treat the component as uncontrolled (preferring `defaultValue`
    // over `value`). Since we always pass `value` here, the prop
    // redundantly survives but does nothing; stripping it via
    // destructure removes the surface ambiguity for future readers.
    const radixSingleRest = props.type === "single"
      ? (() => {
          const r = rest as Record<string, unknown>;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { defaultValue: _dv, value: _v, ...rrest } = r;
          return rrest;
        })()
      : rest;
    const radixMultiRest = props.type === "multiple"
      ? (() => {
          const r = rest as Record<string, unknown>;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { defaultValue: _dv, value: _v, ...rrest } = r;
          return rrest;
        })()
      : rest;
    const rootProps =
      props.type === "single"
        ? ({
            ...radixSingleRest,
            disabled: effectiveDisabled,
            value: effectiveValue as string,
            onValueChange: handleSingleValueChange,
          } as React.ComponentPropsWithoutRef<typeof Accordion.Root>)
        : ({
            ...radixMultiRest,
            disabled: effectiveDisabled,
            value: effectiveValue as string[],
            onValueChange: handleMultiValueChange,
          } as React.ComponentPropsWithoutRef<typeof Accordion.Root>);

    return (
      <Accordion.Root
        ref={setRootRef}
        data-slot="tug-accordion"
        className={cn(
          "tug-accordion",
          `tug-accordion-${variant}`,
          className,
        )}
        {...rootProps}
        // When the engine owns the Tab order, our handler replaces Radix's arrow
        // roving (it `preventDefault`s, which skips Radix's composed handler);
        // otherwise Radix's own keydown handler is left untouched.
        onKeyDown={focusEngineActive ? handleFocusKeyDown : rootProps.onKeyDown}
      >
        <AccordionFocusContext.Provider value={focusCtx}>
          {children}
        </AccordionFocusContext.Provider>
      </Accordion.Root>
    );
  },
);

/* ---------------------------------------------------------------------------
 * TugAccordionItem
 * ---------------------------------------------------------------------------*/

/** TugAccordionItem props. */
export interface TugAccordionItemProps {
  /** Unique identifier for this item within the accordion. */
  value: string;
  /**
   * Trigger content — the clickable header. Accepts ReactNode (string or layout).
   */
  trigger: React.ReactNode;
  /**
   * Collapsible content revealed when the item is open.
   * @selector [data-state="open"] | [data-state="closed"]
   */
  children: React.ReactNode;
  /**
   * Disables this item individually.
   * @selector [data-disabled]
   * @default false
   */
  disabled?: boolean;
  /** Additional CSS class names. */
  className?: string;
}

export const TugAccordionItem = React.forwardRef<HTMLDivElement, TugAccordionItemProps>(
  function TugAccordionItem({ value, trigger, children, disabled, className, ...rest }, ref) {
    // Roving focus, when the parent accordion is engine-driven. The trigger
    // carries `data-accordion-value` for the parent's DOM-query roving, a roving
    // `tabIndex` (the cursor header is `0`, the rest `-1` — making the accordion
    // one Tab stop), and `data-tug-focus="refuse"` so a click toggles without
    // stealing the key view. A click also moves the cursor. Inert when the
    // accordion was not authored into a focus group.
    const { focusEngineActive, focusedValue, notifyCursor } = useContext(
      AccordionFocusContext,
    );
    const triggerFocusProps = focusEngineActive
      ? {
          "data-accordion-value": value,
          "data-tug-focus": "refuse" as const,
          tabIndex: value === focusedValue ? 0 : -1,
          onClick: () => {
            if (!disabled) notifyCursor(value, false);
          },
        }
      : {};

    return (
      <Accordion.Item
        ref={ref}
        data-slot="tug-accordion-item"
        value={value}
        disabled={disabled}
        className={cn("tug-accordion-item", className)}
        {...rest}
      >
        <Accordion.Header className="tug-accordion-header">
          <Accordion.Trigger className="tug-accordion-trigger" {...triggerFocusProps}>
            <span className="tug-accordion-trigger-content">{trigger}</span>
            <ChevronDown
              className="tug-accordion-chevron"
              aria-hidden="true"
            />
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content className="tug-accordion-content">
          <div className="tug-accordion-content-inner">{children}</div>
        </Accordion.Content>
      </Accordion.Item>
    );
  },
);
