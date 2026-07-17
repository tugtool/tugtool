/**
 * PendingContextStore — the per-card queue of shell / `/btw` interactions
 * staged to ride the next `❯` (Claude) submission as attributed context.
 *
 * A shell exchange and a `/btw` side question are, by design, invisible to
 * Claude ([P08]/[P05]): the shell block is non-context ink, and a side
 * question never enters the transcript. This store is the on-demand bridge —
 * the user (or the VISIBILITY toggle) stages an interaction, and at the next
 * code-route send the staged items are prepended to the outgoing user message,
 * each wrapped in a `<tug-context>` sentinel. Because the sentinel travels
 * inside the user message it lands in the session JSONL, so the transcript's
 * user-row renderer splits the same sentinels back out on both the live echo
 * and a Maker ▸ Reload restore — one code path, durable by construction.
 *
 * The staged queue itself is ephemeral (in-memory, per card): an item staged
 * but never sent does not survive a hard reload. That is acceptable — the
 * durable record is the sent user turn, not the pre-send staging.
 *
 * @module lib/pending-context-store
 */

/** Which surface an item was staged from. */
export type ContextSource = "shell" | "btw";

/** One staged interaction awaiting the next code-route submission. */
export interface PendingContextItem {
  /** Stage id (`ctx-${seq}`) — the unstage handle. */
  readonly id: string;
  readonly source: ContextSource;
  /** The source row's address (`s3` for shell `#s3`, `b2` for a `/btw` pair). */
  readonly ref: string;
  /** Short human label for the composer chip (e.g. `shell #s3`). */
  readonly label: string;
  /** Composed content (already fence-safe for its source). */
  readonly body: string;
  /** Stage time (ms epoch). */
  readonly at: number;
}

const OPEN_RE = /^<tug-context source="(shell|btw)" ref="([^"]*)">\n/;
const CLOSE_TAG = "</tug-context>";

/**
 * A staged block that has been split back out of a user message — the shape
 * the transcript renders as an attached-context sub-row.
 */
export interface ParsedContextBlock {
  readonly source: ContextSource;
  readonly ref: string;
  readonly body: string;
}

/**
 * Guard a body so it cannot false-close its sentinel: any literal
 * `</tug-context>` inside the content gets a zero-width space after the `<`,
 * which is invisible on render but no longer matches the close tag. (Shell
 * output containing the literal tag is astronomically rare, but the split must
 * stay unambiguous.)
 */
function guardBody(body: string): string {
  return body.split(CLOSE_TAG).join("<\u200B/tug-context>");
}

/** Wrap one item's body in its `<tug-context>` sentinel. */
function composeBlock(item: Pick<PendingContextItem, "source" | "ref" | "body">): string {
  const body = guardBody(item.body.replace(/\s+$/u, ""));
  return `<tug-context source="${item.source}" ref="${item.ref}">\n${body}\n${CLOSE_TAG}`;
}

/**
 * Compose the sentinel prefix prepended to a user message when items are
 * staged. Blocks stack in stage order, separated by a blank line, and the
 * whole prefix ends with a blank line so the user's own prose starts clean.
 * Returns `null` for an empty queue.
 */
export function composeContextPrefix(
  items: readonly Pick<PendingContextItem, "source" | "ref" | "body">[],
): string | null {
  if (items.length === 0) return null;
  return items.map(composeBlock).join("\n\n") + "\n\n";
}

/**
 * Split any leading `<tug-context>` sentinel blocks off a user message,
 * returning the parsed blocks and the remaining prose. Non-sentinel text (the
 * common case — a plain user message) returns `{ blocks: [], rest: text }`.
 *
 * Runs on both the live optimistic echo and a JSONL restore, since both carry
 * the sentinel verbatim in the user message text. The scan only consumes
 * *leading* blocks: a `<tug-context>`-looking string mid-prose is left alone.
 */
export function splitLeadingContext(text: string): {
  blocks: ParsedContextBlock[];
  rest: string;
} {
  const blocks: ParsedContextBlock[] = [];
  let cursor = text;
  for (;;) {
    const open = OPEN_RE.exec(cursor);
    if (open === null) break;
    const bodyStart = open[0].length;
    const closeIdx = cursor.indexOf(`\n${CLOSE_TAG}`, bodyStart);
    if (closeIdx === -1) break;
    const body = cursor.slice(bodyStart, closeIdx);
    blocks.push({ source: open[1] as ContextSource, ref: open[2], body });
    // Advance past the close tag and any blank-line separator.
    cursor = cursor.slice(closeIdx + CLOSE_TAG.length + 1).replace(/^\n+/u, "");
  }
  return { blocks, rest: cursor };
}

