/**
 * TugListRow — presentational row chrome for list surfaces.
 *
 * The row counterpart to `TugListView`'s windowing primitive, modeled
 * on UIKit's `UITableViewCell`: `TugListView` owns enumeration,
 * windowing, scrolling, and selection state; `TugListRow` owns the
 * row's *presentation* — the leading / content / trailing layout, the
 * `flush` vs `pill` treatment, and the rest / hover / selected /
 * disabled visuals. A `TugListView` cell renderer composes a
 * `TugListRow`; any non-windowed list (a settings group, a static
 * inventory) can use it directly.
 *
 * Presentational only. `TugListRow` takes no `onClick` and owns no
 * selection logic — `selected` and `disabled` are inputs the consumer
 * feeds, reflected to `data-` attributes for CSS. Activation belongs
 * to the enclosing `TugListView` cell wrapper (or the consumer's own
 * wrapper). This mirrors `UITableViewCell`, which is told
 * `setSelected:` by its table view and never decides selection itself.
 *
 * Variants:
 *  - `flush` — edge-to-edge, no rounding, transparent rest. The
 *    iOS-`UITableView.plain` treatment. Row dividers are the
 *    enclosing container's job (a `TugListView` with
 *    `rowLayout="flush"` draws them); a `flush` row paints none of
 *    its own, since it cannot know whether it is the last row.
 *  - `pill` — a discrete bordered, rounded row. Its lineage is
 *    `TugDialogButton`'s outlined-action treatment, so the two
 *    primitives read as one family when stacked.
 *
 * Content:
 *  - `title` plus optional `subtitle` render the common two-line
 *    column — the `UITableViewCellStyle.subtitle` shape.
 *  - `children`, when provided, owns the content column outright and
 *    `title` / `subtitle` are ignored — the escape hatch for rows
 *    whose content is not a plain title / subtitle stack.
 *
 * Accessories:
 *  - `leading` / `trailing` are arbitrary nodes (UIKit's leading
 *    `imageView` / trailing `accessoryView`). `trailingReveal="hover"`
 *    keeps the trailing accessory hidden until row hover /
 *    focus-within.
 *
 * The default `variant` is read from the enclosing `TugListView`'s
 * `rowLayout` through `TugListRowLayoutContext` when present, so a
 * cell renderer need not repeat `variant` on every row; an explicit
 * `variant` prop overrides the context, and `flush` is the final
 * fallback.
 *
 * Laws: [L06] appearance via CSS / DOM attributes, never React state;
 *       [L15] token-driven state visuals; [L16] pairings declared;
 *       [L17] component-tier aliases resolve to base in one hop;
 *       [L19] component authoring guide; [L20] token sovereignty —
 *       composed accessory children keep their own tokens.
 */

import "./tug-list-row.css";

import React from "react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Row presentation. `flush` is edge-to-edge with no rounding; `pill`
 * is a discrete bordered, rounded row.
 */
export type TugListRowVariant = "flush" | "pill";

/** Reveal policy for the trailing accessory. */
export type TugListRowTrailingReveal = "always" | "hover";

export interface TugListRowProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "title"> {
  /**
   * Row presentation. When omitted, falls back to the enclosing
   * `TugListView`'s `rowLayout` (via `TugListRowLayoutContext`), then
   * to `flush`.
   * @selector [data-variant="flush"] | [data-variant="pill"]
   */
  variant?: TugListRowVariant;

  /** Leading accessory — an icon, status glyph, or image. */
  leading?: React.ReactNode;

  /** Trailing accessory — a control or badge. */
  trailing?: React.ReactNode;

  /**
   * Reveal policy for `trailing`. `"hover"` keeps the accessory
   * hidden until the row is hovered or holds focus.
   * @selector .tug-list-row-trailing[data-reveal="hover"]
   * @default "always"
   */
  trailingReveal?: TugListRowTrailingReveal;

  /**
   * Primary row text — sentence-case, single line, truncates with an
   * ellipsis. Ignored when `children` is provided.
   */
  title?: string;

  /**
   * Optional secondary text rendered muted below the title. Ignored
   * when `children` is provided.
   */
  subtitle?: React.ReactNode;

  /**
   * Free-form content column. When provided it owns the content
   * column and `title` / `subtitle` are ignored.
   */
  children?: React.ReactNode;

  /**
   * Selected state. Fed by the consumer; the row does not own
   * selection.
   * @selector [data-selected="true"]
   */
  selected?: boolean;

