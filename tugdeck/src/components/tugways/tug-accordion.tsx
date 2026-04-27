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

import React, { useCallback, useId, useState } from "react";
import * as Accordion from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import { useControlDispatch } from "./use-control-dispatch";
import { TUG_ACTIONS } from "./action-vocabulary";
import { useComponentPersistence } from "./use-component-persistence";

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
   * Opt the accordion into the Component Persistence Protocol ([D13],
   * [A9]). When provided (and rendered inside a card), the open
   * section value is captured into `bag.components[persistKey]` at
   * every save trigger and reapplied on the next mount.
   *
   * Controlled (`value` prop provided): restore dispatches a
   * `toggleSection` action through the responder chain so the
   * parent state owner updates — best-effort, since the parent is
   * the source of truth. In uncontrolled mode, the accordion mirrors
   * Radix's open value in its own `useState` so restore can
   * programmatically update it.
   *
   * Persisted shape: `{ value: string }` for `type="single"`,
   * `{ value: string[] }` for `type="multiple"`. Restore validates
   * the shape against the current `props.type` and silently drops
   * mismatches (a payload from a re-typed accordion).
   *
   * Absence of `persistKey` means "not persisted" — gallery demos
   * and tests that render the accordion outside a card stay
   * unaffected.
   */
  persistKey?: string;
}

/** TugAccordion props — discriminated union of single/multiple modes plus shared props. */
export type TugAccordionProps = (TugAccordionSingleProps | TugAccordionMultipleProps) &
  TugAccordionSharedProps;

/** Serialized shape of `TugAccordion`'s persisted open value. */
interface TugAccordionPersistState {
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
      persistKey,
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
    // persistence working cleanly in the uncontrolled case, mirror
    // Radix's value in our own `useState` and pass it back to Radix
    // as `value`. The user still clicks the same elements;
    // `handleValueChange` keeps the mirror in sync.
    //
    // The discriminated union (`type="single"` vs `"multiple"`) gives
    // the persisted shape two variants. Mirror it as `string | string[]`
    // and narrow at each access site by `props.type`. [L11]
    const isExternallyControlled = props.value !== undefined;
    const [internalValue, setInternalValue] = useState<string | string[]>(
      () => {
        if (props.type === "single") {
          return props.defaultValue ?? "";
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

    // Opt-in Component Persistence Protocol. The hook no-ops when
    // `persistKey` is undefined, so standalone / gallery uses remain
    // unaffected. Capture reads the `effectiveValue` source of truth;
    // restore updates internal state in the uncontrolled path and
    // dispatches a `toggleSection` for the controlled path (a
    // best-effort re-dispatch; the parent is still in charge).
    // [D13] / [A9].
    useComponentPersistence<TugAccordionPersistState>({
      persistKey,
      captureState: () => ({ value: effectiveValue }),
      restoreState: (saved) => {
        if (saved === null || typeof saved !== "object") return;
        const next = (saved as Partial<TugAccordionPersistState>).value;
        if (props.type === "single") {
          if (typeof next !== "string") return;
          if (isExternallyControlled) {
            controlDispatch({
              action: TUG_ACTIONS.TOGGLE_SECTION,
              value: next,
              sender: effectiveSenderId,
              phase: "discrete",
            });
          } else {
            setInternalValue(next);
          }
        } else {
          if (!Array.isArray(next) || next.some((v) => typeof v !== "string")) {
            return;
          }
          const arr = next as string[];
          if (isExternallyControlled) {
            controlDispatch({
              action: TUG_ACTIONS.TOGGLE_SECTION,
              value: arr,
              sender: effectiveSenderId,
              phase: "discrete",
            });
          } else {
            setInternalValue(arr);
          }
        }
      },
    });

    // Build Radix-compatible props with effectiveDisabled, our internal
    // onValueChange, and the controlled `value` injected. The
    // discriminated union is preserved via `props.type` so the right
    // callback shape and value type go to Radix.
    //
    // `defaultValue` is intentionally dropped from the spread when
    // `persistKey` is set — Radix would otherwise treat the component
    // as uncontrolled (preferring `defaultValue` over `value`). Since
    // we always pass `value` here, the prop redundantly survives but
    // does nothing; stripping it via destructure removes the surface
    // ambiguity for future readers.
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
        ref={ref}
        data-slot="tug-accordion"
        className={cn(
          "tug-accordion",
          `tug-accordion-${variant}`,
          className,
        )}
        {...rootProps}
      >
        {children}
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
          <Accordion.Trigger className="tug-accordion-trigger">
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
