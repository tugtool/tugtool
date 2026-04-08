/**
 * gallery-atom.tsx -- Atom img demo tab for the Component Gallery.
 *
 * Shows atom <img> elements in all types, with label formatting,
 * truncation, dismiss affordance, and inline text flow.
 *
 * Atoms are rendered via createAtomImgElement from tug-atom-img.ts —
 * the same path used by TugTextEngine inside contentEditable.
 */

import React, { useRef, useLayoutEffect, useState } from "react";
import {
  createAtomImgElement,
  formatAtomLabel,
} from "@/lib/tug-atom-img";
import type { AtomSegment, AtomLabelMode } from "@/lib/tug-atom-img";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import "./gallery-atom.css";

// ---- Sample data ----

const SAMPLE_ATOMS: AtomSegment[] = [
  { kind: "atom", type: "file", label: "main.ts", value: "/Users/kocienda/project/src/main.ts" },
  { kind: "atom", type: "file", label: "feed-store.ts", value: "/Users/kocienda/project/src/lib/feed-store.ts" },
  { kind: "atom", type: "command", label: "/commit", value: "/commit" },
  { kind: "atom", type: "doc", label: "tuglaws.md", value: "/Users/kocienda/project/tuglaws/tuglaws.md" },
  { kind: "atom", type: "image", label: "screenshot.png", value: "/Users/kocienda/Desktop/screenshot.png" },
  { kind: "atom", type: "link", label: "anthropic.com", value: "https://www.anthropic.com/research" },
];

const LONG_LABEL_ATOMS: AtomSegment[] = [
  { kind: "atom", type: "file", label: "very-long-component-name-that-should-truncate.tsx", value: "very-long-component-name-that-should-truncate.tsx" },
  { kind: "atom", type: "doc", label: "architecture-decisions-and-design-patterns.md", value: "architecture-decisions-and-design-patterns.md" },
  { kind: "atom", type: "link", label: "https://www.anthropic.com/research/very/long/path/to/resource", value: "https://www.anthropic.com/research/very/long/path/to/resource" },
];

const LABEL_MODE_CHOICES: TugChoiceItem[] = [
  { value: "filename", label: "Filename" },
  { value: "relative", label: "Relative" },
  { value: "absolute", label: "Absolute" },
];

// ---- Helpers ----

/** Render atoms into a container element via direct DOM writes [L06]. */
function renderAtoms(
  container: HTMLElement,
  atoms: AtomSegment[],
  options?: Parameters<typeof createAtomImgElement>[3],
) {
  container.textContent = "";
  for (const seg of atoms) {
    const img = createAtomImgElement(seg.type, seg.label, seg.value, options);
    img.style.marginRight = "8px";
    img.style.marginBottom = "4px";
    container.appendChild(img);
  }
}

const descStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--tug7-element-field-text-normal-label-rest)",
  marginBottom: "4px",
};

// ---- Gallery component ----

export function GalleryAtom() {
  const typesRef = useRef<HTMLDivElement>(null);
  const truncRef = useRef<HTMLDivElement>(null);
  const inlineRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const [labelMode, setLabelMode] = useState<AtomLabelMode>("filename");

  // All types [L06]
  useLayoutEffect(() => {
    if (typesRef.current) renderAtoms(typesRef.current, SAMPLE_ATOMS);
  }, []);

  // Truncation [L06]
  useLayoutEffect(() => {
    if (truncRef.current) renderAtoms(truncRef.current, LONG_LABEL_ATOMS, { maxLabelWidth: 150 });
  }, []);

  // Inline with text [L06]
  useLayoutEffect(() => {
    const el = inlineRef.current;
    if (!el) return;
    el.textContent = "";
    const parts: Array<string | AtomSegment> = [
      "Please review the changes in ",
      { kind: "atom", type: "file", label: "main.ts", value: "/src/main.ts" },
      " and run ",
      { kind: "atom", type: "command", label: "/commit", value: "/commit" },
      " when ready. See ",
      { kind: "atom", type: "link", label: "anthropic.com", value: "https://www.anthropic.com" },
      " for more details.",
    ];
    for (const part of parts) {
      if (typeof part === "string") {
        el.appendChild(document.createTextNode(part));
      } else {
        el.appendChild(createAtomImgElement(part.type, part.label, part.value));
      }
    }
  }, []);

  // Label modes [L06]
  useLayoutEffect(() => {
    const el = labelRef.current;
    if (!el) return;
    el.textContent = "";
    const fileAtoms = SAMPLE_ATOMS.filter(s => s.type === "file" || s.type === "doc");
    for (const seg of fileAtoms) {
      const displayLabel = formatAtomLabel(seg.value, labelMode);
      const img = createAtomImgElement(seg.type, displayLabel, seg.value);
      img.style.marginRight = "8px";
      img.style.marginBottom = "4px";
      el.appendChild(img);
    }
  }, [labelMode]);

  return (
    <div className="cg-content" data-testid="gallery-atom">

      {/* ---- All known types ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Atom Types</div>
        <div ref={typesRef} className="gallery-atom-row" />
      </div>

      <div className="cg-divider" />

      {/* ---- Inline with text ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Inline with Text</div>
        <div ref={inlineRef} className="gallery-atom-text-sample" />
      </div>

      <div className="cg-divider" />

      {/* ---- Truncation ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Truncation</div>
        <div style={descStyle}>Labels truncated to 150px with ellipsis</div>
        <div ref={truncRef} className="gallery-atom-row" />
      </div>

      <div className="cg-divider" />

      {/* ---- Label modes ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Label Modes</div>
        <TugChoiceGroup
          items={LABEL_MODE_CHOICES}
          value={labelMode}
          onValueChange={(v) => setLabelMode(v as AtomLabelMode)}
          size="sm"
        />
        <div ref={labelRef} className="gallery-atom-row" style={{ marginTop: "8px" }} />
      </div>

    </div>
  );
}
