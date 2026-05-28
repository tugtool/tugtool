/**
 * `synthesize-user-message` — JSONL-honest substrate synthesis from
 * Anthropic-API-shaped content blocks.
 *
 * ## What this module does
 *
 * Both the live submit path (`code-session-store.send`) and the
 * JSONL replay path (`add_user_message` frame from tugcode) need to
 * produce a `(text, atoms)` substrate pair for the transcript user
 * row. Pre-Step-5c the live path inherited the editor's substrate
 * directly; the replay path cast wire-shape attachments as atoms.
 * The two halves drifted, and the cast was the visible-bug seam.
 *
 * Step 5c collapses both into one synthesizer. Given the same
 * `ContentBlock[]` array (which is what JSONL records verbatim and
 * what tugcode forwards live), this function produces:
 *
 *  - `text`: a substrate string with `U+FFFC` (object replacement)
 *    at every image-block position AND at every non-image atom
 *    mention recovered from a text block via
 *    {@link parseAtomMentionSegments}. Text-block contents otherwise
 *    copy verbatim; adjacent text blocks coalesce in the output
 *    (the walker accumulates between `U+FFFC` insertions).
 *  - `atoms`: one `AtomSegment` per image block, plus one per
 *    backtick-`@` mention span in any text block. Image atoms carry
 *    `label: "image-N"` (1-based per-message image counter) and an
 *    `id` resolved via `options.atomIdAt` (live path) or minted
 *    fresh (replay path). Mention atoms default to `type: "file"`
 *    (the wire marker doesn't preserve the original atom type) and
 *    carry the mention's value as both label and value.
 *  - `thumbnailBake`: a promise that resolves when all newly-fired
 *    thumbnail bakes have settled. Production callers fire-and-forget;
 *    tests can await for deterministic ordering.
 *
 * The bytes-store side-effect is the documented seam: for each image
 * block, the synthesizer ensures the bytes-store has an entry at the
 * resolved id with `content` + `mediaType` matching the block's
 * source. When the existing entry already carries
 * `thumbnailDataUrl`, no bake is fired — preserving the drop-time
 * downsample's thumbnail across the submit boundary. When no
 * thumbnail exists, the synthesizer fires `bakeImage` and updates
 * the entry with the result.
 *
 * ## Determinism caveat
 *
 * The (text, atoms-without-id) output is deterministic on the
 * inputs. Atom ids are deterministic IFF `options.atomIdAt` is
 * provided (live path); without it (replay path), fresh UUIDs are
 * minted on each call. The bytes-store puts are idempotent on
 * identical inputs given identical resolvers.
 *
 * ## Submit boundary
 *
 * On the live path, the editor's pre-submit substrate carries
 * user-friendly labels (`raphael.jpeg`, `src/main.ts`); the
 * synthesized substrate has `image-N` labels. Render-time
 * decoration in `tug-atom-text-body.tsx` further composes
 * `#NNNN-image-N` from the transcript message number. The boundary
 * is intentional: editor = drafting surface, transcript =
 * JSONL-honest committed view (see [Step 5c — submit boundary]
 * (roadmap/dev-atoms.md#step-5c-submit-boundary)).
 *
 * Laws:
 *  - [L02] external state — the bytes-store mutation is documented
 *    and contained to this seam; the reducer's purity is preserved
 *    because the synthesizer runs in the impure wrapper layer.
 *  - [L19] file structure / docstring discipline.
 *
 * References:
 *  - [Step 5c](roadmap/dev-atoms.md#step-5c)
 *  - [Spec S03](roadmap/dev-atoms.md#s03-build-wire-payload) (revised)
 */

import type { ContentBlock } from "@/protocol";
import type { AtomBytesEntry, AtomBytesStore } from "./atom-bytes-store";
import { TUG_ATOM_CHAR, type AtomSegment } from "./tug-atom-img";
import { bakeThumbnail } from "./image-downsample";
import { parseAtomMentionSegments } from "./atom-mention-marker";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Optional knobs for {@link synthesizeUserMessageFromBlocks}. All
 * default to production behaviour; tests inject deterministic
 * versions.
 */
export interface SynthesizeOptions {
  /**
   * Live-path resolver: given the 0-based index of an image block
   * (counting only image blocks in the input), return the atom id to
   * reuse for that block. Returning `undefined` (or omitting the
   * resolver entirely) falls through to {@link mintAtomId}.
   *
   * Live path supplies a resolver mapping image-block index → the
   * editor's original atom id (via `buildWirePayload`'s `atomIdAt`
   * closure). The bytes-store puts overwrite the drop / paste
   * entries idempotently — same id, same bytes, same mediaType.
   *
   * Replay path omits the resolver; ids are minted fresh.
   */
  atomIdAt?: (imageBlockIndex: number) => string | undefined;
  /**
   * UUID minter for atoms that didn't resolve via {@link atomIdAt}.
   * Defaults to `crypto.randomUUID()` (with a string fallback for
   * runtimes without it). Tests pass a deterministic counter.
   */
  mintAtomId?: () => string;
  /**
   * Thumbnail baker. Takes the image block's base64 + mediaType and
   * returns a `data:image/...;base64,...` URL (or `null` on bake
   * failure). Defaults to the Web-Worker-backed `bakeThumbnail`
   * (via a base64→Blob converter). Tests pass a stub returning a
   * fixed string so the production canvas pipeline isn't required.
   */
  bakeImage?: (data: string, mediaType: string) => Promise<string | null>;
}

