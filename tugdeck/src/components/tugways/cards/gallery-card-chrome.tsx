/**
 * gallery-card-chrome.tsx — design spike for the deck's chrome tiers.
 *
 * The Session card wears a 72px masthead; every other card wears the 36px
 * title bar, and a rail (Lens, Jots, Gazette) wears that same bar despite the
 * layout imposer treating it as a different kind of thing entirely. This
 * fixture proposes three tiers instead of two, and shows them side by side
 * against what ships today:
 *
 *   72px masthead, tinted band  → a DOCUMENT card saying its own name
 *   36px title bar, tinted band → a UTILITY card wearing its type's name
 *   30px label, flush ground    → a RAIL, which is a tool and not a document
 *
 * Everything here is the real chrome: a real `CardTitleBar` inside a real
 * `.tug-pane` wrapper, driven by real `CardMastheadPayload`s, so the reserve
 * arithmetic under the control cluster and the focused/unfocused token pairs
 * are the shipping ones and not a mock's approximation. The "today" rows
 * mount the real `TextCardTopBar` for the same reason.
 *
 * Nothing in this file is wired into a shipping card. The Text, File, and
 * Diff cards still publish no masthead and `TugPane` still passes no sidebar
 * role — adopting the tiers is the decision this fixture exists to inform.
 *
 * @module components/tugways/cards/gallery-card-chrome
 */

import React, { useId, useState } from "react";

import { CardTitleBar } from "@/components/chrome/tug-pane";
import type { CardMastheadPayload } from "@/lib/card-title-store";
import type { SlotStackEntry } from "@/deck-store-selectors";
import { DEFAULT_TEXT_CARD_SETTINGS } from "@/lib/text-card-settings";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugBox } from "@/components/tugways/tug-box";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { TextCardTopBar } from "./text-card-top-bar";

import "./gallery-card-chrome.css";

// ---------------------------------------------------------------------------
// Fixture content
// ---------------------------------------------------------------------------

const NOTES_PATH = "/Users/kocienda/Desktop/session-naming-notes.md";
const SHOT_PATH = "/Users/kocienda/Mounts/u/src/tugtool/docs/shots/masthead-2026-08-10.png";

/**
 * A two-pane stack, so the stack badge renders and the control cluster gets
 * wider — which is the interesting case for the reserve, since every line's
 * stop is measured from `--tugx-pane-controls-width` at runtime.
 */
const STACK: readonly SlotStackEntry[] = [
  {
    paneId: "spike-a",
    cardId: "spike-a",
    title: "session-naming-notes.md",
    icon: "FileText",
    topmost: true,
  },
  {
    paneId: "spike-b",
    cardId: "spike-b",
    title: "Project Diff",
    icon: "GitCompareArrows",
    topmost: false,
  },
];

function textMasthead(dirty: boolean, detail: boolean): CardMastheadPayload {
  return {
    kind: "card-masthead",
    icon: "FileText",
    title: dirty ? "session-naming-notes.md •" : "session-naming-notes.md",
    description: NOTES_PATH,
    descriptionKind: "path",
    detail: detail ? "Markdown · manual save · UTF-8 · 1,284 words" : null,
  };
}

function fileMasthead(detail: boolean): CardMastheadPayload {
  return {
    kind: "card-masthead",
    icon: "Image",
    title: "masthead-2026-08-10.png",
    description: SHOT_PATH,
    descriptionKind: "path",
    detail: detail ? "PNG · 2560 × 812 · 341 KB" : null,
  };
}

function diffMasthead(detail: boolean): CardMastheadPayload {
  return {
    kind: "card-masthead",
    icon: "GitCompareArrows",
    title: "Project Diff",
    description: "12 files changed  ·  +348 −91",
    detail: detail ? "main ← avid-rope · 3 commits ahead" : null,
  };
}

// ---------------------------------------------------------------------------
// Mock pane frame
// ---------------------------------------------------------------------------

