/**
 * GallerySelectionWash — the design spike for the committed-selection mark.
 *
 * The question this card exists to answer: now that the container focus wash
 * ships at the minimum alpha that registers (6% dark / 10% light), the committed
 * selection fill is the loudest thing in a list by a wide margin — an opaque
 * cobalt slab that recolours every glyph and every line of text in the row. The
 * two marks are correct in SEMANTICS (focus rides Accent and marks a container,
 * selection rides Key and marks a row — [D122]) but they are authored in two
 * different registers of loudness, and a picker in `singleSelect` mode stacks
 * them on the SAME row by construction: the arrows move the cursor and commit
 * selection in one motion, so the accent bar always lands on the cobalt slab.
 *
 * What to look for, in order:
 *
 *   §1  THE RAMP — the selection mark as a WASH at eight alphas over the three
 *       grounds a list sits on, with the shipped slab as the last rung. The
 *       lowest rung that still says "this row is chosen" is the floor; the first
 *       rung that starts recoloring the row rather than marking it is the ceiling.
 *   §2  SOURCE — the vivid `selected` blue vs the already-toned `quiet` blue at
 *       matched rungs. Mixing down a colour that is already mixed down is how the
 *       old focus wash landed near-invisible; this is the evidence for which
 *       source the selection wash should mix from.
 *   §3  THE FAMILIES — six candidate treatments side by side: the shipped slab,
 *       a pure wash, wash + a Key-axis leading edge, edge alone, a hairline
 *       frame, and the stacked-bar variant. Cursor and selection are on
 *       DIFFERENT rows here, which is the easy case.
 *   §4  THE COLLISION — the same six families with the `singleSelect` reality:
 *       cursor alone, selection alone, and both on one row. This is the section
 *       the verdict actually turns on. A family that reads well in §3 and muddles
 *       here is not the answer.
 *   §5  KEY VIEW LOST — the container wash gone and the cursor bar gone, which is
 *       what the Choose Session list looks like the moment focus moves to the
 *       path field or the Open button. A selection mark that only reads while the
 *       list is focused has failed its one job: giving the default button a
 *       visible antecedent.
 *   §6  A/B ON A REAL LIST — two real `TugListView` + `TugListRow` instances,
 *       shipped beside candidate. The candidate side is expressed purely as
 *       repoints of `--tugx-list-row-selected-*`, which is exactly the shape the
 *       shipped change would take.
 *
 * §1–§5 are row MOCKUPS keyed on self-contained `data-sw-*` attributes so every
 * candidate paints at once for comparison — the same technique and the same
 * reason as `gallery-focus-wash.tsx`. §6 composes the real components, because
 * that is the section whose verdict has to survive contact with real rows.
 *
 * Laws: [L06] appearance is attribute → CSS (no React-driven style anywhere
 * here); [L02] the list's data enters React through the `TugListView` data-source
 * contract; [L19] gallery-card authoring, registered in
 * `gallery-registrations.tsx`.
 */

import "./gallery.css";
import "./gallery-selection-wash.css";

import React from "react";

import { TugLabel } from "@/components/tugways/tug-label";
import { TugListRow } from "@/components/tugways/tug-list-row";
import {
  TugListView,
  type TugListViewCellProps,
  type TugListViewDataSource,
} from "@/components/tugways/tug-list-view";

/**
 * The alpha rungs the ramp walks. `slab` is not an alpha — it is the shipped
 * opaque fill, carried in the same column so the ramp is read against it rather
 * than against a memory of it.
 */
const RUNGS = [10, 14, 18, 22, 26, 32, 40, "slab"] as const;

/** The three surfaces a list with a selected row actually sits on. */
const GROUNDS = [
  { key: "well", label: "Lens band well", note: "the three Lens list sections" },
  { key: "block", label: "Dialog surface", note: "Choose Session, the sheets" },
  { key: "global", label: "Global surface", note: "the deck's own ground" },
] as const;

/**
 * The candidate treatments. `slab` is what ships today and is the control; the
 * other five are the proposals. Each is a `data-sw-family` arm in the CSS.
 */
