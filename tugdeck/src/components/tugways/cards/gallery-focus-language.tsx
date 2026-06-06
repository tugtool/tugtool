/**
 * GalleryFocusLanguage — the focus-language modernization SPIKE (deletable).
 *
 * A static design canvas for settling the new keyboard-focus visual language by
 * eye, across the full taxonomy of component archetypes, in BOTH themes (toggle
 * brio/harmony in the gallery chrome). It is a mockup, not wired to the focus
 * engine: every state (rest / mouse-hover / keyboard-cursor / selected /
 * collision) is forced via a self-contained `data-fl-*` attribute so all states
 * show at once for comparison — the "keyboard vs mouse" distinction is the
 * mouse-hover column sitting next to the keyboard-cursor column.
 *
 * The proposed language is two branches (see gallery-focus-language.css):
 *   FILL  — actionable role controls (buttons): cursor promotes to filled role +
 *           role-coloured ring; siblings stay outlined.
 *   RING  — role-less / selection-bearing controls (inputs, toggles, sliders,
 *           group items, rows, boxes, links): cursor = a double-border ring in
 *           the keyboard colour; FILL stays reserved for selection.
 *
 * This is the canvas the dedicated rollout `/tugplug:devise` plan is judged
 * against. The live, engine-driven proof of the FILL branch already ships in the
 * Permission / Question inline dialogs.
 *
 * Laws: [L06] appearance is attribute → CSS (here forced mockup attributes, no
 * React-driven style); [L19] gallery-card authoring.
 */

import "./gallery.css";
import "./gallery-focus-language.css";

import React from "react";

import { TugLabel } from "@/components/tugways/tug-label";

type Branch = "fill" | "ring";

function SectionHead({
  title,
  branch,
  note,
}: {
  title: string;
  branch: Branch;
  note: string;
}): React.ReactElement {
  return (
    <div className="fl-section-head">
      <div className="fl-section-title">
        {title}
        <span className="fl-branch-tag" data-branch={branch}>
          {branch === "fill" ? "FILL" : "RING"}
        </span>
      </div>
      <div className="fl-note">{note}</div>
    </div>
  );
}

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="fl-cell">
      <div className="fl-stage">{children}</div>
      <div className="fl-cell-label">{label}</div>
    </div>
  );
}

/** A role button mockup at a forced state. */
function Btn({
  role,
  state,
  label,
}: {
  role: "action" | "danger" | "accent";
  state?: "hover" | "cursor";
  label: string;
}): React.ReactElement {
  return (
    <span className="fl-btn" data-role={role} data-fl-state={state}>
      {label}
    </span>
  );
}

