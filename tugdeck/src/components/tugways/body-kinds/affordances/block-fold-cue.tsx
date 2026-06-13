/**
 * `BlockFoldCue` — reusable fold-cue affordance for body kinds.
 *
 * Standardizes the action-row fold cue (the trailing-edge chevron
 * + count label that toggles a body's collapsed state) across
 * `FileBlock`, `TerminalBlock`, `DiffBlock`, and any future body
 * kind that surfaces an expand/fold gesture. Encapsulates:
 *
 *  - Chevron icon swap (`ChevronsDown` when collapsed → "expand
 *    me"; `ChevronsUp` when expanded → "collapse me"). Same shape
 *    across the rest / hover states; only the direction flips.
 *  - `aria-expanded` reflecting the current state.
 *  - **Fixed button width across the label swap.** When the
 *    collapsed and expanded labels differ (e.g. "22 more lines" vs
 *    "Collapse"), the button reserves the width of the WIDER of the
 *    two — both labels share one grid cell via `TugPushButton`'s
 *    `widthStabilize`. The button never changes size when toggled,
 *    so a click never shifts the surrounding action row. This is
 *    structural: a consumer that passes a state-dependent label
 *    cannot accidentally produce a width-shifting cue.
 *  - Position-stable click (`usePositionStableClick`). The fold
 *    gesture inherently changes document height, so the wrapper
 *    measures the cluster's pre-click viewport position and writes
 *    the post-click `scrollTop` to keep the user's cursor over the
 *    button across the layout change.
 *  - Follow-bottom release BEFORE the toggle, via
 *    `useScroller().disengage("block-fold")`. The nearest scrolling
 *    host (a `TugListView`) publishes the `Scroller` façade; the
 *    `disengage` call flips its `isFollowingBottom` to false so the
 *    subsequent `ResizeObserver` flush (triggered by the cell-height
 *    change) finds `shouldAutoPin` false and bails out of
 *    `pinToBottom`. Without this, expanding a body inside a
 *    follow-bottom list scrolls the cue off-screen. A composition
 *    with no scrolling host above gets a no-op façade.
 *
 * The variable parts the consumer provides are minimal:
 *
 *  - `collapsed` — current state.
 *  - `onToggle(next)` — called with the new collapsed value. The
 *    affordance has already dispatched the disengage event and
 *    routed the call through the position-stable wrapper; the
 *    consumer's callback just owns its own state update +
 *    side effects (e.g., first-responder promotion).
 *  - `collapsedLabel` — the label shown while collapsed, typically a
 *    formatted count ("8 hunks", "22 more lines").
 *  - `expandedLabel` — the label shown while expanded. Optional;
 *    defaults to `collapsedLabel`. Pass it only when the expanded
 *    state reads differently (e.g. the verb "Collapse").
 *  - `ariaLabelCollapse` / `ariaLabelExpand` — verb pairs for
 *    screen readers ("Collapse file" / "Expand file", etc.).
 *
 * Laws: [L03] `usePositionStableClick` honors the layout-effect
 *       registration contract internally; [L06] the chevron icon
 *       is a render-time JSX choice driven by the `collapsed` prop
 *       (data, not appearance — the chevron *direction* is
 *       state-derived structure, not a CSS-only visual).
 *
 * @module components/tugways/body-kinds/affordances/block-fold-cue
 */

import React from "react";
import { ChevronsDown, ChevronsUp } from "lucide-react";

