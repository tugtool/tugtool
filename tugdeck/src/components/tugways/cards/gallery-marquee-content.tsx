/**
 * gallery-marquee-content.tsx -- TugMarquee demo tab for the Component Gallery.
 *
 * Shows TugMarquee with various text lengths, speeds, pause times, and icons.
 *
 * Rules of Tugways compliance:
 *   - Marquee animation is CSS-lane (Rule 13 — continuous, infinite)
 *   - No React state drives appearance changes [D08, D09]
 *   - No root.render() after initial mount [D40, D42]
 *
 * @module components/tugways/cards/gallery-marquee-content
 */

import React from "react";
import { Music, Radio, Disc3, FileText, Folder } from "lucide-react";
import { TugMarquee } from "@/components/tugways/tug-marquee";
import type { TugMarqueeSize } from "@/components/tugways/tug-marquee";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_SIZES: TugMarqueeSize[] = ["sm", "md", "lg"];

const SHORT_TEXT = "Short text — no scroll";
const MEDIUM_TEXT = "This is a medium-length label that will overflow in narrow containers";
const LONG_TEXT =
  "This is a very long label that demonstrates the marquee scrolling behavior — it keeps scrolling to reveal the full text, then pauses, then scrolls again";
const PATH_TEXT =
  "/Users/kocienda/Documents/Projects/tugways/src/components/tugways/cards/gallery-marquee-content.tsx";
const SONG_TEXT = "Aphex Twin — Selected Ambient Works 85-92 — Xtal (7:26)";

// ---------------------------------------------------------------------------
// GalleryMarqueeContent
// ---------------------------------------------------------------------------

export function GalleryMarqueeContent() {
  return (
    <div className="cg-content" data-testid="gallery-marquee-content">

      {/* ---- Short text (no animation) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Short Text (No Scroll)</div>
        <p className="cg-description">
          Text fits within the container — stays static, no animation.
        </p>
        <div style={{ maxWidth: "360px" }}>
          <TugMarquee>{SHORT_TEXT}</TugMarquee>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Overflowing text (default settings) ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Overflowing Text (Default: 30px/s, 2s pause)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "280px" }}>
          <TugMarquee>{MEDIUM_TEXT}</TugMarquee>
          <TugMarquee>{LONG_TEXT}</TugMarquee>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Size Variants ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Size Variants</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "280px" }}>
          {ALL_SIZES.map((size) => (
            <TugMarquee key={size} size={size}>
              {`Size ${size}: ${MEDIUM_TEXT}`}
            </TugMarquee>
          ))}
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Speed Variants ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Speed Variants</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "280px" }}>
          <div>
            <p className="cg-description">Slow (15 px/s):</p>
            <TugMarquee speed={15}>{LONG_TEXT}</TugMarquee>
          </div>
          <div>
            <p className="cg-description">Default (30 px/s):</p>
            <TugMarquee speed={30}>{LONG_TEXT}</TugMarquee>
          </div>
          <div>
            <p className="cg-description">Fast (60 px/s):</p>
            <TugMarquee speed={60}>{LONG_TEXT}</TugMarquee>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Pause Time Variants ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Pause Time Variants</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "280px" }}>
          <div>
            <p className="cg-description">Short pause (500ms):</p>
            <TugMarquee pauseTime={500}>{MEDIUM_TEXT}</TugMarquee>
          </div>
          <div>
            <p className="cg-description">Default pause (2000ms):</p>
            <TugMarquee pauseTime={2000}>{MEDIUM_TEXT}</TugMarquee>
          </div>
          <div>
            <p className="cg-description">Long pause (5000ms):</p>
            <TugMarquee pauseTime={5000}>{MEDIUM_TEXT}</TugMarquee>
          </div>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- With Icons ---- */}
      <div className="cg-section">
        <div className="cg-section-title">With Icons</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxWidth: "280px" }}>
          <TugMarquee icon={<Music />} iconColor="var(--tug-base-accent-default)">
            {SONG_TEXT}
          </TugMarquee>
          <TugMarquee icon={<Radio />} iconColor="var(--tug-base-field-tone-success)">
            {MEDIUM_TEXT}
          </TugMarquee>
          <TugMarquee icon={<Folder />}>
            {PATH_TEXT}
          </TugMarquee>
          <TugMarquee icon={<Disc3 />} iconColor="var(--tug-base-accent-cool-default)">
            {SHORT_TEXT}
          </TugMarquee>
        </div>
      </div>

      <div className="cg-divider" />

      {/* ---- Animation Disabled ---- */}
      <div className="cg-section">
        <div className="cg-section-title">Animation Disabled</div>
        <p className="cg-description">
          <code>animate=false</code> — static with end ellipsis, even when text overflows.
        </p>
        <div style={{ maxWidth: "280px" }}>
          <TugMarquee animate={false} icon={<FileText />}>{LONG_TEXT}</TugMarquee>
        </div>
      </div>

    </div>
  );
}
