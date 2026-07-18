/**
 * snippets-section.tsx — the Lens **Snippets** section: a curated list of
 * reusable prompt fragments backed by the machine-global `snippets.json`
 * (`snippetsStore`), edited with the Things-3 keyboard grammar via
 * `TugQuickList` ([P08]).
 *
 * Host-agnostic ([P07]): the body and collapsed summary read `snippetsStore`
 * directly. Rows reorder by grip (the shared `useBlockReorder` FLIP, [P04]);
 * the header `+` creates a row and opens it via the store's `lastCreatedId`
 * signal. All appearance is CSS; the store owns structure ([L02]/[L06]).
 *
 * @module components/lens/sections/snippets-section
 */

import React, { useSyncExternalStore } from "react";
import { Plus, TextQuote } from "lucide-react";
import { getSnippetsStore } from "@/lib/snippets-store";
import { snippetIncipit, type Snippet } from "@/lib/snippets-doc";
import { startSnippetDrag } from "@/lib/snippet-drag";
import { cardServicesStore } from "@/lib/card-services-store";
import { TugQuickList } from "@/components/tugways/tug-quick-list";
import { TugTextarea } from "@/components/tugways/tug-textarea";
import { registerLensSection } from "../lens-section-registry";
import "./snippets-section.css";

/** Route a snippet drop to the card that owns the drop target's prompt entry. */
function insertIntoCard(
  text: string,
  at: { x: number; y: number },
  cardId: string | null,
): void {
  if (cardId === null) return;
  cardServicesStore.getServices(cardId)?.codeSessionStore.insertSnippet(text, at);
}

function useSnippets() {
  const store = getSnippetsStore();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { store, snapshot };
}

/** Live one-line summary: the snippet count. */
function SnippetsCollapsedSummary(): React.ReactElement {
  const { snapshot } = useSnippets();
  const n = snapshot.doc.snippets.length;
  return <>{n === 0 ? "No snippets" : `${n} snippet${n === 1 ? "" : "s"}`}</>;
}

/** The header `+`: create a snippet and open it (via `lastCreatedId`). */
function SnippetsHeaderActions(): React.ReactElement {
  const { store } = useSnippets();
  return (
    <button
      type="button"
      className="snippets-add-button"
      title="New snippet"
      aria-label="New snippet"
      onClick={() => store.createSnippet(null)}
    >
      <Plus size={14} />
    </button>
  );
}

function SnippetRow(snippet: Snippet): React.ReactElement {
  // The row's handle is the incipit — the snippet's opening line.
  const incipit = snippetIncipit(snippet);
  return (
    <span
      className={incipit.length === 0 ? "snippet-row-label snippet-row-label-empty" : "snippet-row-label"}
      onPointerDown={(e) => {
        // Drag the row toward the prompt entry to insert; a plain click (no
        // threshold crossed) still selects, a double-click still opens.
        startSnippetDrag(e, {
          text: snippet.text,
          label: incipit.length === 0 ? "Snippet" : incipit,
          onDrop: insertIntoCard,
        });
      }}
    >
      {incipit.length === 0 ? "New snippet" : incipit}
    </span>
  );
}

function SnippetEditor(snippet: Snippet, store: ReturnType<typeof getSnippetsStore>): React.ReactElement {
  return (
    <TugTextarea
      rows={3}
      autoResize
      maxRows={14}
      placeholder="Type a snippet — its opening line becomes its handle"
      defaultValue={snippet.text}
      onChange={(e) => store.updateSnippet(snippet.id, e.target.value)}
    />
  );
}

function SnippetsBody(): React.ReactElement {
  const { store, snapshot } = useSnippets();
  return (
    <div className="snippets-section">
      {snapshot.error !== null ? (
        <div className="snippets-error" role="status">
          Snippets are read-only: {snapshot.error}
        </div>
      ) : null}
      <TugQuickList<Snippet>
        items={snapshot.doc.snippets}
        openSignal={snapshot.lastCreatedId}
        emptyHint="No snippets yet. Press + (or Space) to add one."
        data-testid="snippets-quick-list"
        renderRow={SnippetRow}
        renderEditor={(item) => SnippetEditor(item, store)}
        onCreate={(afterId) => store.createSnippet(afterId)}
        onDelete={(id) => store.deleteSnippet(id)}
        onOpen={(id) => store.beginEdit(id)}
        onClose={() => store.commitEdit()}
        onUndo={() => store.undo()}
        onRedo={() => store.redo()}
        onReorder={(ids) => store.setOrder(ids)}
      />
    </div>
  );
}

/** Register the Snippets section. Called once at boot from `main.tsx`. */
export function registerSnippetsSection(): void {
  registerLensSection({
    kind: "snippets",
    title: "Snippets",
    glyph: <TextQuote size={14} />,
    collapsedSummary: () => <SnippetsCollapsedSummary />,
    headerActions: () => <SnippetsHeaderActions />,
    body: () => <SnippetsBody />,
  });
}
