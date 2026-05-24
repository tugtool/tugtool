/**
 * gallery-image-block.tsx — visual fixture for `ImageBlock`.
 *
 * Variants:
 *  1. **Standard image** — a public-domain image loads with the lazy
 *     placeholder; click opens the fullscreen overlay.
 *  2. **EXIF-rotated photo** — a photo whose EXIF orientation tag is
 *     non-default; `image-orientation: from-image` rotates it on
 *     paint.
 *  3. **Broken image** — bogus URL; the caption-style error row
 *     paints with the caution tone.
 *  4. **Fullscreen disabled** — same as variant 1 but
 *     `fullscreenDisabled={true}` (click is a no-op).
 *
 * @module components/tugways/cards/gallery-image-block
 */

import React from "react";

import { ImageBlock } from "@/components/tugways/body-kinds/image-block";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// Wikimedia restricts `thumb/.../{N}px-*` to a small whitelist of
// device-aware sizes (330, 510, 770, 1024, 1280, 1920, 2560, 3840 —
// see https://w.wiki/GHai). The older "any size you ask for" path
// was retired; arbitrary sizes return HTTP 400 with a body pointing
// at that whitelist. Picking 330 keeps the gallery card small.
const MONA_LISA_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Mona_Lisa.jpg/330px-Mona_Lisa.jpg";

const EARTH_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/330px-The_Earth_seen_from_Apollo_17.jpg";

const BROKEN_URL =
  "https://example.invalid/this-file-does-not-exist.png";

// ---------------------------------------------------------------------------
// GalleryImageBlock
// ---------------------------------------------------------------------------

export function GalleryImageBlock(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-image-block">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Image — lazy-load placeholder → loaded; click for fullscreen
        </TugLabel>
        <ImageBlock src={MONA_LISA_URL} alt="Mona Lisa" />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Image — EXIF orientation honored via `image-orientation: from-image`
        </TugLabel>
        <ImageBlock src={EARTH_URL} alt="The Earth (Apollo 17)" />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Image — broken URL (caution-toned caption row, no broken-image glyph)
        </TugLabel>
        <ImageBlock src={BROKEN_URL} alt="Intentionally missing image" />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          Image — fullscreen disabled (cursor stays default; no overlay on click)
        </TugLabel>
        <ImageBlock src={MONA_LISA_URL} alt="Mona Lisa (no zoom)" fullscreenDisabled />
      </div>
    </div>
  );
}
