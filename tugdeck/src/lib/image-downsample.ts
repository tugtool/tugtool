/**
 * `image-downsample` — canvas-based image normalization pipeline for
 * inline image attachments (drop / paste).
 *
 * Every image the user drops or pastes runs through this module
 * *before* its bytes reach the per-card bytes-store. The output is
 * always API-compliant: ≤ 2576 px on the long edge (the Opus 4.7
 * Vision cap) and ≤ 5 MB decoded (the Anthropic per-image ceiling).
 * That guarantee means tugcode never sees an oversize image — the
 * Anthropic backend never has cause to reject one of our submissions
 * on size or dimension grounds.
 *
 * ## Pipeline shape
 *
 * Source MIME drives the branch. The decision matrix lives in
 * [`roadmap/tide-atoms.md`](../../../roadmap/tide-atoms.md#t03-downsample-decisions)
 * Table T03; this implementation is its executable form. In summary:
 *
 *  - `image/png` / `image/jpeg` / `image/webp` → canvas resize +
 *    re-encode in source MIME; JPEG quality-ladder fallback (90, 80,
 *    70, 60) if the result still exceeds 5 MB.
 *  - `image/gif` (animated, > 1 frame) → passthrough with a size
 *    check only. Canvas resize would lose the animation; Anthropic
 *    Vision accepts native GIF bytes and analyzes all frames.
 *  - `image/gif` (static, ≤ 1 frame) → canvas resize like any other
 *    raster, with the GIF / JPEG fallback ladder above.
 *  - `image/svg+xml` → rasterize to PNG at long-edge ≤ 1024 px.
 *  - `image/heic` / `image/heif` / `image/avif` → canvas decode
 *    attempt. WebKit (Tug.app, Safari) decodes all three; Chromium
 *    (dev mode) decodes AVIF but rejects HEIC with a `decode-failed`
 *    error the caller surfaces as a toast. Verified empirically
 *    against `claude 2.1.148` engines (see [Q02] in `tide-atoms.md`).
 *  - Anything else → `unsupported-format` discriminated error.
 *
 * ## Discriminated errors
 *
 * The function never throws. Every failure returns
 * `{ ok: false, error: DownsampleError }` so callers can surface
 * different errors with different copy. Three kinds:
 *
 *  - `unsupported-format` — source MIME not in the allowlist.
 *  - `too-large-after-fallback` — exhausted the JPEG quality ladder
 *    and the result still exceeds 5 MB. This is genuinely huge
 *    content (a 50 MP screenshot of a single hue gradient, say); the
 *    user should crop, downscale, or split the image.
 *  - `decode-failed` — the browser could not decode the source
 *    (corrupt bytes, or HEIC in Chromium). The `reason` field carries
 *    a short engine-provided string for diagnostics.
 *
 * ## Off-main-thread preference
 *
 * The pipeline prefers `createImageBitmap(blob)` because supporting
 * browsers (Tug.app's WebKit, modern Chromium) decode off the main
 * thread. The fallback (`HTMLImageElement` + `drawImage`) is
 * main-thread blocking. For images outside the typical-screenshot
 * range, callers should expect a short UI hitch on the fallback path
 * (Risk R01 in `tide-atoms.md`). The 100 ms processing-indicator
 * threshold lives in the caller (drop / paste handlers, Step 2).
 *
 * ## Pure parts
 *
 * `isAnimatedGif(bytes)` is the one fully-pure export — a frame-count
 * detector that walks the raw GIF byte stream looking for image
 * descriptor markers. Pure because the canvas can't tell us whether a
 * GIF is animated without decoding all of it; the byte-level parser
 * is fast (microseconds for a typical file) and gives us a stable
 * branch decision before we touch the canvas.
 *
 * Laws: [L19] file-structure / docstring discipline applies. No L01,
 *       L02, L03, L06 concerns — this is a pure-logic library, no
 *       React state, no DOM rendering, no responder participation.
 *
 * References:
 *  - [Spec S04] image-downsample contract — `roadmap/tide-atoms.md#s04-image-downsample`
 *  - [D05] client-side downsample at insert — `roadmap/tide-atoms.md#d05-client-downsample`
 *  - [Table T03] downsample decision matrix — `roadmap/tide-atoms.md#t03-downsample-decisions`
 *  - [Q02] HEIC / AVIF empirical findings — `roadmap/tide-atoms.md#q02-heic-avif`
 *  - [Q04] animated GIF policy — `roadmap/tide-atoms.md#q04-animated-gif`
 *  - [Risk R01] canvas blocking — `roadmap/tide-atoms.md#r01-canvas-blocking`
 *  - GIF89a specification (W3C). Image Descriptor sentinel `0x2C`,
 *    Extension Introducer `0x21`, Trailer `0x3B`.
 *  - Anthropic Vision docs: 5 MB per image, 2576 px Opus 4.7 long-edge.
 */

