/**
 * gallery-tug-thinking-indicator.tsx -- TugThinkingIndicator showcase.
 *
 * Four sections:
 *
 *  1. **Animating vs static** — the two motion states side-by-side
 *     so the difference is easy to eyeball. The static pair shows
 *     the bars at rest (visible, no motion).
 *  2. **Size variants** — the same animating state at 10 / 12 / 16
 *     / 20 / 24 / 32 px so scaling behavior is visible.
 *  3. **Label position** — every `labelPosition` value with both
 *     the default `"Thinking…"` text and a custom override so the
 *     label slot's API is fully exercised.
 *  4. **Mid-cycle toggle** — a switch that flips `animating` so
 *     the "in-flight group runs to completion" guarantee is
 *     HMR-vettable. Toggle off mid-cycle and watch the bars finish
 *     their current pulse cleanly before freezing.
 *
 * @module components/tugways/cards/gallery-tug-thinking-indicator
 */

import React, { useId, useState } from "react";

import { createNumberFormatter } from "@/lib/tug-format";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugPopupButton } from "@/components/tugways/tug-popup-button";
import type { TugPopupButtonItem } from "@/components/tugways/tug-popup-button";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugSwitch } from "@/components/tugways/tug-switch";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { TugSlider } from "@/components/tugways/tug-slider";
import { TugThinkingIndicator } from "@/components/tugways/tug-thinking-indicator";
import type { TugThinkingIndicatorLabelPosition } from "@/components/tugways/tug-thinking-indicator";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { TUG_ACTIONS } from "../action-vocabulary";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONO = "var(--tug-font-mono, monospace)";
const TEXT_MUTED = "var(--tug7-element-global-text-normal-muted-rest)";

const SIZE_VARIANTS: ReadonlyArray<number> = [10, 12, 16, 20, 24, 32];

const LABEL_POSITIONS: ReadonlyArray<{
  id: TugThinkingIndicatorLabelPosition;
  label: string;
}> = [
  { id: "right", label: "label right (default)" },
  { id: "left", label: "label left" },
  { id: "hidden", label: "label hidden" },
];

// Slider value formatters. `shrinkTo` / `dimTo` show two decimals so
// the value column reads "0.40" / "0.35" at default settings — the
// auto-sizer from `Math.max(displayMin.length, displayMax.length)`
// only sees "0" / "1" and would clip the decimals otherwise, so we
// also pin an explicit `valueWidth` wide enough for the formatted
// "0.00" string plus the standard 2ch padding.
const RATIO_FORMATTER = createNumberFormatter({
  style: "decimal",
  decimals: 2,
  minDecimals: 2,
});
const RATIO_VALUE_WIDTH = "4.5rem";
const MS_VALUE_WIDTH = "4.5rem";

// ---------------------------------------------------------------------------
// GalleryTugThinkingIndicator
// ---------------------------------------------------------------------------

