/**
 * TugBadge — compact status/category label.
 *
 * Pill-shaped, display-only badge for surfacing status, role, or category.
 * Shares the emphasis x role axis system with TugButton.
 * Supports four emphases (filled, outlined, ghost, tinted) and seven roles.
 *
 * Laws: [L06] appearance via CSS, [L11] menu items emit actions through the
 *       chain (no callbacks), [L16] pairings declared, [L18] tokens from the
 *       seven-slot system, [L19] component authoring guide, [L20] tokens scoped
 *       to the component slot
 * Decisions: [D02] emphasis x role system
 */

import "./tug-badge.css";

import React, { useCallback, useId, useRef } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopyableText } from "./use-copyable-text";
import { useControlDispatch } from "./use-control-dispatch";
import type { TugAction } from "./action-vocabulary";
import { TugPopupMenu } from "./internal/tug-popup-menu";
import type { TugPopupMenuEntry } from "./internal/tug-popup-menu";

// ---- Types ----

/** TugBadge emphasis values — controls visual weight */
export type TugBadgeEmphasis = "filled" | "outlined" | "ghost" | "tinted";

/**
 * TugBadge role values — controls color domain.
 *
 * Seven semantic roles (accent / action / agent / data / danger /
 * success / caution) drive theme-mapped colour pairings (see the
 * `@tug-pairings` table in `tug-badge.css`).
 *
 * The eighth role, `"inherit"`, is the deliberate exception: instead
 * of a theme palette, the badge's text / icon / border resolve to
 * `currentColor`, dropping back to whatever the surrounding text
 * colour is. Use it when a badge should blend into the row it sits
 * in rather than read as a separate signal — the Z1B end-state
 * "OK" tone is the motivating callsite (committed success rows
 * stack a green column otherwise). The four `inherit` × emphasis
 * cells in CSS are all painted in `currentColor`; the primary
 * variant is `ghost-inherit` (transparent bg, currentColor text/
 * icon, no border). See the `tug-badge.css` rules for the full
 * emphasis matrix and notes on which combinations are anti-
 * patterns.
 */
export type TugBadgeRole =
  | "accent"
  | "action"
  | "agent"
  | "data"
  | "danger"
  | "success"
  | "caution"
  | "inherit";

/** TugBadge size names. `2xs` is the most compact — for count or
 * status chips tucked into dense rows — through to the prominent `2xl`. */
export type TugBadgeSize = "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

/**
 * TugBadge layout — single-line pill vs two-line label/content chip.
 *
 * - `single` — the default pill: one row, `children` only (icon + text inline).
 * - `label-top` — two stacked rows with the letter-spaced `label` caption above
 *   the `children` content line. Mirrors the dev-card status-bar legend
 *   discipline so ambient chrome reads with one visual vocabulary.
 * - `content-top` — the same two rows in reverse vertical order (content above
 *   label) for the rarer case where the value reads first and the label is a
 *   small caption beneath it.
 *
 * Both two-line layouts keep a stable DOM order (label first, content second);
 * the visual stacking is driven entirely by CSS column direction, never by
 * reordered children. The chip's width resolves to the wider of the two rows.
 */
export type TugBadgeLayout = "single" | "label-top" | "content-top";

/**
 * One entry in a TugBadge popup menu. Mirrors `TugPopupButtonItem`: on
 * activation the badge dispatches `action` (carrying `value`) through the
 * responder chain [L11] — there is no selection callback. Value pickers
 * share one `action` (e.g. `select-value`) and differ by `value`.
 */
export interface TugBadgeMenuItem {
  /** Chain action dispatched when this item is chosen. */
  action: TugAction;
  /** Payload shipped as the dispatched event's `value`. */
  value?: string | number | boolean;
  /** Display label. */
  label: string;
  /** Lucide icon rendered before the label. */
  icon?: React.ReactNode;
  /** Disable the item. */
  disabled?: boolean;
  /**
   * Checkmark state for single-select menus. When defined, the menu reserves
   * a leading check column and the item with `selected: true` shows a
   * checkmark. Set it on every item so labels align.
   */
  selected?: boolean;
}

/**
 * TugBadge props interface.
 */