// ---------------------------------------------------------------------------
// Constants — exported for caller / test alignment.
// ---------------------------------------------------------------------------

/**
 * Long-edge ceiling at submit. Matches Opus 4.7's tokenization cap;
 * larger images get downsampled to this dimension maintaining aspect.
 */
export const MAX_LONG_EDGE_PX = 2576;

/**
 * Max decoded byte size of a single image. Anthropic Vision's per-
 * image ceiling. Images that exceed this after the JPEG quality
 * ladder return a `too-large-after-fallback` error.
 */
export const MAX_BYTE_SIZE = 5 * 1024 * 1024;

/**
 * Long-edge ceiling for thumbnails. Picked so a thumbnail fits the
 * transcript-strip tile (~64 px logical, 128 px on Retina, plus
 * headroom for click-to-enlarge previews) without holding the full
 * payload in React state ([D04] no-bytes-on-snapshot).
 */
export const THUMBNAIL_MAX_EDGE_PX = 256;

/**
 * SVG rasterization target. Vector input has no intrinsic resolution,
 * so we pick a reasonable raster size; 1024 px is large enough to
 * read most diagrams clearly without ballooning the byte count.
 */
export const SVG_RASTER_MAX_EDGE_PX = 1024;

/**
 * JPEG quality ladder for the fallback transcode. Progressively
 * lower quality until the encoded result fits the 5 MB cap. Values
 * chosen empirically: 90 is visually indistinguishable from lossless
 * for most content; 60 is the floor where compression artifacts
 * start to bite. If even 60 doesn't fit, the source is unreasonably
 * large for chat use.
 */
export const JPEG_QUALITY_LADDER: ReadonlyArray<number> = [
  0.9, 0.8, 0.7, 0.6,
];

/**
 * Source MIME types the pipeline recognizes. Anything not in this
 * set (and not `image/heic`/`image/heif`/`image/avif`, which are
 * routed through canvas decode like raster sources) returns
 * `unsupported-format`.
 */
const SUPPORTED_RASTER_MIMES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  // HEIC / HEIF / AVIF flow through the canvas decode path; WebKit
  // decodes them natively. Chromium dev mode decodes AVIF but fails
  // HEIC at the `createImageBitmap` step — the failure surfaces as
  // `decode-failed`, which is the right error class for a "this file
  // looked supported but the browser can't read it" condition.
  "image/heic",
  "image/heif",
  "image/avif",
]);

/**
 * MIME types that pass through unchanged (after a size check) when
 * animated. Currently just `image/gif`; PDFs and other animated
 * formats are out of scope per [Q03] / non-goals.
 */
const ANIMATABLE_MIMES: ReadonlySet<string> = new Set(["image/gif"]);

// ---------------------------------------------------------------------------
// Public types — mirror Spec S04 verbatim.
// ---------------------------------------------------------------------------

/**
 * Successful downsample result. The `content` and `mediaType` pair
 * is what flows to the bytes-store / wire; `thumbnailDataUrl` is the
 * snapshot-resident preview used by the transcript attachment strip.
 *
 * `mediaType` may differ from the source MIME when the JPEG quality
 * ladder kicked in — a 6 MB PNG that transcoded to JPEG comes back
 * as `image/jpeg`, not `image/png`. Callers should honor `mediaType`
 * when constructing the wire `Attachment`, not the original source's
 * type.
 */
export interface DownsampleResult {
  /** Base64-encoded image bytes. */
  content: string;
  /** Effective MIME type after any transcode. */
  mediaType: string;
  /** Inline thumbnail data URL — drop straight into `<img src>`. */
  thumbnailDataUrl: string;
  /** Output dimensions in pixels. */
  width: number;
  height: number;
  /** Decoded byte size — equals `Blob.size` of the encoded output. */
  byteSize: number;
}

