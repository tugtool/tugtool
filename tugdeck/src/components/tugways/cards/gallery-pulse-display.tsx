/**
 * gallery-pulse-display.tsx — the PULSE's design surface.
 *
 * The PULSE is a two-level feed. INTENT is the headline: the model's reading
 * of the goal. ACTIVITY is the detail: the operation running now in service
 * of it. Both levels, both layouts, and every typographic proposal on this
 * card are rendered by the REAL {@link TugPulse} — the same component the Z2
 * strip and the Lens row mount. There is no gallery copy of the type rules,
 * so what is tuned here is what ships, and rolling a decision out is changing
 * `TUG_PULSE_DEFAULT_PRESET`.
 *
 * The open question this card is asking: the activity run has been set in
 * mono, which spends more width per character than any other face we ship on
 * the one line where width is the scarce resource. The presets audition Plex
 * Sans Condensed in its place, across a ladder of sizes, and the bake-off
 * measures them rather than asserting. A preset changes the SECOND run only —
 * the headline is Plex Sans Condensed medium 12px throughout.
 *
 * The card's other question is the Lens session row's PACKING — how one
 * rail's width is divided between the phase indicator, the session name, the
 * layout slots, and the PULSE's three parts. Those frames mount the real
 * {@link TugSessionRow} with the real indicator, slots, and tape inside it, one
 * frame per {@link TugSessionRowFit}, and the fit meter measures what each
 * proposal actually hands the two runs rather than arguing it. Rolling a fit
 * out is changing `TUG_SESSION_ROW_DEFAULT_FIT`.
 *
 * The row carries no reorder handle: a Lens row is carried by its own surface
 * (`block-reorder`), so there is no trailing column of furniture and every fit
 * below is auditioned with the row's content running out to the rail's edge.
 *
 * Fixtures are hand-authored; the sparklines are the real `TugSparkline` fed
 * a deterministic synthetic series so the frames read live without a session
 * behind them.
 *
 * @module components/tugways/cards/gallery-pulse-display
 */

import "./gallery-pulse-display.css";

import React, { useCallback, useEffect, useRef } from "react";

import {
  sparklineCurves,
  TugSparkline,
} from "@/components/tugways/tug-sparkline";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { whenFaceLoaded } from "@/lib/font-metrics";
import { TugChartGlyph } from "@/components/tugways/tug-chart-glyph";
import {
  TUG_PULSE_PRESETS,
  TugPulse,
  type TugPulsePreset,
} from "@/components/tugways/tug-pulse";
import {
  TUG_SESSION_ROW_FITS,
  TUG_SESSION_ROW_INDICATOR_SIZE,
  TUG_SESSION_ROW_SPARK_HEIGHT,
  TUG_SESSION_ROW_SPARK_WIDTH,
  TUG_SESSION_ROW_DEFAULT_FIT,
  TugSessionRow,
  type TugSessionRowFit,
} from "@/components/tugways/tug-session-row";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import { TugSlotLayout } from "@/components/tugways/tug-slot-layout";
import type { TugSlotState } from "@/components/tugways/tug-slot";
import { sessionSessionPhaseVisual } from "@/lib/code-session-store/session-phase-visual";

// ---------------------------------------------------------------------------
// Fixtures — intent in headline register: no articles, no needless words.
// ---------------------------------------------------------------------------

interface PulsePair {
  intent: string;
  activity: string;
}

const PAIRS: readonly PulsePair[] = [
  {
    intent: "Hunting ⌘L focus drift in Lens",
    activity: "Read focus-manager.ts",
  },
  {
    intent: "Wiring overview emitter cadence gate",
    activity: "cargo nextest run session_overview",
  },
  {
    intent: "Pinning slot-assign focus via app-test",
    activity: "Edit at0278-lens-cmdl-focus-stability.test.ts",
  },
  {
    intent: "Chasing flaky shell-restore test",
    activity: "just app-test at0261-shell-restore.test.ts",
  },
  {
    intent: "Mapping theme token fallbacks",
    activity: "Grep styles/themes for accent tokens",
  },
  {
    intent: "Drafting release-gesture roadmap",
    activity: "Edit roadmap/app-release-recipes.md",
  },
  {
    intent: "Tracing capture blackout root cause",
    activity: "Read tugcast/src/feeds/pulse.rs",
  },
  {
    intent: "Bundling static tmux from source",
    activity: "bash scripts/fetch-tmux.sh --verify",
  },
];

