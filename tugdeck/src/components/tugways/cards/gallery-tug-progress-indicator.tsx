/**
 * gallery-tug-progress-indicator.tsx — TugProgressIndicator showcase.
 *
 * Replaces three earlier galleries (gallery-progress, gallery-tug-
 * state-indicator, gallery-tug-thinking-indicator) — the unified
 * indicator subsumes all three predecessors.
 *
 * Layout:
 *  - Variants  — six glyphs in a wrapping card grid
 *  - pulsing-dot — the workshop bench for the breathing dot: size
 *                picker, all five states, and a Lens-row preview
 *  - Size      — the ladder, every size the app actually asks for, 10 → 32.
 *                This is the open bench: the glyph was designed at 32 and now
 *                has to hold at 10.
 *  - Crossing  — the same ladder under a live state picker. State changes are
 *                the one thing a still frame cannot show, and the one place
 *                this glyph used to tear.
 *  - Timing    — two benches left on the pulse: cuts of the breath envelope
 *                (symmetric through severe) and the pulse's stroke weight.
 *                The fade-falloff and ring-easing benches are retired — see
 *                the note there for what they settled.
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
  sizeGeometry,
  DEFAULT_BREATH_TURN,
  DEFAULT_PULSE_WEIGHT,
} from "@/components/tugways/internal/tug-progress-pulsing-dot";
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
 * Sizes for the workshop picker, spanning the glyph's whole working range —
 * from the 10px it is asked for inside a status cell up past the Z5 submit
 * button's 36px square, which is the legibility bar the big end aims at.
 */
const DOT_SIZES = [10, 12, 14, 16, 20, 24, 28, 32, 36, 40] as const;
const DOT_SIZE_ITEMS = DOT_SIZES.map((s) => ({
  value: String(s),
  label: String(s),
}));

/**
 * The size ladder — every size the app actually asks this glyph for, with the
 * surface that asks for it.
 *
 * This is the bench that matters now. The breathing dot was designed at 32px
 * and judged there; making it the only dot means it also has to serve a status
 * cell at 10. It does that by being two treatments rather than one figure
 * scaled: a big one for the Lens, where there are enough pixels for relative
 * size to encode state, and a small one that is the previous glyph's geometry
 * exactly — same dot ratio, same full-box ring, same hairline — carrying the
 * new motion and nothing else.
 *
 * Note where the band sits. Every size the app really asks for is 16 and under
 * or 28 and over, so nothing ships as a blend; the two middle cells are here to
 * show that the crossing is a ramp and not a cliff.
 */
const LADDER: ReadonlyArray<{ size: number; where: string }> = [
  { size: 10, where: "WORK cell" },
  { size: 12, where: "Z2 status · jobs · goals" },
  { size: 14, where: "tool header · setup · todo" },
  { size: 16, where: "indicator default" },
  { size: 20, where: "—" },
  { size: 24, where: "—" },
  { size: 28, where: "Lens session row" },
  { size: 32, where: "authored size" },
];

/** "12px · Z2 status · small". Which treatment this rung is getting. */
function ladderCaption(size: number, where: string): string {
  const { ratio } = sizeGeometry(size);
  // Recovered from the ratio rather than re-derived, so the caption cannot
  // disagree with what the glyph beside it is actually doing.
  const small = Math.round(((0.6 - ratio) / 0.1) * 100);
  const treatment =
    small === 100 ? "small" : small === 0 ? "big" : `${small}% small`;
  return `${size}px · ${where} · ${treatment}`;
}

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

/** "×1.6 — shipped". */
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

