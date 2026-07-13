/**
 * anchor-links — ⌘-click intra-document navigation for the text card.
 *
 * A markdown plan cites itself through several link conventions:
 *
 *   - explicit heading anchors `{#slug}` and the links that target them
 *     (`#slug`, `[#slug]`, `[label](#slug)`);
 *   - table-row identifiers like `#step-7` used as jump targets;
 *   - plan-local shorthands `[Q01]` / `[P05]` / `[R01]` / `[S01]` / `[M04]`
 *     that name the heading declaring that decision, question, risk, or spec.
 *
 * This extension makes those references clickable IN THE SOURCE BUFFER
 * without leaving edit mode: a plain click still places the caret; only a
 * ⌘-click (Ctrl on non-mac) navigates. A resolvable reference is marked so
 * that, while the accelerator is held, it shows a pointer + underline (the
 * `cm-anchor-mod` class the plugin toggles on the editor, styled in
 * `tug-text-card-editor.css`).
 *
 * Resolution is index-driven: the document is scanned once per change into
 * lookup maps, so both the viewport decorator and the click handler resolve
 * a token in O(1). A token is decorated only if it resolves — bare `[x]`
 * checkboxes and other bracketed prose stay inert.
 *
 * Appearance-only via a CM6 mark decoration + CSS ([L06]); the jump itself
 * reuses the card's `revealLine` flash through the injected `navigate`.
 *
 * @module components/tugways/tug-text-card-editor/anchor-links
 */

import { RangeSetBuilder } from "@codemirror/state";
import type { Extension, Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

/**
 * The platform accelerator for "follow this link". ⌘ on macOS (Ctrl there is
 * a right-click), Ctrl elsewhere — mirroring the editor's other modifier
 * gestures (see `use-outer-scroll-on-modifier-wheel`).
 */
const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");

function accelHeld(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey;
}

// ---------------------------------------------------------------------------
// Token grammar
// ---------------------------------------------------------------------------
//
// A single alternation covers every clickable reference form. Order matters:
// the labelled markdown link (`[text](#anchor)`) is tried before the shortcut
// bracket so a labelled link is matched whole. The final branch — a bare
// `#anchor` — requires a preceding whitespace / `(` / `|` so it never fires on
// a markdown heading marker (`#### …`, no space before the hash) or on an
// anchor definition `{#slug}` (preceded by `{`).

const TOKEN_SOURCE =
  "\\[[^\\]\\n]+\\]\\(#[\\w-]+\\)|\\[#?[A-Za-z][\\w-]*\\]|(?<=[\\s(|])#[A-Za-z][\\w-]*";

interface TokenMatch {
  start: number;
  end: number;
  token: string;
}

/** Every reference token on a line, in column order. */
function matchTokens(lineText: string): TokenMatch[] {
  const re = new RegExp(TOKEN_SOURCE, "g");
  const out: TokenMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(lineText)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, token: m[0] });
  }
  return out;
}

/** The reference token covering `col`, or `null` if the column sits in prose. */
function tokenAt(lineText: string, col: number): string | null {
  for (const t of matchTokens(lineText)) {
    if (col >= t.start && col <= t.end) return t.token;
    if (t.start > col) break;
  }
  return null;
}

