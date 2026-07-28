/**
 * gallery-pulse-display.tsx — design spike for the PULSE's two-level
 * grammar: **intent** over **activity**.
 *
 * The PULSE is a two-level feed. INTENT is the headline: the model's
 * reading of the goal and what is going on now, at a high level.
 * ACTIVITY is the detail: the tool call / operation / command running at
 * this moment in service of that intent.
 *
 * Chosen directions (locked):
 *   - The intent is written in HEADLINE REGISTER — newspaper rules. No
 *     definite or indefinite articles, no needless words, punchy and
 *     pithy. The copy doctrine zone shows the rewrite rule in action.
 *   - Session card: **S1** — one line, headline first. The intent leads
 *     bright and layout-pinned, `›` separates, the activity trails in
 *     muted small mono and is the part that ellipsizes.
 *   - Lens: **L1** — stacked. Intent on its own line under the session
 *     name, activity + sparkline on a third; each level keeps a clean
 *     single-line run.
 *
 * S1 and L1 both shipped, so this card is no longer a proposal — it is the
 * doctrine reference for the copy register, and the zone below is where the
 * rewrite rule stays legible. The shipping surfaces are
 * `session-pulse-strip.tsx` (S1) and `sessions-section.tsx` (L1); on the
 * strip the headline is fed by the local model's session overview, and the
 * reference zone keeps the pre-S1 baseline visible for comparison.
 *
 * Pure presentation on hand-authored fixtures — no stores, no wire. The
 * sparklines are the real `TugSparkline` fed a deterministic synthetic
 * series so the frames read live without a session behind them.
 *
 * @module components/tugways/cards/gallery-pulse-display
 */

import "./gallery-pulse-display.css";

import React, { useCallback } from "react";

import {
  sparklineCurves,
  TugSparkline,
} from "@/components/tugways/tug-sparkline";
import { TugSeparator } from "@/components/tugways/tug-separator";

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

const LENS_SESSIONS: ReadonlyArray<{ name: string; pair: PulsePair }> = [
  { name: "tugtool/local-model-bringup", pair: PAIRS[1] },
  { name: "tugtool/lens-xp", pair: PAIRS[0] },
  { name: "tugtool/release-recipes", pair: PAIRS[5] },
  { name: "tugtool/bonsai-eval", pair: PAIRS[7] },
];

// Sparkline shape — the strip's own constants, so the demos read at the
// shipping weight.
const SPARK_FULL_SCALE = 1200;
const SPARK_CURVE = sparklineCurves.gamma(0.6);
const DEMO_BIN_MS = 250;

/**
 * The real sparkline over a deterministic synthetic series — a phased
 * wave with bursts, derived from wall-clock bins so the tape scrolls
 * live. `phase` decorrelates the frames so no two demos pulse in step.
 */