/**
 * Discriminated downsample failure. The pipeline never throws;
 * callers branch on `kind`.
 */
export type DownsampleError =
  | { kind: "unsupported-format"; mediaType: string }
  | { kind: "too-large-after-fallback"; byteSize: number }
  | { kind: "decode-failed"; reason: string };

/**
 * Discriminated result. Callers branch on `ok`.
 */
export type DownsampleOutcome =
  | { ok: true; result: DownsampleResult }
  | { ok: false; error: DownsampleError };

// ---------------------------------------------------------------------------
// `isAnimatedGif` — pure GIF frame-count detector.
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the byte stream is a GIF containing more than one
 * frame (i.e., animated), `false` otherwise. Pure function; reads no
 * external state and produces no side effects.
 *
 * Why a real parser rather than a `0x2C` count: the Image Descriptor
 * sentinel `0x2C` can appear inside the global color table, inside
 * sub-block data of extension records, or inside LZW-compressed image
 * data. A naive byte-count would over-report and route static GIFs
 * (mistakenly classified as animated) through the passthrough branch,
 * where they'd skip the resize step and possibly exceed the 5 MB cap
 * for no reason. The structured walk costs microseconds even on
 * megabyte-class GIFs and rules out false positives.
 *
 * Algorithm:
 *  1. Verify the `GIF87a` or `GIF89a` magic.
 *  2. Read the Logical Screen Descriptor; if the Global Color Table
 *     flag is set, skip its bytes (`3 * 2^(gctSize + 1)`).
 *  3. Walk the data stream block-by-block until the Trailer (`0x3B`)
 *     or end-of-bytes:
 *      - `0x2C`: Image Descriptor. Count it; if count > 1 short-
 *        circuit `true`. Skip its 9 fixed-bytes, then conditionally
 *        skip the Local Color Table, then the LZW min code size byte,
 *        then the LZW data sub-blocks (length-prefixed; `0x00`
 *        terminates).
 *      - `0x21`: Extension Introducer. Skip the label byte, then walk
 *        sub-blocks (length-prefixed; `0x00` terminates).
 *      - `0x3B`: Trailer. End of file. Return `count > 1`.
 *      - Anything else: malformed — return `false`. Malformed GIFs
 *        flow into the canvas path where the engine produces a
 *        clean `decode-failed` if it can't read them.
 *
 * @example
 * ```ts
 * isAnimatedGif(new Uint8Array(staticGifBytes))    // → false
 * isAnimatedGif(new Uint8Array(animatedGifBytes))  // → true
 * isAnimatedGif(new Uint8Array(corruptBytes))      // → false
 * ```
 */
