/**
 * lens-section-band.tsx — one Lens section: a sticky band (glyph +
 * title + live collapsed-summary + drag grip + chevron) over a body.
 *
 * The band models `TugTranscriptEntry`'s participant band, NOT
 * `BlockChrome` ([P06]): it is a sticky title row that measures its own
 * height onto the section root's `--tugx-pin-stack-top` so nested sticky
 * content (a future changeset section) telescopes BELOW it rather than
 * nesting three sticky levels deep. The measurement copies the transcript
 * entry's `useLayoutEffect` + `ResizeObserver` discipline verbatim — no
 * synchronous `getBoundingClientRect` seed (that read makes an all-rich
 * mount O(n²)); a static CSS fallback covers the first frame.
 *
 * Collapse is persisted ([P03]) via `lensStore.setCollapsed`; the
 * expand/collapse appearance is a `data-collapsed` attribute + CSS
 * ([L06]). A collapsed section renders its band's live `collapsedSummary`
 * and hides its body.
 *
 * Laws: [L06] appearance via CSS + DOM var writes; [L03] the
 * ResizeObserver registration runs in `useLayoutEffect`; [L02] collapse
 * state flows from `lensStore`.
 *
 * @module components/lens/lens-section-band
 */

import React from "react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import { lensStore } from "@/lib/lens-store/lens-store";
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
  const rootRef = React.useRef<HTMLElement | null>(null);
  const bandRef = React.useRef<HTMLDivElement | null>(null);

  // Write `--tugx-pin-stack-top` = live band height onto the section
  // root so nested sticky content clears the band ([P06]). [L03]
  // useLayoutEffect before paint; [L06] DOM var write, not React state.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const band = bandRef.current;
    if (root === null || band === null) return;
    const write = (px: number): void => {
      root.style.setProperty(
        "--tugx-pin-stack-top",
        `${Math.ceil(px) + TIER_GAP_PX}px`,
      );
    };
    // Do NOT seed synchronously with getBoundingClientRect — that forced
    // read interleaved with the write below makes an all-rich mount
    // O(n²). The ResizeObserver fires an initial callback on observe()
    // with the real height (rAF-coalesced); the static CSS fallback
    // covers the one frame before it lands.
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
  }, []);

  const toggleCollapsed = React.useCallback(() => {
    lensStore.setCollapsed(def.kind, !collapsed);
  }, [def.kind, collapsed]);

  return (
    <section
      ref={rootRef}
      className="lens-section"
      data-lens-section={def.kind}
      data-collapsed={collapsed ? "true" : "false"}
    >
      <div ref={bandRef} className="lens-section-band" data-testid="lens-section-band">
        {/* Drag grip — starts a reorder drag ([P08]). */}
        <span
          className="lens-section-grip"
          data-testid="lens-section-grip"
          onPointerDown={
            onGripPointerDown
              ? (e) => onGripPointerDown(def.kind, e)
              : undefined
          }
        >
          <GripVertical size={14} aria-hidden="true" />
        </span>
        <span className="lens-section-glyph" aria-hidden="true">
          {def.glyph}
        </span>
        <span className="lens-section-title">{def.title}</span>
        {collapsed ? (
          <span className="lens-section-summary" data-testid="lens-section-summary">
            <LensSectionSlot render={def.collapsedSummary} host={host} />
          </span>
        ) : (
          <span className="lens-section-summary-spacer" />
        )}
        <TugIconButton
          icon={collapsed ? <ChevronRight /> : <ChevronDown />}
          aria-label={collapsed ? `Expand ${def.title}` : `Collapse ${def.title}`}
          onClick={toggleCollapsed}
        />
      </div>
      {collapsed ? null : (
        <div className="lens-section-body" data-testid="lens-section-body">
          <LensSectionSlot render={def.body} host={host} />
        </div>
      )}
    </section>
  );
}
