/**
 * png.ts — minimal PNG decoder for screenshot pixel assertions.
 *
 * Decodes the 8-bit, non-interlaced RGB / RGBA / greyscale PNGs that
 * `WKWebView.takeSnapshot` produces (the `app.screenshot()` verb) into a
 * flat RGBA buffer, so tests can assert on real rendered pixels — the
 * only ground truth for compositor-level bugs (e.g. an `<img>` whose
 * SVG document rasterized before its resources were ready). No
 * dependency: PNG is zlib-compressed filtered scanlines, and `node:zlib`
 * ships with Bun.
 *
 * Scope is deliberately narrow: bit depth 8, color types 0 (grey),
 * 2 (RGB), 4 (grey+alpha), 6 (RGBA), interlace 0. Anything else throws —
 * a snapshot format change should fail loudly, not decode garbage.
 */

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

/** Decoded image: `rgba` is `width * height * 4` bytes, row-major. */
export interface DecodedPng {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Bytes per pixel for each supported PNG color type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Decode a PNG file from disk into a flat RGBA buffer. */
export function decodePngFile(path: string): DecodedPng {
  return decodePng(readFileSync(path));
}

/** Decode an in-memory PNG into a flat RGBA buffer. */
export function decodePng(bytes: Uint8Array): DecodedPng {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("not a PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];

  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const dataStart = offset + 8;
    if (type === "IHDR") {
      width = view.getUint32(dataStart);
      height = view.getUint32(dataStart + 4);
      bitDepth = bytes[dataStart + 8]!;
      colorType = bytes[dataStart + 9]!;
      const interlace = bytes[dataStart + 12]!;
      if (bitDepth !== 8 || !(colorType in CHANNELS) || interlace !== 0) {
        throw new Error(
          `unsupported PNG (bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace})`,
        );
      }
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4; // skip data + CRC
  }
  if (width === 0 || height === 0) throw new Error("PNG missing IHDR");

  const compressed = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of idat) {
    compressed.set(chunk, at);
    at += chunk.length;
  }
  const raw = inflateSync(compressed);

  const channels = CHANNELS[colorType]!;
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);

  // Unfilter scanlines (filter types 0-4 per the PNG spec), then expand
  // each pixel to RGBA.
  const prior = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart]!;
    for (let x = 0; x < stride; x++) {
      const value = raw[rowStart + 1 + x]!;
      const left = x >= channels ? line[x - channels]! : 0;
      const up = prior[x]!;
      const upLeft = x >= channels ? prior[x - channels]! : 0;
      let recon: number;
      switch (filter) {
        case 0: recon = value; break;
        case 1: recon = value + left; break;
        case 2: recon = value + up; break;
        case 3: recon = value + ((left + up) >> 1); break;
        case 4: recon = value + paeth(left, up, upLeft); break;
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      line[x] = recon & 0xff;
    }
    for (let px = 0; px < width; px++) {
      const src = px * channels;
      const dst = (y * width + px) * 4;
      switch (colorType) {
        case 0:
          rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = line[src]!;
          rgba[dst + 3] = 255;
          break;
        case 2:
          rgba[dst] = line[src]!;
          rgba[dst + 1] = line[src + 1]!;
          rgba[dst + 2] = line[src + 2]!;
          rgba[dst + 3] = 255;
          break;
        case 4:
          rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = line[src]!;
          rgba[dst + 3] = line[src + 1]!;
          break;
        case 6:
          rgba[dst] = line[src]!;
          rgba[dst + 1] = line[src + 1]!;
          rgba[dst + 2] = line[src + 2]!;
          rgba[dst + 3] = line[src + 3]!;
          break;
      }
    }
    prior.set(line);
  }
  return { width, height, rgba };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}