const FAMILIES = [
  {
    key: "slab",
    label: "slab (shipped)",
    note: "Opaque quiet-cobalt fill, all row text recoloured to the selection foreground.",
  },
  {
    key: "wash",
    label: "wash",
    note: "Low-alpha selection-hue fill, text left alone. The symmetric answer to the focus wash — same arithmetic, different axis.",
  },
  {
    key: "wash-edge",
    label: "wash + edge",
    note: "The wash plus a Key-axis leading-edge bar. Gives the row a crisp anchor without a slab; the bar shares the edge with the accent cursor bar and loses it when they coincide.",
  },
  {
    key: "edge",
    label: "edge only",
    note: "A Key-axis leading-edge bar and nothing else. The lightest possible mark — and the one that vanishes hardest under a coincident cursor.",
  },
  {
    key: "frame",
    label: "hairline frame",
    note: "A 1px inset selection-hue outline, no fill. Marks the row's extent without tinting anything under it.",
  },
  {
    key: "wash-stack",
    label: "wash + stacked edge",
    note: "The wash, with the selection bar set INBOARD of the accent cursor bar so a coincident row shows both stripes rather than one occluding the other.",
  },
] as const;

/** One row inside a swatch. */
type RowSpec = {
  readonly label: string;
  readonly selected?: boolean;
  readonly cursor?: boolean;
};

const RAMP_ROWS: readonly RowSpec[] = [
  { label: "Alpha" },
  { label: "Bravo", selected: true },
  { label: "Charlie", cursor: true },
];

const COLLISION_ROWS: readonly RowSpec[] = [
  { label: "cursor only", cursor: true },
  { label: "selected only", selected: true },
  { label: "selected + cursor", selected: true, cursor: true },
];

const RESTING_ROWS: readonly RowSpec[] = [
  { label: "Alpha" },
  { label: "Bravo", selected: true },
  { label: "Charlie" },
];

/**
 * A container mockup. `focus="on"` paints the shipped container focus wash
 * beneath the rows and lets the cursor bar draw, which is the state every
 * candidate has to survive; `focus="off"` is the same list with the keyboard
 * somewhere else (§5).
 */
function Swatch({
  ground,
  rows,
  family,
  rung,
  source,
  focus = "on",
  demote = false,
}: {
  ground: string;
  rows: readonly RowSpec[];
  family?: string;
  rung?: number | string;
  source?: "vivid" | "quiet";
  focus?: "on" | "off";
  demote?: boolean;
}): React.ReactElement {
  return (
    <div
      className="sw-swatch"
      data-sw-ground={ground}
      data-sw-family={family}
      data-sw-rung={rung}
      data-sw-source={source}
      data-sw-focus={focus}
      data-sw-demote={demote ? "true" : undefined}
    >
      {rows.map((row) => (
        <div
          className="sw-row"
          key={row.label}
          data-sw-selected={row.selected ? "true" : undefined}
          data-sw-cursor={row.cursor ? "true" : undefined}
        >
          {row.label}
        </div>
      ))}
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
    <div className="sw-section">
      <div className="sw-section-head">
        <div className="sw-section-title">{title}</div>
        <div className="sw-note">{note}</div>
      </div>
      {children}
    </div>
  );
}

// ---- §6's real list -------------------------------------------------------

const AB_ROWS = [
  { title: "New session", subtitle: "" },
  { title: "blithe-mica", subtitle: "Live in another card" },
  { title: "aware-gleam", subtitle: "Live in another card" },
  { title: "zany-lager", subtitle: "14m ago · 1 turn · 14 KB" },
] as const;

/** The row the A/B marks — index 1, so a divider sits above and below it. */
const AB_SELECTED_INDEX = 1;

