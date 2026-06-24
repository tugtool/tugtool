/**
 * gallery-completion-spike.tsx — design spike for the inline atom.
 *
 * Direction locked: the atom keeps its bounded, indivisible shape (caret
 * can't land inside, selects/deletes whole) but renders as full-size live
 * text inside a RECESSED fill — a soft inset shadow, no hard 1px stroke — so
 * legibility matches the surrounding prose. (Treatment "C" from the earlier
 * matrix.)
 *
 * This pass adds a light keycolor wash to the recessed fill: a low-percentage
 * blend of the theme's KEY hue (the selection / filled-action axis — not the
 * accent/affordance hue) into the atom surface, so the atom carries a hint of
 * the active theme instead of reading as a flat neutral slot. The wash
 * strength is driven by the `--cspike-wash` custom property, so the ramp
 * section can tune "light" by eye; switch themes to confirm the hue tracks the
 * key colour.
 *
 * Shown in both places the atom lives — a transcript sentence and a
 * prompt-entry editor line — for a slash command and a file together. The
 * baseline (genuine `TugAtomChip` / `createAtomImgElement`) stays for
 * reference. Nothing here is wired into the real editor/transcript; this card
 * only lets us judge the look before a direction lands in `tug-atom-img.ts` /
 * `tug-atom-text-body.tsx`.
 *
 * @module components/tugways/cards/gallery-completion-spike
 */

import React, { useEffect, useRef } from "react";
import { File as FileIcon } from "lucide-react";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugAtomChip } from "@/lib/tug-atom-chip";
import { createAtomImgElement } from "@/lib/tug-atom-img";
import "./gallery-completion-spike.css";

// ---------------------------------------------------------------------------
// Sample atoms + the two sample lines they appear in
// ---------------------------------------------------------------------------

type Atom =
  | { kind: "command"; name: string }
  | { kind: "file"; label: string; value: string };

const cmd = (name: string): Atom => ({ kind: "command", name });
const file = (label: string, value: string): Atom => ({ kind: "file", label, value });

const A = {
  review: cmd("review"),
  rewind: cmd("rewind"),
  model: cmd("model"),
  feed: file("feed-store.ts", "/Users/kocienda/project/src/lib/feed-store.ts"),
  editor: file("tug-text-editor.tsx", "/Users/kocienda/project/tugdeck/src/components/tugways/tug-text-editor.tsx"),
};

type Seg = { t: string } | { a: Atom };

// A realistic assistant turn — atoms embedded mid-prose.
const TRANSCRIPT_LINE: Seg[] = [
  { t: "Reviewed the diff with " },
  { a: A.review },
  { t: ", flagged a stale cache in " },
  { a: A.feed },
  { t: " — run " },
  { a: A.rewind },
  { t: " to back it out." },
];

// A realistic prompt-entry line — what the user typed before sending.
const EDITOR_LINE: Seg[] = [
  { a: A.model },
  { t: " opus-4.8, then summarize " },
  { a: A.editor },
  { t: " and " },
  { a: A.feed },
];

type Rep = "pill" | "wash";
type Context = "transcript" | "editor";

/** The default "light" wash the chosen treatment ships at. */
const DEFAULT_WASH = "9%";

/** Wash strengths for the tuning ramp — 0% is the neutral recessed slot. */
const WASH_RAMP = ["0%", "6%", "9%", "13%", "18%"];

// ---------------------------------------------------------------------------
// Inline token renderers
// ---------------------------------------------------------------------------

const displayText = (atom: Atom): string =>
  atom.kind === "command" ? `/${atom.name}` : atom.label;

const atomValue = (atom: Atom): string =>
  atom.kind === "command" ? atom.name : atom.value;

/** The real editor bake path — `createAtomImgElement`, mounted into a span. */
function RealEditorAtom({ atom }: { atom: Atom }): React.ReactElement {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.textContent = "";
    const img = createAtomImgElement(
      atom.kind === "command" ? "command" : "file",
      atom.kind === "command" ? `/${atom.name}` : atom.label,
      atomValue(atom),
    );
    host.appendChild(img);
    return () => {
      host.textContent = "";
    };
  }, [atom]);
  return <span className="cspike-real-atom" ref={ref} />;
}