function DemoSpark({
  phase,
  width = 64,
  height = 22,
  className,
}: {
  phase: number;
  width?: number;
  height?: number;
  className?: string;
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
  return (
    <TugSparkline
      getSeries={getSeries}
      binMs={DEMO_BIN_MS}
      fullScale={SPARK_FULL_SCALE}
      curve={SPARK_CURVE}
      width={width}
      height={height}
      className={className}
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

// ---------------------------------------------------------------------------
// S1 — the session-card band: one line, headline first.
// ---------------------------------------------------------------------------

/** The chosen strip grammar: intent bright and layout-pinned, `›`, then
 *  activity in muted mono — the activity is the part that ellipsizes.
 *  Either level may be absent; the line simply drops that run. */
function StripLine({
  pair,
  phase,
  placeholder,
}: {
  pair: Partial<PulsePair>;
  phase: number;
  placeholder?: boolean;
}): React.ReactElement {
  return (
    <div className="gpd-band">
      <span className="gpd-legend">PULSE</span>
      <span className="gpd-s1-line">
        {pair.intent !== undefined ? (
          <span
            className={
              placeholder === true
                ? "gpd-intent-text gpd-placeholder"
                : "gpd-intent-text"
            }
          >
            {pair.intent}
          </span>
        ) : null}
        {pair.intent !== undefined && pair.activity !== undefined ? (
          <span className="gpd-s1-sep" aria-hidden="true">
            ›
          </span>
        ) : null}
        {pair.activity !== undefined ? (
          <span className="gpd-activity-text gpd-s1-activity">
            {pair.activity}
          </span>
        ) : null}
      </span>
      <DemoSpark phase={phase} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// L1 — the Lens row: stacked intent + activity under the name line.
// ---------------------------------------------------------------------------

function LensFrame({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="gpd-lens-frame">
      <div className="gpd-lens-name-line">
        <span className="gpd-lens-dot" aria-hidden="true" />
        <span className="gpd-lens-name">{name}</span>
        <span className="gpd-lens-slots" aria-hidden="true">
          <span>1</span>
          <span>2</span>
          <span>3</span>
        </span>
      </div>
      {children}
    </div>
  );
}

/** The chosen Lens grammar: intent on its own line, activity + sparkline
 *  on a third. A missing level collapses its line — the row never
 *  reserves an empty run. */
function LensStacked({
  name,
  pair,
  phase,
  placeholder,
}: {
  name: string;
  pair: Partial<PulsePair>;
  phase: number;
  placeholder?: boolean;
}): React.ReactElement {
  return (
    <LensFrame name={name}>
      {pair.intent !== undefined ? (
        <div className="gpd-lens-intent-line">
          <span
            className={
              placeholder === true
                ? "gpd-intent-text gpd-lens-intent gpd-placeholder"
                : "gpd-intent-text gpd-lens-intent"
            }
          >
            {pair.intent}
          </span>
          {pair.activity === undefined ? (
            <DemoSpark phase={phase} width={56} height={16} className="gpd-lens-spark" />
          ) : null}
        </div>
      ) : null}
      {pair.activity !== undefined ? (
        <div className="gpd-lens-activity-line">
          <span className="gpd-live-dot" aria-hidden="true" />
          <span className="gpd-activity-text gpd-lens-activity">
            {pair.activity}
          </span>
          <DemoSpark phase={phase} width={56} height={16} className="gpd-lens-spark" />
        </div>
      ) : null}
    </LensFrame>
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export function GalleryPulseDisplay(): React.ReactElement {
  return (
    <div className="gpd-root" data-slot="gallery-pulse-display">
      <p className="gpd-blurb">
        The PULSE as a two-level feed: <strong>INTENT</strong> — the headline —
        over <strong>ACTIVITY</strong> — the operation running now. Locked
        directions: intents in headline register (no articles, no needless
        words); the session card wears <strong>S1</strong> (one line, headline
        first, <code>›</code> separator); the Lens wears <strong>L1</strong>{" "}
        (stacked lines).
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
        title="Session card — S1, headline first"
        blurb="One line, today's band geometry. The intent leads bright and is layout-pinned; the activity trails in muted mono past the › and is the part that ellipsizes. The sparkline keeps its place and weight."
      >
        {PAIRS.slice(0, 6).map((pair, i) => (
          <StripLine key={pair.intent} pair={pair} phase={i + 1} />
        ))}
      </Section>

      <TugSeparator />

      <Section
        title="Lens — L1, stacked"
        blurb="Intent on its own line under the session name; activity + sparkline on a third. Each level keeps a clean single-line run. Frames at monitor width."
      >
        <div className="gpd-lens-stack">
          {LENS_SESSIONS.map((s, i) => (
            <LensStacked
              key={s.name}
              name={s.name}
              pair={s.pair}
              phase={i + 10}
            />
          ))}
        </div>
      </Section>

      <TugSeparator />

      <Section
        title="States — the lifecycle in both grammars"
        blurb="Either level can be absent. S1 drops the missing run from its line; L1 collapses the missing line entirely — neither surface reserves empty space."
      >
        <div className="gpd-state">
          <span className="gpd-state-label">Both levels live</span>
          <StripLine pair={PAIRS[2]} phase={20} />
        </div>
        <div className="gpd-state">
          <span className="gpd-state-label">
            No intent yet — turn just started, first overview pending
          </span>
          <StripLine pair={{ activity: "Grep tugdeck/src for pulse" }} phase={21} />
        </div>
        <div className="gpd-state">
          <span className="gpd-state-label">
            Intent held, activity idle — between operations
          </span>
          <StripLine pair={{ intent: PAIRS[1].intent }} phase={22} />
        </div>
        <div className="gpd-state">
          <span className="gpd-state-label">Turn done</span>
          <StripLine pair={{ intent: "Done" }} phase={23} placeholder />
        </div>
        <div className="gpd-state">
          <span className="gpd-state-label">
            Overflow — activity past the width; the headline never truncates
          </span>
          <StripLine pair={LONG_PAIR} phase={24} />
        </div>
        <div className="gpd-state">
          <span className="gpd-state-label">Lens: no intent yet / turn done</span>
          <div className="gpd-lens-stack">
            <LensStacked
              name="tugtool/lens-xp"
              pair={{ activity: "Grep tugdeck/src for pulse" }}
              phase={25}
            />
            <LensStacked
              name="tugtool/local-model-bringup"
              pair={{ intent: "Done" }}
              phase={26}
              placeholder
            />
          </div>
        </div>
      </Section>
    </div>
  );
}