export function GalleryFocusLanguage(): React.ReactElement {
  return (
    <div className="cg-content cg-focus-language" data-testid="gallery-focus-language">
      <TugLabel className="cg-section-title">
        Focus-language spike — proposed keyboard-focus treatment across the archetype
        taxonomy. Toggle the theme to judge both. Each row labels its branch and the
        fork it settles.
      </TugLabel>

      {/* ---------- Legend: current vs proposed ---------- */}
      <div className="fl-section">
        <SectionHead
          title="Legend — current orange ring vs proposed"
          branch="ring"
          note="Today every focusable wears one global orange outline (left). The proposal replaces it with the two-branch language below: fill-promotion for role buttons, a keyboard-coloured double border for everything else."
        />
        <div className="fl-legend">
          <Cell label="current (orange)">
            <span className="fl-btn fl-current-ring" data-role="action">
              Allow
            </span>
          </Cell>
          <Cell label="proposed · fill">
            <Btn role="action" state="cursor" label="Allow" />
          </Cell>
          <Cell label="proposed · ring">
            <span className="fl-input" data-fl-state="cursor">
              text field
            </span>
          </Cell>
        </div>
      </div>

      {/* ---------- 1. Role button ---------- */}
      <div className="fl-section">
        <SectionHead
          title="1 · Role button"
          branch="fill"
          note="Settles the filled-overload fork. A pure action control has no separate 'selected' state, so the cursor can safely take over the FILL: focused button promotes to its filled role style + a role-coloured ring; siblings demote to outlined (default-button emphasis follows focus). Covers TugPushButton, TugIconButton, TugDialogButton, TugPopupButton."
        />
        <div className="fl-grid">
          <Cell label="rest (outlined)">
            <Btn role="action" label="Allow" />
          </Cell>
          <Cell label="mouse-hover">
            <Btn role="action" state="hover" label="Allow" />
          </Cell>
          <Cell label="kbd-cursor (action)">
            <Btn role="action" state="cursor" label="Allow" />
          </Cell>
          <Cell label="kbd-cursor (danger)">
            <Btn role="danger" state="cursor" label="Delete" />
          </Cell>
          <Cell label="kbd-cursor (accent)">
            <Btn role="accent" state="cursor" label="Save" />
          </Cell>
        </div>
        <div className="fl-grid" style={{ marginTop: "16px" }}>
          <Cell label="group — keyboard on Allow (Deny demoted)">
            <span className="fl-btn-group">
              <Btn role="danger" label="Deny" />
              <Btn role="action" state="cursor" label="Allow" />
            </span>
          </Cell>
          <Cell label="group — keyboard on Deny (Allow demoted)">
            <span className="fl-btn-group">
              <Btn role="danger" state="cursor" label="Deny" />
              <Btn role="action" label="Allow" />
            </span>
          </Cell>
        </div>
      </div>

      {/* ---------- 2. Text input ---------- */}
      <div className="fl-section">
        <SectionHead
          title="2 · Text input"
          branch="ring"
          note="Can't fill — a filled body destroys legibility of typed text. So the cursor is a DOUBLE border: the field's own border recolours to the keyboard colour + an offset outer ring. Covers TugInput, TugTextarea, TugValueInput, and caret editors (prompt, code/markdown)."
        />
        <div className="fl-grid">
          <Cell label="rest">
            <span className="fl-input">name@host</span>
          </Cell>
          <Cell label="mouse-hover">
            <span className="fl-input" data-fl-state="hover">
              name@host
            </span>
          </Cell>
          <Cell label="kbd-cursor (double border)">
            <span className="fl-input" data-fl-state="cursor">
              name@host
            </span>
          </Cell>
        </div>
      </div>

      {/* ---------- 3. Small toggle ---------- */}
      <div className="fl-section">
        <SectionHead
          title="3 · Small toggle"
          branch="ring"
          note="A 16–20px box where FILL means 'checked' = the BLUE selection axis these controls actually use (TugCheckbox/TugSwitch/TugRadio/TugOption, never accent-orange). The cursor adds a keyboard-coloured ring — but that ring is also blue, so checked and focused sit in the same hue family here: judge whether they stay distinct at small size, or whether the cursor needs a different treatment. Covers TugCheckbox, TugSwitch."
        />
        <div className="fl-grid">
          <Cell label="unchecked · rest">
            <span className="fl-check" />
          </Cell>
          <Cell label="unchecked · kbd">
            <span className="fl-check" data-fl-state="cursor" />
          </Cell>
          <Cell label="checked · rest">
            <span className="fl-check" data-checked="true">
              ✓
            </span>
          </Cell>
          <Cell label="checked · kbd (collision)">
            <span className="fl-check" data-checked="true" data-fl-state="both">
              ✓
            </span>
          </Cell>
          <Cell label="switch · off / on / on+kbd">
            <span style={{ display: "inline-flex", gap: "10px", alignItems: "center" }}>
              <span className="fl-switch" />
              <span className="fl-switch" data-checked="true" />
              <span className="fl-switch" data-checked="true" data-fl-state="both" />
            </span>
          </Cell>
        </div>
      </div>

      {/* ---------- 4. Continuous / slider ---------- */}
      <div className="fl-section">
        <SectionHead
          title="4 · Continuous / slider"
          branch="ring"
          note="Commits live (cursor = value), continuous, no act. Can't fill a 'state' — the value IS the fill. Cursor = a ring on the thumb. Covers TugSlider, TugHueStrip, TugColorStrip, the SplitPane divider."
        />
        <div className="fl-grid">
          <Cell label="rest">
            <span className="fl-track">
              <span className="fl-fill" />
              <span className="fl-thumb" />
            </span>
          </Cell>
          <Cell label="kbd-cursor (thumb ring)">
            <span className="fl-track" data-fl-state="cursor">
              <span className="fl-fill" />
              <span className="fl-thumb" />
            </span>
          </Cell>
        </div>
      </div>

      {/* ---------- 5. Deferred item-group ---------- */}
      <div className="fl-section">
        <SectionHead
          title="5 · Deferred item-group — the collision case"
          branch="ring"
          note="The crux: cursor and selection are DIFFERENT items at the same time, and both are role-less. Selection = the blue dot filling (no selected-row background — these groups tint the row only on hover/cursor); cursor = a keyboard-coloured ring around the row. Because selection is a small dot and the cursor is a row outline, the two stay distinct even though both are blue. The last cell shows all combinations coexisting (A selected, B cursored, C both). Covers TugRadioGroup, TugChoiceGroup, TugOptionGroup."
        />
        <div className="fl-grid">
          <Cell label="rest">
            <Group />
          </Cell>
          <Cell label="mouse-hover (item B)">
            <Group hover={1} />
          </Cell>
          <Cell label="kbd-cursor on B (A selected)">
            <Group selected={0} cursor={1} />
          </Cell>
          <Cell label="cursor lands on selection (B)">
            <Group selected={1} cursor={1} />
          </Cell>
          <Cell label="all combos coexisting">
            <Group selected={0} cursor={2} />
          </Cell>
        </div>
      </div>

      {/* ---------- 6. Live item-group / tab bar ---------- */}
      <div className="fl-section">
        <SectionHead
          title="6 · Live item-group / tab bar"
          branch="ring"
          note="Derived from the deferred group, but cursor = selection (it switches live as you move). One element carries both: accent-active tab + keyboard ring. Covers TugTabBar."
        />
        <div className="fl-grid">
          <Cell label="rest (Files active)">
            <Tabs selected={0} />
          </Cell>
          <Cell label="kbd on active tab">
            <Tabs selected={0} cursor={0} />
          </Cell>
          <Cell label="moved → Search now active+cursor">
            <Tabs selected={1} cursor={1} />
          </Cell>
        </div>
      </div>

      {/* ---------- 7. Descendable rows ---------- */}
      <div className="fl-section">
        <SectionHead
          title="7 · Descendable rows + descend mark"
          branch="ring"
          note="Like a deferred group (row cursor = ring, row selection = accent) plus the descend story: when keyboard descends INTO a row, the container wears a quiet 'contains active' mark (the data-key-within analogue). Covers TugListView, TugListRow, TugAccordion, transcript/body-kind blocks."
        />
        <div className="fl-grid">
          <Cell label="cursor on row 2 (row 1 selected)">
            <ListRows selected={0} cursor={1} />
          </Cell>
          <Cell label="descended — container 'within' mark">
            <ListRows selected={1} within />
          </Cell>
        </div>
      </div>

      {/* ---------- 8. Component box-scope ---------- */}
      <div className="fl-section">
        <SectionHead
          title="8 · Component box-scope"
          branch="ring"
          note="A whole container becomes the key view (popover / sheet / alert / inline-dialog box). It can't fill. Proposal: a box-shadow ring that hugs the radius with no reflow (the treatment the dialogs already use), and the quiet 'within' variant when it merely contains the active control. Covers TugPopover, TugSheet, TugAlert, the inline-dialog shell."
        />
        <div className="fl-grid">
          <Cell label="rest">
            <span className="fl-box">Popover content</span>
          </Cell>
          <Cell label="kbd key-view (ring)">
            <span className="fl-box" data-fl-state="cursor">
              Popover content
            </span>
          </Cell>
          <Cell label="contains-active (within)">
            <span className="fl-box" data-fl-state="within">
              Popover content
            </span>
          </Cell>
        </div>
      </div>

      {/* ---------- 9. Inline link ---------- */}
      <div className="fl-section">
        <SectionHead
          title="9 · Inline link (long tail)"
          branch="ring"
          note="The app-wide long tail focus-ring.css flags: inline, non-box focusables that can't ring cleanly or fill. Proposal: underline on hover, underline + a keyboard-coloured ring on cursor. Covers TugLink and arbitrary focusable content."
        />
        <div className="fl-grid">
          <Cell label="rest">
            <span>
              See the <span className="fl-link">documentation</span> for details.
            </span>
          </Cell>
          <Cell label="mouse-hover">
            <span>
              See the{" "}
              <span className="fl-link" data-fl-state="hover">
                documentation
              </span>{" "}
              for details.
            </span>
          </Cell>
          <Cell label="kbd-cursor">
            <span>
              See the{" "}
              <span className="fl-link" data-fl-state="cursor">
                documentation
              </span>{" "}
              for details.
            </span>
          </Cell>
        </div>
      </div>
    </div>
  );
}

