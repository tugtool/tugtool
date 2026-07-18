/**
 * Pure document logic for the Snippets feature — no IO, no timers, no React.
 *
 * Everything decision-shaped lives here so it is testable as pure logic
 * (`src/__tests__/snippets-doc.test.ts`): the immutable S01 document
 * transforms, the undo/redo stack, echo suppression, and the foreign-merge
 * open-row carve-out (Risk R01). `snippets-store.ts` composes these with the
 * feed subscription, autosave, and the `useSyncExternalStore` surface.
 *
 * Mirrors the Rust model in `tugcast/src/snippets.rs` (Spec S01/S02).
 */

/** The only document version this build reads and writes. */
export const SNIPPETS_VERSION = 1;

/** One reusable snippet: an opaque id and its (possibly multi-line) text. The
 *  row's handle is the *incipit* (opening line of `text`), not a stored title. */
export interface Snippet {
  id: string;
  text: string;
}

/** The whole snippets document. Array position is display order ([P09]). */
export interface SnippetsDoc {
  version: number;
  snippets: Snippet[];
}

/** The SNIPPETS feed frame payload (Spec S02). */
export interface SnippetsFrame {
  doc: SnippetsDoc;
  hash: string | null;
  error: string | null;
}

/** The empty document served when `snippets.json` is missing. */
export function emptyDoc(): SnippetsDoc {
  return { version: SNIPPETS_VERSION, snippets: [] };
}

/** Generate a stable opaque snippet id: `sn_` + 12 hex chars. */
export function newSnippetId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `sn_${hex}`;
}

/**
 * The snippet's *incipit* — its opening line, the handle shown in the list
 * (borrowed from how papal bulls are named by their first words). Empty when
 * the snippet has no text yet.
 */
export function snippetIncipit(snippet: Snippet): string {
  return snippet.text.trimStart().split("\n", 1)[0]?.trim() ?? "";
}

/**
 * Parse a SNIPPETS feed payload into a validated frame, or `null` if the bytes
 * are not a well-formed S02 frame.
 */
export function parseSnippetsFrame(payload: Uint8Array): SnippetsFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const doc = obj.doc;
  if (typeof doc !== "object" || doc === null) return null;
  const d = doc as Record<string, unknown>;
  if (typeof d.version !== "number" || !Array.isArray(d.snippets)) return null;
  const snippets: Snippet[] = [];
  for (const raw of d.snippets) {
    if (typeof raw !== "object" || raw === null) return null;
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== "string") return null;
    snippets.push({
      id: s.id,
      text: typeof s.text === "string" ? s.text : "",
    });
  }
  return {
    doc: { version: d.version, snippets },
    hash: typeof obj.hash === "string" ? obj.hash : null,
    error: typeof obj.error === "string" ? obj.error : null,
  };
}

// ── Immutable document transforms ──────────────────────────────────────────

/**
 * Insert a new blank snippet after `afterId` (or at the end when `afterId` is
 * absent / not found). Returns the new document and the new snippet's id.
 */
export function applyCreate(
  doc: SnippetsDoc,
  afterId: string | null,
  id: string,
): { doc: SnippetsDoc; id: string } {
  const snippet: Snippet = { id, text: "" };
  const idx = afterId === null ? -1 : doc.snippets.findIndex((s) => s.id === afterId);
  const snippets = doc.snippets.slice();
  if (idx < 0) snippets.push(snippet);
  else snippets.splice(idx + 1, 0, snippet);
  return { doc: { ...doc, snippets }, id };
}

/** Set a snippet's text. No-op if `id` is absent. */
export function applyUpdate(doc: SnippetsDoc, id: string, text: string): SnippetsDoc {
  const snippets = doc.snippets.map((s) => (s.id === id ? { ...s, text } : s));
  return { ...doc, snippets };
}

/**
 * Remove a snippet. Returns the new document and the id that should take
 * selection next (the successor row, else the new last row, else `null`).
 */
