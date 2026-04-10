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

import React, { useCallback, useId } from "react";
import * as Accordion from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTugBoxDisabled } from "./internal/tug-box-context";
import { useResponderChain } from "./responder-chain-provider";
import { TUG_ACTIONS } from "./action-vocabulary";

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
}

/** TugAccordion props — discriminated union of single/multiple modes plus shared props. */
export type TugAccordionProps = (TugAccordionSingleProps | TugAccordionMultipleProps) &
  TugAccordionSharedProps;

// ---- TugAccordion ----

export const TugAccordion = React.forwardRef<HTMLDivElement, TugAccordionProps>(
  function TugAccordion(props, ref) {
    const {
      variant = "separator",
      disabled = false,
      senderId,
      className,
      children,
      ...rest
    } = props;

    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // Chain dispatch [L11]: on user toggle, dispatch a `toggleSection`
    // action through the responder chain. Single-mode payload is `string`
    // (the open item id, or "" when collapsed); multi-mode payload is
    // `string[]` (the set of currently open item ids). The responder
    // handler narrows on shape via the `toggleSectionSingle` /
    // `toggleSectionMulti` slots in `useResponderForm`.
    //
    // Uncontrolled accordions still dispatch — Radix tracks the open set
    // internally and we just notify the chain. If no responder cares,
    // the dispatch walks past unhandled (which is correct).
    const manager = useResponderChain();
    const fallbackSenderId = useId();
    const effectiveSenderId = senderId ?? fallbackSenderId;
    const handleSingleValueChange = useCallback(
      (value: string) => {
        if (!manager) return;
        manager.dispatch({
          action: TUG_ACTIONS.TOGGLE_SECTION,
          value,
          sender: effectiveSenderId,
          phase: "discrete",
        });
      },
      [manager, effectiveSenderId],
    );
    const handleMultiValueChange = useCallback(
      (value: string[]) => {
        if (!manager) return;
        manager.dispatch({
          action: TUG_ACTIONS.TOGGLE_SECTION,
          value,
          sender: effectiveSenderId,
          phase: "discrete",
        });
      },
      [manager, effectiveSenderId],
    );

    // Build Radix-compatible props with effectiveDisabled and our internal
    // onValueChange injected. The discriminated union is preserved via
    // `props.type` so the right callback shape goes to Radix.
    const rootProps =
      props.type === "single"
        ? ({
            ...rest,
            disabled: effectiveDisabled,
            onValueChange: handleSingleValueChange,
          } as React.ComponentPropsWithoutRef<typeof Accordion.Root>)
        : ({
            ...rest,
            disabled: effectiveDisabled,
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
