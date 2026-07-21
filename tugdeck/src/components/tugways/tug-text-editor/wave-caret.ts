/**
 * wave-caret — a CM6 decoration that paints the AI-thinking wave glyph as a
 * caret at the tail of the document, following streamed text ([P06]).
 *
 * The commit composer goes read-only (`editable(false)`) while the Auto-Message
 * scribe streams, so neither the native caret nor the substrate's own
 * `caret-layer` paints — this widget has the field to itself. Rather than track
 * a mapped position (a full-document `restoreState` per delta would strand it),
 * the field rebuilds a single point widget at `doc.length` on every
 * transaction while active, so the wave rides the growing draft to its end.
 *
 * The glyph mirrors {@link TugProgressWave}'s three-bar DOM + `data-state`
 * running loop (see `../internal/tug-progress-wave.css`); `eq()` is always true
 * so CM6 reuses the element across rebuilds and the pulse never restarts.
 *
 * Toggle with {@link setWaveCaretActive}; install {@link waveCaretExtension} in
 * the editor's host extensions (inert until the effect turns it on).
 *
 * @module components/tugways/tug-text-editor/wave-caret
 */

import "../internal/tug-progress-wave.css";
import "./wave-caret.css";

import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import type { Extension } from "@codemirror/state";

/** Bar geometry, matching `TugProgressWave`'s ratios at a caret-sized glyph. */
const WAVE_SIZE_PX = 15;
const BAR_WIDTH_RATIO = 0.15;
const GAP_TO_WIDTH_RATIO = 0.8;

/** Turn the wave caret on (streaming) or off (settled / cancelled). */
export const setWaveCaretActive = StateEffect.define<boolean>();

/** The wave glyph, rebuilt into the same DOM shape `TugProgressWave` renders. */
class WaveCaretWidget extends WidgetType {
  override eq(): boolean {
    // Every wave caret is identical — CM6 keeps the existing element (and its
    // running animation) across the per-delta rebuilds.
    return true;
  }

  override toDOM(): HTMLSpanElement {
    const barWidth = WAVE_SIZE_PX * BAR_WIDTH_RATIO;
    const barGap = barWidth * GAP_TO_WIDTH_RATIO;
    const root = document.createElement("span");
    root.className = "tug-progress-wave tug-commit-wave-caret";
    root.dataset.state = "running";
    root.setAttribute("aria-hidden", "true");
    root.style.setProperty("--tugx-progress-wave-size", `${WAVE_SIZE_PX}px`);
    root.style.setProperty("--tugx-progress-wave-bar-width", `${barWidth}px`);
    root.style.setProperty("--tugx-progress-wave-bar-gap", `${barGap}px`);
    for (let i = 0; i < 3; i += 1) {
      const bar = document.createElement("span");
      bar.className = "tug-progress-wave-bar";
      // Seed the rest pose (short-long-short) so the first paint matches the
      // running loop's 0% keyframe — no jump when the animation takes over.
      const rest = i === 1 ? 1 : 0.5;
      bar.style.transform = `scaleY(${rest})`;
      root.appendChild(bar);
    }
    return root;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

/** `side: 1` seats the wave after any content at the tail position. */
const waveCaretDecoration = Decoration.widget({
  widget: new WaveCaretWidget(),
  side: 1,
});

const waveCaretField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    // Active carries across transactions via the current decoration presence;
    // an explicit effect flips it. While active, always re-seat at the tail.
    let active = deco.size > 0;
    for (const effect of tr.effects) {
      if (effect.is(setWaveCaretActive)) active = effect.value;
    }
    if (!active) return Decoration.none;
    return Decoration.set([waveCaretDecoration.range(tr.state.doc.length)]);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Install in the editor's host extensions; inert until `setWaveCaretActive`. */
export const waveCaretExtension: Extension = [waveCaretField];