/** Normalise a raw token to a lookup key + kind, or `null` if not a link. */
function normalizeToken(
  token: string,
): { kind: "hash" | "short"; key: string } | null {
  let m: RegExpExecArray | null;
  if ((m = /^\[[^\]]+\]\(#([\w-]+)\)$/.exec(token)) !== null) {
    return { kind: "hash", key: m[1] };
  }
  if ((m = /^\[#([\w-]+)\]$/.exec(token)) !== null) {
    return { kind: "hash", key: m[1] };
  }
  if ((m = /^\[([A-Za-z][\w-]*)\]$/.exec(token)) !== null) {
    return { kind: "short", key: m[1].toUpperCase() };
  }
  if ((m = /^#([\w-]+)$/.exec(token)) !== null) {
    return { kind: "hash", key: m[1] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Document index
// ---------------------------------------------------------------------------

interface AnchorIndex {
  /** `{#slug}` → 1-based line of the heading it anchors. */
  anchors: Map<string, number>;
  /** table-row identifier `#slug` (row start or after `|`) → its line. */
  hashRows: Map<string, number>;
  /** `Q01` / `P05` / `R01` / `S01` / `M04` → the heading that declares it. */
  shorthands: Map<string, number>;
  /** GitHub-style slug of a heading's text → its line (anchorless fallback). */
  headingSlugs: Map<string, number>;
}

const ANCHOR_RE = /\{#([\w-]+)\}/g;
const HASH_ROW_RE = /(?:^|\|)\s*#([A-Za-z][\w-]*)\b/g;
const SHORTHAND_RE = /\b([A-Za-z]\d{2})\b/g;
const HEADING_RE = /^\s*(?:#{1,6}\s+|\*\*)/;

/** GitHub-style slug of a heading's visible text (anchor + markup stripped). */
function githubSlug(lineText: string): string {
  return lineText
    .replace(/\{#[\w-]+\}\s*$/, "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/\*\*/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

function buildIndex(doc: Text): AnchorIndex {
  const anchors = new Map<string, number>();
  const hashRows = new Map<string, number>();
  const shorthands = new Map<string, number>();
  const headingSlugs = new Map<string, number>();

  const total = doc.lines;
  for (let n = 1; n <= total; n++) {
    const text = doc.line(n).text;

    ANCHOR_RE.lastIndex = 0;
    for (let m = ANCHOR_RE.exec(text); m !== null; m = ANCHOR_RE.exec(text)) {
      if (!anchors.has(m[1])) anchors.set(m[1], n);
    }

    HASH_ROW_RE.lastIndex = 0;
    for (let m = HASH_ROW_RE.exec(text); m !== null; m = HASH_ROW_RE.exec(text)) {
      if (!hashRows.has(m[1])) hashRows.set(m[1], n);
    }

    if (HEADING_RE.test(text)) {
      SHORTHAND_RE.lastIndex = 0;
      for (let m = SHORTHAND_RE.exec(text); m !== null; m = SHORTHAND_RE.exec(text)) {
        const key = m[1].toUpperCase();
        if (!shorthands.has(key)) shorthands.set(key, n);
      }
      const slug = githubSlug(text);
      if (slug.length > 0 && !headingSlugs.has(slug)) headingSlugs.set(slug, n);
    }
  }

  return { anchors, hashRows, shorthands, headingSlugs };
}

/** The 1-based line a reference token jumps to, or `null` if unresolved. */
function resolveLine(index: AnchorIndex, token: string): number | null {
  const n = normalizeToken(token);
  if (n === null) return null;
  if (n.kind === "short") return index.shorthands.get(n.key) ?? null;
  return (
    index.anchors.get(n.key) ??
    index.hashRows.get(n.key) ??
    index.headingSlugs.get(n.key) ??
    null
  );
}

// ---------------------------------------------------------------------------
// View plugin — viewport decoration + accelerator affordance
// ---------------------------------------------------------------------------

const anchorLinkMark = Decoration.mark({ class: "cm-anchor-link" });

class AnchorLinkPlugin {
  decorations: DecorationSet;
  private cachedIndex: AnchorIndex;
  private accelActive = false;

  constructor(private readonly view: EditorView) {
    this.cachedIndex = buildIndex(view.state.doc);
    this.decorations = this.buildDecorations(view);

    const win = view.dom.ownerDocument.defaultView;
    win?.addEventListener("keydown", this.onModifier, true);
    win?.addEventListener("keyup", this.onModifier, true);
    win?.addEventListener("blur", this.clearAccel);
  }

  update(u: ViewUpdate): void {
    if (u.docChanged) {
      this.cachedIndex = buildIndex(u.state.doc);
    }
    if (u.docChanged || u.viewportChanged) {
      this.decorations = this.buildDecorations(u.view);
    }
  }

  destroy(): void {
    const win = this.view.dom.ownerDocument.defaultView;
    win?.removeEventListener("keydown", this.onModifier, true);
    win?.removeEventListener("keyup", this.onModifier, true);
    win?.removeEventListener("blur", this.clearAccel);
    this.view.dom.classList.remove("cm-anchor-mod");
  }

  /** Resolve a raw token against the live index (used by the click handler). */
  resolve(token: string): number | null {
    return resolveLine(this.cachedIndex, token);
  }

  private buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    let lastLine = 0;
    for (const { from, to } of view.visibleRanges) {
      let pos = from;
      while (pos <= to) {
        const line = view.state.doc.lineAt(pos);
        if (line.number > lastLine) {
          lastLine = line.number;
          for (const t of matchTokens(line.text)) {
            if (resolveLine(this.cachedIndex, t.token) !== null) {
              builder.add(line.from + t.start, line.from + t.end, anchorLinkMark);
            }
          }
        }
        if (line.to + 1 <= pos) break;
        pos = line.to + 1;
      }
    }
    return builder.finish();
  }

  private readonly onModifier = (e: KeyboardEvent): void => {
    const held = accelHeld(e);
    if (held === this.accelActive) return;
    this.accelActive = held;
    this.view.dom.classList.toggle("cm-anchor-mod", held);
  };

  private readonly clearAccel = (): void => {
    if (!this.accelActive) return;
    this.accelActive = false;
    this.view.dom.classList.remove("cm-anchor-mod");
  };
}

const anchorLinkPlugin = ViewPlugin.fromClass(AnchorLinkPlugin, {
  decorations: (plugin) => plugin.decorations,
});

/**
 * ⌘-click (Ctrl-click off macOS) intra-document link navigation for the
 * text card. `navigate(line)` is called with the 1-based target line — the
 * card wires this to `revealLine` so the jump lands with the accent flash.
 */
export function anchorLinkExtension(navigate: (line: number) => void): Extension {
  return [
    anchorLinkPlugin,
    EditorView.domEventHandlers({
      mousedown(e, view) {
        if (e.button !== 0 || !accelHeld(e)) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null) return false;
        const line = view.state.doc.lineAt(pos);
        const token = tokenAt(line.text, pos - line.from);
        if (token === null) return false;
        const plugin = view.plugin(anchorLinkPlugin);
        const target =
          plugin?.resolve(token) ?? resolveLine(buildIndex(view.state.doc), token);
        if (target === null) return false;
        e.preventDefault();
        e.stopPropagation();
        navigate(target);
        return true;
      },
    }),
  ];
}
