/**
 * lens-section-band.tsx — one Lens section: a band (grip + glyph + title +
 * live collapsed-summary + fold chevron) over an internally-scrolling body.
 *
 * The band is a {@link BlockStrip} at `altitude="section"` ([P02]): the same
 * header-shell primitive the transcript tool-call header wears, one altitude
 * up — so the Lens sections and the transcript read as one component family.
 * The section keeps its own lensStore-driven collapse and conditional body
 * render; it is NOT a full `BlockChrome` (that would bridge two collapse
 * owners, see [Q01]).
 *
 * Every band is always visible: the Lens stack does not scroll — the section
 * is a flex band whose BODY scrolls internally when its content outgrows the
 * section's share of the height (the sizing lives in `lens-section-band.css`
 * / `lens-content.css`). No sticky pinning, no measured pin offsets.
 *
 * Clicking the band (anywhere except its buttons / the grip) focuses the
 * section's list: it expands a collapsed section and lands the keyboard key
 * view on the section's focus group via a keyboard `place()`, so the band is
 * a one-click route to keyboard navigation of its items.
 *
 * Collapse is persisted via `lensStore.setCollapsed`; the expand/collapse
 * appearance is a `data-collapsed` attribute + CSS ([L06]). A collapsed
 * section renders its band's live `collapsedSummary` and hides its body.
 *
 * Laws: [L06] appearance via CSS + DOM attributes; [L02] collapse state
 * flows from `lensStore`; [L17]/[L20] the section sizes come from the
 * `data-altitude` token scale, not bespoke band CSS; [L19] file pair,
 * docstring, `data-slot`; [L22] the band-click focus goes through the
 * FocusManager (a keyboard `place()`), never a hand-rolled focus walk.
 *
 * @module components/lens/lens-section-band
 */

import React from "react";
import { lensStore } from "@/lib/lens-store/lens-store";
import { BlockStrip } from "@/components/tugways/blocks/block-strip";
import { BlockGrip } from "@/components/tugways/body-kinds/affordances/block-grip";
import { BlockFoldCue } from "@/components/tugways/body-kinds/affordances/block-fold-cue";
import { useFocusManager } from "@/components/tugways/use-focusable";
import { sectionFocusGroup } from "./lens-section-registry";
import type {
  LensSectionDefinition,
  LensSectionHost,
} from "./lens-section-registry";
import "./lens-section-band.css";

/** Render a section factory (body or collapsed-summary) inside its own
 *  component boundary so the factory may use hooks and collapse can
 *  mount/unmount it without breaking the rules of hooks. */
function LensSectionSlot({
  render,
  host,
}: {
  render: (host: LensSectionHost) => React.ReactNode;
  host: LensSectionHost;
}): React.ReactElement {
  return <>{render(host)}</>;
}

export interface LensSectionProps {
  def: LensSectionDefinition;
  host: LensSectionHost;
  collapsed: boolean;
  /** Begin a drag-reorder from this section's grip (DOM-only preview,
   *  committed on drop by the owning `LensContent`). */
  onGripPointerDown?: (kind: string, event: React.PointerEvent) => void;
}

export function LensSection({
  def,
  host,
  collapsed,
  onGripPointerDown,
}: LensSectionProps): React.ReactElement {
  const focusManager = useFocusManager();

  // Band click → focus this section's list. Filtered to the band's inert
  // surface: clicks on the fold chevron, header-action buttons, or the drag
  // grip keep their own meaning. Expanding a collapsed section first means
  // the list mounts before the key view lands; the placement realizes
  // immediately against a mounted focusable and arms a late-mount resume for
  // one still mounting — both orderings land the ring.
  const onBandClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, .block-grip") !== null) return;
      if (collapsed) lensStore.setCollapsed(def.kind, false);
      focusManager?.place(
        host.lensCardId,
        { kind: "focus-key", focusKey: `${sectionFocusGroup(def.kind)}:0` },
        { modality: "keyboard" },
      );
    },
    [collapsed, def.kind, focusManager, host.lensCardId],
  );

  return (
    <section
      className="lens-section"
      data-lens-section={def.kind}
      data-collapsed={collapsed ? "true" : "false"}
    >
      <BlockStrip
        altitude="section"
        className="tool-call-header"
        dataTestid="lens-section-band"
        dataCollapsed={collapsed}
        onClick={onBandClick}
        // Drag grip — starts a reorder drag ([P04]/[P08]).
        grip={
          onGripPointerDown !== undefined ? (
            <BlockGrip
              data-testid="lens-section-grip"
              onPointerDown={(e) => onGripPointerDown(def.kind, e)}
            />
          ) : undefined
        }
        leading={
          <span className="tool-call-header-leading" aria-hidden="true">
            {def.glyph}
          </span>
        }
        name={def.title}
        // Collapsed ⇒ the live one-line summary fills the detail column (the
        // flexible spacer), pushing the chevron right; expanded ⇒ an empty
        // detail is the spacer. The summary keeps its `lens-section-summary`
        // test hook.
        detail={
          collapsed ? (
            <span data-testid="lens-section-summary">
              <LensSectionSlot render={def.collapsedSummary} host={host} />
            </span>
          ) : undefined
        }
        actions={
          <>
            {/* Section-contributed controls sit LEFT of the chevron and,
                like the tool header's body-kind portal, show only while the
                section is expanded — the controls act on the visible body.
                The fold chevron itself is always present. */}
            {collapsed ? null : def.headerActions?.(host)}
            <BlockFoldCue
              collapsed={collapsed}
              onToggle={(next) => lensStore.setCollapsed(def.kind, next)}
              collapsedLabel="Expand"
              expandedLabel="Collapse"
              ariaLabelExpand={`Expand ${def.title}`}
              ariaLabelCollapse={`Collapse ${def.title}`}
              size="xs"
              subtype="icon"
              // The section body owns its own scrolling; a section fold is a
              // plain toggle, so skip the fold-cue's scroll-stabilization
              // machinery (a no-op here anyway).
              stabilizeScroll={false}
            />
          </>
        }
      />
      {collapsed ? null : (
        <div className="lens-section-body" data-testid="lens-section-body">
          <LensSectionSlot render={def.body} host={host} />
        </div>
      )}
    </section>
  );
}
