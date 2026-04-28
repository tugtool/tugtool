/**
 * gallery-text-edit.tsx — TugEdit gallery card.
 *
 * Demo surface for the CodeMirror 6-backed `TugEdit` substrate.
 * Mounts an editor and exposes the host's focus-style and borderless
 * variants, the keymap policy (`returnAction`), a row of atom-insert
 * buttons covering each kind supported by `tug-atom-img.ts` (file,
 * command, doc, image, link), and a `historyProvider` that records
 * the user's own submissions: each submit captures the current
 * editing state, appends it to the in-card history list, and clears
 * the editor for the next draft. Cmd-Up walks back through the
 * actual submissions; Cmd-Down walks forward, then restores the
 * draft the user had typed before navigating.
 *
 * Laws: [L01] one root.render() at mount, [L02] the per-card history
 *        list and provider live in refs, never copied into React
 *        state for rendering, [L06] appearance via CSS and DOM, never
 *        React state, [L11] toggle controls and atom-insert buttons
 *        emit actions consumed by this scope's responder form, the
 *        editor handles the chain-routed editing actions on its own
 *        document, [L19] component authoring guide.
 */

import "./gallery-text-edit.css";

import React, { useMemo, useRef, useState } from "react";
import { TugEdit } from "@/components/tugways/tug-edit";
import type { TugEditDelegate, TugEditFocusStyle } from "@/components/tugways/tug-edit";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { captureEditState } from "@/components/tugways/tug-edit/keymap";
import type { AtomSegment } from "@/lib/tug-atom-img";
import type {
  CompletionItem,
  CompletionProvider,
  HistoryProvider,
  InputAction,
  TugTextEditingState,
} from "@/lib/tug-text-engine";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FOCUS_STYLE_CHOICES: TugChoiceItem[] = [
  { value: "background", label: "Background" },
  { value: "ring", label: "Ring" },
];

const BORDERLESS_CHOICES: TugChoiceItem[] = [
  { value: "false", label: "Bordered" },
  { value: "true", label: "Borderless" },
];

const RETURN_ACTION_CHOICES: TugChoiceItem[] = [
  { value: "submit", label: "Submits" },
  { value: "newline", label: "Newline" },
];

/**
 * Sample atoms exercising every kind that `tug-atom-img.ts` knows
 * how to draw. Each click on the matching button inserts a fresh
 * atom of that kind at the editor's current selection.
 */
const ATOM_SAMPLES: { label: string; segment: AtomSegment }[] = [
  {
    label: "file",
    segment: { kind: "atom", type: "file", label: "main.ts", value: "/project/src/main.ts" },
  },
  {
    label: "command",
    segment: { kind: "atom", type: "command", label: "/commit", value: "/commit" },
  },
  {
    label: "doc",
    segment: { kind: "atom", type: "doc", label: "tuglaws.md", value: "/tuglaws/tuglaws.md" },
  },
  {
    label: "image",
    segment: { kind: "atom", type: "image", label: "screenshot.png", value: "/Desktop/screenshot.png" },
  },
  {
    label: "link",
    segment: { kind: "atom", type: "link", label: "anthropic.com", value: "https://www.anthropic.com" },
  },
];

// ---------------------------------------------------------------------------
// Mock completion providers
// ---------------------------------------------------------------------------

/**
 * Hard-coded sample file list for the `@`-trigger provider. Real
 * tug-prompt-input wires `@` to a live FileTreeStore-backed provider;
 * the gallery just demonstrates the popup's keyboard nav, hover, and
 * accept flow against a fixed set of items.
 */
const MOCK_FILES: { path: string; label: string }[] = [
  { path: "/project/src/main.ts", label: "main.ts" },
  { path: "/project/src/app.tsx", label: "app.tsx" },
  { path: "/project/src/router.ts", label: "router.ts" },
  { path: "/project/src/lib/utils.ts", label: "utils.ts" },
  { path: "/project/src/lib/store.ts", label: "store.ts" },
  { path: "/project/styles/themes/brio.css", label: "brio.css" },
  { path: "/project/styles/themes/harmony.css", label: "harmony.css" },
  { path: "/project/README.md", label: "README.md" },
  { path: "/project/package.json", label: "package.json" },
];

/**
 * Hard-coded sample slash-command list for the `/`-trigger provider.
 * Mirrors a typical command palette: each item carries a label and
 * the verbatim slash command string used as the atom value.
 */
