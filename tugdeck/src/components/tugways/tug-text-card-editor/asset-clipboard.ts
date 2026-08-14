/**
 * asset-clipboard — attachments travelling between a document and the prompt.
 *
 * Copy an image out of the prompt entry, paste it into a Text card, and you
 * should get a file beside the document and a markdown link to it. Copy that
 * link back out, paste it into the prompt, and you should get the image chip
 * again. That round trip is this module.
 *
 * ## The geometry
 *
 * The sidecar's atom schema is **positional** — one U+FFFC in `text` per entry
 * — and a markdown link is a **range** of literal text. The two attachment
 * classes therefore ride differently ([P04]):
 *
 *  - An **image** link is substituted with U+FFFC in the sidecar and carried as
 *    an ordinary image-atom entry with `assetPath`/`assetName` and no inline
 *    bytes. The prompt's existing `insertSidecar` then reconstitutes it as an
 *    image atom with no special casing at all.
 *  - A **non-image** link stays literal text and is recorded in the payload's
 *    `assets` range list. The prompt inserts it as markup untouched — there is
 *    no atom entry to place — which is how [P05] holds by construction.
 *
 * The `text/plain` flavor is always the literal markdown, so an external app
 * pastes exactly what the document says.
 *
 * ## Bytes come from the original, never from the downsample
 *
 * `AtomBytesEntry.content` is the *downsample* — the caps exist for API-payload
 * reasons and were never meant to be what lands on disk. Writing a file from
 * `content` would store a degraded copy that renders convincingly and is
 * invisible until somebody opens their original expecting it. Every write here
 * reads the original through `/api/fs/bytes`, from `assetPath` or `bytes.path`
 * — the bytes route rather than the blob route, because an attachment is any
 * file at all and blob serves only what a viewer card can render.
 *
 * @module components/tugways/tug-text-card-editor/asset-clipboard
 */

import type { EditorView } from "@codemirror/view";

import {
  encodeLinkDestination,
  parseAssetLinks,
  resolveAssetPath,
} from "@/lib/asset-links";
import {
  uploadDocAttachment,
  type AssetBaseDescriptor,
} from "@/lib/attachment-upload";
import { bytesUrl, classifyFileKind } from "@/lib/file-kinds";
import { TUG_ATOM_CHAR } from "@/lib/tug-atom-img";
import type {
  TugAtomsClipboardAssetRange,
  TugAtomsClipboardEntry,
  TugAtomsClipboardPayload,
} from "../tug-text-editor/clipboard-filters";

/** The file's own name from an absolute path. */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Build the sidecar for a copied slice of a document, or `null` when the slice
 * carries no attachments at all (in which case the copy is ordinary text and
 * needs no sidecar).
 *
 * `base` is the document's asset base, which is what turns each link's
 * relative destination into the absolute path that survives the clipboard.
 */
export function buildAssetSidecar(
  text: string,
  base: string | null,
): TugAtomsClipboardPayload | null {
  if (base === null) return null;
  const atoms: TugAtomsClipboardEntry[] = [];
  const assets: TugAtomsClipboardAssetRange[] = [];

  const refs = parseAssetLinks(text).filter(
    (ref) => resolveAssetPath(base, ref.destination) !== null,
  );

  // Built in one forward pass, carrying the output offset as it goes. Every
  // position and range in the payload indexes the payload's OWN `text`, not
  // the document's — an image link collapses from its whole markdown to a
  // single character, so anything after it sits at a different offset, and
  // recording document offsets would put the destination's atoms and ranges in
  // the wrong places by exactly that much.
  let out = "";
  let cursor = 0;
  for (const ref of refs) {
    out += text.slice(cursor, ref.from);
    const path = resolveAssetPath(base, ref.destination) as string;
    const name = nameOf(path);
    if (classifyFileKind(path) === "image") {
      atoms.push({
        position: out.length,
        segment: {
          kind: "atom",
          type: "image",
          label: ref.label.length > 0 ? ref.label : name,
          value: name,
          id: `asset:${path}`,
        },
        assetPath: path,
        assetName: name,
      });
      out += TUG_ATOM_CHAR;
    } else {
      const literal = text.slice(ref.from, ref.to);
      assets.push({
        from: out.length,
        to: out.length + literal.length,
        assetPath: path,
        assetName: name,
      });
      out += literal;
    }
    cursor = ref.to;
  }
  out += text.slice(cursor);

  if (atoms.length === 0 && assets.length === 0) return null;
  const payload: TugAtomsClipboardPayload = { version: 1, text: out, atoms };
  if (assets.length > 0) payload.assets = assets;
  return payload;
}