/* ---------- mockup sub-components ---------- */

const GROUP_ITEMS = ["Allow once", "Allow always", "Allow for session"];

function Group({
  selected,
  cursor,
  hover,
}: {
  selected?: number;
  cursor?: number;
  hover?: number;
}): React.ReactElement {
  return (
    <div className="fl-group">
      {GROUP_ITEMS.map((label, i) => (
        <div
          key={label}
          className="fl-item"
          data-fl-selected={selected === i ? "true" : undefined}
          data-fl-cursor={cursor === i ? "true" : undefined}
          data-fl-hover={hover === i ? "true" : undefined}
        >
          <span className="fl-dot" />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

const TAB_ITEMS = ["Files", "Search", "Git"];

function Tabs({
  selected,
  cursor,
}: {
  selected: number;
  cursor?: number;
}): React.ReactElement {
  return (
    <div className="fl-tabs">
      {TAB_ITEMS.map((label, i) => (
        <span
          key={label}
          className="fl-tab"
          data-fl-selected={selected === i ? "true" : undefined}
          data-fl-cursor={cursor === i ? "true" : undefined}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

const LIST_ITEMS = ["README.md", "package.json", "tsconfig.json"];

function ListRows({
  selected,
  cursor,
  within,
}: {
  selected?: number;
  cursor?: number;
  within?: boolean;
}): React.ReactElement {
  return (
    <div className="fl-list" data-fl-within={within ? "true" : undefined}>
      {LIST_ITEMS.map((label, i) => (
        <div
          key={label}
          className="fl-list-row"
          data-fl-selected={selected === i ? "true" : undefined}
          data-fl-cursor={cursor === i ? "true" : undefined}
        >
          {label}
        </div>
      ))}
    </div>
  );
}
