/**
 * gallery-tug-progress-indicator.tsx — TugProgressIndicator showcase.
 *
 * Replaces three earlier galleries (gallery-progress, gallery-tug-
 * state-indicator, gallery-tug-thinking-indicator) — the unified
 * indicator subsumes all three predecessors.
 *
 * Layout:
 *  - Variants  — seven glyphs in a wrapping card grid
 *  - large-pulsing-dot — the workshop bench for the breathing dot: size
 *                picker, all five states, and a Lens-row preview beside the
 *                small dot at the same size
 *  - Timing    — four benches on the pulse: cuts of the breath envelope
 *                (symmetric through severe), the ring's opacity falloff, its
 *                stroke weight, and the small dot's two ring easings
 *  - Roles     — eight role tones in a wrapping card grid (ring variant)
 *  - States    — a 4 × 5 matrix (variant rows × state columns)
 *  - Determinate — a 3 × 5 matrix (variant rows × value columns)
 *  - Value readout — showValue percentage on bar / ring / pie + labeled bar
 *  - Phase     — phase picker + live indicator using phaseLabels/phaseVisual
 *  - Layout    — glyphPosition picker + labelAlign="center" demo with
 *                width-stabilize so phase changes don't shift layout
 *
 * @module components/tugways/cards/gallery-tug-progress-indicator
 */

import "./gallery-tug-progress-indicator.css";

import React, { useId, useState } from "react";
import { ArrowUp } from "lucide-react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import {
  breathEnvelope,
  DEFAULT_BREATH_TURN,
  DEFAULT_FADE_POWER,
  DEFAULT_PULSE_WEIGHT,
} from "@/components/tugways/internal/tug-progress-large-pulsing-dot";
import {
  TugProgressIndicator,
  type TugProgressIndicatorRole,
  type TugProgressIndicatorState,
  type TugProgressIndicatorVariant,
  type TugProgressIndicatorPhaseVisual,
} from "@/components/tugways/tug-progress-indicator";

const VARIANTS: ReadonlyArray<TugProgressIndicatorVariant> = [
  "ring",
  "bar",
  "spinner",
  "pulsing-dot",
  "large-pulsing-dot",
  "wave",
  "pie",
];

const ROLES: ReadonlyArray<TugProgressIndicatorRole> = [
  "inherit",
  "action",
  "agent",
  "data",
  "option",
  "success",
  "caution",
  "danger",
];

const STATE_DEMO_VARIANTS: ReadonlyArray<TugProgressIndicatorVariant> = [
  "ring",
  "pulsing-dot",
  "large-pulsing-dot",
  "wave",
];

const STATES: ReadonlyArray<TugProgressIndicatorState> = [
  "running",
  "paused",
  "stopped",
  "completed",
  "aborted",
];

const DETERMINATE_VARIANTS: ReadonlyArray<TugProgressIndicatorVariant> = [
  "ring",
  "bar",
  "pie",
];

const DETERMINATE_VALUES = [0, 0.25, 0.5, 0.75, 1] as const;

const DEMO_PHASES: Record<string, string> = {
  idle: "Idle",
  streaming: "Streaming",
  awaiting_approval: "Awaiting",
  offline: "Disconnected",
};
const DEMO_PHASE_KEYS = Object.keys(DEMO_PHASES);

function demoPhaseVisual(phase: string): TugProgressIndicatorPhaseVisual {
  switch (phase) {
    case "offline":
      return { role: "danger", state: "aborted" };
    case "awaiting_approval":
      return { role: "caution", state: "running" };
    case "streaming":
      return { role: "success", state: "running" };
    case "idle":
    default:
      return { role: "inherit", state: "stopped" };
  }
}

// ---------------------------------------------------------------------------
// Cell — one labeled glyph card. The bar variant fills the cell's width.
// ---------------------------------------------------------------------------

interface GalleryCellProps {
  caption: string;
  children: React.ReactNode;
  /** Wide cell — used for the bar variant. */
  wide?: boolean;
}

