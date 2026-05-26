/**
 * TugTaskItem — one row in a task / checklist surface: a leading
 * status indicator (icon or progress ring) + a `TugLabel`.
 *
 * The three statuses each pick a standard-role visual treatment so
 * the colors come from the seven-slot system, not bespoke aliases:
 *
 *  - `pending`     — lucide `Circle` icon, muted text color.
 *  - `in_progress` — `TugProgress` ring `variant="ring"`
 *                    `role="action"` (resolves to the standard
 *                    "active" accent — blue, matched by the
 *                    component's own background band and label
 *                    color tokens, both of which alias the
 *                    `surface-tone-*` / `element-tone-*` active
 *                    family). When the host passes `idle`, the
 *                    ring renders in its `stopped` state (closed
 *                    outlined circle, no animation).
 *  - `completed`   — lucide `Check` icon, muted text color, with a
 *                    line-through on the label so finished rows
 *                    fade visually.
 *
 * Composition layout: a horizontal flex row with the indicator at
 * its natural size and the label flexing to fill. When
 * `description` is set, the row is wrapped in a `TugTooltip` so
 * the longer prose surfaces on hover; the row itself stays
 * single-line.
 *
 * Why this component exists. Before this primitive, the task list
 * was rendered ad-hoc inside `TodoListBlock` with row-specific
 * lucide icons + hand-rolled CSS for the highlight band. That
 * produced non-standard accent colors (because the row had no path
 * to the standard "active" tone) and forced any consumer needing
 * a task row to either re-implement the rendering or wrap the
 * whole body kind. `TugTaskItem` consolidates the "indicator +
 * label" composition into one reusable primitive with proper
 * role-driven colors.
 *
 * Laws:
 *  - [L06] Visual state (highlight, strikethrough) is driven by
 *    `data-status` on the root; CSS owns the appearance. The
 *    `idle` boolean is data (it reflects the surrounding session
 *    phase) and passes through React props.
 *  - [L19] File pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="tug-task-item"` on the root, this docstring.
 *  - [L20] Component-token sovereignty — this file owns only
 *    `--tugx-task-item-*` slots, and composes `TugProgress` /
 *    `TugLabel` / `TugTooltip` through their public APIs
 *    (`role`, `color`, `content`). It never overrides any of
 *    those components' own token slots.
 *
 * @module components/tugways/tug-task-item
 */

import "./tug-task-item.css";

import React from "react";
import { Check, Circle } from "lucide-react";

import { TugLabel, type TugLabelEmphasis, type TugLabelRole } from "./tug-label";
import { TugProgress } from "./tug-progress";
import { TugTooltip } from "./tug-tooltip";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Lifecycle of one task. */
export type TugTaskItemStatus = "pending" | "in_progress" | "completed";

export interface TugTaskItemProps {
  /** Task status — drives the indicator type and the label / band treatment. */
  status: TugTaskItemStatus;

  /** Primary label text. */
  label: string;

  /**
   * Optional secondary text — surfaces in a `TugTooltip` on hover.
   * When undefined, the row is rendered without a tooltip wrapper.
   */
  description?: string;

  /**
   * For `in_progress`: when `true`, the progress ring renders in
   * its `stopped` state (closed outlined circle, no animation).
   * Use to keep the row quiet when the surrounding context is idle
   * — e.g. the Tide session's `phase === "idle"`. Ignored for
   * `pending` and `completed` rows.
   * @default false
   */
  idle?: boolean;

  /** Forwarded class name for cascade-scoped customization. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_SLOT_ROOT = "tug-task-item";
const DATA_SLOT_INDICATOR = "tug-task-item-indicator";
const DATA_SLOT_LABEL = "tug-task-item-label";

// Match the `TugProgress variant="ring" size="sm"` outer dimension
// (16 px) so the lucide icons used for `pending` / `completed`
// occupy the same visual extent as the in-progress ring — no size
// jitter on a status change.
const ICON_SIZE_PX = 16;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TugTaskItem: React.FC<TugTaskItemProps> = ({
  status,
  label,
  description,
  idle = false,
  className,
}) => {
  const rootClass =
    className === undefined
      ? "tug-task-item"
      : `tug-task-item ${className}`;

  const indicator = (() => {
    if (status === "in_progress") {
      return (
        <TugProgress
          variant="ring"
          size="sm"
          role="action"
          stopped={idle}
          aria-hidden="true"
        />
      );
    }
    const Icon = status === "completed" ? Check : Circle;
    return <Icon size={ICON_SIZE_PX} aria-hidden="true" />;
  })();

  // Per-status label treatment:
  //   - `in_progress` → `role="action"` so the label text picks
  //     up the same active-tone color family the ring uses (one
  //     consistent role-driven accent for the whole row).
  //   - `completed`   → `emphasis="calm"` so finished rows fade
  //     to prose weight; the strikethrough is applied via CSS.
  //   - `pending`     → default color, no emphasis.
  const labelEmphasis: TugLabelEmphasis | undefined =
    status === "completed" ? "calm" : undefined;
  const labelRole: TugLabelRole | undefined =
    status === "in_progress" ? "action" : undefined;

  const row = (
    <div
      className={rootClass}
      data-slot={DATA_SLOT_ROOT}
      data-status={status}
    >
      <span
        className="tug-task-item-indicator"
        data-slot={DATA_SLOT_INDICATOR}
      >
        {indicator}
      </span>
      <TugLabel
        size="sm"
        emphasis={labelEmphasis}
        role={labelRole}
        className="tug-task-item-label"
        data-slot={DATA_SLOT_LABEL}
      >
        {label}
      </TugLabel>
    </div>
  );

  if (description === undefined) return row;
  return (
    <TugTooltip content={description} side="top" align="start">
      {row}
    </TugTooltip>
  );
};