/** Overflow fixture — headline-brief intent, oversized activity. */
const LONG_PAIR: PulsePair = {
  intent: "Fixing download resume restart-from-zero",
  activity:
    "curl --range 4194304- https://huggingface.co/mlx-community/weights-00002-of-00009.safetensors",
};

/** The rewrite rule in action: flabby prose → headline register. */
const DOCTRINE: ReadonlyArray<{ before: string; after: string }> = [
  {
    before: "Investigating the Cmd-L focus drift in the Lens card",
    after: "Hunting ⌘L focus drift in Lens",
  },
  {
    before: "Working on wiring up the overview emitter's cadence gate",
    after: "Wiring overview cadence gate",
  },
  {
    before: "Trying to figure out why the download resume path restarts from zero",
    after: "Fixing download resume restart-from-zero",
  },
  {
    before: "Running the test suite for the session overview module",
    after: "Testing session overview",
  },
  {
    before: "Making some updates to the release recipes roadmap document",
    after: "Drafting release-recipe roadmap",
  },
];

/**
 * The Lens rows the fit audition sets. Each fit is shown twice: once on an
 * everyday session, once on the one that does not fit. The pair is the SAME in
 * every fit, so what differs between two frames is only how the row packs.
 */
const FIT_CALM: SessionFixture = {
  name: "tugtool/lens-xp",
  intent: PAIRS[0].intent,
  activity: PAIRS[0].activity,
  phase: "streaming",
};

const FIT_PRESSURE: SessionFixture = {
  name: "tugtool/local-model-bringup",
  intent: LONG_PAIR.intent,
  activity: LONG_PAIR.activity,
  phase: "tool_work",
};

/** One session's row content, as the Lens would supply it. */
interface SessionFixture {
  name: string;
  intent?: string;
  activity?: string;
  phase: string;
}

/** The lifecycle, as four rows: both levels live, no intent yet, intent held
 *  with nothing running, and a session before its first beat. */
const LIFECYCLE_ROWS: readonly SessionFixture[] = [
  {
    name: "tugtool/lens-xp",
    intent: PAIRS[2].intent,
    activity: PAIRS[2].activity,
    phase: "streaming",
  },
  {
    name: "tugtool/local-model-bringup",
    activity: "Grep tugdeck/src for pulse",
    phase: "tool_work",
  },
  {
    name: "tugtool/release-recipes",
    intent: PAIRS[1].intent,
    phase: "idle",
  },
  { name: "tugtool/bonsai-eval", phase: "idle" },
];

/**
 * What each fit proposes, and what it hands back — stated as the line that
 * gains the width, because that is the whole argument.
 */
const FIT_BLURB: Record<TugSessionRowFit, string> = {
  gutter:
    "The indicator holds a column of its own, so all three lines start past it; the slots ride the name and the tape rides the activity. The shape the others are measured against.",
  inset:
    "The indicator moves onto the name line. The two PULSE lines start at the row's own inset and gain the whole leading column — the widest single reclamation available, and it costs nothing but the dot's advance on one line.",
  reveal:
    "The slots carry no width until the row is engaged. At rest every line runs the full rail; on engage the slots claim their width back from the name, which is the one string the reader already knows.",
  wash: "The tape leaves the flow and paints behind the PULSE at the trailing edge. The activity keeps the width the sparkline was spending — the line that needed it most, since a path identifies itself at the end.",
  duplex:
    "Both levels share one line, read as the session card's strip reads them. Three lines become two, and the activity gets a whole line minus the intent rather than a line minus the tape.",
};

/**
 * What each preset proposes, in one line, beside the thing it proposes.
 *
 * A condensed rung sets both runs at ONE size and lets weight do the
 * separating, so each blurb names both runs and the rung is read as a single
 * decision — how big is the PULSE.
 */
const PRESET_BLURB: Record<TugPulsePreset, string> = {
  machine:
    "Condensed medium 12px › Mono regular 11px — the old setting, kept only to be measured against.",
  "condensed-sm":
    "Condensed medium 11px › Condensed regular 11px — the quiet rung.",
  condensed:
    "Condensed medium 12px › Condensed regular 12px — the shipping rung, and the app's default.",
  "condensed-lg":
    "Condensed medium 13px › Condensed regular 13px — the loud rung.",
};

