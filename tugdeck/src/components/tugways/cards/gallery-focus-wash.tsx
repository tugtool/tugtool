/**
 * GalleryFocusWash — the design spike for the container focus WASH.
 *
 * The question this card exists to answer: with the container focus RING retired
 * ([P01] of `roadmap/focus-language-wash.md`), what alpha of the accent makes a
 * background wash read as "the keyboard is in this container" without reading as
 * a filled surface or as a committed selection?
 *
 * Light is the hard case and drives the answer. Over `brio`'s dark ground there
 * is a wide band of alphas that read as lit-but-not-filled; over `harmony`'s pale
 * ground the same band is a few percent wide before the wash becomes a surface
 * colour of its own. Toggle the theme in the gallery chrome and read the ramp in
 * BOTH modes: if the winning rung differs, that is the answer to [Q01]'s
 * "per-mode override" option, and the override belongs next to
 * `--tugx-drop-ring-width` in `focus-ring.css`, which already splits by mode.
 *
 * What to look for, in order:
 *
 *   §1  THE RAMP — the same wash at eight alphas over the three grounds a
 *       container actually sits on. The lowest rung that still reads is the
 *       answer; the first rung that reads as a *fill* is the ceiling.
 *   §2  SOURCE — accent FILL vs accent TONE at matched rungs. The plan builds
 *       the wash from the fill; this is the evidence for that choice.
 *   §3  WITHIN — the reduced-strength wash for `data-key-within` beside the
 *       full one ([Q02]). They must be distinguishable without the weaker one
 *       vanishing.
 *   §4  A/B ON A REAL LIST — the shipped ring beside the proposed wash, both on
 *       real `TugListView` instances with real rows, a cursor bar, and a selected
 *       row. This is where the "is this actually better" judgement gets made.
 *
 * The ramp swatches (§1–§3) are row MOCKUPS, keyed on self-contained `data-fw-*`
 * attributes so every candidate paints at once for comparison — the same
 * technique and the same reason as `gallery-focus-language.tsx`. §4 composes the
 * real component, because that is the section whose verdict has to survive
 * contact with real rows.
 *
 * Laws: [L06] appearance is attribute → CSS (no React-driven style anywhere
 * here); [L02] the list's data enters React through the `TugListView` data-source
 * contract; [L19] gallery-card authoring, registered in
 * `gallery-registrations.tsx`.
 */

import "./gallery.css";
import "./gallery-focus-wash.css";

import React from "react";

import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewDataSource,
} from "@/components/tugways/tug-list-view";
import { TugLabel } from "@/components/tugways/tug-label";

/** The alpha rungs the ramp walks, as percentages of the source colour. */
const RUNGS = [6, 8, 10, 12, 15, 18, 22, 26] as const;

/** The three surfaces a washed container actually sits on in the shipped app. */
const GROUNDS = [
  { key: "well", label: "Lens band well", note: "the three Lens list sections" },
  { key: "block", label: "Block surface", note: "a tool block's expanded body" },
  { key: "global", label: "Global surface", note: "the deck's own ground" },
] as const;

/**
 * A container mockup: three rows, a cursor bar on the middle one, a committed
 * selection on the last. Enough to judge the wash against everything that will
 * sit on top of it — including the one opaque row that occludes it, which is
 * correct behaviour and not a defect (see the plan's row-opacity table).
 */
function Swatch({
  ground,
  rung,
  source = "fill",
  strength = "full",
}: {
  ground: string;
  rung?: number;
  source?: "fill" | "tone";
  strength?: "full" | "within";
}): React.ReactElement {
  return (
    <div
      className="fw-swatch"
      data-fw-ground={ground}
      data-fw-rung={rung}
      data-fw-source={source}
      data-fw-strength={strength}
    >
      <div className="fw-row">Alpha</div>
      <div className="fw-row" data-fw-cursor="true">
        Bravo
      </div>
      <div className="fw-row" data-fw-selected="true">
        Charlie
      </div>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="fw-section">
      <div className="fw-section-head">
        <div className="fw-section-title">{title}</div>
        <div className="fw-note">{note}</div>
      </div>
      {children}
    </div>
  );
}

// ---- §4's real list -------------------------------------------------------

const AB_ROWS = [
  "scroll-height-floor.md",
  "tugcast-performance-fixups.md",
  "focus-language-wash.md",
  "transcript-dom-eviction.md",
] as const;

/** A constant data source — the point is the paint, not the data flow. */
class WashDemoDataSource implements TugListViewDataSource {
  numberOfItems(): number {
    return AB_ROWS.length;
  }
  idForIndex(index: number): string {
    return `wash-row-${index}`;
  }
  kindForIndex(): string {
    return "row";
  }
  subscribe(): () => void {
    return () => {};
  }
  getVersion(): unknown {
    return AB_ROWS;
  }
}