function GalleryCell({
  caption,
  children,
  wide,
}: GalleryCellProps): React.ReactElement {
  return (
    <div className={wide ? "gpi-cell gpi-cell-wide" : "gpi-cell"}>
      <div className="gpi-cell-glyph">{children}</div>
      <div className="gpi-cell-caption">{caption}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryTugProgressIndicator
// ---------------------------------------------------------------------------

/**
 * Sizes for the `large-pulsing-dot` workshop, bracketing the Z5 submit
 * button's 36px square — the legibility bar this variant is aiming at.
 */
const LARGE_DOT_SIZES = [24, 28, 32, 36, 40] as const;
const LARGE_DOT_SIZE_ITEMS = LARGE_DOT_SIZES.map((s) => ({
  value: String(s),
  label: String(s),
}));

/**
 * The timing bench — cuts of the breath envelope, symmetric through severe.
 *
 * `turn` is where in the cycle the dot reaches full size, so it is also the
 * split between the two legs: 0.3 means the dot rises over 600ms of the 2s
 * cycle and sinks over the remaining 1400ms. 0.5 is the symmetric breath this
 * variant shipped with first — the one that reads as a mechanism cycling
 * rather than something alive.
 *
 * Everything else about the envelope follows from the turn: the ring's
 * ignition sits 3% of the cycle ahead of it, and the radius it is born at is
 * whatever the dot's edge measures at that instant.
 */
const BREATH_TURNS: ReadonlyArray<{ turn: number; note?: string }> = [
  { turn: 0.5, note: "symmetric" },
  { turn: 0.4 },
  { turn: DEFAULT_BREATH_TURN },
  { turn: 0.22, note: "severe" },
];

/** "30 / 70 — shipped". The split is the turn; the shipped cut says so. */
function turnCaption(turn: number, note?: string): string {
  const split = `${Math.round(turn * 100)} / ${Math.round((1 - turn) * 100)}`;
  return caption(split, turn === DEFAULT_BREATH_TURN ? "shipped" : note);
}

/** "fade ×³ — shipped". */
function powerCaption(power: number, note?: string): string {
  const supers = ["", "¹", "²", "³", "⁴", "⁵"];
  return caption(
    `fade ×${supers[power] ?? String(power)}`,
    power === DEFAULT_FADE_POWER ? "shipped" : note,
  );
}

/** "×1.15 — shipped". */
function weightCaption(weight: number, note?: string): string {
  return caption(
    `×${weight}`,
    weight === DEFAULT_PULSE_WEIGHT ? "shipped" : note,
  );
}

function caption(head: string, note?: string): string {
  return note === undefined ? head : `${head} — ${note}`;
}

/**
 * Bench cells pin the per-instance period jitter to 1. The drift is there to
 * pull a column of live sessions apart; here it would just be noise between
 * two things meant to be compared, and every cell mounts in the same frame so
 * they start the cycle together.
 */
const BENCH_NO_DRIFT: React.CSSProperties = {
  ["--tugx-progress-large-pulsing-dot-drift" as string]: "1",
};

/**
 * Falloff exponents for the ring's opacity — how front-loaded the fade is.
 *
 * The shape of the exit turned out not to be the lever; the birth opacity was.
 * Once the ring is born near-solid, the even fall reads best — it is a ring
 * travelling outward and thinning. Each step up buys a little more snap at the
 * dot's edge and pays for it by cutting the ring's visible life shorter, until
 * at ×⁴ the pulse is over before it has crossed half the box.
 */
const FADE_POWERS: ReadonlyArray<{ power: number; note?: string }> = [
  { power: DEFAULT_FADE_POWER, note: "even" },
  { power: 2 },
  { power: 3 },
  { power: 4, note: "near-flash" },
];

/**
 * Pulse stroke weights, as multiples of the resting ring's.
 *
 * The ring expands by `transform: scale`, so its border is thinnest at
 * ignition — where it most needs to read — and thickest as it fades out. The
 * multiplier compensates for the first; 1 is no compensation at all and the
 * pulse is born a hairline ghost.
 *
 * Expect coarse steps rather than a smooth ladder. Borders quantize to whole
 * CSS px, so at a 32px glyph the resting ring is 2px and these four weights
 * paint 2, 2, 2 and 3 — the knob is continuous, the screen is not.
 */
const PULSE_WEIGHTS: ReadonlyArray<{ weight: number; note?: string }> = [
  { weight: 1, note: "no compensation" },
  { weight: 1.15 },
  { weight: 1.3 },
  { weight: DEFAULT_PULSE_WEIGHT },
];

/**
 * The small dot's ring easing, mild cut against hard. Expo-out leaves the dot
 * about twice as fast as `ease-out` and spends the rest of the pulse fading —
 * the same quick-out / slow-home asymmetry the large glyph gets from an early
 * turn.
 */
const PULSE_EASINGS: ReadonlyArray<{ easing: string; caption: string }> = [
  { easing: "ease-out", caption: "ease-out — shipped" },
  { easing: "cubic-bezier(0.16, 1, 0.3, 1)", caption: "expo-out" },
];

const PHASE_ITEMS = DEMO_PHASE_KEYS.map((p) => ({ value: p, label: p }));
const GLYPH_POSITION_ITEMS = [
  { value: "left", label: "left" },
  { value: "right", label: "right" },
  { value: "both", label: "both" },
];

export function GalleryTugProgressIndicator(): React.ReactElement {
  const [phase, setPhase] = useState<string>("streaming");
  const [glyphPosition, setGlyphPosition] = useState<"left" | "right" | "both">(
    "both",
  );
  const [largeDotSize, setLargeDotSize] = useState<number>(32);

  const phaseGroupId = useId();
  const layoutPhaseGroupId = useId();
  const glyphPositionGroupId = useId();
  const largeDotSizeGroupId = useId();

  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: {
      [phaseGroupId]: setPhase,
      [layoutPhaseGroupId]: setPhase,
      [glyphPositionGroupId]: (v: string) =>
        setGlyphPosition(v as "left" | "right" | "both"),
      [largeDotSizeGroupId]: (v: string) => setLargeDotSize(Number(v)),
    },
  });

  return (
    <ResponderScope>
      <div
        className="cg-content"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        {/* Variants ---------------------------------------------------- */}
        <section className="cg-section">
          <TugLabel className="cg-section-title">
            Variants — seven glyphs, default role/state
          </TugLabel>
          <div className="gpi-grid">
            {VARIANTS.map((v) => (
              <GalleryCell key={v} caption={v} wide={v === "bar"}>
                <TugProgressIndicator variant={v} size={v === "bar" ? 6 : 20} />
              </GalleryCell>
            ))}
          </div>
        </section>

        <TugSeparator />

        {/* Large pulsing dot — the workshop bench --------------------- */}
        <section className="cg-section">
          <TugLabel className="cg-section-title">
            large-pulsing-dot — breathing dot, ring on the fall
          </TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            Read the row of states below as a size ladder first. Running owns
            the whole glyph box; paused and aborted draw in to 0.7 of it;
            stopped and completed recede to 0.5. The box never changes, so
            nothing reflows — only the figure inside it does. That ordering is
            the point: a working session must be the biggest mark in a column of
            them.
          </TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            The inner dot eases between 0.35 and full size over a 2s cycle,
            traveling the whole swing every time. The ring is not on its own
            clock: it is lit a few degrees before top dead center — 47% of the
            cycle, ~10.8° BTDC — flush with the dot's edge, so it is already
            moving when the dot turns over it. It then widens to the glyph box
            and fades across the exhale. Two rejected timings: the 75% crossing
            read as a hesitation the dot never makes, and exact TDC ran a hair
            behind the beat.
          </TugLabel>
          <TugChoiceGroup
            size="sm"
            value={String(largeDotSize)}
            senderId={largeDotSizeGroupId}
            items={LARGE_DOT_SIZE_ITEMS}
            aria-label="Large dot size"
          />
          <div className="gpi-grid">
            {STATES.map((s) => (
              <GalleryCell key={s} caption={s}>
                <TugProgressIndicator
                  variant="large-pulsing-dot"
                  size={largeDotSize}
                  state={s}
                />
              </GalleryCell>
            ))}
          </div>
          <TugLabel size="2xs" emphasis="calm">
            The scale reference is the real Z5 submit button (36px square),
            shown here beside the glyph. Below it, the destination: the leading
            slot of a Lens Sessions row, small dot then large, over the row's
            own two-line type.
          </TugLabel>
          <div className="gpi-demo-frame">
            <div className="gpi-row-preview">
              <TugPushButton
                subtype="icon"
                size="lg"
                emphasis="filled"
                role="action"
                aria-label="Z5 submit button, for scale"
                icon={<ArrowUp size={16} strokeWidth={2.5} />}
              />
              <TugProgressIndicator
                variant="large-pulsing-dot"
                size={largeDotSize}
                state="running"
              />
            </div>
          </div>
          <div className="gpi-demo-frame">
            <div className="gpi-row-preview">
              <TugProgressIndicator
                variant="pulsing-dot"
                size={largeDotSize}
                state="running"
              />
              <div className="gpi-row-preview-text">
                <div className="gpi-row-preview-title">tugtool/coral-clip</div>
                <div className="gpi-row-preview-pulse">
                  Read select-tests.ts…
                </div>
              </div>
            </div>
            <div className="gpi-row-preview">
              <TugProgressIndicator
                variant="large-pulsing-dot"
                size={largeDotSize}
                state="running"
              />
              <div className="gpi-row-preview-text">
                <div className="gpi-row-preview-title">tugtool/coral-clip</div>
                <div className="gpi-row-preview-pulse">
                  Read select-tests.ts…
                </div>
              </div>
            </div>
          </div>
        </section>

        <TugSeparator />

        {/* Timing bench ------------------------------------------------ */}
        <section className="cg-section">
          <TugLabel className="cg-section-title">
            Timing — the breath envelope, four cuts
          </TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            Where the dot reaches full size is also where the cycle splits. At
            the left it turns at the halfway mark: the rise takes exactly as
            long as the fall, and the glyph reads as a mechanism cycling. Moving
            the turn earlier makes the dot arrive quickly and leave slowly — the
            shape of the colon blink on a digital watch face, where the dots
            appear faster than they go away. Each leg is its own cosine fitted
            to its own length, so however quick the rise, it still lands with
            zero velocity: the dot hits a HOLD at the top rather than a corner,
            then drifts back down. Rise, hover, sink.
          </TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            The ring follows the turn — it is lit 3% of the cycle ahead of it,
            at whatever radius the dot's edge measures there. Nothing here is a
            separate keyframe block: each cell overrides the four `linear()`
            easing variables the stylesheet reads, which is the same call
            (`breathEnvelope`) that produced the shipped defaults. Drift is
            pinned to 1 in this bench so the only difference between cells is
            the curve.
          </TugLabel>
          <div className="gpi-grid">
            {BREATH_TURNS.map(({ turn, note }) => (
              <GalleryCell key={turn} caption={turnCaption(turn, note)}>
                <TugProgressIndicator
                  variant="large-pulsing-dot"
                  size={largeDotSize}
                  state="running"
                  style={{ ...BENCH_NO_DRIFT, ...breathEnvelope(turn) }}
                />
              </GalleryCell>
            ))}
          </div>
          <TugLabel size="2xs" emphasis="calm">
            The ring's opacity falloff, all four born at the same near-solid
            strength. The birth is what was wrong before: at partial strength
            the ring looked like it was already fading before it existed, and no
            shape of exit fixes that. With the birth corrected, the even fall is
            the one that reads — each step up trades a little more snap at the
            dot's edge for a shorter visible life, until the pulse is gone
            before it has crossed half the box.
          </TugLabel>
          <div className="gpi-grid">
            {FADE_POWERS.map(({ power, note }) => (
              <GalleryCell key={power} caption={powerCaption(power, note)}>
                <TugProgressIndicator
                  variant="large-pulsing-dot"
                  size={largeDotSize}
                  state="running"
                  style={{
                    ...BENCH_NO_DRIFT,
                    ...breathEnvelope(DEFAULT_BREATH_TURN, power),
                  }}
                />
              </GalleryCell>
            ))}
          </div>
          <TugLabel size="2xs" emphasis="calm">
            Stroke weight, on the same envelope. The pulse expands by
            `transform: scale`, which scales its border with its radius — so it
            is thinnest at ignition, where it most needs to read, and thickest
            as it fades out. `--…-pulse-weight` compensates for the first, and
            because it multiplies a stroke that is growing, it lands hardest at
            the second. Expect coarse steps: borders quantize to whole CSS px,
            so at a 32px glyph the resting ring is 2px and these four weights
            paint 2, 2, 2 and 3. The knob is continuous; the screen is not.
          </TugLabel>
          <div className="gpi-grid">
            {PULSE_WEIGHTS.map(({ weight, note }) => (
              <GalleryCell key={weight} caption={weightCaption(weight, note)}>
                <TugProgressIndicator
                  variant="large-pulsing-dot"
                  size={largeDotSize}
                  state="running"
                  style={{
                    ...BENCH_NO_DRIFT,
                    ["--tugx-progress-large-pulsing-dot-pulse-weight" as string]:
                      String(weight),
                  }}
                />
              </GalleryCell>
            ))}
          </div>
          <TugLabel size="2xs" emphasis="calm">
            The small `pulsing-dot` is already front-loaded — its ring is a
            WAAPI one-shot on `ease-out`, so it leaves the dot fast and fades
            home slowly. What it lacked was a knob;
            `--tugx-progress-pulsing-dot-pulse-easing` is read at the start of
            every pulse, so the same asymmetry is now tunable there too.
          </TugLabel>
          <div className="gpi-grid">
            {PULSE_EASINGS.map(({ easing, caption }) => (
              <GalleryCell key={caption} caption={caption}>
                <TugProgressIndicator
                  variant="pulsing-dot"
                  size={largeDotSize}
                  state="running"
                  style={{
                    ["--tugx-progress-pulsing-dot-pulse-easing" as string]:
                      easing,
                  }}
                />
              </GalleryCell>
            ))}
          </div>
        </section>

        <TugSeparator />

        {/* Roles ------------------------------------------------------- */}
        <section className="cg-section">
          <TugLabel className="cg-section-title">
            Roles — eight role tones (ring variant)
          </TugLabel>
          <div className="gpi-grid">
            {ROLES.map((r) => (
              <GalleryCell key={r} caption={r}>
                <TugProgressIndicator variant="ring" size={20} role={r} />
              </GalleryCell>
            ))}
          </div>
        </section>

        <TugSeparator />

        {/* States matrix ---------------------------------------------- */}
        <section className="cg-section">
          <TugLabel className="cg-section-title">
            States — four variants × five states
          </TugLabel>
          <div
            className="gpi-matrix"
            style={{
              gridTemplateColumns: `auto repeat(${STATES.length}, minmax(80px, 1fr))`,
            }}
          >
            {/* header row */}
            <div className="gpi-matrix-corner" />
            {STATES.map((s) => (
              <div key={s} className="gpi-matrix-col-head">
                {s}
              </div>
            ))}
            {STATE_DEMO_VARIANTS.map((variant) => (
              <React.Fragment key={variant}>
                <div className="gpi-matrix-row-head">{variant}</div>
                {STATES.map((s) => (
                  <div key={s} className="gpi-matrix-cell">
                    {/* No explicit `role` — each state's default role
                      shows through (running→action, paused→caution,
                      stopped→inherit, completed→success, aborted→danger). */}
                    <TugProgressIndicator
                      variant={variant}
                      size={20}
                      state={s}
                    />
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
        </section>

        <TugSeparator />

        {/* Determinate matrix ----------------------------------------- */}
        <section className="cg-section">
          <TugLabel className="cg-section-title">
            Determinate — three variants × five fill values
          </TugLabel>
          <div
            className="gpi-matrix"
            style={{
              gridTemplateColumns: `auto repeat(${DETERMINATE_VALUES.length}, minmax(80px, 1fr))`,
            }}
          >
            <div className="gpi-matrix-corner" />
            {DETERMINATE_VALUES.map((v) => (
              <div key={v} className="gpi-matrix-col-head">
                {Math.round(v * 100)}%
              </div>
            ))}
            {DETERMINATE_VARIANTS.map((variant) => (
              <React.Fragment key={variant}>
                <div className="gpi-matrix-row-head">{variant}</div>
                {DETERMINATE_VALUES.map((v) => (
                  <div key={v} className="gpi-matrix-cell">
                    <TugProgressIndicator
                      variant={variant}
                      size={variant === "bar" ? 6 : 22}
                      role="action"
                      value={v}
                    />
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
        </section>

        <TugSeparator />

        {/* Value readout ---------------------------------------------- */}
        <section className="cg-section">
          <TugLabel className="cg-section-title">
            Value readout — showValue (determinate)
          </TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            `showValue` renders the determinate value as a muted percentage at
            the trailing end of the row. For the bar it sits to the right of the
            flexing track; pair with `label` for the canonical labeled bar.
            Override the text via `formatValue`.
          </TugLabel>
          <div className="gpi-readout-frame">
            <TugProgressIndicator
              variant="bar"
              size={8}
              role="action"
              value={0.42}
              showValue
            />
            <TugProgressIndicator
              variant="bar"
              size={8}
              role="action"
              value={0.42}
              showValue
              label="Summarizing…"
              glyphPosition="right"
            />
            <div className="gpi-readout-glyphs">
              <TugProgressIndicator
                variant="ring"
                size={22}
                role="action"
                value={0.42}
                showValue
              />
              <TugProgressIndicator
                variant="pie"
                size={22}
                role="action"
                value={0.75}
                showValue
              />
            </div>
          </div>
        </section>

        <TugSeparator />

        {/* Phase ------------------------------------------------------- */}
        <section className="cg-section">
          <TugLabel className="cg-section-title">
            Phase — phaseLabels + phaseVisual
          </TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            The caller passes a free-form `phase` plus a `phaseLabels` map and a
            `phaseVisual` mapper; explicit `role` / `state` props override the
            mapper's return.
          </TugLabel>
          <TugChoiceGroup
            size="sm"
            value={phase}
            senderId={phaseGroupId}
            items={PHASE_ITEMS}
            aria-label="Phase picker"
          />
          <div className="gpi-demo-frame">
            <TugProgressIndicator
              variant="pulsing-dot"
              size={16}
              phase={phase}
              phaseLabels={DEMO_PHASES}
              phaseVisual={demoPhaseVisual}
            />
          </div>
        </section>

        <TugSeparator />

        {/* Layout ------------------------------------------------------ */}
        <section className="cg-section">
          <TugLabel className="cg-section-title">
            Layout — glyphPosition × labelAlign="center" width-stabilize
          </TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            The label cell sizes to the widest `phaseLabels` entry
            ("Disconnected"); the active label centers within that width — no
            layout jitter when the phase flips.
          </TugLabel>
          <TugChoiceGroup
            size="sm"
            value={glyphPosition}
            senderId={glyphPositionGroupId}
            items={GLYPH_POSITION_ITEMS}
            aria-label="Glyph position"
          />
          <TugChoiceGroup
            size="sm"
            value={phase}
            senderId={layoutPhaseGroupId}
            items={PHASE_ITEMS}
            aria-label="Phase picker"
          />
          <div className="gpi-demo-frame">
            <TugProgressIndicator
              variant="pulsing-dot"
              size={12}
              phase={phase}
              phaseLabels={DEMO_PHASES}
              phaseVisual={demoPhaseVisual}
              glyphPosition={glyphPosition}
              labelAlign="center"
            />
          </div>
        </section>
      </div>
    </ResponderScope>
  );
}