/** A constant data source — the point is the paint, not the data flow. */
class SelectionDemoDataSource implements TugListViewDataSource {
  numberOfItems(): number {
    return AB_ROWS.length;
  }
  idForIndex(index: number): string {
    return `sw-row-${index}`;
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

function SelectionRowCell({
  index,
}: TugListViewCellProps<SelectionDemoDataSource>): React.ReactElement {
  const row = AB_ROWS[index];
  return (
    <TugListRow
      variant="flush"
      title={row.title}
      subtitle={row.subtitle || undefined}
      selected={index === AB_SELECTED_INDEX}
    />
  );
}

const AB_CELLS = { row: SelectionRowCell };

/**
 * A real `TugListView` of real `TugListRow`s with the selection committed on one
 * row and the container mark forced on. `data-sw-ab="candidate"` repoints the
 * row's own `--tugx-list-row-selected-*` aliases — the same three declarations
 * the shipped change would carry — so what is judged here is the actual edit.
 */
function AbList({ arm }: { arm: "shipped" | "candidate" }): React.ReactElement {
  const source = React.useMemo(() => new SelectionDemoDataSource(), []);
  return (
    <div className="sw-ab-host" data-sw-ab={arm}>
      <TugListView<SelectionDemoDataSource>
        dataSource={source}
        cellRenderers={AB_CELLS}
        inline
        scrollKey={`sw-ab-${arm}`}
        interactive={false}
        rowLayout="flush"
      />
    </div>
  );
}

export function GallerySelectionWash(): React.ReactElement {
  return (
    <div
      className="cg-content cg-selection-wash"
      data-testid="gallery-selection-wash"
    >
      <TugLabel className="cg-section-title">
        Selection Wash — the design spike for the committed-selection mark. Focus
        marks a CONTAINER on the accent axis at 6–10%; selection marks a ROW on
        the key axis at 100%. This card asks what the second half should look like
        if it were authored in the same register as the first. Read it in both
        themes. Tune the candidate in <code>gallery-selection-wash.css</code> (the{" "}
        <code>--sw-pick</code> and <code>--sw-src</code> knobs at the top).
      </TugLabel>

      {/* ---------- §1 The ramp ---------- */}
      <Section
        title="1 · The ramp — alpha × ground"
        note="One selection wash, seven alphas plus the shipped slab, over the three surfaces a list actually sits on. Each swatch carries an unmarked row, a SELECTED row, and a CURSOR row, so every rung is judged against both neighbours at once. Read down each column: the LOWEST rung that still says 'this row is chosen' is the floor, and the first rung that reads as recolouring the row rather than marking it is the ceiling. The container focus wash is painted beneath — that is the real context, and the selection mark has to stay legibly above it without becoming a slab."
      >
        <div className="sw-ramp">
          <div className="sw-ramp-corner" />
          {GROUNDS.map((g) => (
            <div className="sw-ramp-col-head" key={g.key}>
              <div className="sw-ramp-col-title">{g.label}</div>
              <div className="sw-note">{g.note}</div>
            </div>
          ))}
          {RUNGS.map((rung) => (
            <React.Fragment key={String(rung)}>
              <div className="sw-ramp-row-head">
                {rung === "slab" ? "slab" : `${rung}%`}
              </div>
              {GROUNDS.map((g) => (
                <div className="sw-ramp-cell" key={g.key}>
                  <Swatch
                    ground={g.key}
                    rows={RAMP_ROWS}
                    family={rung === "slab" ? "slab" : "wash"}
                    rung={rung}
                  />
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
      </Section>

      {/* ---------- §2 Source token ---------- */}
      <Section
        title="2 · Source — the vivid blue vs the quiet blue"
        note="The shipped slab is the `quiet` selection surface, a cobalt already toned well back per theme so it could carry a full-bleed fill without glaring. Mixing THAT down again is the arithmetic that made the old focus wash near-invisible. The `selected` surface — the vibrant blue the popup menus use for their small transient highlight — is the full-chroma source, and at low alpha it lands where a wash wants to be. Same rungs, both sources, over the dialog surface."
      >
        <div className="sw-pair-grid">
          {[14, 22, 32].map((rung) => (
            <React.Fragment key={rung}>
              <div className="sw-pair-label">{rung}% · vivid</div>
              <Swatch
                ground="block"
                rows={RAMP_ROWS}
                family="wash"
                rung={rung}
                source="vivid"
              />
              <div className="sw-pair-label">{rung}% · quiet</div>
              <Swatch
                ground="block"
                rows={RAMP_ROWS}
                family="wash"
                rung={rung}
                source="quiet"
              />
            </React.Fragment>
          ))}
        </div>
      </Section>

      {/* ---------- §3 The families ---------- */}
      <Section
        title="3 · The families — six candidate marks"
        note="Every candidate at the current --sw-pick, over the dialog surface, with the cursor on a DIFFERENT row from the selection. This is the easy case — the two marks are on separate rows and cannot be confused. The question here is only whether each candidate reads as 'chosen' at a glance, and whether it sits at a volume compatible with the whisper-quiet focus wash beneath it."
      >
        <div className="sw-family-grid">
          {FAMILIES.map((f) => (
            <div className="sw-family-cell" key={f.key}>
              <div className="sw-family-label">{f.label}</div>
              <Swatch ground="block" rows={RAMP_ROWS} family={f.key} />
              <div className="sw-note">{f.note}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ---------- §4 The collision ---------- */}
      <Section
        title="4 · The collision — cursor and selection on ONE row"
        note="This is the section the verdict turns on. A singleSelect picker (Choose Session, the model and effort sheets, the rewind sheet) moves the cursor and commits selection in one keystroke, so the accent bar and the selection mark are ALWAYS on the same row while the keyboard is driving. Each swatch shows the three states that row can be in. What to look for: does the coincident row read as one coherent mark, or as two marks from two different design languages stacked on top of each other? And can you still tell the middle row (selected, cursor elsewhere) from the bottom one?"
      >
        <div className="sw-family-grid">
          {FAMILIES.map((f) => (
            <div className="sw-family-cell" key={f.key}>
              <div className="sw-family-label">{f.label}</div>
              <Swatch ground="block" rows={COLLISION_ROWS} family={f.key} />
            </div>
          ))}
        </div>
      </Section>

      {/* ---------- §5 Key view lost ---------- */}
      <Section
        title="5 · Key view lost — the list is not focused"
        note="The container wash is gone and there is no cursor bar: this is the Choose Session list the moment focus moves to the path field, the filter, or the Open button. The selection mark is now the ONLY thing on the surface, and it has to give the default button a visible antecedent — a mark that only reads while the list is focused has failed its one job. The last swatch is orthogonal: the shipped slab demoted to the `plain-inactive` gray, the Mac idiom where a selection grays back when focus leaves. Any family could adopt that; the question is whether one needs to."
      >
        <div className="sw-family-grid">
          {FAMILIES.map((f) => (
            <div className="sw-family-cell" key={f.key}>
              <div className="sw-family-label">{f.label}</div>
              <Swatch
                ground="block"
                rows={RESTING_ROWS}
                family={f.key}
                focus="off"
              />
            </div>
          ))}
          <div className="sw-family-cell">
            <div className="sw-family-label">slab · grayed back</div>
            <Swatch
              ground="block"
              rows={RESTING_ROWS}
              family="slab"
              focus="off"
              demote
            />
          </div>
        </div>
      </Section>

      {/* ---------- §6 A/B on a real list ---------- */}
      <Section
        title="6 · A/B — the shipped slab vs the candidate, on real rows"
        note="Two real TugListView instances of real TugListRows, with real titles and subtitles, a committed selection, the container wash forced on, and the cursor bar forced onto the selected row (the singleSelect reality). The left arm is what ships. The right arm changes NOTHING but the three --tugx-list-row-selected-* aliases, which is exactly the shape of the eventual edit. The question is not which is prettier — it is which one you can read the selected row's TEXT in while still knowing it is selected."
      >
        <div className="sw-ab-grid">
          <div className="sw-ab-cell">
            <AbList arm="shipped" />
            <div className="sw-cell-label">slab (shipped)</div>
          </div>
          <div className="sw-ab-cell">
            <AbList arm="candidate" />
            <div className="sw-cell-label">candidate (--sw-pick)</div>
          </div>
        </div>
      </Section>
    </div>
  );
}
