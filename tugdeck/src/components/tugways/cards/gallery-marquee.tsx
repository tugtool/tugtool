/**
 * gallery-marquee.tsx -- TugMarquee gallery card.
 *
 * Shows TugMarquee with various text lengths, speeds, pause times, and icons.
 */

import React from "react";
import { Music, Radio, Disc3, FileText, Folder } from "lucide-react";
import { TugMarquee } from "@/components/tugways/tug-marquee";
import type { TugMarqueeSize } from "@/components/tugways/tug-marquee";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_SIZES: TugMarqueeSize[] = ["sm", "md", "lg"];

const SHORT_TEXT = "Short text — no scroll";
const MEDIUM_TEXT = "This is a medium-length label that will overflow in narrow containers";
const LONG_TEXT =
  "This is a very long label that demonstrates the marquee scrolling behavior — it keeps scrolling to reveal the full text, then pauses, then scrolls again";
const PATH_TEXT =
  "/Users/kocienda/Documents/Projects/tugways/src/components/tugways/cards/gallery-marquee.tsx";
const SONG_TEXT = "Aphex Twin — Selected Ambient Works 85-92 — Xtal (7:26)";

// ---------------------------------------------------------------------------
// GalleryMarquee
// ---------------------------------------------------------------------------

export function GalleryMarquee() {
  return (
    <div className="cg-content" data-testid="gallery-marquee">

      {/* ---- Short text (no animation) ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugMarquee — Short Text (No Scroll)</TugLabel>
        <TugLabel size="2xs" color="muted">Text fits within the container — stays static, no animation.</TugLabel>
        <div style={{ maxWidth: "360px" }}>
          <TugMarquee>{SHORT_TEXT}</TugMarquee>
        </div>
      </div>

      <TugSeparator />

      {/* ---- Overflowing text (default settings) ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugMarquee — Overflowing Text (Default: 30px/s, 2s pause)</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "280px" }}>
          <TugMarquee>{MEDIUM_TEXT}</TugMarquee>
          <TugMarquee>{LONG_TEXT}</TugMarquee>
        </div>
      </div>

      <TugSeparator />

      {/* ---- Size Variants ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugMarquee — Size Variants</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "280px" }}>
          {ALL_SIZES.map((size) => (
            <TugMarquee key={size} size={size}>
              {`Size ${size}: ${MEDIUM_TEXT}`}
            </TugMarquee>
          ))}
        </div>
      </div>

      <TugSeparator />

      {/* ---- Speed Variants ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugMarquee — Speed Variants</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "280px" }}>
          <div>
            <TugLabel size="2xs" color="muted">Slow (15 px/s):</TugLabel>
            <TugMarquee speed={15}>{LONG_TEXT}</TugMarquee>
          </div>
          <div>
            <TugLabel size="2xs" color="muted">Default (30 px/s):</TugLabel>
            <TugMarquee speed={30}>{LONG_TEXT}</TugMarquee>
          </div>
          <div>
            <TugLabel size="2xs" color="muted">Fast (60 px/s):</TugLabel>
            <TugMarquee speed={60}>{LONG_TEXT}</TugMarquee>
          </div>
        </div>
      </div>

      <TugSeparator />

      {/* ---- Pause Time Variants ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugMarquee — Pause Time Variants</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "280px" }}>
          <div>
            <TugLabel size="2xs" color="muted">Short pause (500ms):</TugLabel>
            <TugMarquee pauseTime={500}>{MEDIUM_TEXT}</TugMarquee>
          </div>
          <div>
            <TugLabel size="2xs" color="muted">Default pause (2000ms):</TugLabel>
            <TugMarquee pauseTime={2000}>{MEDIUM_TEXT}</TugMarquee>
          </div>
          <div>
            <TugLabel size="2xs" color="muted">Long pause (5000ms):</TugLabel>
            <TugMarquee pauseTime={5000}>{MEDIUM_TEXT}</TugMarquee>
          </div>
        </div>
      </div>

      <TugSeparator />

      {/* ---- With Icons ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugMarquee — With Icons</TugLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "280px" }}>
          <TugMarquee icon={<Music />} iconColor="var(--tug7-element-global-fill-normal-accent-rest)">
            {SONG_TEXT}
          </TugMarquee>
          <TugMarquee icon={<Radio />} iconColor="var(--tug7-element-field-fill-normal-success-rest)">
            {MEDIUM_TEXT}
          </TugMarquee>
          <TugMarquee icon={<Folder />}>
            {PATH_TEXT}
          </TugMarquee>
          <TugMarquee icon={<Disc3 />} iconColor="var(--tug7-element-global-fill-normal-accentCool-rest)">
            {SHORT_TEXT}
          </TugMarquee>
        </div>
      </div>

      <TugSeparator />

      {/* ---- Animation Disabled ---- */}
      <div className="cg-section">
        <TugLabel className="cg-section-title">TugMarquee — Animation Disabled</TugLabel>
        <TugLabel size="2xs" color="muted">animate=false — static with end ellipsis, even when text overflows.</TugLabel>
        <div style={{ maxWidth: "280px" }}>
          <TugMarquee animate={false} icon={<FileText />}>{LONG_TEXT}</TugMarquee>
        </div>
      </div>

    </div>
  );
}