import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useOuterScrollport } from "@/components/tugways/internal/outer-scrollport-context";
import { useScroller } from "@/components/tugways/internal/scroller-context";
import { usePositionStableClick } from "@/components/tugways/internal/use-position-stable-click";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BlockFoldCueProps {
  /** Current collapsed state. */
  collapsed: boolean;
  /**
   * Called with the new collapsed value. The affordance has
   * already:
   *  - Released the host scroller's follow-bottom lock via
   *    `useScroller().disengage("block-fold")`.
   *  - Wrapped the call in `usePositionStableClick` so the
   *    cluster's viewport position holds across the height change.
   *
   * The consumer's callback owns block-specific concerns: state
   * mutation (controlled vs uncontrolled), first-responder
   * promotion via the chain manager, host-notification callbacks.
   */
  onToggle: (next: boolean) => void;
  /**
   * Label shown while the block is COLLAPSED — typically a formatted
   * count of what is hidden ("8 hunks", "22 more lines", "3 nested
   * calls"). The consumer applies locale-aware number rules
   * (`toLocaleString`) and singular/plural words; the affordance
   * renders the resulting string.
   */
  collapsedLabel: string;
  /**
   * Label shown while the block is EXPANDED. Optional — defaults to
   * `collapsedLabel`, the right choice when the label is the same in
   * both states (a static count like "8 hunks"). Pass a distinct
   * value when the expanded state reads differently — e.g. the verb
   * "Collapse" against a collapsed "22 more lines". When the two
   * differ the button reserves the wider label's width so toggling
   * never resizes it.
   */
  expandedLabel?: string;
  /** ARIA label when the click would collapse the block (expanded → collapsed). */
  ariaLabelCollapse: string;
  /** ARIA label when the click would expand the block (collapsed → expanded). */
  ariaLabelExpand: string;
  /**
   * Optional `data-slot` for per-block test selectors. Falls back
   * to `"block-fold-cue"` when omitted; consumers typically pass
   * a block-specific slot (e.g., `"diff-fold-cue"`, `"file-fold-cue"`).
   */
  "data-slot"?: string;
  /**
   * Affordance scale. `"2xs"` (default) is the body-kind action-row
   * scale; `"xs"` is one step up, for the tool-call header where the
   * cue sits beside an `xs` Copy and must match it.
   */
  size?: "2xs" | "xs";
  /**
   * Button shape. `"icon-text"` (default) shows the chevron + label —
   * the body-kind action-row form. `"icon"` is glyph-only (chevron, no
   * label) — the compact form for the tool-call header's whole-block
   * Expand/Collapse, where a run of blocks would be too busy with text.
   * The chevron still swaps direction to convey state.
   */
  subtype?: "icon-text" | "icon";
  /**
   * Whether the click runs through the body-fold scroll machinery —
   * `usePositionStableClick` (hold the cue under the cursor across the
   * height change) + `useScroller().disengage` (release follow-bottom).
   * `true` (default) for a fold WITHIN a scrolling body. Pass `false`
   * for the tool-call header's whole-block Expand/Collapse, where the
   * surrounding chrome + list windowing own the scroll response and the
   * body-fold machinery would fight it.
   */
  stabilizeScroll?: boolean;
  /** Optional className for cascade-scoped customization. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BlockFoldCue({
  collapsed,
  onToggle,
  collapsedLabel,
  expandedLabel,
  ariaLabelCollapse,
  ariaLabelExpand,
  "data-slot": dataSlot = "block-fold-cue",
  size = "2xs",
  subtype = "icon-text",
  stabilizeScroll = true,
  className,
}: BlockFoldCueProps): React.ReactElement {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  const scrollport = useOuterScrollport();
  const scrollportRef = React.useRef<HTMLElement | null>(null);
  scrollportRef.current = scrollport;
  const { stableClick } = usePositionStableClick({
    targetRef: buttonRef,
    scrollportRef,
  });

  // Follow-bottom handle from the nearest scrolling host. A stable
  // singleton per [L07]: the host publishes a reference-stable façade
  // and a host-less tree gets the module-constant no-op — so listing
  // it in `handleClick`'s deps below never recreates the callback.
  const scroller = useScroller();

  // [L07] — the click handler is `useCallback` over the stable
  // `scroller` singleton and reads `collapsed` + `onToggle` through
  // latest-refs mirrored via `useLayoutEffect`. This avoids the
  // deps-array pattern's closure-recreation churn AND matches the
  // literal wording of L07 ("Every action handler must access current
  // state through refs or stable singletons, never stale
  // closures"). The consumer's `onToggle` may itself be deps-based
  // (e.g., FileBlock's `handleFoldToggle` recreates when
  // `chainManager` changes); the mirror picks up the latest
  // reference at every commit.
  const collapsedRef = React.useRef(collapsed);
  React.useLayoutEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);
  const onToggleRef = React.useRef(onToggle);
  React.useLayoutEffect(() => {
    onToggleRef.current = onToggle;
  }, [onToggle]);

  const handleClick = React.useCallback(() => {
    // Release follow-bottom BEFORE calling onToggle so the host
    // stops pinning before React commits the new cell height; the
    // subsequent ResizeObserver flush then finds `shouldAutoPin`
    // false and bails out of `pinToBottom`. `useScroller()` resolves
    // to the nearest scrolling host's façade (a `TugListView`), or a
    // no-op when no host is above (standalone gallery, non-list
    // composition). The `"block-fold"` source tags the disengage in
    // the deck trace so a follow-bottom regression is traceable.
    // Skipped for whole-block headers (`stabilizeScroll={false}`),
    // where the chrome + list windowing own the scroll response.
    if (stabilizeScroll) scroller.disengage("block-fold");
    onToggleRef.current(!collapsedRef.current);
  }, [scroller, stabilizeScroll]);

  // Resolve the visible label and, when the two fold states read
  // differently, the off-state label the button must also reserve
  // room for. `widthStabilize` overlays both in one grid cell so the
  // button width is `max-content` of the pair — invariant across the
  // toggle. When the labels match (a static count) there is nothing
  // to reserve and `widthStabilize` stays off.
  const resolvedExpandedLabel = expandedLabel ?? collapsedLabel;
  const visibleLabel = collapsed ? collapsedLabel : resolvedExpandedLabel;
  const offStateLabel = collapsed ? resolvedExpandedLabel : collapsedLabel;

  return (
    <TugPushButton
      ref={buttonRef}
      className={className}
      data-slot={dataSlot}
      icon={collapsed ? <ChevronsDown /> : <ChevronsUp />}
      subtype={subtype}
      emphasis="ghost"
      size={size}
      aria-expanded={!collapsed}
      aria-label={collapsed ? ariaLabelExpand : ariaLabelCollapse}
      onClick={() => (stabilizeScroll ? stableClick(handleClick) : handleClick())}
      widthStabilize={
        subtype === "icon" || visibleLabel === offStateLabel
          ? undefined
          : { alternateLabel: offStateLabel }
      }
    >
      {visibleLabel}
    </TugPushButton>
  );
}