  /**
   * Disabled state — dimmed, `not-allowed` cursor.
   * @selector [data-disabled="true"]
   */
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Layout context — published by TugListView's `rowLayout`
// ---------------------------------------------------------------------------

/**
 * Default variant published to a `TugListRow` by an enclosing
 * `TugListView` via its `rowLayout` prop. `null` means "no list-view
 * ancestor" — a standalone `TugListRow` then falls back to its own
 * `variant` prop, defaulting to `flush`.
 *
 * Internal to the row/list-view pair; app code never reads it
 * directly. `TugListView` (in `rowLayout` mode) is the only provider.
 */
const TugListRowLayoutContext = React.createContext<TugListRowVariant | null>(
  null,
);

/**
 * Provider for the row-layout context. `TugListView` wraps its
 * rendered window with this when `rowLayout` is set, so descendant
 * `TugListRow`s inherit the variant without each cell repeating it.
 */
export const TugListRowLayoutProvider = TugListRowLayoutContext.Provider;

// ---------------------------------------------------------------------------
// Pure helpers — exported for the test suite
// ---------------------------------------------------------------------------

/** Variant used when neither a prop nor a layout context supplies one. */
export const DEFAULT_LIST_ROW_VARIANT: TugListRowVariant = "flush";

/**
 * Resolve the effective row variant. An explicit `variant` prop wins;
 * otherwise the enclosing `TugListView`'s `rowLayout` (via context);
 * otherwise {@link DEFAULT_LIST_ROW_VARIANT}. Pure; exported for tests.
 */
export function resolveListRowVariant(
  propVariant: TugListRowVariant | undefined,
  contextVariant: TugListRowVariant | null,
): TugListRowVariant {
  return propVariant ?? contextVariant ?? DEFAULT_LIST_ROW_VARIANT;
}

/**
 * Which content path the row renders.
 *  - `"children"` — `children` is non-empty; it owns the content
 *    column and `title` / `subtitle` are ignored.
 *  - `"structured"` — no `children`, but a `title` or `subtitle` is
 *    present; the title / subtitle stack renders.
 *  - `"empty"` — no content at all (a degenerate but non-crashing
 *    case; the content column renders empty).
 */
export type TugListRowContentMode = "children" | "structured" | "empty";

/** True when a `ReactNode` slot carries something worth rendering. */
function isRenderable(node: React.ReactNode): boolean {
  return node !== undefined && node !== null && node !== false;
}

/**
 * Resolve the content-rendering mode. `children` takes precedence
 * over `title` / `subtitle` per the escape-hatch contract. Pure;
 * exported for tests.
 */
export function resolveListRowContentMode(
  children: React.ReactNode,
  title: string | undefined,
  subtitle: React.ReactNode,
): TugListRowContentMode {
  if (isRenderable(children)) return "children";
  if ((title !== undefined && title !== "") || isRenderable(subtitle)) {
    return "structured";
  }
  return "empty";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Presentational list row. See the module docstring for the variant,
 * content, and accessory contracts.
 */
export const TugListRow = React.forwardRef<HTMLDivElement, TugListRowProps>(
  function TugListRow(
    {
      variant,
      leading,
      trailing,
      trailingReveal = "always",
      title,
      subtitle,
      selected,
      disabled,
      children,
      className,
      ...rest
    },
    ref,
  ) {
    const contextVariant = React.useContext(TugListRowLayoutContext);
    const resolvedVariant = resolveListRowVariant(variant, contextVariant);
    const contentMode = resolveListRowContentMode(children, title, subtitle);

    const hasLeading = isRenderable(leading);
    const hasTrailing = isRenderable(trailing);

    return (
      <div
        ref={ref}
        data-slot="tug-list-row"
        data-variant={resolvedVariant}
        data-selected={selected ? "true" : undefined}
        data-disabled={disabled ? "true" : undefined}
        className={cn("tug-list-row", className)}
        {...rest}
      >
        {hasLeading ? (
          <span
            className="tug-list-row-leading"
            data-slot="tug-list-row-leading"
          >
            {leading}
          </span>
        ) : null}
        <span className="tug-list-row-content">
          {contentMode === "children" ? (
            children
          ) : contentMode === "structured" ? (
            <>
              {title !== undefined && title !== "" ? (
                <span className="tug-list-row-title">{title}</span>
              ) : null}
              {isRenderable(subtitle) ? (
                <span className="tug-list-row-subtitle">{subtitle}</span>
              ) : null}
            </>
          ) : null}
        </span>
        {hasTrailing ? (
          <span
            className="tug-list-row-trailing"
            data-slot="tug-list-row-trailing"
            data-reveal={trailingReveal}
          >
            {trailing}
          </span>
        ) : null}
      </div>
    );
  },
);