const MOCK_COMMANDS: { command: string; label: string }[] = [
  { command: "/commit", label: "/commit" },
  { command: "/build", label: "/build" },
  { command: "/test", label: "/test" },
  { command: "/run", label: "/run" },
  { command: "/help", label: "/help" },
];

/**
 * Filter a list against a query. Returns items that contain every
 * character of the query as a subsequence (case-insensitive),
 * preserving the original order.
 */
function fuzzyFilter<T extends { label: string }>(items: T[], query: string): T[] {
  if (query.length === 0) return items;
  const q = query.toLowerCase();
  return items.filter((item) => {
    const label = item.label.toLowerCase();
    let qi = 0;
    for (let i = 0; i < label.length && qi < q.length; i++) {
      if (label[i] === q[qi]) qi++;
    }
    return qi === q.length;
  });
}

/** `@`-trigger provider — synchronous match against the mock file list. */
const mockFileProvider: CompletionProvider = (query: string): CompletionItem[] => {
  return fuzzyFilter(MOCK_FILES, query).map((file) => ({
    label: file.label,
    atom: { kind: "atom", type: "file", label: file.label, value: file.path },
  }));
};

/** `/`-trigger provider — synchronous match against the mock command list. */
const mockCommandProvider: CompletionProvider = (query: string): CompletionItem[] => {
  return fuzzyFilter(MOCK_COMMANDS, query).map((cmd) => ({
    label: cmd.label,
    atom: { kind: "atom", type: "command", label: cmd.label, value: cmd.command },
  }));
};

// ---------------------------------------------------------------------------
// Card-scoped history provider
// ---------------------------------------------------------------------------

/**
 * History provider whose entry list is owned by the gallery card.
 *
 * Mirrors `SessionHistoryProvider` from `prompt-history-store.ts` so
 * the gallery exercises the same contract production wires up. The
 * crucial difference: the entry list is supplied via a getter, not
 * baked at construction. The card's `onSubmit` handler appends to a
 * ref-held array, and the provider reads through the same ref on
 * every `back()` / `forward()` — so a submit landing right before a
 * Cmd-Up brings the new entry into view immediately.
 *
 * Cursor / draft semantics:
 *   - `back(current)` saves `current` as the draft on the first
 *     call, then walks back through the entry list (newest first).
 *     Returns `null` once the oldest entry has been served.
 *   - `forward()` walks forward toward the present; once past the
 *     newest entry it returns the saved draft (which may itself be
 *     empty if the user submitted, then immediately Cmd-Up'd).
 */
class CardHistoryProvider implements HistoryProvider {
  private cursor = -1;
  private draft: TugTextEditingState = { text: "", atoms: [], selection: null };

  constructor(private readonly getEntries: () => readonly TugTextEditingState[]) {}

  back(current: TugTextEditingState): TugTextEditingState | null {
    const entries = this.getEntries();
    if (entries.length === 0) return null;
    if (this.cursor === -1) {
      this.draft = current;
      this.cursor = entries.length - 1;
    } else if (this.cursor > 0) {
      this.cursor--;
    } else {
      return null;
    }
    return entries[this.cursor]!;
  }

  forward(): TugTextEditingState | null {
    const entries = this.getEntries();
    if (this.cursor === -1) return null;
    if (this.cursor < entries.length - 1) {
      this.cursor++;
      return entries[this.cursor]!;
    }
    this.cursor = -1;
    return this.draft;
  }

  /**
   * Reset the cursor to the draft slot and replace the saved draft
   * with the supplied state. Called from the submit flow so a
   * subsequent Cmd-Up offers the just-submitted entry as the most
   * recent — not the historic "draft I navigated away from."
   */
  resetToDraft(draft: TugTextEditingState): void {
    this.cursor = -1;
    this.draft = draft;
  }
}

// ---------------------------------------------------------------------------
// GalleryTextEdit
// ---------------------------------------------------------------------------