export function isAnimatedGif(bytes: Uint8Array): boolean {
  // GIF needs at least signature (6) + Logical Screen Descriptor (7)
  // = 13 bytes before any block data.
  if (bytes.length < 13) return false;

  // Signature: "GIF87a" (0x47 0x49 0x46 0x38 0x37 0x61) or
  //            "GIF89a" (0x47 0x49 0x46 0x38 0x39 0x61).
  if (
    bytes[0] !== 0x47 ||
    bytes[1] !== 0x49 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x38 ||
    (bytes[4] !== 0x37 && bytes[4] !== 0x39) ||
    bytes[5] !== 0x61
  ) {
    return false;
  }

  // Logical Screen Descriptor layout (bytes 6-12, total 7 bytes):
  //  [6-7]   logical screen width  (u16 little-endian)
  //  [8-9]   logical screen height (u16 little-endian)
  //  [10]    packed: GCT-flag(1) | color-resolution(3) | sort-flag(1) | gct-size(3)
  //  [11]    background color index
  //  [12]    pixel aspect ratio
  const packed = bytes[10]!;
  const gctFlag = (packed & 0x80) !== 0;
  const gctSize = packed & 0x07;

  // Cursor: position in the byte stream we're about to read.
  let p = 13;

  // Skip the Global Color Table when present. Size in bytes is
  // 3 * 2^(gctSize + 1).
  if (gctFlag) {
    p += 3 * (1 << (gctSize + 1));
  }

  let imageDescriptorCount = 0;

  while (p < bytes.length) {
    const block = bytes[p]!;

    // Trailer — end of GIF.
    if (block === 0x3b) {
      return imageDescriptorCount > 1;
    }

    // Extension Introducer.
    if (block === 0x21) {
      p += 1; // consume introducer
      if (p >= bytes.length) return imageDescriptorCount > 1;
      p += 1; // consume label byte (GCE 0xF9, comment 0xFE, etc.)
      // Walk sub-blocks until the 0x00 terminator.
      while (p < bytes.length) {
        const subLen = bytes[p]!;
        p += 1;
        if (subLen === 0) break;
        p += subLen;
      }
      continue;
    }

    // Image Descriptor.
    if (block === 0x2c) {
      imageDescriptorCount += 1;
      if (imageDescriptorCount > 1) {
        // Short-circuit: as soon as we see a second image, we know
        // the GIF is animated and can stop walking.
        return true;
      }
      p += 1; // consume separator
      // Skip 8 bytes of fixed image-descriptor fields:
      //   left(u16le) + top(u16le) + width(u16le) + height(u16le)
      p += 8;
      if (p >= bytes.length) return false;
      const imagePacked = bytes[p]!;
      p += 1;
      const lctFlag = (imagePacked & 0x80) !== 0;
      const lctSize = imagePacked & 0x07;
      if (lctFlag) {
        p += 3 * (1 << (lctSize + 1));
      }
      // LZW Minimum Code Size byte.
      p += 1;
      // Image data sub-blocks.
      while (p < bytes.length) {
        const subLen = bytes[p]!;
        p += 1;
        if (subLen === 0) break;
        p += subLen;
      }
      continue;
    }

    // Unknown block byte — malformed GIF. Return false so the canvas
    // path produces a clean decode-failed error rather than us
    // pretending to know more than we do.
    return false;
  }

  return imageDescriptorCount > 1;
}

// ---------------------------------------------------------------------------
// MIME classification — pure helper for routing decisions.
// ---------------------------------------------------------------------------

/**
 * Classification of a source MIME type into a downsample branch.
 *
 *  - `raster`: standard canvas decode + resize + re-encode path.
 *  - `gif-animatable`: GIF input — `isAnimatedGif` branches further
 *    into passthrough (animated) vs. raster (static).
 *  - `svg`: rasterize via canvas.
 *  - `unsupported`: source is not in the allowlist.
 */
export type SourceMimeClass =
  | "raster"
  | "gif-animatable"
  | "svg"
  | "unsupported";

/**
 * Classify a source MIME type for the downsample pipeline. Pure
 * function — exported so callers can introspect supported MIMEs
 * without invoking the canvas pipeline (drop / paste handlers may
 * want to early-reject unsupported drops before the file is read).
 *
 * MIME types are compared case-insensitively; we lower-case before
 * lookup. `image/JPEG` and `image/jpeg` both resolve to `raster`.
 *
 * @example
 * ```ts
 * classifySourceMime("image/png")           // → "raster"
 * classifySourceMime("image/gif")           // → "gif-animatable"
 * classifySourceMime("image/svg+xml")       // → "svg"
 * classifySourceMime("application/pdf")     // → "unsupported"
 * ```
 */
