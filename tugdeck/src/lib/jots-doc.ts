/**
 * Pure document logic for the Jots feature — no IO, no timers, no React.
 *
 * Everything decision-shaped lives here so it is testable as pure logic
 * (`src/__tests__/jots-doc.test.ts`): the immutable S01 document
 * transforms, the undo/redo stack, echo suppression, and the foreign-merge
 * open-row carve-out (Risk R01). `jots-store.ts` composes these with the
 * feed subscription, autosave, and the `useSyncExternalStore` surface.
 *
 * Mirrors the Rust model in `tugcast/src/jots.rs` (Spec S01/S02).
 */

/** The only document version this build reads and writes. */
export const JOTS_VERSION = 1;

/** One reusable jot: an opaque id and its (possibly multi-line) text. The
 *  row's handle is the *incipit* (opening line of `text`), not a stored title. */
export interface Jot {
  id: string;
  text: string;
}

/** The whole jots document. Array position is display order ([P09]). */
export interface JotsDoc {
  version: number;
  jots: Jot[];
}

/** The JOTS feed frame payload (Spec S02). */
export interface JotsFrame {
  doc: JotsDoc;
  hash: string | null;
  error: string | null;
}

/** The empty document served when `jots.json` is missing. */
export function emptyDoc(): JotsDoc {
  return { version: JOTS_VERSION, jots: [] };
}

/** Generate a stable opaque jot id: `jt_` + 12 hex chars. */
export function newJotId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `jt_${hex}`;
}

/**
 * The jot's *incipit* — its opening line, the handle shown in the list
 * (borrowed from how papal bulls are named by their first words). Empty when
 * the jot has no text yet.
 */
export function jotIncipit(jot: Jot): string {
  return jot.text.trimStart().split("\n", 1)[0]?.trim() ?? "";
}

/**
 * Parse a JOTS feed payload into a validated frame, or `null` if the bytes
 * are not a well-formed S02 frame.
 */
export function parseJotsFrame(payload: Uint8Array): JotsFrame | null {
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
  if (typeof d.version !== "number" || !Array.isArray(d.jots)) return null;
  const jots: Jot[] = [];
  for (const raw of d.jots) {
    if (typeof raw !== "object" || raw === null) return null;
    const s = raw as Record<string, unknown>;
    if (typeof s.id !== "string") return null;
    jots.push({
      id: s.id,
      text: typeof s.text === "string" ? s.text : "",
    });
  }
  return {
    doc: { version: d.version, jots },
    hash: typeof obj.hash === "string" ? obj.hash : null,
    error: typeof obj.error === "string" ? obj.error : null,
  };
}

// ── Immutable document transforms ──────────────────────────────────────────

/**
 * Insert a new blank jot after `afterId` (or at the end when `afterId` is
 * absent / not found). Returns the new document and the new jot's id.
 */
export function applyCreate(
  doc: JotsDoc,
  afterId: string | null,
  id: string,
): { doc: JotsDoc; id: string } {
  const jot: Jot = { id, text: "" };
  const idx = afterId === null ? -1 : doc.jots.findIndex((s) => s.id === afterId);
  const jots = doc.jots.slice();
  if (idx < 0) jots.push(jot);
  else jots.splice(idx + 1, 0, jot);
  return { doc: { ...doc, jots }, id };
}

/** Set a jot's text. No-op if `id` is absent. */
export function applyUpdate(doc: JotsDoc, id: string, text: string): JotsDoc {
  const jots = doc.jots.map((s) => (s.id === id ? { ...s, text } : s));
  return { ...doc, jots };
}

/**
 * Remove a jot. Returns the new document and the id that should take
 * selection next (the successor row, else the new last row, else `null`).
 */
export function applyDelete(
  doc: JotsDoc,
  id: string,
): { doc: JotsDoc; nextSelected: string | null } {
  const idx = doc.jots.findIndex((s) => s.id === id);
  if (idx < 0) return { doc, nextSelected: null };
  const jots = doc.jots.slice();
  jots.splice(idx, 1);
  let nextSelected: string | null = null;
  if (jots.length > 0) {
    const nextIdx = Math.min(idx, jots.length - 1);
    nextSelected = jots[nextIdx].id;
  }
  return { doc: { ...doc, jots }, nextSelected };
}

/**
 * Reorder to match `ids`. Jots not named in `ids` keep their relative
 * order at the end (defensive; the caller always passes a full permutation).
 */
export function applyOrder(doc: JotsDoc, ids: string[]): JotsDoc {
  const byId = new Map(doc.jots.map((s) => [s.id, s]));
  const ordered: Jot[] = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (s) {
      ordered.push(s);
      byId.delete(id);
    }
  }
  for (const s of byId.values()) ordered.push(s);
  return { ...doc, jots: ordered };
}

// ── Undo/redo stack ────────────────────────────────────────────────────────

/** Bounded whole-document undo/redo stack ([P07]). */
export interface UndoStack {
  past: JotsDoc[];
  future: JotsDoc[];
}

/** Maximum retained undo entries. */
export const UNDO_LIMIT = 50;

export function emptyUndo(): UndoStack {
  return { past: [], future: [] };
}

/** Push `prevDoc` (the state before a mutation) onto the stack; clears redo. */
export function pushUndo(stack: UndoStack, prevDoc: JotsDoc): UndoStack {
  const past = [...stack.past, prevDoc];
  if (past.length > UNDO_LIMIT) past.shift();
  return { past, future: [] };
}

/** Walk back one step. Returns `null` when there is nothing to undo. */
export function undo(
  stack: UndoStack,
  current: JotsDoc,
): { stack: UndoStack; doc: JotsDoc } | null {
  if (stack.past.length === 0) return null;
  const past = stack.past.slice();
  const doc = past.pop() as JotsDoc;
  return { stack: { past, future: [current, ...stack.future] }, doc };
}

/** Walk forward one step. Returns `null` when there is nothing to redo. */
export function redo(
  stack: UndoStack,
  current: JotsDoc,
): { stack: UndoStack; doc: JotsDoc } | null {
  if (stack.future.length === 0) return null;
  const future = stack.future.slice();
  const doc = future.shift() as JotsDoc;
  return { stack: { past: [...stack.past, current], future }, doc };
}

// ── Frame decisions ────────────────────────────────────────────────────────

/**
 * True when an inbound frame is the echo of this client's own last write (its
 * hash matches `lastWrittenHash`) and should be ignored so it does not disturb
 * an in-progress edit ([P03]).
 */
export function shouldIgnoreFrame(frame: JotsFrame, lastWrittenHash: string | null): boolean {
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
  local: JotsDoc,
  foreign: JotsDoc,
  openRowId: string | null,
): JotsDoc {
  if (openRowId === null) return foreign;
  const localOpen = local.jots.find((s) => s.id === openRowId);
  if (localOpen === undefined) return foreign;

  const foreignHasOpen = foreign.jots.some((s) => s.id === openRowId);
  const jots = foreign.jots.map((s) => (s.id === openRowId ? localOpen : s));
  if (!foreignHasOpen) jots.push(localOpen);
  return { ...foreign, jots };
}
