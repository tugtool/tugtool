/**
 * gallery-atom.tsx -- TugAtom demo tab for the Component Gallery.
 *
 * Shows TugAtom in all states (rest, hover, selected, highlighted, disabled),
 * all known types, dismissible mode with icon-to-X flip, click-to-select,
 * the DOM rendering path for engine integration, and label formatting options.
 *
 * @module components/tugways/cards/gallery-atom
 */

import React, { useRef, useLayoutEffect, useCallback, useState } from "react";
import {
  TugAtom,
  createAtomDOM,
  formatAtomLabel,
} from "@/components/tugways/tug-atom";
import type { AtomSegment, AtomLabelMode } from "@/components/tugways/tug-atom";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import "./gallery-atom.css";

// ---- Sample data ----

const SAMPLE_ATOMS: AtomSegment[] = [
  { kind: "atom", type: "file", label: "main.ts", value: "/Users/kocienda/project/src/main.ts" },
  { kind: "atom", type: "file", label: "feed-store.ts", value: "/Users/kocienda/project/src/lib/feed-store.ts" },
  { kind: "atom", type: "command", label: "/commit", value: "/commit" },
  { kind: "atom", type: "doc", label: "laws-of-tug.md", value: "/Users/kocienda/project/tuglaws/laws-of-tug.md" },
  { kind: "atom", type: "image", label: "screenshot.png", value: "/Users/kocienda/Desktop/screenshot.png" },
  { kind: "atom", type: "link", label: "anthropic.com", value: "https://www.anthropic.com/research" },
];

const LONG_PATH_ATOM: AtomSegment = {
  kind: "atom",
  type: "file",
  label: "very-long-component-name-that-should-truncate.tsx",
  value: "/Users/kocienda/project/src/components/tugways/cards/very-long-component-name-that-should-truncate.tsx",
};

const LABEL_MODE_CHOICES: TugChoiceItem[] = [
  { value: "filename", label: "Filename" },
  { value: "relative", label: "Relative" },
  { value: "absolute", label: "Absolute" },
];

// ---- Styles ----

const descStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginBottom: "4px",
};

const inlineWrapStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  alignItems: "center",
};

// ---- Gallery component ----

export function GalleryAtom() {
  const [labelMode, setLabelMode] = useState<AtomLabelMode>("filename");
  const domContainerRef = useRef<HTMLDivElement>(null);
  const [dismissLog, setDismissLog] = useState<string[]>([]);
  // Track which atom is selected by value (at most one at a time)
  const [selectedValue, setSelectedValue] = useState<string | null>(null);

  const handleDismiss = useCallback((label: string) => {
    setDismissLog(prev => [`Dismissed: ${label}`, ...prev].slice(0, 5));
  }, []);

  const handleSelect = useCallback((value: string) => {
    setSelectedValue(value);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedValue(null);
  }, []);

  // Render DOM-path atoms into a container via useLayoutEffect [L01, L06]
  useLayoutEffect(() => {
    const container = domContainerRef.current;
    if (!container) return;
    container.textContent = "";
    for (const seg of SAMPLE_ATOMS) {
      const el = createAtomDOM(seg);
      container.appendChild(el);
    }
  }, []);

  return (
    <div className="cg-content" data-testid="gallery-atom">

      {/* ---- All known types ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Atom Types</div>
        <div style={inlineWrapStyle}>
          {SAMPLE_ATOMS.map((seg) => (
            <TugAtom
              key={seg.value}
              type={seg.type}
              label={seg.label}
              value={seg.value}
            />
          ))}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- States: static examples + interactive click-to-select ---- */}
      <div className="cg-section">
        <div className="cg-section-title">States</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <div style={descStyle}>rest (default)</div>
            <TugAtom type="file" label="main.ts" value="/src/main.ts" />
          </div>
          <div>
            <div style={descStyle}>hover — try hovering the atom above (border intensifies)</div>
          </div>
          <div>
            <div style={descStyle}>selected (two-step delete highlight)</div>
            <TugAtom type="file" label="main.ts" value="/src/main.ts" selected />
          </div>
          <div>
            <div style={descStyle}>highlighted (search match / typeahead preview)</div>
            <TugAtom type="file" label="main.ts" value="/src/main.ts" highlighted />
          </div>
          <div>
            <div style={descStyle}>disabled (unavailable reference)</div>
            <TugAtom type="file" label="deleted-file.ts" value="/src/deleted-file.ts" disabled />
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Click to select ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Click to Select</div>
        <div style={descStyle}>Click any atom to select it. Clear button deselects.</div>
        <div style={{ ...inlineWrapStyle, marginBottom: "8px" }}>
          {SAMPLE_ATOMS.map((seg) => (
            <TugAtom
              key={seg.value}
              type={seg.type}
              label={seg.label}
              value={seg.value}
              selected={selectedValue === seg.value}
              onClick={() => handleSelect(seg.value)}
            />
          ))}
        </div>
        <div>
          <TugPushButton
            emphasis="outlined"
            role="action"
            size="sm"
            disabled={selectedValue === null}
            onClick={clearSelection}
          >
            Clear Selection
          </TugPushButton>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Dismissible (icon flips to X on hover) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Dismissible (hover to see X)</div>
        <div style={inlineWrapStyle}>
          {SAMPLE_ATOMS.map((seg) => (
            <TugAtom
              key={seg.value}
              type={seg.type}
              label={seg.label}
              value={seg.value}
              onDismiss={() => handleDismiss(seg.label)}
            />
          ))}
        </div>
        {dismissLog.length > 0 && (
          <div className="gallery-atom-log">
            {dismissLog.map((msg, i) => (
              <div key={i}>{msg}</div>
            ))}
          </div>
        )}
      </div>

      <div className="cg-divider" />

      {/* ---- Inline with text ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Inline with Text</div>
        <div className="gallery-atom-text-sample">
          Please review the changes in{" "}
          <TugAtom type="file" label="main.ts" value="/src/main.ts" />{" "}
          and run{" "}
          <TugAtom type="command" label="/commit" value="/commit" />{" "}
          when ready. See{" "}
          <TugAtom type="link" label="anthropic.com" value="https://www.anthropic.com" />{" "}
          for more details.
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Label truncation ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Truncation & Label Modes</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <div style={descStyle}>long filename — truncated with ellipsis, hover for tooltip</div>
            <TugAtom
              type={LONG_PATH_ATOM.type}
              label={LONG_PATH_ATOM.label}
              value={LONG_PATH_ATOM.value}
            />
          </div>
          <div>
            <div style={descStyle}>label mode — controls how file paths are displayed</div>
            <TugChoiceGroup
              items={LABEL_MODE_CHOICES}
              value={labelMode}
              onValueChange={(v) => setLabelMode(v as AtomLabelMode)}
              size="sm"
            />
            <div style={{ ...inlineWrapStyle, marginTop: "8px" }}>
              {SAMPLE_ATOMS.filter(s => s.type === "file" || s.type === "doc").map((seg) => (
                <TugAtom
                  key={`${seg.value}-${labelMode}`}
                  type={seg.type}
                  label={formatAtomLabel(seg.value, labelMode)}
                  value={seg.value}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- DOM rendering path ---- */}
      <div className="cg-section">
        <div className="cg-section-title">DOM Rendering Path (createAtomDOM)</div>
        <div style={descStyle}>
          These atoms are built imperatively via createAtomDOM() — the same path
          used by TugTextEngine's reconciler inside contentEditable.
        </div>
        <div ref={domContainerRef} style={inlineWrapStyle} />
      </div>

    </div>
  );
}