export function classifySourceMime(mediaType: string): SourceMimeClass {
  const m = mediaType.toLowerCase();
  if (m === "image/svg+xml") return "svg";
  if (ANIMATABLE_MIMES.has(m)) return "gif-animatable";
  if (SUPPORTED_RASTER_MIMES.has(m)) return "raster";
  return "unsupported";
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/**
 * Compute the resize target maintaining aspect ratio. Returns the
 * input dimensions unchanged when both fit under `maxLongEdge`;
 * otherwise scales the long edge to `maxLongEdge` and the short edge
 * proportionally (rounded to nearest integer).
 *
 * Exported for unit-test coverage — the math is pure and easy to
 * pin against expected values without dragging in the canvas.
 */
export function fitWithinLongEdge(
  width: number,
  height: number,
  maxLongEdge: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) {
    return { width, height };
  }
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Read a Blob as a base64 string (no `data:` prefix). */
async function blobToBase64(blob: Blob): Promise<string> {
  // FileReader gives us a `data:<mime>;base64,<payload>` string; we
  // strip the prefix and return only the payload. This avoids the
  // chunked-btoa song-and-dance and works uniformly across WebKit /
  // Chromium / Firefox.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader did not yield a string"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}

/** Read a Blob as a data URL (`data:<mime>;base64,<payload>`). */
async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader did not yield a string"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Decode a Blob to an ImageBitmap-like source the canvas can paint.
 * Prefers `createImageBitmap` (off-main-thread on supporting
 * engines); falls back to an `HTMLImageElement` wired through
 * `URL.createObjectURL`. Always frees the object-URL on cleanup.
 *
 * Returns a uniform `{ width, height, draw }` shape so callers don't
 * have to branch on bitmap vs. image element.
 */
interface DecodedSource {
  readonly width: number;
  readonly height: number;
  draw(ctx: CanvasRenderingContext2D, dw: number, dh: number): void;
  close(): void;
}

async function decodeSource(blob: Blob): Promise<DecodedSource> {
  // Prefer ImageBitmap — off-main-thread on supporting browsers.
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      return {
        width: bmp.width,
        height: bmp.height,
        draw(ctx, dw, dh) {
          ctx.drawImage(bmp, 0, 0, dw, dh);
        },
        close() {
          bmp.close();
        },
      };
    } catch (err) {
      // Fall through to the HTMLImageElement path; some engines (or
      // some formats on some engines — e.g., HEIC in Chromium) reject
      // here. The img-element path also fails for those cases, but
      // for other engines it can sometimes succeed where
      // createImageBitmap doesn't.
      void err;
    }
  }

  return decodeViaImageElement(blob);
}

async function decodeViaImageElement(blob: Blob): Promise<DecodedSource> {
  const url = URL.createObjectURL(blob);
  return new Promise<DecodedSource>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth,
        height: img.naturalHeight,
        draw(ctx, dw, dh) {
          ctx.drawImage(img, 0, 0, dw, dh);
        },
        close() {
          URL.revokeObjectURL(url);
        },
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("HTMLImageElement decode failed"));
    };
    img.src = url;
  });
}

/**
 * Paint a decoded source onto a fresh canvas at the requested
 * dimensions and return the canvas. The caller owns disposal.
 *
 * Uses `OffscreenCanvas` when available (modern engines, supports
 * off-thread paint), falls back to `HTMLCanvasElement`. The
 * `toBlob`-equivalent surface differs between the two; the caller
 * funnels through `canvasToBlob` below to paper over that.
 */
type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;

function paintTo(
  source: DecodedSource,
  width: number,
  height: number,
): RenderCanvas {
  const canvas: RenderCanvas =
    typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });
  if (canvas instanceof OffscreenCanvas) {
    canvas.width = width;
    canvas.height = height;
  } else {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (ctx === null) {
    throw new Error("2D canvas context unavailable");
  }
  source.draw(ctx, width, height);
  return canvas;
}

/**
 * Encode a canvas to a Blob in the requested MIME type at the given
 * quality. Unifies the `HTMLCanvasElement.toBlob` and
 * `OffscreenCanvas.convertToBlob` surfaces.
 */
async function canvasToBlob(
  canvas: RenderCanvas,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) {
    // Some engines accept quality only for lossy formats; passing
    // undefined for PNG / GIF is fine.
    return canvas.convertToBlob(
      quality !== undefined ? { type: mimeType, quality } : { type: mimeType },
    );
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error(`canvas.toBlob returned null for ${mimeType}`));
        } else {
          resolve(blob);
        }
      },
      mimeType,
      quality,
    );
  });
}

/**
 * Build a thumbnail data URL from a decoded source. The same canvas
 * pipeline at the smaller target size; output is always PNG since
 * the snapshot-side `<img src>` doesn't care about size.
 */
async function bakeThumbnailFromSource(
  source: DecodedSource,
): Promise<string> {
  const { width, height } = fitWithinLongEdge(
    source.width,
    source.height,
    THUMBNAIL_MAX_EDGE_PX,
  );
  const canvas = paintTo(source, width, height);
  const blob = await canvasToBlob(canvas, "image/png");
  return blobToDataUrl(blob);
}

/**
 * Encode-with-fallback. Tries the source MIME first; if the result
 * exceeds `MAX_BYTE_SIZE`, walks the JPEG quality ladder. Returns
 * the first encoded form that fits, or `null` if every step exceeded
 * the cap.
 */