/**
 * The condensed weights we ship, for the second run. The ladder above sets
 * regular; this is the column that shows what the other cuts cost in color,
 * so the weight can be chosen on sight rather than by name.
 */
const ACTIVITY_WEIGHTS: ReadonlyArray<{ weight: number; name: string }> = [
  { weight: 100, name: "thin" },
  { weight: 200, name: "extralight" },
  { weight: 300, name: "light" },
  { weight: 400, name: "regular" },
];

// Sparkline shape — the strip's own constants, so the demos read at the
// shipping weight.
const SPARK_FULL_SCALE = 1200;
const SPARK_CURVE = sparklineCurves.gamma(0.6);
const DEMO_BIN_MS = 250;

// The session row's own metrics, imported rather than restated: an audition
// whose dot or tape is a different size than the Lens's is an audition of a row
// nobody ships.
const ROW_PHASE_DOT_SIZE = TUG_SESSION_ROW_INDICATOR_SIZE;
const SPARK_ROW_WIDTH = TUG_SESSION_ROW_SPARK_WIDTH;
const SPARK_ROW_HEIGHT = TUG_SESSION_ROW_SPARK_HEIGHT;

// The slot layout as a row wears it while its card holds the second slot and is
// the one on top of it — the everyday look, so the furniture is auditioned at
// the width it actually has.
const SLOT_STATES: readonly TugSlotState[] = ["rest", "filled", "rest"];

/**
 * The real sparkline over a deterministic synthetic series — a phased
 * wave with bursts, derived from wall-clock bins so the tape scrolls
 * live. `phase` decorrelates the frames so no two demos pulse in step.
 */
function DemoSpark({
  phase,
  width = 64,
  height = 22,
}: {
  phase: number;
  width?: number;
  height?: number;
}): React.ReactElement {
  const getSeries = useCallback(
    (nowMs: number): number[] => {
      const bins = 48;
      const head = Math.floor(nowMs / DEMO_BIN_MS);
      const out: number[] = [];
      for (let i = 0; i < bins; i++) {
        const t = head - (bins - 1) + i + phase * 17;
        const wave = Math.sin(t / 5) * 0.5 + 0.5;
        const burst = Math.sin(t / 23) > 0.55 ? 1 : 0.22;
        out.push(wave * burst * 900);
      }
      return out;
    },
    [phase],
  );
  // The demo's data is synthesized from the wall clock, so its data-event
  // clock is an explicit driver ticking at the bin cadence — the gallery
  // stands in for the store here, generator and clock alike. Confined to
  // this audition card; product tapes ride the activity store's events.
  const subscribeActivity = useCallback((wake: () => void): (() => void) => {
    const timer = window.setInterval(wake, DEMO_BIN_MS);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <TugSparkline
      getSeries={getSeries}
      subscribeActivity={subscribeActivity}
      binMs={DEMO_BIN_MS}
      fullScale={SPARK_FULL_SCALE}
      curve={SPARK_CURVE}
      width={width}
      height={height}
      title="Synthetic activity (demo)"
    />
  );
}

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="gpd-section">
      <h3 className="gpd-section-title">{title}</h3>
      {blurb !== undefined ? <p className="gpd-blurb">{blurb}</p> : null}
      {children}
    </section>
  );
}

/** The strip's legend pill, as a plain label — the shipping one is a popover
 *  trigger, and its behavior is the strip's business, not the type's. */
function Legend(): React.ReactElement {
  return <span className="gpd-legend">PULSE</span>;
}

/** One demo band on the strip's own surface, carrying a real `TugPulse`. */
function Band({
  preset,
  pair,
  phase,
  legendAlign,
  truncate,
  activityWeight,
  rules,
  tight,
}: {
  preset?: TugPulsePreset;
  pair: Partial<PulsePair>;
  phase: number;
  legendAlign?: "cap-center" | "baseline";
  truncate?: "middle" | "end";
  /** Override the activity's weight — the knob, set at the mount site. */
  activityWeight?: number;
  /** Draw the declared baseline and the headline's visual middle. */
  rules?: boolean;
  /** Narrow the band so the activity has to give way. */
  tight?: boolean;
}): React.ReactElement {
  return (
    <div
      className={[
        "gpd-band",
        rules === true ? "gpd-band-ruled" : "",
        tight === true ? "gpd-band-tight" : "",
      ]
        .filter((c) => c.length > 0)
        .join(" ")}
    >
      <TugPulse
        preset={preset}
        legendAlign={legendAlign}
        truncate={truncate}
        style={
          activityWeight !== undefined
            ? ({
                "--tugx-pulse-activity-weight": activityWeight,
              } as React.CSSProperties)
            : undefined
        }
        legend={<Legend />}
        headline={pair.intent}
        activity={pair.activity}
        trailing={<DemoSpark phase={phase} />}
      />
    </div>
  );
}