const CROSSING_ITEMS = STATES.map((s) => ({ value: s, label: s }));

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
  const [crossingState, setCrossingState] =
    useState<TugProgressIndicatorState>("running");

  const phaseGroupId = useId();
  const layoutPhaseGroupId = useId();
  const glyphPositionGroupId = useId();
  const largeDotSizeGroupId = useId();
  const crossingGroupId = useId();

  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: {
      [phaseGroupId]: setPhase,
      [layoutPhaseGroupId]: setPhase,
      [glyphPositionGroupId]: (v: string) =>
        setGlyphPosition(v as "left" | "right" | "both"),
      [largeDotSizeGroupId]: (v: string) => setLargeDotSize(Number(v)),
      [crossingGroupId]: (v: string) =>
        setCrossingState(v as TugProgressIndicatorState),
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
            pulsing-dot — breathing dot, ring on the fall
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
            items={DOT_SIZE_ITEMS}
            aria-label="Large dot size"
          />
          <div className="gpi-grid">
            {STATES.map((s) => (
              <GalleryCell key={s} caption={s}>
                <TugProgressIndicator
                  variant="pulsing-dot"
                  size={largeDotSize}
                  state={s}
                />
              </GalleryCell>
            ))}
          </div>
          <TugLabel size="2xs" emphasis="calm">
            The scale reference is the real Z5 submit button (36px square),
            shown here beside the glyph. Below it, the destination: the leading
            slot of a Lens Sessions row, over the row's own two-line type.
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
                variant="pulsing-dot"
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
          </div>
        </section>

        <TugSeparator />

        {/* Size ladder ------------------------------------------------- */}
        <section className="cg-section">
          <TugLabel className="cg-section-title">
            Size — the ladder, 10px through 32px
          </TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            Every size the app asks this glyph for, with the surface that asks.
            One variant now, so this row has to carry a 10px status cell and a
            28px Lens row — and the honest answer is that it does it as two
            treatments, not one figure scaled. What they share is the whole
            point of the unification: the same breath, the same ring shed at the
            turn, the same 30/70 asymmetry.
          </TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            **The small treatment is the previous glyph's geometry, exactly.**
            Same 0.5 dot ratio, same full-box static ring, same hairline stroke,
            no presence ladder — so a settled dot in a Z2 cell or a tool-call
            header paints the pixels it painted before, to the fraction. It
            picks up the new motion and nothing else. Making a status marker
            bigger or smaller was never what this was for.
          </TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            **The big treatment is the Lens figure**, and it is where the extra
            size buys something: a 0.6 dot ratio, a ring held inside the box so
            the glyph is layout-safe, and the PRESENCE ladder that makes a
            column of sessions readable by size alone. Two numbers still have to
            move on the way down — the ring's reach, since 2.5px of radius reads
            as a twitch rather than a pulse, so below 28px it is let out past
            the box to 1.75× (the old glyph ran to 1.9×); and the breath's
            depth, which narrows to a 0.7 trough. A deep swing is a luxury of
            diameter — 0.35 of a 19px dot still reads as a dot, 0.35 of a 6px
            one reads as a dot going out, and the small glyph is the only mark
            in a row of type. It cannot afford to half-disappear every cycle,
            and it does not need to: the shed ring is carrying the motion.
          </TugLabel>
          <div className="gpi-grid">
            {LADDER.map(({ size, where }) => (
              <GalleryCell key={size} caption={ladderCaption(size, where)}>
                <TugProgressIndicator
                  variant="pulsing-dot"
                  size={size}
                  state="running"
                />
              </GalleryCell>
            ))}
          </div>
          <TugLabel size="2xs" emphasis="calm">
            The same ladder settled — the state most of these sizes spend most
            of their life in, and the row where the parity claim is checkable.
            Every cell at 16px and under is the previous glyph's `completed`
            pose to the pixel: a full-box 1px ring around a dot at 0.85 of half
            the box. From 28px the PRESENCE ladder takes over and the figure
            draws in, which is the Lens behavior and is meant to look different
            here.
          </TugLabel>
          <div className="gpi-grid">
            {LADDER.map(({ size }) => (
              <GalleryCell key={size} caption={`${size}px · completed`}>
                <TugProgressIndicator
                  variant="pulsing-dot"
                  size={size}
                  state="completed"
                />
              </GalleryCell>
            ))}
          </div>
        </section>

        <TugSeparator />

        {/* Crossing ---------------------------------------------------- */}
        <section className="cg-section" data-bench="crossing">
          <TugLabel className="cg-section-title">
            Crossing — every state change is a transition, never a cut
          </TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            Drive the whole ladder at once. A real state change lands on a frame
            nobody chose — a tool call finishes mid-breath, with a ring halfway
            through its travel — and the glyph has to arrive at its new pose
            without tearing. Watch the same crossing at both treatments: the
            small cells are the tool-call header and the Z2 status cell, the
            28px and 32px cells are the Lens row.
          </TugLabel>
          <TugChoiceGroup
            size="sm"
            value={crossingState}
            senderId={crossingGroupId}
            items={CROSSING_ITEMS}
            aria-label="Crossing state"
          />
          <TugLabel size="2xs" emphasis="calm">
            **A lit pulse always finishes.** The ring was shed — it left the dot
            and is travelling outward under its own momentum, and the work
            ending is no business of its. So the emitter is released on the
            pulse's clock rather than the state's, which is why the motion is
            gated on `data-emitting` and not on `data-state`. Change the state
            while a ring is in flight and it flies out and fades as though
            nothing had happened. A ring that was never lit — the change landed
            during the inhale — is simply never lit.
          </TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            **The dot is caught where it stands.** Its live scale is pinned, the
            loop is dropped against that pin so the removal changes nothing, and
            a transition carries it from there to the settled pose — so the
            settle starts from the pose that was on screen, not from the
            keyframe's base. Going back the other way is the same idea inverted:
            the breath starts at the phase whose pose the dot already holds, as
            a negative `animation-delay`, and picks it up mid-stride. Neither
            direction has a frame you could call the jump.
          </TugLabel>
          <div className="gpi-grid">
            {LADDER.map(({ size, where }) => (
              <GalleryCell
                key={size}
                caption={`${size}px · ${where === "—" ? crossingState : where}`}
              >
                <TugProgressIndicator
                  variant="pulsing-dot"
                  size={size}
                  state={crossingState}
                />
              </GalleryCell>
            ))}
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
            (`breathEnvelope`) that produced the shipped defaults. Nothing here
            needs to pin the period: dots run the nominal 2s unless a caller
            opts into the jitter, and the only caller that does is the Lens.
          </TugLabel>
          <div className="gpi-grid">
            {BREATH_TURNS.map(({ turn, note }) => (
              <GalleryCell key={turn} caption={turnCaption(turn, note)}>
                <TugProgressIndicator
                  variant="pulsing-dot"
                  size={largeDotSize}
                  state="running"
                  style={breathEnvelope(turn)}
                />
              </GalleryCell>
            ))}
          </div>
          <TugLabel size="2xs" emphasis="calm">
            **Retired: the ring's opacity falloff.** Four exponents were benched
            here, from an even fall to a near-flash. The bench answered a
            different question than it asked — the shape of the ring's exit was
            never the lever, its birth was. At partial strength the ring looked
            like it was already fading before it existed, and no exit curve
            fixes that. With the birth corrected to near-solid, the even fall
            (`breathEnvelope`'s default power of 1) is the one that reads as a
            ring travelling outward and thinning; every step up only shortened
            its visible life. Shipped even, bench removed.
          </TugLabel>
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
                  variant="pulsing-dot"
                  size={largeDotSize}
                  state="running"
                  style={{
                    ["--tugx-progress-pulsing-dot-pulse-weight" as string]:
                      String(weight),
                  }}
                />
              </GalleryCell>
            ))}
          </div>
          <TugLabel size="2xs" emphasis="calm">
            **Retired: the old dot's ring easing.** A two-cell bench used to sit
            here comparing `ease-out` against an expo-out on the WAAPI one-shot
            that the previous `pulsing-dot` chained around a fixed circle. There
            is no such glyph any more — the breathing dot took the name and the
            call sites — so the bench went with it.
          </TugLabel>
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
            States — three variants × five states
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