export interface TugBadgeProps extends Omit<React.ComponentPropsWithoutRef<"span">, "role"> {
  /**
   * Visual weight.
   * @selector .tug-badge-{emphasis}-{role}
   * @default "tinted"
   */
  emphasis?: TugBadgeEmphasis;
  /**
   * Color domain.
   * @selector .tug-badge-{emphasis}-{role}
   * @default "action"
   */
  role?: TugBadgeRole;
  /**
   * Badge size.
   * @selector .tug-badge-size-2xs | .tug-badge-size-xs | .tug-badge-size-sm | .tug-badge-size-md | .tug-badge-size-lg | .tug-badge-size-xl | .tug-badge-size-2xl
   * @default "sm"
   */
  size?: TugBadgeSize;
  /**
   * Layout arrangement. `single` is the one-row pill (default, non-breaking
   * for every existing call site). `label-top` / `content-top` render the
   * `label` caption and `children` content as two stacked rows.
   * @selector .tug-badge-layout-single | .tug-badge-layout-label-top | .tug-badge-layout-content-top
   * @default "single"
   */
  layout?: TugBadgeLayout;
  /**
   * Letter-spaced uppercase caption line for the two-line layouts. Only
   * meaningful when `layout !== "single"`; ignored in single layout. The
   * content line is always `children`.
   */
  label?: string;
  /** Badge label content (required). */
  children: React.ReactNode;
  /** Lucide icon node rendered before the label. */
  icon?: React.ReactNode;
  /**
   * Override for the gap between the leading icon and the label
   * text, in CSS pixels. Defaults vary by size (3-4 px); pass an
   * explicit value when a callsite needs a tighter or looser
   * spacing than the size's natural gap. Applied as inline style
   * on the badge root (via `style.gap`); takes effect only when
   * an `icon` is supplied.
   */
  iconGap?: number;
  /**
   * When non-empty, the badge becomes a popup-menu trigger: a chevron hint
   * renders vertically centered to the right of the content (it does NOT
   * disturb the text layout), and clicking opens a menu whose items dispatch
   * their `action` through the responder chain [L11]. Display badges with no
   * `menuItems` are unchanged.
   */
  menuItems?: TugBadgeMenuItem[];
  /**
   * Sender id for the menu's chain dispatch, so a handler can tell this
   * badge's menu apart from sibling controls. Defaults to a `useId()`.
   */
  menuSenderId?: string;
  /**
   * Chevron direction hinting which way the menu opens. Rendered only when
   * `menuItems` is non-empty. A bottom-anchored chip whose menu flips upward
   * uses `"up"`. No default — omit to hint nothing even with a menu.
   * @selector .tug-badge-chevron
   */
  chevron?: "up" | "down";
  /** aria-label for the menu trigger when the badge hosts a menu. */
  menuAriaLabel?: string;
  /**
   * Optional non-interactive header at the top of the popup menu (a label
   * with an optional icon, followed by a separator). Use for a teaching hint
   * — e.g. "⬆ Tab to cycle". Ignored without `menuItems`.
   */
  menuHeader?: { label: string; icon?: React.ReactNode };
}

// ---- TugBadge ----