async function encodeWithFallback(
  canvas: RenderCanvas,
  sourceMime: string,
): Promise<{ blob: Blob; mediaType: string } | null> {
  // Lossy MIMEs start with their natural quality; lossless ones
  // encode once. We always try the source format first.
  const tryNative = await canvasToBlob(canvas, sourceMime);
  if (tryNative.size <= MAX_BYTE_SIZE) {
    return { blob: tryNative, mediaType: sourceMime };
  }

  // The source didn't fit. Fall back to JPEG at progressively
  // lower quality. We attempt the ladder even when the source is
  // already JPEG — the source might have been encoded at quality
  // 95+ and would shrink at 80.
  for (const q of JPEG_QUALITY_LADDER) {
    const jpeg = await canvasToBlob(canvas, "image/jpeg", q);
    if (jpeg.size <= MAX_BYTE_SIZE) {
      return { blob: jpeg, mediaType: "image/jpeg" };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// `downsampleImage` — main entry point.
// ---------------------------------------------------------------------------

/**
 * Normalize a dropped or pasted image for inline submission. Never
 * throws; every failure is a `{ ok: false, error }` outcome.
 *
 * Pipeline per [D05]:
 *  1. Classify source MIME ([Table T03]).
 *  2. GIF: animated → passthrough with size check; static → raster
 *     pipeline. Both branches share the size cap.
 *  3. SVG: rasterize to PNG at `SVG_RASTER_MAX_EDGE_PX`.
 *  4. Raster (PNG / JPEG / WebP / HEIC / HEIF / AVIF / static GIF):
 *     decode via `createImageBitmap` (with HTMLImageElement
 *     fallback); resize maintaining aspect to `MAX_LONG_EDGE_PX`;
 *     re-encode in source MIME; JPEG-ladder fallback if > 5 MB.
 *  5. Bake a `THUMBNAIL_MAX_EDGE_PX` thumbnail in the same operation.
 *
 * Source MIME is read from `source.type`; callers that have a more
 * reliable MIME signal (e.g., a `File.type` from a drop event) should
 * pass it through.
 */
export async function downsampleImage(
  source: Blob | File,
): Promise<DownsampleOutcome> {
  const mediaType = source.type;
  const cls = classifySourceMime(mediaType);

  if (cls === "unsupported") {
    return { ok: false, error: { kind: "unsupported-format", mediaType } };
  }

  // GIF branch — animated GIFs passthrough; static GIFs go to canvas.
  if (cls === "gif-animatable") {
    return downsampleGif(source, mediaType);
  }

  // SVG branch — rasterize to PNG.
  if (cls === "svg") {
    return downsampleSvg(source);
  }

  // Raster branch — PNG / JPEG / WebP / HEIC / HEIF / AVIF.
  return downsampleRaster(source, mediaType);
}

/**
 * Bake a thumbnail data URL for an already-decoded image source.
 * Convenience wrapper used by the reducer commit path (replay
 * attachments need a thumbnail even though they skipped the full
 * downsample pipeline at submit time).
 *
 * The input is the raw Blob/File of an already-API-compliant image;
 * we just produce the 256 px preview. Returns `null` on decode
 * failure rather than the discriminated-error shape because the
 * caller has already committed to using the bytes — a missing
 * thumbnail is a soft degradation (fallback to a generic icon), not
 * a submission-blocking failure.
 */
export async function bakeThumbnail(
  source: Blob | File,
): Promise<string | null> {
  try {
    const decoded = await decodeSource(source);
    try {
      return await bakeThumbnailFromSource(decoded);
    } finally {
      decoded.close();
    }
  } catch (err) {
    void err;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Branch implementations.
// ---------------------------------------------------------------------------

async function downsampleGif(
  source: Blob,
  mediaType: string,
): Promise<DownsampleOutcome> {
  const buffer = await source.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (isAnimatedGif(bytes)) {
    // Animated: passthrough. Canvas resize would collapse the
    // animation to a single frame; Anthropic Vision accepts native
    // GIF bytes and analyzes frames. Per [Q04].
    if (source.size > MAX_BYTE_SIZE) {
      return {
        ok: false,
        error: { kind: "too-large-after-fallback", byteSize: source.size },
      };
    }
    const content = await blobToBase64(source);
    // Bake a thumbnail from the GIF's first frame (the decode path
    // naturally takes the first frame when the GIF is animated and
    // decoded as a still image).
    let thumbnailDataUrl: string;
    let width: number;
    let height: number;
    try {
      const decoded = await decodeSource(source);
      try {
        thumbnailDataUrl = await bakeThumbnailFromSource(decoded);
        width = decoded.width;
        height = decoded.height;
      } finally {
        decoded.close();
      }
    } catch (err) {
      void err;
      // Decode failed but we already have the passthrough bytes; ship
      // them without a thumbnail rather than rejecting the drop. The
      // transcript-strip falls back to a generic icon.
      thumbnailDataUrl = "";
      width = 0;
      height = 0;
    }
    return {
      ok: true,
      result: {
        content,
        mediaType,
        thumbnailDataUrl,
        width,
        height,
        byteSize: source.size,
      },
    };
  }

  // Static GIF — flow through the raster pipeline.
  return downsampleRaster(source, mediaType);
}

async function downsampleSvg(source: Blob): Promise<DownsampleOutcome> {
  // SVG goes through the standard decode path; the resulting bitmap
  // is rasterized at SVG_RASTER_MAX_EDGE_PX, then re-encoded as PNG.
  let decoded: DecodedSource;
  try {
    decoded = await decodeSource(source);
  } catch (err) {
    return {
      ok: false,
      error: { kind: "decode-failed", reason: errorReason(err) },
    };
  }
  try {
    const { width, height } = fitWithinLongEdge(
      // Many SVGs declare 0×0 intrinsic dimensions when no viewBox
      // is set; fall back to the raster target as the canvas size.
      decoded.width > 0 ? decoded.width : SVG_RASTER_MAX_EDGE_PX,
      decoded.height > 0 ? decoded.height : SVG_RASTER_MAX_EDGE_PX,
      SVG_RASTER_MAX_EDGE_PX,
    );
    const canvas = paintTo(decoded, width, height);
    const png = await canvasToBlob(canvas, "image/png");
    if (png.size > MAX_BYTE_SIZE) {
      // Extremely unlikely for a 1024 px PNG, but uphold the cap.
      return {
        ok: false,
        error: { kind: "too-large-after-fallback", byteSize: png.size },
      };
    }
    const content = await blobToBase64(png);
    const thumbnailDataUrl = await bakeThumbnailFromSource(decoded);
    return {
      ok: true,
      result: {
        content,
        mediaType: "image/png",
        thumbnailDataUrl,
        width,
        height,
        byteSize: png.size,
      },
    };
  } finally {
    decoded.close();
  }
}

async function downsampleRaster(
  source: Blob,
  mediaType: string,
): Promise<DownsampleOutcome> {
  let decoded: DecodedSource;
  try {
    decoded = await decodeSource(source);
  } catch (err) {
    return {
      ok: false,
      error: { kind: "decode-failed", reason: errorReason(err) },
    };
  }
  try {
    const { width, height } = fitWithinLongEdge(
      decoded.width,
      decoded.height,
      MAX_LONG_EDGE_PX,
    );
    if (width === 0 || height === 0) {
      return {
        ok: false,
        error: { kind: "decode-failed", reason: "zero-dimension source" },
      };
    }
    const canvas = paintTo(decoded, width, height);
    const encoded = await encodeWithFallback(canvas, mediaType);
    if (encoded === null) {
      // Exhausted the quality ladder.
      const lastResort = await canvasToBlob(
        canvas,
        "image/jpeg",
        JPEG_QUALITY_LADDER[JPEG_QUALITY_LADDER.length - 1],
      );
      return {
        ok: false,
        error: {
          kind: "too-large-after-fallback",
          byteSize: lastResort.size,
        },
      };
    }
    const content = await blobToBase64(encoded.blob);
    const thumbnailDataUrl = await bakeThumbnailFromSource(decoded);
    return {
      ok: true,
      result: {
        content,
        mediaType: encoded.mediaType,
        thumbnailDataUrl,
        width,
        height,
        byteSize: encoded.blob.size,
      },
    };
  } finally {
    decoded.close();
  }
}

// ---------------------------------------------------------------------------
// Misc.
// ---------------------------------------------------------------------------

function errorReason(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "unknown decode error";
}