export function applyDelete(
  doc: SnippetsDoc,
  id: string,
): { doc: SnippetsDoc; nextSelected: string | null } {
  const idx = doc.snippets.findIndex((s) => s.id === id);
  if (idx < 0) return { doc, nextSelected: null };
  const snippets = doc.snippets.slice();
  snippets.splice(idx, 1);
  let nextSelected: string | null = null;
  if (snippets.length > 0) {
    const nextIdx = Math.min(idx, snippets.length - 1);
    nextSelected = snippets[nextIdx].id;
  }
  return { doc: { ...doc, snippets }, nextSelected };
}

/**
 * Reorder to match `ids`. Snippets not named in `ids` keep their relative
 * order at the end (defensive; the caller always passes a full permutation).
 */
export function applyOrder(doc: SnippetsDoc, ids: string[]): SnippetsDoc {
  const byId = new Map(doc.snippets.map((s) => [s.id, s]));
  const ordered: Snippet[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (s) {
      ordered.push(s);
      byId.delete(id);
    }
  }
  for (const s of byId.values()) ordered.push(s);
  return { ...doc, snippets: ordered };
}

// ── Undo/redo stack ────────────────────────────────────────────────────────

/** Bounded whole-document undo/redo stack ([P07]). */
export interface UndoStack {
  past: SnippetsDoc[];
  future: SnippetsDoc[];
}

/** Maximum retained undo entries. */
export const UNDO_LIMIT = 50;

export function emptyUndo(): UndoStack {
  return { past: [], future: [] };
}

/** Push `prevDoc` (the state before a mutation) onto the stack; clears redo. */
export function pushUndo(stack: UndoStack, prevDoc: SnippetsDoc): UndoStack {
  const past = [...stack.past, prevDoc];
  if (past.length > UNDO_LIMIT) past.shift();
  return { past, future: [] };
}

/** Walk back one step. Returns `null` when there is nothing to undo. */
export function undo(
  stack: UndoStack,
  current: SnippetsDoc,
): { stack: UndoStack; doc: SnippetsDoc } | null {
  if (stack.past.length === 0) return null;
  const past = stack.past.slice();
  const doc = past.pop() as SnippetsDoc;
  return { stack: { past, future: [current, ...stack.future] }, doc };
}

/** Walk forward one step. Returns `null` when there is nothing to redo. */
export function redo(
  stack: UndoStack,
  current: SnippetsDoc,
): { stack: UndoStack; doc: SnippetsDoc } | null {
  if (stack.future.length === 0) return null;
  const future = stack.future.slice();
  const doc = future.shift() as SnippetsDoc;
  return { stack: { past: [...stack.past, current], future }, doc };
}

// ── Frame decisions ────────────────────────────────────────────────────────

/**
 * True when an inbound frame is the echo of this client's own last write (its
 * hash matches `lastWrittenHash`) and should be ignored so it does not disturb
 * an in-progress edit ([P03]).
 */
export function shouldIgnoreFrame(frame: SnippetsFrame, lastWrittenHash: string | null): boolean {
  return lastWrittenHash !== null && frame.hash !== null && frame.hash === lastWrittenHash;
}

/**
 * Merge a foreign document (written by another build) into the local view,
 * preserving the row currently open for editing (Risk R01): every row takes
 * the foreign value except `openRowId`, which keeps its local content and is
 * re-inserted at its foreign position (or appended if the foreign doc dropped
 * it). When no row is open, the foreign document wins wholesale.
 */
export function mergeForeignDoc(
  local: SnippetsDoc,
  foreign: SnippetsDoc,
  openRowId: string | null,
): SnippetsDoc {
  if (openRowId === null) return foreign;
  const localOpen = local.snippets.find((s) => s.id === openRowId);
  if (localOpen === undefined) return foreign;

  const foreignHasOpen = foreign.snippets.some((s) => s.id === openRowId);
  const snippets = foreign.snippets.map((s) => (s.id === openRowId ? localOpen : s));
  if (!foreignHasOpen) snippets.push(localOpen);
  return { ...foreign, snippets };
}