export function GalleryTextEdit() {
  const editRef = useRef<TugEditDelegate>(null);
  const [focusStyle, setFocusStyle] = useState<TugEditFocusStyle>("background");
  const [borderless, setBorderlessFlag] = useState<boolean>(false);
  const [returnAction, setReturnAction] = useState<InputAction>("newline");
  const [submitCount, setSubmitCount] = useState<number>(0);

  // Per-card runtime history. The ref-held array is the single source
  // of truth; React state (`submitCount`) carries only the rendered
  // counter, not the entries themselves [L02].
  const entriesRef = useRef<TugTextEditingState[]>([]);

  // One provider instance per card lifetime. The closure passed to
  // the constructor reads `entriesRef.current` at every navigation,
  // so newly-appended entries are visible without rebuilding the
  // provider.
  const historyProvider = useMemo(
    () => new CardHistoryProvider(() => entriesRef.current),
    [],
  );

  // Stable typeahead provider map. Module-level constants — neither
  // the file list nor the command list changes during the gallery's
  // lifetime, so the map's identity stays stable across renders and
  // the substrate's provider thunk doesn't churn.
  const completionProviders = useMemo<Record<string, CompletionProvider>>(
    () => ({
      "@": mockFileProvider,
      "/": mockCommandProvider,
    }),
    [],
  );

  // Submit handler: capture the current editing state, append it to
  // the per-card history, reset the provider's cursor / draft, then
  // clear the editor for the next draft. The capture happens on the
  // current view so atoms in the submitted draft are preserved (so
  // Cmd-Up after submit restores the exact draft, atoms and all).
  const handleSubmit = (): void => {
    const view = editRef.current?.view();
    if (view === null || view === undefined) return;
    const snapshot = captureEditState(view);
    if (snapshot.text.length === 0) return; // ignore empty submits
    entriesRef.current.push(snapshot);
    // Reset the provider's draft to a fresh blank state so the next
    // Cmd-Up serves the just-submitted entry, not the saved draft.
    historyProvider.resetToDraft({ text: "", atoms: [], selection: null });
    editRef.current?.clear();
    setSubmitCount((n) => n + 1);
  };

  // Sender ids for the selectValue actions below.
  const focusId = React.useId();
  const borderlessId = React.useId();
  const returnId = React.useId();

  const { ResponderScope, responderRef } = useResponderForm({
    selectValue: {
      [focusId]: (v: string) => setFocusStyle(v as TugEditFocusStyle),
      [borderlessId]: (v: string) => setBorderlessFlag(v === "true"),
      [returnId]: (v: string) => setReturnAction(v as InputAction),
    },
  });

  return (
    <ResponderScope>
      <div
        className="cg-content"
        data-testid="gallery-text-edit"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >

        {/* ---- Editor ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">TugEdit</TugLabel>
          <div className="gallery-text-edit-host">
            <TugEdit
              ref={editRef}
              focusStyle={focusStyle}
              borderless={borderless}
              returnAction={returnAction}
              onSubmit={handleSubmit}
              historyProvider={historyProvider}
              completionProviders={completionProviders}
            />
          </div>
        </div>

        <TugSeparator />

        {/* ---- Atoms ----
           Each button inserts a fresh atom of one kind at the editor's
           current selection. Verifies that atomicRanges, decoration
           rendering, and the imperative `insertAtom` delegate method
           work end to end.
        */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Insert atom</TugLabel>
          <div className="gallery-text-edit-atom-row">
            {ATOM_SAMPLES.map((sample) => (
              <TugPushButton
                key={sample.label}
                size="sm"
                emphasis="outlined"
                onClick={() => editRef.current?.insertAtom(sample.segment)}
              >
                {sample.label}
              </TugPushButton>
            ))}
          </div>
        </div>

        <TugSeparator />

        {/* ---- Return action ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Return action</TugLabel>
          <TugChoiceGroup
            items={RETURN_ACTION_CHOICES}
            value={returnAction}
            senderId={returnId}
            size="sm"
          />
        </div>

        <TugSeparator />

        {/* ---- Submit counter ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">
            {`Submits: ${submitCount}`}
          </TugLabel>
        </div>

        <TugSeparator />

        {/* ---- Focus style ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Focus style</TugLabel>
          <TugChoiceGroup
            items={FOCUS_STYLE_CHOICES}
            value={focusStyle}
            senderId={focusId}
            size="sm"
          />
        </div>

        <TugSeparator />

        {/* ---- Borderless ---- */}
        <div className="cg-section">
          <TugLabel className="cg-section-title">Border</TugLabel>
          <TugChoiceGroup
            items={BORDERLESS_CHOICES}
            value={borderless ? "true" : "false"}
            senderId={borderlessId}
            size="sm"
          />
        </div>

      </div>
    </ResponderScope>
  );
}

