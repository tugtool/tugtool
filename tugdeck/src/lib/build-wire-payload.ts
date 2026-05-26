/**
 * `build-wire-payload` — pure flattening of the substrate's
 * `(text, atoms)` pair into the wire-ready `(wireText, attachments)`
 * pair the `user_message` IPC frame carries.
 *
 * ## What this module does
 *
 * The substrate stores user input in two parallel halves: a string
 * with `U+FFFC` (object replacement character) placeholders at every
 * atom position, and a parallel `AtomSegment[]` whose entries carry
 * the chip data. The substrate keeps both halves because the
 * transcript chip renderer (Step 5) walks `text` looking for
 * `U+FFFC` and reads the corresponding atom — substituting in the
 * substrate would erase the chip-position information.
 *
 * The wire, by contrast, is plain text + Anthropic content blocks.
 * `U+FFFC` characters would reach claude as the OS's object-
 * replacement glyph (tofu); image bytes only land in claude's
 * context if they ride the `Attachment[]` slot. So at submit time
 * we flatten — substitute each `U+FFFC` with the corresponding
 * atom's `value`, pack image-atom bytes into Attachments — and ship
 * the flattened form on the wire.
 *
 * Per [D01](roadmap/tide-atoms.md#d01-ffc-substitution-at-submit)
 * and [D02](roadmap/tide-atoms.md#d02-image-attach-text-rest).
 *
 * ## Atom-to-wire mapping ([List L03](roadmap/tide-atoms.md#l03-atom-to-wire-mapping))
 *
 * The discriminator is **bytes in the store, not atom type**: any
 * atom whose `id` resolves to a bytes-store entry rides as an
 * Attachment (image bytes as base64, text content as raw text);
 * atoms without an id, or whose id is unknown to the store, ride
 * only as substituted text in `wireText`.
 *
 *  - `image` + id + bytes (drop / paste of an image) → Attachment
 *    (image bytes) + substituted text (filename / value).
 *  - `file` + id + bytes (drop of a `.md` / `.json` / source file
 *    from Finder) → Attachment (raw text content) + substituted
 *    text. tugcode's `buildContentBlocks` wraps the text content
 *    in a `text` content block.
 *  - `file` / `doc` (no id — `@`-completion of a workspace path) →
 *    substituted text only. The path goes verbatim into `wireText`;
 *    claude's `Read` tool fetches on demand per Test 24's finding.
 *  - `image` (no id; defensive) → substituted text only.
 *  - `link` → substituted text (the URL).
 *  - `command` → substituted text (the command name).
 *  - Any unknown atom type with id + bytes → Attachment;
 *    without → substituted text only.
 *
 * ## Invariants per [Spec S03](roadmap/tide-atoms.md#s03-build-wire-payload)
 *
 *  - **Pure.** The bytes-store is read-only here; mutations live in
 *    the drop / paste / commit paths. Same inputs always yield the
 *    same `(wireText, attachments)` pair.
 *  - **No `U+FFFC` in wireText when `atoms.length === count(U+FFFC, text)`.**
 *    The substrate maintains this invariant on every state mutation;
 *    we just walk in lockstep.
 *  - **Defensive on count mismatch.** If `atoms.length < count(U+FFFC, text)`,
 *    extra `U+FFFC` chars pass through. This is a visible regression
 *    on the assistant side rather than a crash — preferable to
 *    silently dropping characters or throwing inside the dispatch
 *    pipeline.
 *  - **Silent skip on missing bytes.** An image atom whose id is
 *    not in the store contributes only its substituted text. This
 *    handles the edge case of an atom dropped before the bytes
 *    finished encoding (impossible today since `processAttachmentFiles`
 *    awaits before inserting the atom, but defensive against future
 *    paths).
 *
 * ## Why this lives outside the reducer
 *
 * The reducer is pure with no side effects. The bytes-store IS
 * external state — looking up bytes by id is a side-effecting read
 * (the store's contents change over time). Doing the read here, in
 * the impure store wrapper (`CodeSessionStore.send`), keeps the
 * reducer pure: it receives the already-flattened wire fields on the
 * `SendActionEvent` and never has to touch the bytes-store.
 *
 * Laws: [L02] — bytes-store is external state, not React-observable
 *       (the substrate's atom array drives rendering, not the
 *       bytes-store's contents). [L07] — `code-session-store.send`
 *       reads the live store at the moment of dispatch.
 *       [L19] — file structure / docstring discipline.
 */

import type { Attachment } from "@/protocol";
import { TUG_ATOM_CHAR, type AtomSegment } from "./tug-atom-img";
import type { AtomBytesStore } from "./atom-bytes-store";