/**
 * The chrome's own wrapper, not a stand-in for it: `.tug-pane` is where the
 * chrome-height property is published and where `data-focused` selects the
 * active token pair, so a demo that skipped it would show the inactive
 * palette for everything and no reserve at all.
 */
function SpikePane({
  focused,
  masthead = false,
  children,
  body,
}: {
  focused: boolean;
  /**
   * Mirrors what `TugPane` stamps on the pane element when its active card
   * publishes a masthead. It has to live HERE and not on the bar: the tier is
   * published as `--tugx-pane-chrome-height` from the pane, so that the scrim
   * and the banner seat below whatever the chrome wears.
   */
  masthead?: boolean;
  children: React.ReactNode;
  body: string;
}) {
  return (
    <div
      className="tug-pane cg-spike-pane"
      data-focused={focused ? "true" : undefined}
      data-masthead={masthead ? "true" : undefined}
    >
      {children}
      <div className="cg-spike-pane-body">{body}</div>
    </div>
  );
}

function SpikeRow({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="cg-spike-row">
      <TugLabel size="2xs" emphasis="calm">
        {caption}
      </TugLabel>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryCardChrome
// ---------------------------------------------------------------------------

export function GalleryCardChrome(): React.ReactElement {
  const [focused, setFocused] = useState(true);
  const [dirty, setDirty] = useState(true);
  const [detail, setDetail] = useState(true);
  const [stacked, setStacked] = useState(false);

  const focusedId = useId();
  const dirtyId = useId();
  const detailId = useId();
  const stackedId = useId();

  const { ResponderScope, responderRef } = useResponderForm({
    toggle: {
      [focusedId]: setFocused,
      [dirtyId]: setDirty,
      [detailId]: setDetail,
      [stackedId]: setStacked,
    },
  });

  const slotStack = stacked ? STACK : undefined;
  const noop = () => {
    /* spike: the chrome is the subject, its actions are not */
  };

  return (
    <ResponderScope>
      <div
        className="cg-content"
        data-testid="gallery-card-chrome"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        <div className="cg-section">
          <TugLabel className="cg-section-title">Card Chrome — three tiers</TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            A proposal: the masthead generalizes from the Session card to every document
            card, and a rail stops borrowing a content card's title bar. Real CardTitleBar
            throughout — nothing here is drawn by hand.
          </TugLabel>
        </div>

        <TugSeparator />

        {/* ---- Controls ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Preview Controls</TugLabel>
          <TugBox
            variant="bordered"
            rounded="sm"
            style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}
          >
            <TugCheckbox checked={focused} senderId={focusedId} label="Pane focused" size="sm" />
            <TugCheckbox checked={dirty} senderId={dirtyId} label="Unsaved changes" size="sm" />
            <TugCheckbox checked={detail} senderId={detailId} label="Third line" size="sm" />
            <TugCheckbox checked={stacked} senderId={stackedId} label="Stacked (badge)" size="sm" />
          </TugBox>
          <TugLabel size="2xs" emphasis="calm">
            Stacking widens the control cluster. Every masthead line stops short of the
            measured width, so the reserve should visibly follow the badge in and out.
          </TugLabel>
        </div>

        <TugSeparator />

        {/* ---- Tier 1: the document masthead ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Tier 1 — document card (72px masthead)</TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            A card that holds a named thing says its name, then where it lives. The path is
            the line the Text card currently spends a whole second row on.
          </TugLabel>

          <SpikeRow caption="Text card — name, path, and (optionally) what the status bar knows">
            <SpikePane focused={focused} masthead body="1  Notes:">
              <CardTitleBar
                title="session-naming-notes.md"
                masthead={textMasthead(dirty, detail)}
                widthPreset="comfy"
                onSetWidth={noop}
                slotStack={slotStack}
                onClose={noop}
              />
            </SpikePane>
          </SpikeRow>

          <SpikeRow caption="File viewer — gains a path it does not show anywhere today">
            <SpikePane focused={focused} masthead body="(image)">
              <CardTitleBar
                title="masthead-2026-08-10.png"
                masthead={fileMasthead(detail)}
                widthPreset="wide"
                onSetWidth={noop}
                slotStack={slotStack}
                onClose={noop}
              />
            </SpikePane>
          </SpikeRow>

          <SpikeRow caption="Diff — label and stats move up; the toggles stay on the document header">
            <SpikePane focused={focused} masthead body="tugdeck/src/components/chrome/tug-pane.tsx">
              <CardTitleBar
                title="Project Diff"
                masthead={diffMasthead(detail)}
                widthPreset="comfy"
                onSetWidth={noop}
                slotStack={slotStack}
                onClose={noop}
              />
            </SpikePane>
          </SpikeRow>
        </div>

        <TugSeparator />

        {/* ---- What ships today ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Today, for comparison</TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            The real Text card chrome: a 36px bar naming the file, then a separate strip
            repeating it as a path. Two tiers, one identity, and the actions are the only
            thing the second tier holds that the first could not.
          </TugLabel>

          <SpikeRow caption="Text card as shipped — title bar + TextCardTopBar">
            <SpikePane focused={focused} body="1  Notes:">
              <CardTitleBar
                title={dirty ? "session-naming-notes.md •" : "session-naming-notes.md"}
                icon="FileText"
                widthPreset="comfy"
                onSetWidth={noop}
                slotStack={slotStack}
                onClose={noop}
              />
              <TextCardTopBar
                path={NOTES_PATH}
                isDraft={false}
                saveMode="manual"
                canMoveTo={false}
                onMoveTo={noop}
                onSave={noop}
                canSave={dirty}
                onRevealInFinder={noop}
                settings={DEFAULT_TEXT_CARD_SETTINGS}
                onChangeSetting={noop}
              />
            </SpikePane>
          </SpikeRow>
        </div>

        <TugSeparator />

        {/* ---- Tier 2: the utility card ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Tier 2 — utility card (36px, unchanged)</TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            Settings, Keyboard Shortcuts, DevTools, the gallery. These have no document
            identity — a second line under "Settings" would have to be invented — so they
            keep the bar they have.
          </TugLabel>

          <SpikeRow caption="Settings — the tier that already exists">
            <SpikePane focused={focused} body="Appearance · Editor · Sessions">
              <CardTitleBar
                title="Settings"
                icon="Settings"
                widthPreset="comfy"
                onSetWidth={noop}
                slotStack={slotStack}
                onClose={noop}
              />
            </SpikePane>
          </SpikeRow>
        </div>

        <TugSeparator />

        {/* ---- Tier 3: the rail ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Tier 3 — rail (30px, flush)</TugLabel>
          <TugLabel size="2xs" emphasis="calm">
            A rail pins to a deck edge, takes its width from the allocator rather than a
            preset, and insets the band the content cards live in. The chrome should say
            so: flush ground instead of the tinted band, a tracked label instead of an
            icon and a title, and no width control (already true today).
          </TugLabel>

          {/* No `icon` on any of these: Lens, Jots and Gazette register none
              today, so the tracked label is what changes and not the glyph. */}
          <SpikeRow caption="Lens — proposed rail chrome">
            <SpikePane focused={focused} body="Cards · Layouts · Sessions">
              <CardTitleBar title="Lens" sidebar onClose={noop} />
            </SpikePane>
          </SpikeRow>

          <SpikeRow caption="Jots — proposed rail chrome">
            <SpikePane focused={focused} body="Filter · New jot">
              <CardTitleBar title="Jots" sidebar onClose={noop} />
            </SpikePane>
          </SpikeRow>

          <SpikeRow caption="Lens as shipped — a content card's bar on a rail">
            <SpikePane focused={focused} body="Cards · Layouts · Sessions">
              <CardTitleBar title="Lens" onClose={noop} />
            </SpikePane>
          </SpikeRow>
        </div>
      </div>
    </ResponderScope>
  );
}