/**
 * A Lens session row — the REAL {@link TugSessionRow}, with every part it
 * carries supplied by the real component the Lens supplies: the phase
 * indicator, the slot layout, and a sparkline. Only the strings and the series
 * are fixtures. So a fit judged here is a fit that ships; there is no gallery
 * drawing of a row.
 *
 * The frame is the Lens rail at its usual width, and it declares the row knobs
 * `lens-sessions-list` declares — the reading inset, the zeroed indicator
 * gutter, and the rail's trailing edge — so widths read here are widths the
 * Lens has.
 */
function SessionFrame({
  fit,
  fixture,
  phase,
  measure,
}: {
  fit: TugSessionRowFit;
  fixture: SessionFixture;
  phase: number;
  /** Marks this row as the one the fit meter reads. */
  measure?: boolean;
}): React.ReactElement {
  return (
    <div className="gpd-rail">
      <TugSessionRow
        fit={fit}
        data-gpd-fit-measure={measure === true ? fit : undefined}
        indicator={
          <TugProgressIndicator
            variant="pulsing-dot"
            size={ROW_PHASE_DOT_SIZE}
            phase={fixture.phase}
            phaseVisual={sessionSessionPhaseVisual}
            aria-hidden
          />
        }
        name={fixture.name}
        slots={<TugSlotLayout count={3} states={SLOT_STATES} size="sm" />}
        intent={fixture.intent}
        activity={fixture.activity}
        sparkline={
          <DemoSpark
            phase={phase}
            width={SPARK_ROW_WIDTH}
            height={SPARK_ROW_HEIGHT}
          />
        }
      />
    </div>
  );
}

/**
 * The fit meter — what each fit actually hands the two runs that have
 * something to lose.
 *
 * Packing is an argument about pixels, so it is measured rather than claimed:
 * the numbers come from the audition rows above, not from a second rendering,
 * so the table always describes exactly what is on screen. For each fit it
 * reports the width the ACTIVITY run was given and the width the NAME was
 * given, against the shipping `gutter` fit, plus whether the activity still
 * had to be cut at that width.
 *
 * Measurement writes straight to the DOM ([L06]): a readout derived from
 * layout, routed through React state, would re-render the rows being measured.
 */