function WashRowCell({
  index,
}: TugListViewCellProps<WashDemoDataSource>): React.ReactElement {
  return <div className="fw-ab-row">{AB_ROWS[index]}</div>;
}

const AB_CELLS = { row: WashRowCell };

/**
 * A real `TugListView` with the container mark forced on. `data-fw-ab` selects
 * which mark the spike CSS paints — `ring` reproduces the shipped treatment,
 * `wash` the proposed one — so the two can be read side by side without needing
 * two engines or two focus states.
 */
function AbList({ mark }: { mark: "ring" | "wash" }): React.ReactElement {
  const source = React.useMemo(() => new WashDemoDataSource(), []);
  return (
    <div className="fw-ab-host" data-fw-ab={mark}>
      <TugListView<WashDemoDataSource>
        dataSource={source}
        cellRenderers={AB_CELLS}
        inline
        scrollKey={`fw-ab-${mark}`}
        interactive={false}
        rowSeparator="none"
      />
    </div>
  );
}

export function GalleryFocusWash(): React.ReactElement {
  return (
    <div className="cg-content cg-focus-wash" data-testid="gallery-focus-wash">
      <TugLabel className="cg-section-title">
        Focus Wash — the design spike for the container mark. Rings and the cursor
        caret mark ELEMENTS; a background wash marks CONTAINERS. Read this card in
        both themes: the light ground is what constrains the value. Tune the
        candidate in <code>gallery-focus-wash.css</code> (the{" "}
        <code>--fw-pick</code> knob at the top).
      </TugLabel>

      {/* ---------- §1 The ramp ---------- */}
      <Section
        title="1 · The ramp — alpha × ground"
        note="One wash, eight alphas, over the three surfaces a container actually sits on. Read down each column: the LOWEST rung that still says 'the keyboard is in here' is the answer, and the FIRST rung that reads as a filled surface is the ceiling. The cursor bar must stay the loudest thing in the box at every rung — if the wash starts competing with it, the rung is already too high."
      >
        <div className="fw-ramp">
          <div className="fw-ramp-corner" />
          {GROUNDS.map((g) => (
            <div className="fw-ramp-col-head" key={g.key}>
              <div className="fw-ramp-col-title">{g.label}</div>
              <div className="fw-note">{g.note}</div>
            </div>
          ))}
          {RUNGS.map((rung) => (
            <React.Fragment key={rung}>
              <div className="fw-ramp-row-head">{rung}%</div>
              {GROUNDS.map((g) => (
                <div className="fw-ramp-cell" key={g.key} data-fw-ground={g.key}>
                  <Swatch ground={g.key} rung={rung} />
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      </Section>

      {/* ---------- §2 Source token ---------- */}
      <Section
        title="2 · Source — accent FILL vs accent TONE"
        note="The shipped default builds the wash from the accent TONE, which is already alpha-bearing in every theme and then mixed down a further 65% — which is how it lands near-invisible, and why the Layouts section had to override it locally with 15% of the accent FILL. Same rungs, both sources, over the Lens well. If the tone column reads as unmarked at every rung, the plan's choice of the fill is settled."
      >
        <div className="fw-pair-grid">
          {[10, 15, 22].map((rung) => (
            <React.Fragment key={rung}>
              <div className="fw-pair-label">{rung}% · fill</div>
              <Swatch ground="well" rung={rung} source="fill" />
              <div className="fw-pair-label">{rung}% · tone</div>
              <Swatch ground="well" rung={rung} source="tone" />
            </React.Fragment>
          ))}
        </div>
      </Section>

      {/* ---------- §3 The within ratio ---------- */}
      <Section
        title="3 · Within — the reduced strength"
        note="A container that merely CONTAINS the active control wears a weaker wash than one holding the key view ([Q02]). The pair must be distinguishable at a glance without the weaker one disappearing into the ground. Both swatches here ride the current --fw-pick; the ratio is --fw-within-ratio."
      >
        <div className="fw-pair-grid">
          <div className="fw-pair-label">key view</div>
          <Swatch ground="well" strength="full" />
          <div className="fw-pair-label">within</div>
          <Swatch ground="well" strength="within" />
        </div>
      </Section>

      {/* ---------- §4 A/B on a real list ---------- */}
      <Section
        title="4 · A/B — the shipped ring vs the proposed wash"
        note="Two real TugListView instances, real rows, the container mark forced on. The left one reproduces what ships today; the right one is the proposal at the current --fw-pick. The question is not which is prettier — it is which one lets you find the cursor bar first."
      >
        <div className="fw-ab-grid">
          <div className="fw-ab-cell">
            <AbList mark="ring" />
            <div className="fw-cell-label">ring (shipped)</div>
          </div>
          <div className="fw-ab-cell">
            <AbList mark="wash" />
            <div className="fw-cell-label">wash (proposed)</div>
          </div>
        </div>
      </Section>
    </div>
  );
}
