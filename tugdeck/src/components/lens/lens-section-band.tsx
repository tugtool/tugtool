/**
 * lens-section-band.tsx — one Lens section: a sticky band (grip + glyph +
 * title + live collapsed-summary + fold chevron) over a body.
 *
 * The band is a {@link BlockStrip} at `altitude="section"` ([P02]): the same
 * header-shell primitive the transcript tool-call header wears, one altitude
 * up — so the Lens sections and the transcript read as one component family.
 * The section keeps its own lensStore-driven collapse and conditional body
 * render; it is NOT a full `BlockChrome` (that would bridge two collapse
 * owners, see [Q01]).
 *
 * The band measures its own height onto the section BODY's
 * `--tugx-pin-stack-top` ([P09]) so nested sticky content (the Sessions
 * entries) telescopes BELOW it. The producer is the body, never the element
 * the strip reads from: the section strip pins at an explicit `top: 0` (the
 * `[data-altitude="section"]` override), always the outermost pin, breaking
 * the self-reference that would otherwise have the strip read the very
 * variable its measured height writes. The measurement keeps the
 * no-synchronous-seed discipline (#header-dom-seam) — a forced
 * `getBoundingClientRect` per section would make an all-rich mount O(n²);
 * the `ResizeObserver`'s initial callback (rAF-coalesced) carries the real
 * height, with a static CSS fallback for the first frame.
 *
 * Collapse is persisted via `lensStore.setCollapsed`; the expand/collapse
 * appearance is a `data-collapsed` attribute + CSS ([L06]). A collapsed
 * section renders its band's live `collapsedSummary` and hides its body.
 *
 * Laws: [L06] appearance via CSS + DOM var writes; [L03] the ResizeObserver
 * registration runs in `useLayoutEffect`; [L02] collapse state flows from
 * `lensStore`; [L17]/[L20] the section sizes come from the `data-altitude`
 * token scale, not bespoke band CSS; [L19] file pair, docstring, `data-slot`.
 *
 * @module components/lens/lens-section-band
 */

import React from "react";
import { lensStore } from "@/lib/lens-store/lens-store";
import { BlockStrip } from "@/components/tugways/blocks/block-strip";
import { BlockGrip } from "@/components/tugways/body-kinds/affordances/block-grip";
import { BlockFoldCue } from "@/components/tugways/body-kinds/affordances/block-fold-cue";
import type {
  LensSectionDefinition,
  LensSectionHost,
} from "./lens-section-registry";
import "./lens-section-band.css";

/** Tier gap so nested sticky chrome clears the band rather than slipping
 *  under it on sub-pixel heights (mirrors `TugTranscriptEntry`). */
const TIER_GAP_PX = 4;

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
  const bandRef = React.useRef<HTMLDivElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);

  // Write `--tugx-pin-stack-top` = live band height onto the section BODY
  // ([P09]) so nested sticky content clears the band. The strip pins at
  // `top: 0` (its own `[data-altitude="section"]` override), so it never
  // reads this variable — the producer and the consumer are different
  // elements, no self-reference. A collapsed section has no body, so nothing
  // is observed or written (nothing nested to clear). [L03] useLayoutEffect
  // before paint; [L06] DOM var write, not React state.
  React.useLayoutEffect(() => {
    const band = bandRef.current;
    const body = bodyRef.current;
    if (band === null || body === null) return;
    const write = (px: number): void => {
      body.style.setProperty(
        "--tugx-pin-stack-top",
        `${Math.ceil(px) + TIER_GAP_PX}px`,
      );
    };
    // Do NOT seed synchronously with getBoundingClientRect — that forced
    // read interleaved with the write below makes an all-rich mount O(n²).
    // The ResizeObserver fires an initial callback on observe() with the
    // real height (rAF-coalesced); the static CSS fallback on
    // `.lens-section-body` covers the one frame before it lands.
    let rafId = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const boxes = entry.borderBoxSize;
      const next =
        boxes !== undefined && boxes.length > 0
          ? boxes[0].blockSize
          : entry.contentRect.height;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => write(next));
    });
    observer.observe(band);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
    // Re-run across a collapse toggle: the body mounts/unmounts, so the
    // write target changes (an unmounted body must not be measured into).
  }, [collapsed]);

  return (
    <section
      className="lens-section"
      data-lens-section={def.kind}
      data-collapsed={collapsed ? "true" : "false"}
    >
      <BlockStrip
        ref={bandRef}
        altitude="section"
        className="tool-call-header"
        dataTestid="lens-section-band"
        dataCollapsed={collapsed}
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
              // The Lens content scroller owns its own follow-behavior; a
              // section fold is a plain toggle, so skip the fold-cue's
              // scroll-stabilization machinery (a no-op here anyway).
              stabilizeScroll={false}
            />
          </>
        }
      />
      {collapsed ? null : (
        <div ref={bodyRef} className="lens-section-body" data-testid="lens-section-body">
          <LensSectionSlot render={def.body} host={host} />
        </div>
      )}
    </section>
  );
}