function InlineToken({
  rep,
  atom,
  context,
  wash,
}: {
  rep: Rep;
  atom: Atom;
  context: Context;
  wash?: string;
}): React.ReactElement {
  const isCommand = atom.kind === "command";

  if (rep === "pill") {
    if (context === "editor") return <RealEditorAtom atom={atom} />;
    return (
      <TugAtomChip
        className="tug-atom-chip"
        type={isCommand ? "command" : "file"}
        label={displayText(atom)}
        value={atomValue(atom)}
      />
    );
  }

  return (
    <span
      className="cspike-tok cspike-tok-wash"
      data-kind={atom.kind}
      title={atomValue(atom)}
      style={wash !== undefined ? ({ "--cspike-wash": wash } as React.CSSProperties) : undefined}
    >
      {!isCommand && <FileIcon className="cspike-tok-ico" aria-hidden />}
      {displayText(atom)}
    </span>
  );
}

/** Lay out one sample line, rendering each atom in the given representation. */
function SampleLine({
  rep,
  context,
  wash,
}: {
  rep: Rep;
  context: Context;
  wash?: string;
}): React.ReactElement {
  const script = context === "transcript" ? TRANSCRIPT_LINE : EDITOR_LINE;
  return (
    <div className={context === "transcript" ? "cspike-prose" : "cspike-editor"}>
      {script.map((seg, i) =>
        "t" in seg ? (
          <React.Fragment key={i}>{seg.t}</React.Fragment>
        ) : (
          <InlineToken key={i} rep={rep} atom={seg.a} context={context} wash={wash} />
        ),
      )}
      {context === "editor" && <span className="cspike-caret" aria-hidden />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GalleryCompletionSpike
// ---------------------------------------------------------------------------

export function GalleryCompletionSpike(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-completion-spike">
      <div className="cg-section">
        <TugLabel className="cg-section-title">Recessed atom + keycolor wash</TugLabel>
        <p className="cspike-note">
          The chosen direction: full-size live text in a bounded, recessed slot
          (soft inset shadow, no hard stroke) so the atom still reads as one
          indivisible unit but no longer breaks legibility. This pass tints the
          slot with a light wash of the theme's key colour. Hover a token to see
          it select as a unit; switch themes to confirm the wash tracks the key
          hue.
        </p>
      </div>

      <TugSeparator />

      {/* ---- Baseline (reference) ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Baseline — current chip (reference)</TugLabel>
        <p className="cspike-note">
          The genuine renderers, kept for contrast: hard stroke, 12px baked text
          in 14px prose.
        </p>
        <div className="cspike-ctx">
          <span className="cspike-ctx-label">Transcript</span>
          <SampleLine rep="pill" context="transcript" />
        </div>
        <div className="cspike-ctx">
          <span className="cspike-ctx-label">Prompt editor</span>
          <SampleLine rep="pill" context="editor" />
        </div>
      </div>

      <TugSeparator />

      {/* ---- Chosen treatment ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">{`C — recessed + keycolor wash (${DEFAULT_WASH})`}</TugLabel>
        <p className="cspike-note">
          Recessed slot, full prose size, with the light key wash. Reads as the
          same atom — just legible and theme-aware.
        </p>
        <div className="cspike-ctx">
          <span className="cspike-ctx-label">Transcript</span>
          <SampleLine rep="wash" context="transcript" wash={DEFAULT_WASH} />
        </div>
        <div className="cspike-ctx">
          <span className="cspike-ctx-label">Prompt editor</span>
          <SampleLine rep="wash" context="editor" wash={DEFAULT_WASH} />
        </div>
      </div>

      <TugSeparator />

      {/* ---- Wash strength ramp ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">Wash strength — tune "light"</TugLabel>
        <p className="cspike-note">
          The same transcript line at rising key-wash strength (0% is the neutral
          recessed slot). Pick the lightest level that still reads as
          theme-tinted rather than grey.
        </p>
        {WASH_RAMP.map((w) => (
          <div className="cspike-ctx" key={w}>
            <span className="cspike-ctx-label">{w === "0%" ? "0% (neutral)" : w}</span>
            <SampleLine rep="wash" context="transcript" wash={w} />
          </div>
        ))}
      </div>
    </div>
  );
}
