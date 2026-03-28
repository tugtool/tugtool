/**
 * TugAccordion — Collapsible content sections.
 *
 * Wraps @radix-ui/react-accordion. Supports single and multiple open modes,
 * chevron rotation indicator, bordered item dividers, and TugBox disabled
 * cascade. Animation uses CSS keyframes with Radix's content-height variable.
 *
 * Laws: [L06] appearance via CSS, [L14] Radix Presence owns DOM lifecycle — use CSS keyframes,
 *       [L16] pairings declared, [L19] component authoring guide
 */

import "./tug-accordion.css";

import React from "react";
import * as Accordion from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTugBoxDisabled } from "./internal/tug-box-context";

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
  /** Called when the open item changes. */
  onValueChange?: (value: string) => void;
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
  /** Called when the set of open items changes. */
  onValueChange?: (value: string[]) => void;
}

/** Shared props merged with the discriminated union. */
export interface TugAccordionSharedProps {
  /**
   * Show borders between items.
   * @selector .tug-accordion-bordered
   * @default true
   */
  bordered?: boolean;
  /**
   * Disables all items. Merges with TugBox disabled cascade.
   * @selector [data-disabled]
   * @default false
   */
  disabled?: boolean;
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
    const { bordered = true, disabled = false, className, children, ...rest } = props;

    const boxDisabled = useTugBoxDisabled();
    const effectiveDisabled = disabled || boxDisabled;

    // Build Radix-compatible props with effectiveDisabled injected.
    // The discriminated union is passed through via ...rest so TypeScript can
    // narrow correctly at the Radix Root level.
    const rootProps = {
      ...rest,
      disabled: effectiveDisabled,
    } as React.ComponentPropsWithoutRef<typeof Accordion.Root>;

    return (
      <Accordion.Root
        ref={ref}
        data-slot="tug-accordion"
        className={cn(
          "tug-accordion",
          bordered && "tug-accordion-bordered",
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
