/**
 * tug-edit/atomic-ranges.ts — provider that lifts the atom decoration
 * field into `EditorView.atomicRanges`.
 *
 * `EditorView.atomicRanges` tells CM6 which document ranges should
 * behave as atomic units for cursor motion, selection extension, and
 * the standard delete commands. Pointing the provider at the atom
 * decoration field means: every `Decoration.replace` covering a
 * U+FFFC character — i.e. every rendered atom — is treated as one
 * unit for arrow-key motion, shift-arrow extension, double-click
 * select, and delete-char commands [Q01].
 *
 * This file is the structural seam between the atom data model
 * (`atomDecorationField`) and the editor's motion/deletion machinery.
 * Swapping the source set in the future (e.g. extending atomic ranges
 * to cover read-only header decorations) means changing the provider
 * here, not threading a new state through the rest of the substrate.
 *
 * Laws: [L02] reads from a CM6 facet, not React state, [L19] file
 *        structure.
 */

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { atomDecorationField } from "./atom-decoration";

/**
 * Extension that registers the atom decoration field as the source of
 * atomic ranges for the editor.
 */
export const atomicRangesExt: Extension = EditorView.atomicRanges.of((view) =>
  view.state.field(atomDecorationField),
);
