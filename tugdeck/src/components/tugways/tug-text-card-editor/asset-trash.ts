/**
 * asset-trash — removing an attachment takes the link and the file, and undo
 * brings both back.
 *
 * ## Why the file moves to the Trash
 *
 * A ✕ that only edited text would leave the file behind, accumulating
 * invisibly — assets are git-ignored, so nothing would ever surface it. A ✕
 * that unlinked the file would be an unrecoverable destructive act behind a
 * small glyph. So the file goes to the **macOS Trash**, which gives two
 * independent recoveries: ⌘Z here, and Finder's Put Back for the user who
 * never presses it.
 *
 * `NSWorkspace.recycle` reports the URL it moved the file to, and that URL is
 * the whole restore mechanism — the undo is an ordinary move from a location
 * we recorded ourselves, never a programmatic Put Back.
 *
 * ## Why the coupling is an inverted effect
 *
 * The document edit and the file move have to travel together through the
 * history, and CM6 has a supported hook for exactly that: `invertedEffects`
 * registers an effect to be applied when a transaction is later undone. The
 * ✕ transaction registers a `restoreAssetEffect` carrying the trashed URL, so
 * the undo transaction *arrives with its own restore instruction* — there is no
 * "is this change currently undone" bookkeeping to invent and get wrong. The
 * inverse is registered too, so redo re-trashes and a cycle of ⌘Z / ⇧⌘Z costs
 * nothing but the moves themselves. `atomInvertedEffects` is the in-tree
 * precedent for the same shape of problem.
 *
 * Nothing here persists. The trashed URL lives in the editor's history and dies
 * with it — undo across a relaunch was never offered for text edits either.
 *
 * @module components/tugways/tug-text-card-editor/asset-trash
 */

import { StateEffect, type Extension, type StateEffectType } from "@codemirror/state";
import { invertedEffects } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";

import { restoreTrashedPathInOS, trashPathInOS } from "@/lib/os-trash";

/** One asset that moved, and where it came from. */
export interface TrashedAsset {
  /** Where the host put it — the handle a restore needs. */
  trashedPath: string;
  /** Where it was, and where a restore puts it back. */
  originalPath: string;
}

/**
 * Rides the ✕ transaction as a *record* of what was trashed. Deliberately
 * never acted on: `removeAssetWithUndo` has already moved the file by the time
 * it dispatches, and a handler that treated this as an instruction would trash
 * the same file twice.
 */
export const assetTrashedEffect: StateEffectType<TrashedAsset> =
  StateEffect.define<TrashedAsset>();

/**
 * Applied when a ✕ is undone: put the file back. Registered as the ✕
 * transaction's inverted effect, so the history delivers it at exactly the
 * moment the link text reappears.
 */
export const restoreAssetEffect: StateEffectType<TrashedAsset> =
  StateEffect.define<TrashedAsset>();

/**
 * Applied when that undo is itself undone: trash the file again. Registered as
 * the *restore's* inverted effect, which is what makes redo symmetric.
 */
export const trashAssetEffect: StateEffectType<TrashedAsset> =
  StateEffect.define<TrashedAsset>();

/**
 * Couple the effects through the history so the file follows the text in both
 * directions, for as many undo/redo cycles as the user cares to run.
 *
 *   ✕            → records `assetTrashed`, history keeps `restore`
 *   ⌘Z           → applies `restore`,      history keeps `trash`
 *   ⇧⌘Z          → applies `trash`,        history keeps `restore`
 */
export const assetTrashInvertedEffects: Extension = invertedEffects.of((tr) => {
  const out: StateEffect<TrashedAsset>[] = [];
  for (const effect of tr.effects) {
    if (effect.is(assetTrashedEffect) || effect.is(trashAssetEffect)) {
      out.push(restoreAssetEffect.of(effect.value));
    } else if (effect.is(restoreAssetEffect)) {
      out.push(trashAssetEffect.of(effect.value));
    }
  }
  return out;
});

/**
 * Perform the file moves the history asks for, and report a failure.
 *
 * The moves are the side effect; the transaction carrying them has already
 * been applied, so the document and the disk converge as soon as the host
 * answers. A failed restore — the ordinary cause being a Trash the user
 * emptied between the ✕ and the undo — is reported rather than silently
 * leaving the text edited, because an undo that half-worked is worse than one
 * that says so.
 */
export function assetTrashEffectHandler(
  onFailure: (name: string, message: string) => void,
): Extension {
  return EditorView.updateListener.of((update) => {
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(restoreAssetEffect)) {
          const { trashedPath, originalPath } = effect.value;
          void (async () => {
            const restored = await restoreTrashedPathInOS(
              trashedPath,
              originalPath,
            );
            if (restored === null) {
              onFailure(
                nameOf(originalPath),
                `Could not restore ${nameOf(originalPath)} — it may have been removed from the Trash.`,
              );
              return;
            }
            if (restored !== originalPath) {
              // Something took the name while the file sat in the Trash, so
              // the host suffixed it. The re-inserted link still names the
              // original, which now resolves to nothing — the strip already
              // shows that as a missing tile, and this says why.
              onFailure(
                nameOf(originalPath),
                `Restored as ${nameOf(restored)} — the original name was taken.`,
              );
            }
          })();
        } else if (effect.is(trashAssetEffect)) {
          // Redo: the link is gone again, so the file follows it back out.
          void trashPathInOS(effect.value.originalPath);
        }
      }
    }
  });
}

/** The file's own name from an absolute path. */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Remove an attachment: take its link out of the document and move its file to
 * the Trash, as one undoable gesture.
 *
 * The text edit and the trash call are deliberately ordered — the file moves
 * first, and the document is only edited once the host confirms where it went.
 * A ✕ that edited the text and then failed to move the file would leave the
 * user with a document that no longer mentions a file that is still there.
 */
export async function removeAssetWithUndo(
  view: EditorView,
  range: { from: number; to: number },
  assetPath: string,
  onFailure: (name: string, message: string) => void,
): Promise<boolean> {
  const trashedPath = await trashPathInOS(assetPath);
  if (trashedPath === null) {
    onFailure(
      nameOf(assetPath),
      `Could not remove ${nameOf(assetPath)}.`,
    );
    return false;
  }
  if (!view.dom.isConnected) return false;
  // Clamp: the buffer may have been edited while the host was working.
  const length = view.state.doc.length;
  const from = Math.max(0, Math.min(range.from, length));
  const to = Math.max(from, Math.min(range.to, length));
  view.dispatch({
    changes: { from, to, insert: "" },
    selection: { anchor: from },
    userEvent: "delete.tug-remove-attachment",
    // The history records this effect's INVERSE, so the undo transaction
    // arrives carrying `restoreAssetEffect` and the file comes back with the
    // text — one gesture, one undo, both halves.
    effects: assetTrashedEffect.of({ trashedPath, originalPath: assetPath }),
  });
  return true;
}