export function GalleryTugThinkingIndicator(): React.ReactElement {
  const [labelPosition, setLabelPosition] =
    useState<TugThinkingIndicatorLabelPosition>("right");
  const [animating, setAnimating] = useState<boolean>(true);
  const [customLabel, setCustomLabel] = useState<string>("");
  const [size, setSize] = useState<number>(16);
  // Tunable animation parameters — surfaced as sliders / checkboxes
  // in the live tinker bench (Section 4) so the design space is
  // HMR-vettable. Defaults match the component's prop defaults.
  const [shrinkTo, setShrinkTo] = useState<number>(0.5);
  const [dimTo, setDimTo] = useState<number>(0.5);
  const [cycleMs, setCycleMs] = useState<number>(960);
  const [shrinkFromTop, setShrinkFromTop] = useState<boolean>(true);
  const [shrinkFromBottom, setShrinkFromBottom] = useState<boolean>(true);

  const animatingSwitchId = useId();
  const labelPositionPopupId = useId();
  const sizePopupId = useId();
  const shrinkToSliderId = useId();
  const dimToSliderId = useId();
  const cycleMsSliderId = useId();
  const shrinkFromTopCheckboxId = useId();
  const shrinkFromBottomCheckboxId = useId();

  const { ResponderScope, responderRef } = useResponderForm({
    toggle: {
      [animatingSwitchId]: setAnimating,
      [shrinkFromTopCheckboxId]: setShrinkFromTop,
      [shrinkFromBottomCheckboxId]: setShrinkFromBottom,
    },
    setValueString: {
      [labelPositionPopupId]: (v: string) =>
        setLabelPosition(v as TugThinkingIndicatorLabelPosition),
      [sizePopupId]: (v: string) => setSize(Number.parseInt(v, 10) || 16),
    },
    setValueNumber: {
      [shrinkToSliderId]: setShrinkTo,
      [dimToSliderId]: setDimTo,
      [cycleMsSliderId]: setCycleMs,
    },
  });

  const labelPositionItems: TugPopupButtonItem<string>[] = LABEL_POSITIONS.map(
    (p) => ({
      action: TUG_ACTIONS.SET_VALUE,
      value: p.id,
      label: p.label,
    }),
  );
  const labelPositionLabel =
    LABEL_POSITIONS.find((p) => p.id === labelPosition)?.label ?? labelPosition;

  const sizeItems: TugPopupButtonItem<string>[] = SIZE_VARIANTS.map((s) => ({
    action: TUG_ACTIONS.SET_VALUE,
    value: String(s),
    label: `${s}px`,
  }));

  const customLabelOrUndefined =
    customLabel.length > 0 ? customLabel : undefined;

  return (
    <ResponderScope>
      <div
        className="cg-content"
        data-testid="gallery-tug-thinking-indicator"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        {/* ---- Section 1 — Animating vs static ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">TugThinkingIndicator — Animating vs static</TugLabel>
          <TugLabel size="2xs" color="muted">
            Three vertical bars that pulse in staggered sequence via
            TugAnimator.group(). When `animating` is true the bars run a
            chained pulse cycle; when false the bars sit at rest (visible,
            no motion).
          </TugLabel>
          <div style={{ display: "flex", gap: 48, alignItems: "center", padding: "12px 0" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                minWidth: 80,
              }}
            >
              <TugThinkingIndicator animating={true} labelPosition="hidden" size={20} />
              <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
                animating
              </span>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                minWidth: 80,
              }}
            >
              <TugThinkingIndicator animating={false} labelPosition="hidden" size={20} />
              <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
                static
              </span>
            </div>
          </div>
        </div>

        <TugSeparator />

        {/* ---- Section 2 — Size variants ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">TugThinkingIndicator — Size Variants</TugLabel>
          <TugLabel size="2xs" color="muted">
            The same animating state at 10 / 12 / 16 / 20 / 24 / 32 px. The
            `size` prop drives `--tugx-thinking-indicator-size`; bar width
            and gap scale proportionally so the three-bar identity holds
            across scales.
          </TugLabel>
          <div style={{ display: "flex", gap: 28, alignItems: "flex-end", padding: "12px 0" }}>
            {SIZE_VARIANTS.map((s) => (
              <div
                key={s}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 56,
                }}
              >
                <TugThinkingIndicator size={s} labelPosition="hidden" />
                <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
                  {s}px
                </span>
              </div>
            ))}
          </div>
        </div>

        <TugSeparator />

        {/* ---- Section 3 — Label position ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">TugThinkingIndicator — Label Position</TugLabel>
          <TugLabel size="2xs" color="muted">
            The `labelPosition` prop renders the label to the right of the
            glyph (default), to the left, or hides it. The default text is
            "Thinking…"; supply `label` to override.
          </TugLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}>
            {LABEL_POSITIONS.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                <TugThinkingIndicator labelPosition={p.id} />
                <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
                  {p.label} (default text)
                </span>
              </div>
            ))}
            {LABEL_POSITIONS.filter((p) => p.id !== "hidden").map((p) => (
              <div
                key={`${p.id}-custom`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                <TugThinkingIndicator labelPosition={p.id} label="Working…" />
                <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
                  {p.label} (custom text)
                </span>
              </div>
            ))}
          </div>
        </div>

        <TugSeparator />

        {/* ---- Section 4 — Live tinker bench ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">TugThinkingIndicator — Live Tinker Bench</TugLabel>
          <TugLabel size="2xs" color="muted">
            Tune every knob — animating, label position, size, shrink scale,
            opacity dip, cycle speed, and shrink direction. The bars'
            transform-origin updates live; mid-cycle slider changes take
            effect on the NEXT pulse cycle so the in-flight pulse runs to
            completion cleanly (no hops, no jumps).
          </TugLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "12px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <TugThinkingIndicator
                animating={animating}
                labelPosition={labelPosition}
                label={customLabelOrUndefined}
                size={size}
                shrinkTo={shrinkTo}
                dimTo={dimTo}
                cycleMs={cycleMs}
                shrinkFromTop={shrinkFromTop}
                shrinkFromBottom={shrinkFromBottom}
              />
              <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
                {animating ? "animating" : "static (rest)"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <TugSwitch
                checked={animating}
                senderId={animatingSwitchId}
                label="animating"
                size="sm"
              />
              <TugPopupButton
                label={`labelPosition: ${labelPositionLabel}`}
                items={labelPositionItems}
                senderId={labelPositionPopupId}
                size="sm"
                aria-label="label position"
              />
              <TugPopupButton
                label={`size: ${size}px`}
                items={sizeItems}
                senderId={sizePopupId}
                size="sm"
                aria-label="size"
              />
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontFamily: MONO,
                  fontSize: "0.6875rem",
                  color: TEXT_MUTED,
                }}
              >
                label:
                <input
                  type="text"
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.currentTarget.value)}
                  placeholder="(default: Thinking…)"
                  style={{
                    fontFamily: MONO,
                    fontSize: "0.75rem",
                    padding: "4px 8px",
                    minWidth: 160,
                  }}
                />
              </label>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr)",
                gap: 12,
                maxWidth: 520,
              }}
            >
              <TugSlider
                value={shrinkTo}
                senderId={shrinkToSliderId}
                min={0}
                max={1}
                step={0.05}
                label="shrinkTo (scaleY at trough)"
                size="sm"
                formatter={RATIO_FORMATTER}
                valueWidth={RATIO_VALUE_WIDTH}
              />
              <TugSlider
                value={dimTo}
                senderId={dimToSliderId}
                min={0}
                max={1}
                step={0.05}
                label="dimTo (opacity at trough)"
                size="sm"
                formatter={RATIO_FORMATTER}
                valueWidth={RATIO_VALUE_WIDTH}
              />
              <TugSlider
                value={cycleMs}
                senderId={cycleMsSliderId}
                min={300}
                max={2400}
                step={60}
                label="cycleMs (total cycle ms)"
                size="sm"
                valueWidth={MS_VALUE_WIDTH}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <TugCheckbox
                checked={shrinkFromTop}
                senderId={shrinkFromTopCheckboxId}
                label="reduce from top"
              />
              <TugCheckbox
                checked={shrinkFromBottom}
                senderId={shrinkFromBottomCheckboxId}
                label="reduce from bottom"
              />
              <span style={{ fontFamily: MONO, fontSize: "0.6875rem", color: TEXT_MUTED }}>
                {shrinkFromTop && shrinkFromBottom
                  ? "shrinking from both ends (center)"
                  : shrinkFromBottom
                    ? "shrinking from bottom up"
                    : shrinkFromTop
                      ? "shrinking from top down (default)"
                      : "no direction selected — falls back to top-down"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </ResponderScope>
  );
}