/**
 * Output of {@link synthesizeUserMessageFromBlocks}. `text` + `atoms`
 * land on the `UserMessage` substrate; `thumbnailBake` is the
 * fire-and-forget handle production callers ignore and tests await.
 */
export interface SynthesizeResult {
  text: string;
  atoms: AtomSegment[];
  /**
   * Resolves when every newly-fired thumbnail bake has settled (the
   * matching bytes-store entry has either been updated with
   * `thumbnailDataUrl` or the bake failed and the entry was left as
   * was). Resolves immediately when no bakes were needed (every
   * image block's bytes-store entry already had a thumbnail — the
   * pure-live case where drop / paste populated everything).
   */
  thumbnailBake: Promise<void>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultMintAtomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `atom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function base64ToBlob(data: string, mediaType: string): Blob {
  // `atob` is available in browsers + bun. Decodes base64 → binary
  // string; we then copy into a Uint8Array for the Blob constructor.
  // Errors here surface as a `bake-failed` outcome upstream because
  // the bake's catch wraps to `null`.
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes as unknown as BlobPart], { type: mediaType });
}

async function defaultBakeImage(
  data: string,
  mediaType: string,
): Promise<string | null> {
  try {
    const blob = base64ToBlob(data, mediaType);
    return await bakeThumbnail(blob);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

/**
 * Walk `blocks` and produce a `(text, atoms)` substrate. See module
 * docstring for the full contract.
 */
export function synthesizeUserMessageFromBlocks(
  blocks: ReadonlyArray<ContentBlock>,
  bytesStore: AtomBytesStore,
  options?: SynthesizeOptions,
): SynthesizeResult {
  const mintAtomId = options?.mintAtomId ?? defaultMintAtomId;
  const bakeImage = options?.bakeImage ?? defaultBakeImage;
  const atomIdAt = options?.atomIdAt;

  let textBuf = "";
  const atoms: AtomSegment[] = [];
  const bakes: Array<Promise<void>> = [];
  let imageBlockIndex = 0;

  for (const block of blocks) {
    if (block.type === "text") {
      // Parse backtick-`@` mention markers out of the wire text and
      // re-mint chips at the original positions. The submit-side
      // `buildWirePayload` wraps non-image atom values as
      // `` `@<value>` ``; the parser inverts the wrap. Plain text
      // between (or surrounding) mentions concatenates verbatim. See
      // `atom-mention-marker.ts` for the marker rationale + parse
      // contract.
      for (const seg of parseAtomMentionSegments(block.text)) {
        if (seg.kind === "text") {
          textBuf += seg.text;
          continue;
        }
        // Mention atom — the original `type` (file / doc / link /
        // command) is not preserved on the wire; we default to
        // `"file"` since that's the overwhelmingly common case for
        // `@`-mention completions and the chip's icon falls back
        // gracefully if the value is actually a URL or command.
        textBuf += TUG_ATOM_CHAR;
        atoms.push({
          kind: "atom",
          type: "file",
          label: seg.value,
          value: seg.value,
        });
      }
      continue;
    }
    if (block.type === "image") {
      const idx = imageBlockIndex;
      imageBlockIndex += 1;
      const labelN = idx + 1;
      const label = `image-${labelN}`;
      const resolvedId = atomIdAt?.(idx);
      const id = resolvedId ?? mintAtomId();
      // Merge with any existing entry's thumbnail so the live path
      // (where drop / paste already populated thumbnailDataUrl)
      // doesn't lose it on the synthesizer's idempotent put.
      const existing = bytesStore.get(id);
      const entry: AtomBytesEntry = {
        content: block.source.data,
        mediaType: block.source.media_type,
      };
      if (existing?.thumbnailDataUrl !== undefined) {
        entry.thumbnailDataUrl = existing.thumbnailDataUrl;
      }
      bytesStore.put(id, entry);
      if (entry.thumbnailDataUrl === undefined) {
        // No prior thumbnail — fire the bake. Resolves with the
        // updated entry once the worker returns; settles even on
        // bake failure (the entry stays without a thumbnail; Step 6's
        // strip renderer falls back to a placeholder tile).
        const bake = bakeImage(block.source.data, block.source.media_type).then(
          (url) => {
            if (url === null) return;
            // Re-read in case the entry has shifted (rare; defensive
            // against concurrent puts) — preserve current `content` /
            // `mediaType` rather than re-stamping with stale values.
            const cur = bytesStore.get(id);
            if (cur === null) return;
            bytesStore.put(id, { ...cur, thumbnailDataUrl: url });
          },
          () => {
            // Bake threw — the bytes-store entry stays as-is; the
            // strip renderer will see no thumbnail and fall back.
          },
        );
        bakes.push(bake);
      }
      textBuf += TUG_ATOM_CHAR;
      atoms.push({
        kind: "atom",
        type: "image",
        label,
        value: label,
        id,
      });
    }
  }

  const thumbnailBake: Promise<void> =
    bakes.length === 0
      ? Promise.resolve()
      : Promise.allSettled(bakes).then(() => undefined);

  return { text: textBuf, atoms, thumbnailBake };
}