function FitMeter(): React.ReactElement {
  const outRefs = useRef(new Map<TugSessionRowFit, HTMLSpanElement>());

  useEffect(() => {
    let live = true;
    const read = (
      fit: TugSessionRowFit,
    ): { activity: number; name: number; cut: boolean } | null => {
      const row = document.querySelector<HTMLElement>(
        `[data-gpd-fit-measure="${fit}"]`,
      );
      if (row === null) return null;
      const run = row.querySelector<HTMLElement>(
        '[data-slot="tug-pulse-activity"]',
      );
      const name = row.querySelector<HTMLElement>(".tug-list-row-title");
      if (run === null || name === null) return null;
      return {
        activity: run.clientWidth,
        name: name.clientWidth,
        cut: run.dataset.truncated === "true",
      };
    };
    const measure = (): void => {
      if (!live) return;
      const base = read("gutter");
      if (base === null || base.activity === 0) return;
      for (const [fit, out] of outRefs.current) {
        const now = read(fit);
        if (now === null) continue;
        const delta = Math.round(now.activity - base.activity);
        out.textContent =
          `activity ${Math.round(now.activity)}px` +
          (fit === "gutter"
            ? " — the baseline"
            : ` — ${delta >= 0 ? "+" : ""}${delta}px`) +
          ` · name ${Math.round(now.name)}px` +
          (now.cut ? " · still cut" : " · fits");
      }
    };
    // Nothing is measured until the rows' own faces have loaded — an unloaded
    // face measures as its fallback — and not until the PULSE has had its own
    // pass at the truncation it reports here, which is a frame behind the load.
    const row = document.querySelector<HTMLElement>("[data-gpd-fit-measure]");
    void whenFaceLoaded(row ?? document.body, row?.textContent ?? "").then(
      () => {
        requestAnimationFrame(() => {
          requestAnimationFrame(measure);
        });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="gpd-meter">
      {TUG_SESSION_ROW_FITS.map((fit) => (
        <div className="gpd-fit-row" key={fit}>
          <span className="gpd-preset-name">{fit}</span>
          <span
            className="gpd-fit-readout"
            ref={(el) => {
              if (el !== null) outRefs.current.set(fit, el);
            }}
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The density bake-off — measured, not asserted
// ---------------------------------------------------------------------------

/**
 * Sets the SAME machine string in every preset and measures the natural
 * width each one takes, reporting it against the mono baseline. The measure
 * runs after `document.fonts.ready`, because a face that has not loaded
 * measures as its fallback and would report a confident wrong number.
 *
 * Measurement writes straight to the DOM ([L06]): the readout is appearance
 * derived from layout, and routing it through React state would re-render
 * the very rows being measured.
 */
interface Specimen {
  /** Row label, and the measurement key. */
  key: string;
  preset: TugPulsePreset;
  /** Activity weight override, when the row is auditioning a cut. */
  weight?: number;
}

function DensityMeter({
  sample,
  specimens,
  baselineKey,
}: {
  sample: string;
  specimens: readonly Specimen[];
  /** The row every other row is reported against. */
  baselineKey: string;
}): React.ReactElement {
  const rowRefs = useRef(new Map<string, HTMLSpanElement>());
  const outRefs = useRef(new Map<string, HTMLSpanElement>());

  useEffect(() => {
    let live = true;
    const measure = (): void => {
      if (!live) return;
      const widths = new Map<string, number>();
      for (const [key, el] of rowRefs.current) {
        widths.set(key, el.getBoundingClientRect().width);
      }
      const base = widths.get(baselineKey);
      if (base === undefined || base === 0) return;
      for (const [key, width] of widths) {
        const out = outRefs.current.get(key);
        if (out === undefined) continue;
        const saved = Math.round((1 - width / base) * 100);
        out.textContent =
          key === baselineKey
            ? `${Math.round(width)}px — the baseline`
            : `${Math.round(width)}px — ${
                saved > 0 ? `${saved}% narrower` : `${-saved}% wider`
              }`;
      }
    };
    // Every specimen's OWN face, requested and awaited. `document.fonts.ready`
    // was the bug here: it resolved before any condensed face had been asked
    // for, so every condensed row reported the width of the Plex Sans fallback
    // — a uniform ~11% too wide, which read as a plausible-looking table and
    // was wrong in every cell.
    void Promise.all(
      [...rowRefs.current.values()].map((el) =>
        whenFaceLoaded(el, el.textContent ?? ""),
      ),
    ).then(measure);
    return () => {
      live = false;
    };
  }, [sample, baselineKey]);

  return (
    <div className="gpd-meter">
      {specimens.map(({ key, preset, weight }) => (
        <div className="gpd-meter-row" key={key}>
          <span className="gpd-preset-name">{key}</span>
          {/* Measured, so it must not be shortened: middle truncation would
              have this row reporting the width of a string it just cut down
              rather than the width the type actually asks for. */}
          <TugPulse
            className="gpd-meter-specimen"
            preset={preset}
            truncate="end"
            style={
              weight !== undefined
                ? ({
                    "--tugx-pulse-activity-weight": weight,
                  } as React.CSSProperties)
                : undefined
            }
            activity={
              <span
                ref={(el) => {
                  if (el !== null) rowRefs.current.set(key, el);
                }}
              >
                {sample}
              </span>
            }
          />
          <span
            className="gpd-meter-readout"
            ref={(el) => {
              if (el !== null) outRefs.current.set(key, el);
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** The size ladder, all in regular — the axis the presets encode. */
const SIZE_SPECIMENS: readonly Specimen[] = TUG_PULSE_PRESETS.map((preset) => ({
  key: preset,
  preset,
}));

/** The weight axis at one size, measured through the same rig so the two
 *  tables can be read against each other. */
const WEIGHT_SPECIMENS: readonly Specimen[] = [
  { key: "machine", preset: "machine" },
  ...ACTIVITY_WEIGHTS.map(({ weight, name }) => ({
    key: name,
    preset: "condensed-sm" as TugPulsePreset,
    weight,
  })),
];

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export function GalleryPulseDisplay(): React.ReactElement {
  return (
    <div className="gpd-root" data-slot="gallery-pulse-display">
      <p className="gpd-blurb">
        The PULSE as a two-level feed: <strong>INTENT</strong> — the headline —
        over <strong>ACTIVITY</strong> — the operation running now. Every frame
        below is the real <code>TugPulse</code>, the same component the Z2 strip
        and the Lens row mount; the type rules live in <code>tug-pulse.css</code>{" "}
        and nowhere else, so tuning here is tuning what ships.
      </p>

      <TugSeparator />

      <Section
        title="Headline register — the copy doctrine"
        blurb="The intent is a newspaper headline. Drop definite and indefinite articles, cut filler verbs, omit needless words. The rewrite rule, applied:"
      >
        <div className="gpd-doctrine">
          {DOCTRINE.map((d) => (
            <div className="gpd-doctrine-row" key={d.after}>
              <span className="gpd-doctrine-before">{d.before}</span>
              <span className="gpd-doctrine-arrow" aria-hidden="true">
                →
              </span>
              <span className="gpd-doctrine-after">{d.after}</span>
            </div>
          ))}
        </div>
      </Section>

      <TugSeparator />

      <Section
        title="Density — the same string, measured in each proposal"
        blurb="Set width is the whole argument, so it is measured rather than claimed: one real machine string, set in every preset, reported against the mono baseline. Measured after the faces load."
      >
        <DensityMeter
          sample={LONG_PAIR.activity}
          specimens={SIZE_SPECIMENS}
          baselineKey="machine"
        />
      </Section>

      <TugSeparator />

      <Section
        title="Session card — the presets on the strip"
        blurb="Today's band geometry. The intent leads bright and layout-pinned; the activity trails past the › and is the run that gives way. A condensed rung sets BOTH runs at one size — 11, 12, or 13px — and separates them by weight and tone alone. The bar height, the baseline, and the legend hold across every rung."
      >
        {TUG_PULSE_PRESETS.map((preset, i) => (
          <div className="gpd-preset" key={preset}>
            <span className="gpd-preset-label">
              <span className="gpd-preset-name">{preset}</span>
              <span className="gpd-preset-blurb">{PRESET_BLURB[preset]}</span>
            </span>
            <Band preset={preset} pair={PAIRS[i]} phase={i + 1} />
          </div>
        ))}
      </Section>

      <TugSeparator />

      <Section
        title="Weight — the second run's cut, at one size"
        blurb={
          <>
            The ladder above sets the activity in Condensed{" "}
            <strong>regular</strong>. This is what the lighter cuts cost, all at
            11px under an 11px headline, so the weight is chosen on sight.
            Weight is doing the whole job of separating the two runs now that
            they share a face and a size — which is why the medium/regular pair
            has to carry, and does.
          </>
        }
      >
        <DensityMeter
          sample={LONG_PAIR.activity}
          specimens={WEIGHT_SPECIMENS}
          baselineKey="machine"
        />
        {ACTIVITY_WEIGHTS.map(({ weight, name }, i) => (
          <div className="gpd-preset" key={weight}>
            <span className="gpd-preset-label">
              <span className="gpd-preset-name">{name}</span>
              <span className="gpd-preset-blurb">
                {`Condensed medium 11px › Condensed ${name} 11px`}
              </span>
            </span>
            <Band
              preset="condensed-sm"
              activityWeight={weight}
              pair={PAIRS[i]}
              phase={i + 60}
            />
          </div>
        ))}
      </Section>

      <TugSeparator />

      <Section
        title="Overflow — the presets under pressure"
        blurb="One overlong activity, one width. The headline never truncates; where each preset's ellipsis falls is how much of the operation the reader actually gets."
      >
        {TUG_PULSE_PRESETS.map((preset, i) => (
          <div className="gpd-preset" key={preset}>
            <span className="gpd-preset-name">{preset}</span>
            <Band preset={preset} pair={LONG_PAIR} phase={i + 30} />
          </div>
        ))}
      </Section>

      <TugSeparator />

      <Section
        title="Lens — how the session row packs"
        blurb={
          <>
            A session row carries <strong>five</strong> things and has one
            rail&apos;s width to spend on them: the phase indicator, the
            session&apos;s name, the layout slots, and the PULSE&apos;s three
            parts — intent, activity, and the tape. Three of those are text that
            would rather not be cut; the rest is fixed-width furniture that
            takes its width off the top before the text gets any. There is no
            sixth: the reorder handle that used to hold a trailing column is
            gone, because the row is carried by its own surface, and the content
            runs out to the rail&apos;s edge in its place. Each fit below is one
            proposal about where the remaining furniture goes, rendered by the
            real <code>TugSessionRow</code> with the real indicator, slots, and
            tape in it — so the fit approved here is the fit the Lens wears, by
            construction. Every fit shows the same two sessions: an everyday
            one, then the one that does not fit.
          </>
        }
      >
        <div className="gpd-fit-audition">
          {TUG_SESSION_ROW_FITS.map((fit, i) => (
            <div className="gpd-fit" key={fit}>
              <span className="gpd-preset-label">
                <span className="gpd-preset-name">{fit}</span>
                <span className="gpd-preset-blurb">{FIT_BLURB[fit]}</span>
              </span>
              <div className="gpd-lens-stack">
                <SessionFrame fit={fit} fixture={FIT_CALM} phase={i + 10} />
                <SessionFrame
                  fit={fit}
                  fixture={FIT_PRESSURE}
                  phase={i + 70}
                  measure
                />
              </div>
            </div>
          ))}
        </div>

        <p className="gpd-blurb">
          What each fit actually handed the two runs that have something to
          lose, measured off the pressure rows above rather than claimed:
        </p>
        <FitMeter />
      </Section>

      <TugSeparator />

      <Section
        title="The legend against the line"
        blurb={
          <>
            The general rule for a label sharing a line with text is the
            baseline. The PULSE is an exception to it: <code>PULSE</code> is an
            all-caps word beside a mixed-case headline nearly half again its
            size, and on the shared baseline its cap band hangs low — it reads
            as sitting <em>under</em> the line rather than on it. What the eye
            wants matched is the two glyph bands&apos; VISUAL CENTERS. The blue
            hairline is the declared baseline; the amber one is the headline&apos;s
            visual middle.
          </>
        }
      >
        <div className="gpd-state">
          <span className="gpd-state-label">
            cap-center — the label&apos;s middle on the headline&apos;s middle (the
            PULSE&apos;s rule, and the default)
          </span>
          <Band pair={PAIRS[4]} phase={40} legendAlign="cap-center" rules />
        </div>
        <div className="gpd-state">
          <span className="gpd-state-label">
            baseline — the general rule, shown so the exception can be seen as
            one
          </span>
          <Band pair={PAIRS[4]} phase={41} legendAlign="baseline" rules />
        </div>
      </Section>

      <TugSeparator />

      <Section
        title="Truncation — where the activity gives way"
        blurb={
          <>
            An activity is a command or a path, and both carry the part that
            identifies them at the END — the file being read, the test being
            run, the weights being fetched. An end ellipsis throws exactly that
            away and leaves a row of <code>https://huggingf…</code> that says
            nothing the next row does not also say. Cutting the middle keeps
            both: what is running, and what it is running on. The full string
            stays in the DOM either way, so a copy and a screen reader still get
            all of it.
          </>
        }
      >
        {[
          { label: "end — the CSS ellipsis", mode: "end" as const },
          { label: "middle — both ends survive (the default)", mode: "middle" as const },
        ].map(({ label, mode }) => (
          <div className="gpd-state" key={mode}>
            <span className="gpd-state-label">{label}</span>
            <Band pair={LONG_PAIR} phase={50} truncate={mode} tight />
            <Band
              pair={{ activity: PAIRS[2].activity }}
              phase={51}
              truncate={mode}
              tight
            />
          </div>
        ))}
      </Section>

      <TugSeparator />

      <Section
        title="States — the lifecycle in both layouts"
        blurb={
          <>
            <strong>Neither level is ever absent.</strong> A level with nothing
            to say holds its space and says so: the headline stands in with{" "}
            <code>PULSE</code>, the activity with <code>None</code>. So a
            stacked PULSE is always exactly two baseline steps tall, and a Lens
            row never changes height as its session comes and goes quiet.
            Inline, the legend is already saying <code>PULSE</code> beside the
            run, so the run stays empty rather than printing the word twice —
            the bar is a fixed height either way. Every stand-in is set exactly
            like the level it stands in for; there is no placeholder voice.
          </>
        }
      >
        <div className="gpd-state">
          <span className="gpd-state-label">Both levels live</span>
          <Band pair={PAIRS[2]} phase={20} />
        </div>
        <div className="gpd-state">
          <span className="gpd-state-label">
            No intent yet — turn just started, first overview pending
          </span>
          <Band pair={{ activity: "Grep tugdeck/src for pulse" }} phase={21} />
        </div>
        <div className="gpd-state">
          <span className="gpd-state-label">
            Intent held, activity idle — between operations
          </span>
          <Band pair={{ intent: PAIRS[1].intent }} phase={22} />
        </div>
        <div className="gpd-state">
          <span className="gpd-state-label">
            Before the session&apos;s first beat
          </span>
          <Band pair={{ intent: PAIRS[3].intent, activity: "None" }} phase={23} />
        </div>
        <div className="gpd-state">
          <span className="gpd-state-label">Turn done</span>
          <Band pair={{ intent: PAIRS[3].intent, activity: "Done" }} phase={24} />
        </div>
        <div className="gpd-state">
          <span className="gpd-state-label">
            Lens: the same row height whatever the session is doing — shown in
            the shipping fit
          </span>
          <div className="gpd-lens-stack">
            {LIFECYCLE_ROWS.map((fixture, i) => (
              <SessionFrame
                key={fixture.name}
                fit={TUG_SESSION_ROW_DEFAULT_FIT}
                fixture={fixture}
                phase={i + 25}
              />
            ))}
          </div>
        </div>
      </Section>

      <TugSeparator />

      <Section
        title="Datatype — a chart as a glyph"
        blurb={
          <>
            Datatype&apos;s ligatures substitute a literal expression with a
            drawn mark: <code>{"{p:75}"}</code> is a pie, <code>{"{b:…}"}</code>{" "}
            a bar row, <code>{"{l:…}"}</code> a static sparkline. A mark costs
            what a word costs, so it fits where a chart cannot — but it cannot
            animate, which is why the activity tape stays{" "}
            <code>TugSparkline</code> and this is for quantities that stand
            still.
          </>
        }
      >
        <div className="gpd-chart-row">
          {[0, 12, 25, 40, 50, 66, 75, 88, 100].map((v) => (
            <span className="gpd-chart-cell" key={v}>
              <TugChartGlyph kind="pie" values={[v]} label={`${v} percent`} />
              <span className="gpd-chart-caption">{v}%</span>
            </span>
          ))}
        </div>

        <p className="gpd-blurb">
          The proposal: a work item&apos;s completion, inline in its own row —
          the quantity sits with the words instead of in a column beside them.
        </p>
        <div className="gpd-worklist">
          {[
            { name: "Pulse componentization", done: 5, total: 6 },
            { name: "Proportional activity run", done: 3, total: 4 },
            { name: "Condensed weights vendored", done: 2, total: 2 },
            { name: "Lens rollout", done: 1, total: 5 },
          ].map((w) => {
            const pct = Math.round((w.done / w.total) * 100);
            return (
              <div className="gpd-work-row" key={w.name}>
                <TugChartGlyph
                  kind="pie"
                  values={[pct]}
                  label={`${w.done} of ${w.total} done`}
                />
                <span className="gpd-work-name">{w.name}</span>
                <span className="gpd-work-count">
                  {w.done}/{w.total}
                </span>
              </div>
            );
          })}
        </div>

        <p className="gpd-blurb">
          The other two marks, for reference. The bar row reads a distribution;
          the line is a frozen series — a shape to compare against, not a live
          one.
        </p>
        <div className="gpd-chart-row">
          <span className="gpd-chart-cell">
            <TugChartGlyph
              kind="bar"
              values={[15, 45, 80, 30, 60, 90, 20]}
              label="Bar chart of seven values"
            />
            <span className="gpd-chart-caption">bar</span>
          </span>
          <span className="gpd-chart-cell">
            <TugChartGlyph
              kind="line"
              values={[20, 45, 60, 55, 80, 95, 70, 88]}
              label="Sparkline of eight values"
            />
            <span className="gpd-chart-caption">line</span>
          </span>
        </div>
      </Section>
    </div>
  );
}
