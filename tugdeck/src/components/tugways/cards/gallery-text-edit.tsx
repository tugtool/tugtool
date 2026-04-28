/**
 * gallery-text-edit.tsx — TugEdit gallery card.
 *
 * Demo surface for the CodeMirror 6-backed `TugEdit` substrate.
 * Mirrors `gallery-prompt-input`'s wiring so the typeahead is
 * exercised against the live FileTreeStore and SessionMetadataStore
 * — same backing data the production prompt input uses, no synthetic
 * fixtures. Without that, the spike's typeahead surface would only
 * exercise the substrate's keyboard / popup mechanics; integrating
 * the real providers is what proves the substrate can replace the
 * `tug-prompt-input` engine for completion as well.
 *
 * Provider sources:
 *   - `@` triggers `FileTreeStore.getFileCompletionProvider()` over a
 *     workspace-filtered live `FeedStore<FILETREE>` — async; results
 *     stream in via the provider's `subscribe` hook and the substrate
 *     dispatches a refresh transaction whenever the FileTreeStore
 *     emits.
 *   - `/` triggers `getFixtureSessionMetadataStore().getCommandCompletionProvider()`
 *     — same `SessionMetadataStore` class production uses, but
 *     backed by the captured `capabilities/<LATEST>/system-metadata.jsonl`
 *     payload from `just capture-capabilities`. Live SESSION_METADATA
 *     only arrives when a code session is active, and the gallery is a
 *     harness with no session — `gallery-prompt-entry` uses the same
 *     fixture for the same reason.
 *
 * Card-scoped history is kept in a per-instance ref-held entry list:
 * each Return submit captures the current editing state, appends it,
 * and clears the editor. Cmd-Up/Cmd-Down walk the live entries and
 * the saved draft, mirroring `SessionHistoryProvider`'s contract
 * without requiring a real session.
 *
 * Laws: [L01] one root.render() at mount, [L02] history list and
 *        feed-store stack live in refs; React state carries only the
 *        rendered counter, [L03] the file-tree feed-store filter is
 *        re-installed in a `useEffect` keyed on workspace identity,
 *        matching `gallery-prompt-input`'s pattern, [L06] appearance
 *        via CSS and DOM, never React state, [L07] provider thunks
 *        and the card-scoped history closure read their state at
 *        call time, [L11] toggle controls and atom-insert buttons
 *        emit actions consumed by this scope's responder form,
 *        [L19] component authoring guide, [L22] the file-completion
 *        provider's async refresh path is a direct
 *        store-observation channel — no React round-trip.
 */

import "./gallery-text-edit.css";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TugEdit } from "@/components/tugways/tug-edit";
import type { TugEditDelegate, TugEditFocusStyle } from "@/components/tugways/tug-edit";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";
import { TugChoiceGroup } from "@/components/tugways/tug-choice-group";
import type { TugChoiceItem } from "@/components/tugways/tug-choice-group";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { captureEditState } from "@/components/tugways/tug-edit/keymap";
import { useCardWorkspaceKey } from "@/components/tugways/hooks/use-card-workspace-key";
import { presentWorkspaceKey } from "@/card-registry";
import { FeedStore, type FeedStoreFilter } from "@/lib/feed-store";
import { FileTreeStore } from "@/lib/filetree-store";
import { getConnection } from "@/lib/connection-singleton";
import { FeedId } from "@/protocol";
import { getFixtureSessionMetadataStore } from "./completion-fixtures/system-metadata-fixture";
import type { AtomSegment } from "@/lib/tug-atom-img";
import type {
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
// Empty provider — fallback when the live FILETREE connection isn't
// yet available. Stable identity so the substrate's provider thunk
// doesn't churn on the unbound-window first render.
// ---------------------------------------------------------------------------

const EMPTY_PROVIDER: CompletionProvider = ((_q: string) => []) as CompletionProvider;

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

interface GalleryTextEditProps {
  /** Card instance id — used to scope the FILETREE feed-store filter. */
  cardId: string;
}

export function GalleryTextEdit({ cardId }: GalleryTextEditProps) {
  const editRef = useRef<TugEditDelegate>(null);
  const [focusStyle, setFocusStyle] = useState<TugEditFocusStyle>("background");
  const [borderless, setBorderlessFlag] = useState<boolean>(false);
  const [returnAction, setReturnAction] = useState<InputAction>("newline");
  const [submitCount, setSubmitCount] = useState<number>(0);

  // Per-card runtime history. The ref-held array is the single source
  // of truth; React state (`submitCount`) carries only the rendered
  // counter, not the entries themselves [L02].
  const entriesRef = useRef<TugTextEditingState[]>([]);

  // One provider instance per card lifetime.
  const historyProvider = useMemo(
    () => new CardHistoryProvider(() => entriesRef.current),
    [],
  );

  // ---- File-tree completion provider (per-card) ----
  //
  // Mirrors `gallery-prompt-input`'s setup: a workspace-filtered
  // FeedStore over FILETREE plus a FileTreeStore that exposes the
  // async `@`-trigger provider. The provider's `subscribe` hook
  // streams refreshed results into the substrate's typeahead state
  // through the completion-extension ([L22]).
  const workspaceKey = useCardWorkspaceKey(cardId);
  const workspaceFilter: FeedStoreFilter = useMemo(
    () =>
      workspaceKey
        ? (_feedId, decoded) =>
            typeof decoded === "object"
            && decoded !== null
            && "workspace_key" in decoded
            && (decoded as { workspace_key: unknown }).workspace_key === workspaceKey
        : presentWorkspaceKey,
    [workspaceKey],
  );

  const fileTreeStackRef = useRef<{
    feedStore: FeedStore;
    fileTreeStore: FileTreeStore;
    provider: CompletionProvider;
  } | null>(null);

  if (fileTreeStackRef.current === null) {
    const connection = getConnection();
    if (connection) {
      const feedStore = new FeedStore(
        connection,
        [FeedId.FILETREE],
        undefined,
        workspaceFilter,
      );
      const fileTreeStore = new FileTreeStore(feedStore, FeedId.FILETREE);
      const provider = fileTreeStore.getFileCompletionProvider();
      fileTreeStackRef.current = { feedStore, fileTreeStore, provider };
    }
  }

  // Re-install the workspace filter when the binding changes —
  // mirror of the `gallery-prompt-input` pattern.
  useEffect(() => {
    fileTreeStackRef.current?.feedStore.setFilter(workspaceFilter);
  }, [workspaceFilter]);

  // Dispose the file-tree stack on unmount.
  useEffect(() => {
    return () => {
      const stack = fileTreeStackRef.current;
      if (stack !== null) {
        stack.fileTreeStore.dispose();
        stack.feedStore.dispose();
        fileTreeStackRef.current = null;
      }
    };
  }, []);

  // Stable provider map. The thunk inside the substrate reads this
  // map at every transaction; both providers' identities are stable
  // across the card's lifetime, so empty deps are correct.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const completionProviders = useMemo<Record<string, CompletionProvider>>(
    () => ({
      "@": fileTreeStackRef.current?.provider ?? EMPTY_PROVIDER,
      "/": getFixtureSessionMetadataStore().getCommandCompletionProvider(),
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