/**
 * Read a file back as a `File` the upload can send.
 *
 * Through the **bytes** route, not the blob route: an attachment is any file at
 * all, and blob refuses every type outside its viewer table. A `.txt` in a
 * document's `assets/` could be written and never read back, so copying one
 * into another document did nothing at all — and said nothing about it.
 *
 * The `File` carries no media type, and needs none: the document tier names the
 * stored file from the name it is given, never from the type it is sent, so
 * inventing one here would be a value nothing reads.
 */
async function fileAtPath(path: string): Promise<File | null> {
  try {
    const res = await fetch(bytesUrl(path));
    if (!res.ok) return null;
    return new File([await res.blob()], nameOf(path));
  } catch {
    return null;
  }
}

/**
 * Turn a pasted sidecar into the markdown this document should hold.
 *
 * Every attachment in the payload is resolved against `base`: one that already
 * lives in this document's own `assets/` is referenced as-is, and one that came
 * from somewhere else — the prompt entry, or another document's directory — is
 * copied in first. That copy is the "asset copy when pasting between text
 * files" half of the round trip, and it only ever happens for a file that is
 * not already here.
 *
 * Returns `null` when the payload carries no attachments, so the caller falls
 * through to an ordinary text paste.
 */
export async function assetMarkdownForPaste(
  payload: TugAtomsClipboardPayload,
  base: AssetBaseDescriptor,
  baseDir: string | null,
): Promise<string | null> {
  const attachments = payload.atoms.filter(
    (a) => (a.assetPath ?? a.bytes?.path ?? "").length > 0,
  );
  const ranges = payload.assets ?? [];
  if (attachments.length === 0 && ranges.length === 0) return null;

  /**
   * The destination this document should link `path` by, copying if needed.
   *
   * `name` is what the copy should be called: the file's own name when the
   * attachment came from a document, and the *dropped* name when it came from
   * the prompt entry — where the file on disk is a UUID in a flat per-instance
   * folder and its real name lives only on the atom's bytes entry. `null` when
   * there is no name to use, which is a pasted screenshot: the server mints a
   * timestamped one where the write happens ([P11]). Falling back to the
   * path's own name in that case would put a UUID in the user's directory.
   */
  const destinationFor = async (
    path: string,
    name: string | null,
  ): Promise<string | null> => {
    // Already ours: reference it, never duplicate it.
    if (baseDir !== null && path.startsWith(`${baseDir}/assets/`)) {
      return `assets/${nameOf(path)}`;
    }
    const file = await fileAtPath(path);
    if (file === null) return null;
    const stored = await uploadDocAttachment(base, file, name);
    return stored === null ? null : stored.relativePath;
  };

  // Replacements are applied back-to-front, so an earlier one never shifts a
  // later one's offsets.
  const edits: Array<{ from: number; to: number; insert: string }> = [];

  for (const atom of attachments) {
    const path = (atom.assetPath ?? atom.bytes?.path) as string;
    // The name in preference order: the one a document copy states outright,
    // then the one the prompt entry kept from the drop, then none at all.
    const name = atom.assetName ?? atom.bytes?.name ?? null;
    const destination = await destinationFor(path, name);
    if (destination === null) continue;
    // Label with the name the file actually ended up with, so the document
    // reads as the file is called — including the `-2` a collision added, and
    // the minted name a nameless paste was given.
    edits.push({
      from: atom.position,
      to: atom.position + 1,
      insert: `![${nameOf(destination)}](${encodeLinkDestination(destination)})`,
    });
  }

  for (const range of ranges) {
    const destination = await destinationFor(range.assetPath, range.assetName);
    if (destination === null) continue;
    edits.push({
      from: range.from,
      to: range.to,
      insert: `[${nameOf(destination)}](${encodeLinkDestination(destination)})`,
    });
  }

  if (edits.length === 0) return null;
  edits.sort((a, b) => b.from - a.from);
  let out = payload.text;
  for (const edit of edits) {
    out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to);
  }
  return out;
}

/** Replace the editor's selection with `text`, in one undoable transaction. */
export function insertPastedText(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    userEvent: "input.paste",
  });
}