// ---------------------------------------------------------------------------
// Public type
// ---------------------------------------------------------------------------

/**
 * Flattened wire payload — what `code-session-store.send` builds
 * before dispatching the `SendActionEvent`.
 *
 *  - `wireText` is the text claude sees. No `U+FFFC` characters when
 *    the substrate's count invariant holds; raw atom labels / values
 *    are inlined at the positions where the chips used to live.
 *  - `attachments` is one entry per image atom with bytes in the
 *    store. Order matches the atoms' document order — the same
 *    order the chips render in. tugcode's `buildContentBlocks`
 *    consumes this verbatim.
 */
export interface WirePayload {
  wireText: string;
  attachments: Attachment[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Build the wire-ready `(wireText, attachments)` pair from the
 * substrate's `(text, atoms)` form.
 *
 * Walks `text` character-by-character, substituting each `U+FFFC` with
 * the corresponding atom's `value`, while accumulating image atoms'
 * Attachment records via lookups in `bytesStore`. Single pass, O(n)
 * in `text.length`.
 *
 * @example
 * ```ts
 * const text = "Look at ￼ and read ￼.";
 * const atoms: AtomSegment[] = [
 *   { kind: "atom", type: "image", label: "shot.png", value: "shot.png", id: "img-1" },
 *   { kind: "atom", type: "file", label: "README.md", value: "README.md" },
 * ];
 * const bytes = createAtomBytesStore();
 * bytes.put("img-1", { content: "iVBORw0…", mediaType: "image/png" });
 *
 * buildWirePayload(text, atoms, bytes);
 * // → {
 * //     wireText: "Look at shot.png and read README.md.",
 * //     attachments: [{ filename: "shot.png", content: "iVBORw0…", media_type: "image/png" }],
 * //   }
 * ```
 *
 * @example
 * ```ts
 * // Missing bytes — image atom contributes text only, no Attachment.
 * const text = "￼";
 * const atoms: AtomSegment[] = [
 *   { kind: "atom", type: "image", label: "missing.png", value: "missing.png", id: "img-x" },
 * ];
 * buildWirePayload(text, atoms, createAtomBytesStore());
 * // → { wireText: "missing.png", attachments: [] }
 * ```
 */
export function buildWirePayload(
  text: string,
  atoms: ReadonlyArray<AtomSegment>,
  bytesStore: AtomBytesStore,
): WirePayload {
  // Fast path: no atoms means no substitution and no attachments.
  // Any `U+FFFC` characters in the text are passed through verbatim
  // (defensive — should be impossible when atoms.length === 0 and
  // the substrate's invariant holds, but we don't reach for the
  // bytes-store on the empty path).
  if (atoms.length === 0) {
    return { wireText: text, attachments: [] };
  }

  let wireText = "";
  const attachments: Attachment[] = [];
  let atomIdx = 0;

  // Walk characters via `for…of` so surrogate pairs (emoji, rare
  // CJK) don't accidentally split a code point. `U+FFFC` is in the
  // Basic Multilingual Plane (a single 16-bit code unit), so the
  // visit count for that char is unchanged either way; but using
  // the code-point iterator is the safer pattern for future-proofing
  // against UTF-16 edge cases.
  for (const ch of text) {
    if (ch === TUG_ATOM_CHAR && atomIdx < atoms.length) {
      const atom = atoms[atomIdx]!;
      atomIdx += 1;
      wireText += atom.value;
      // Any atom with an id whose bytes are in the store contributes
      // an Attachment. Image atoms ship base64; text-file atoms ship
      // raw UTF-8 text. tugcode's `buildContentBlocks` dispatches on
      // `media_type` (image/* → `image` block; everything else →
      // `text` block) — the store's MIME drives that decision.
      //
      // Atoms without an id (file / doc atoms from `@`-completion;
      // link / command atoms; image atoms whose bytes were evicted)
      // contribute only the substituted text above.
      if (atom.id !== undefined) {
        const bytes = bytesStore.get(atom.id);
        if (bytes !== null) {
          attachments.push({
            filename: atom.label,
            content: bytes.content,
            media_type: bytes.mediaType,
          });
        }
      }
      continue;
    }
    // Defensive: a `U+FFFC` with no paired atom (atoms.length <
    // count(U+FFFC, text)) passes through verbatim. The substrate
    // maintains this invariant, but if it ever breaks we surface a
    // visible regression instead of crashing the submit pipeline.
    wireText += ch;
  }

  return { wireText, attachments };
}