/** Compose the markdown body for a staged `/btw` exchange — a Q/A pair. */
export function composeBtwContextBody(question: string, answer: string): string {
  return `**Side question:** ${question}\n\n${answer}`;
}

/** Reactive snapshot the composer / rows / VISIBILITY chip read via
 *  `useSyncExternalStore`. */
export interface PendingContextSnapshot {
  /** The staged items, in stage order. */
  readonly items: readonly PendingContextItem[];
  /** VISIBILITY=Context for the `$` shell route — auto-stage new exchanges. */
  readonly shellContext: boolean;
  /** VISIBILITY=Context for the `?` btw route — auto-stage new side questions. */
  readonly btwContext: boolean;
}

const EMPTY_ITEMS: readonly PendingContextItem[] = [];

export class PendingContextStore {
  private _items: readonly PendingContextItem[] = EMPTY_ITEMS;
  private _shellContext = false;
  private _btwContext = false;
  private _snapshot: PendingContextSnapshot = {
    items: EMPTY_ITEMS,
    shellContext: false,
    btwContext: false,
  };
  private _listeners = new Set<() => void>();
  private _seq = 0;

  /**
   * Stage an interaction. De-duplicated by `source`+`ref`: staging the same
   * row twice is a no-op (it is already queued), so the toggle's auto-stage
   * and a manual add can't double it.
   */
  stage(item: {
    source: ContextSource;
    ref: string;
    label: string;
    body: string;
  }): void {
    if (this._items.some((it) => it.source === item.source && it.ref === item.ref)) {
      return;
    }
    this._seq += 1;
    this._items = [
      ...this._items,
      {
        id: `ctx-${this._seq}`,
        source: item.source,
        ref: item.ref,
        label: item.label,
        body: item.body,
        at: Date.now(),
      },
    ];
    this._emit();
  }

  /** Un-stage one item by its stage id (the composer chip's `×`). */
  unstage(id: string): void {
    const next = this._items.filter((it) => it.id !== id);
    if (next.length === this._items.length) return;
    this._items = next;
    this._emit();
  }

  /** Un-stage by source+ref (the row's toggle-off). */
  unstageRef(source: ContextSource, ref: string): void {
    const next = this._items.filter((it) => !(it.source === source && it.ref === ref));
    if (next.length === this._items.length) return;
    this._items = next;
    this._emit();
  }

  /** Is this row currently staged? Drives the row's queued badge. */
  has(source: ContextSource, ref: string): boolean {
    return this._items.some((it) => it.source === source && it.ref === ref);
  }

  /** Empty the queue. */
  clear(): void {
    if (this._items.length === 0) return;
    this._items = EMPTY_ITEMS;
    this._emit();
  }

  /**
   * Compose the sentinel prefix for the staged items and clear the queue — the
   * consume-at-send path. Returns `null` (and clears nothing) when empty.
   */
  takePrefix(): string | null {
    const prefix = composeContextPrefix(this._items);
    if (prefix === null) return null;
    this._items = EMPTY_ITEMS;
    this._emit();
    return prefix;
  }

  // ── VISIBILITY (Context / Private) ──────────────────────────────────────────

  /** Read a route's VISIBILITY — `true` = Context (auto-stage), `false` =
   *  Private (the default). The settle handlers read this synchronously. */
  isContext(source: ContextSource): boolean {
    return source === "shell" ? this._shellContext : this._btwContext;
  }

  /** Set a route's VISIBILITY. Toggling to Private stops auto-staging future
   *  interactions but leaves already-staged items in place. */
  setContext(source: ContextSource, on: boolean): void {
    if (source === "shell") {
      if (this._shellContext === on) return;
      this._shellContext = on;
    } else {
      if (this._btwContext === on) return;
      this._btwContext = on;
    }
    this._emit();
  }

  private _emit(): void {
    this._snapshot = {
      items: this._items,
      shellContext: this._shellContext,
      btwContext: this._btwContext,
    };
    for (const listener of this._listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };

  getSnapshot = (): PendingContextSnapshot => this._snapshot;

  dispose(): void {
    this._listeners.clear();
    this._items = EMPTY_ITEMS;
  }
}