export const TugBadge = React.forwardRef<HTMLSpanElement, TugBadgeProps>(
  function TugBadge({
    emphasis = "tinted",
    role = "action",
    size = "sm",
    layout = "single",
    label,
    children,
    icon,
    iconGap,
    menuItems,
    menuSenderId,
    chevron,
    menuAriaLabel,
    menuHeader,
    className,
    style,
    ...rest
  }: TugBadgeProps, ref) {
    const emphasisRoleClass = `tug-badge-${emphasis}-${role}`;
    const sizeClass = `tug-badge-size-${size}`;
    const layoutClass = `tug-badge-layout-${layout}`;
    const twoLine = layout !== "single";
    const hasMenu = menuItems !== undefined && menuItems.length > 0;
    // `iconGap` overrides the size's natural gap (set by the
    // `.tug-badge-size-{sm,md,lg}` CSS rules). Inline style takes
    // precedence per CSS specificity. Caller's `style` wins last
    // if the consumer wants the final say. In a two-line layout the
    // root's `gap` is the row gap between label and content, so the
    // icon-gap override only applies to the single-line layout where
    // the icon sits beside the text on the badge root.
    const mergedStyle: React.CSSProperties | undefined =
      iconGap !== undefined && !twoLine
        ? { gap: `${iconGap}px`, ...style }
        : style;

    // Badges are copyable — right-click → Copy copies the badge's
    // text content. Intrinsic, not opt-in. `copyMenu` keeps the menu
    // to a single Copy entry, matching the compact pill shape.
    const badgeRef = useRef<HTMLSpanElement | null>(null);
    const copyable = useCopyableText({
      ref: badgeRef as React.MutableRefObject<HTMLElement | null>,
      forwardedRef: ref as React.Ref<HTMLElement>,
      copyMenu: true,
    });

    // Menu dispatch [L11]: a chosen item dispatches its `action` (carrying
    // `value`) to the parent responder via targeted dispatch. The hooks run
    // unconditionally (cheap, null-safe outside a provider) even for the
    // common menu-less badge.
    const { dispatchForContinuation } = useControlDispatch();
    const fallbackSenderId = useId();
    const effectiveSenderId = menuSenderId ?? fallbackSenderId;
    // The menu entries: an optional non-interactive header (label + icon,
    // then a separator) above the selectable items. Item ids are the index
    // into `menuItems` so `handleMenuSelect` resolves them regardless of the
    // header — the header carries no id and never selects.
    const internalMenuItems: TugPopupMenuEntry[] = [
      ...(menuHeader !== undefined
        ? [
            { type: "label" as const, label: menuHeader.label, icon: menuHeader.icon },
            { type: "separator" as const },
          ]
        : []),
      ...(menuItems ?? []).map((item, index) => ({
        id: String(index),
        label: item.label,
        icon: item.icon,
        disabled: item.disabled,
        selected: item.selected,
      })),
    ];
    const handleMenuSelect = useCallback(
      (id: string) => {
        const index = Number.parseInt(id, 10);
        const item = menuItems?.[index];
        if (!item) return;
        const { continuation } = dispatchForContinuation({
          action: item.action,
          value: item.value,
          sender: effectiveSenderId,
          phase: "discrete",
        });
        continuation?.();
      },
      [dispatchForContinuation, menuItems, effectiveSenderId],
    );

    // The chevron hint sits to the right of the content, vertically centred,
    // and never participates in the text stack — so adding it leaves the
    // label/content layout untouched.
    const chevronNode = hasMenu && chevron !== undefined ? (
      <span className="tug-badge-chevron" aria-hidden="true">
        {chevron === "up" ? <ChevronUp /> : <ChevronDown />}
      </span>
    ) : null;

    // Inner content: two-line layouts wrap the caption + value in a
    // `.tug-badge-stack` column so the chevron can sit beside the whole
    // stack; single layout keeps the icon + children inline. DOM order is
    // stable (caption first); `content-top` reverses only the visual order.
    const inner = twoLine ? (
      <span className="tug-badge-stack">
        <span className="tug-badge-label">{label}</span>
        <span className="tug-badge-content">
          {icon && <span className="tug-badge-icon">{icon}</span>}
          {children}
        </span>
      </span>
    ) : (
      <>
        {icon && <span className="tug-badge-icon">{icon}</span>}
        {children}
      </>
    );

    const badgeNode = (
      <span
        ref={copyable.composedRef as React.Ref<HTMLSpanElement>}
        data-slot="tug-badge"
        // `data-emphasis` lets CSS dispatch on the emphasis
        // axis without parsing the role half of the class name.
        // The "ghost" variant uses it to zero out padding +
        // border (see `tug-badge.css`) so a badge with no
        // visible chrome doesn't reserve layout space for box
        // it never paints.
        data-emphasis={emphasis}
        className={cn(
          "tug-badge",
          sizeClass,
          layoutClass,
          emphasisRoleClass,
          hasMenu && "tug-badge-has-menu",
          className,
        )}
        style={mergedStyle}
        onContextMenu={copyable.handleContextMenu}
        aria-label={hasMenu ? menuAriaLabel : undefined}
        {...rest}
      >
        {inner}
        {chevronNode}
      </span>
    );

    return (
      <>
        {hasMenu ? (
          <TugPopupMenu
            trigger={badgeNode}
            items={internalMenuItems}
            onSelect={handleMenuSelect}
            // Left-align the menu's edge with the badge's leading edge.
            align="start"
            // The chevron direction is also the side the menu opens toward —
            // an up chevron on a bottom-anchored chip opens the menu above it.
            side={chevron === "up" ? "top" : chevron === "down" ? "bottom" : undefined}
          />
        ) : (
          badgeNode
        )}
        {copyable.contextMenu}
      </>
    );
  }
);
