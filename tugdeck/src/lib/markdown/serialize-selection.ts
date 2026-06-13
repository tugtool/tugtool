/**
 * `serialize-selection.ts` — turn a live DOM `Selection` into markdown.
 *
 * Governing principle: **the copy is the selected text, decorated with
 * the styling those characters carry — built from the selection, clipped
 * to the selection.** Never the source sliced to whole-construct
 * boundaries; never a plain-text bail when styling is hard.
 *
 * How: walk the **text nodes inside the range** in document order,
 * clipping the first/last to the selection's offsets, so the text is
 * exactly what's selected. For each run, read its inline styling from its
 * ancestors (`<strong>`→`**`, `<em>`→`*`, `<del>`→`~~`, `<code>`→`` ` ``,
 * `<a>`→`[…](href)`) and its block context (heading level, list item,
 * code fence, blockquote), and emit markdown that wraps **only** the
 * selected text. A partial bold selection → `**old**`; a heading → `## …`;
 * an unstyled run → plain. Markers aren't text, so the rendered result
 * equals the selection exactly.
 *
 * Because only text nodes produce output, structural/empty nodes the
 * selection merely grazed — a bare `<hr>`, an empty heading clone at a
 * boundary — contribute nothing: overshoot is impossible by construction.
 *
 * Math comes from KaTeX's embedded TeX annotation (`$tex$` / `$$tex$$`),
 * emitted once per `.katex` (skipping its duplicated MathML/visual text);
 * fenced code from the `<pre>` text.
 *
 * Laws: [L07] reads the live selection inside the copy gesture; no state.
 *
 * @module lib/markdown/serialize-selection
 */

interface Marks {
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
}

interface BlockInfo {
  /** The block element — runs sharing it group into one block. */
  el: Element;
  /** "heading" | "li" | "pre" | "p" (default). */
  kind: string;
  /** Heading level (1..6) when kind === "heading"; 0 otherwise. */
  level: number;
  /** Inside a `<blockquote>` (prefix lines with `> `). */
  inQuote: boolean;
}

interface Run {
  text: string;
  block: BlockInfo;
  marks: Marks;
  /** Pre-formatted (KaTeX TeX) — emitted verbatim, no inline marks. */
  raw: boolean;
}

const BLOCK_TAGS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "PRE",
  "BLOCKQUOTE",
  "TD",
  "TH",
]);

function isBlockBoundary(el: Element): boolean {
  return BLOCK_TAGS.has(el.tagName) || el.classList.contains("tugx-md-block");
}

function closestKatex(node: Node): Element | null {
  let el = node.parentElement;
  while (el !== null) {
    if (el.classList.contains("katex") || el.classList.contains("katex-display")) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

/** `$tex$` / `$$tex$$` from a KaTeX render's embedded TeX annotation. */
function serializeKatex(el: Element): string {
  const ann = el.querySelector('annotation[encoding="application/x-tex"]');
  const tex = (ann?.textContent ?? "").trim();
  const display =
    el.classList.contains("katex-display") || el.closest(".katex-display") !== null;
  if (tex === "") return (el.textContent ?? "").trim();
  return display ? `$$${tex}$$` : `$${tex}$`;
}

/** The block context of a text node: nearest block ancestor + flags. */
function blockInfoOf(node: Node): BlockInfo {
  let el = node.parentElement;
  let block: Element | null = null;
  let inPre = false;
  let inQuote = false;
  while (el !== null) {
    const tag = el.tagName;
    if (tag === "PRE") inPre = true;
    if (tag === "BLOCKQUOTE") inQuote = true;
    if (block === null && BLOCK_TAGS.has(tag)) block = el;
    if (el.classList.contains("tugx-md-block")) {
      if (block === null) block = el;
      break;
    }
    el = el.parentElement;
  }
  if (block === null) block = node.parentElement ?? (node as Element);
  const tag = block.tagName;
  const kind = inPre
    ? "pre"
    : /^H[1-6]$/.test(tag)
      ? "heading"
      : tag === "LI"
        ? "li"
        : "p";
  const level = /^H[1-6]$/.test(tag) ? Number(tag[1]) : 0;
  return { el: block, kind, level, inQuote };
}

/** Inline styling of a text node, from its ancestors up to the block. */
function marksOf(node: Node): Marks {
  const marks: Marks = {};
  let el = node.parentElement;
  while (el !== null && !isBlockBoundary(el)) {
    switch (el.tagName) {
      case "STRONG":
      case "B":
        marks.bold = true;
        break;
      case "EM":
      case "I":
        marks.italic = true;
        break;
      case "DEL":
      case "S":
        marks.strike = true;
        break;
      case "CODE":
        marks.code = true;
        break;
      case "A":
        if (marks.href === undefined) {
          marks.href = el.getAttribute("href") ?? undefined;
        }
        break;
      default:
        break;
    }
    el = el.parentElement;
  }
  return marks;
}

/** Walk the text runs inside `range`, clipped to the selection. */
function collectRuns(range: Range): Run[] {
  const root =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement;
  if (root === null) return [];

  const doc = root.ownerDocument;
  if (doc === null) return [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const runs: Run[] = [];
  const seenKatex = new Set<Element>();

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const textNode = node as Text;
    if (!range.intersectsNode(textNode)) continue;

    // KaTeX: emit the TeX once for the whole `.katex`, skip its text.
    const katex = closestKatex(textNode);
    if (katex !== null) {
      if (!seenKatex.has(katex)) {
        seenKatex.add(katex);
        runs.push({
          text: serializeKatex(katex),
          block: blockInfoOf(katex),
          marks: {},
          raw: true,
        });
      }
      continue;
    }

    let text = textNode.data;
    const start = textNode === range.startContainer ? range.startOffset : 0;
    const end = textNode === range.endContainer ? range.endOffset : text.length;
    text = text.slice(start, end);
    if (text === "") continue;

    const block = blockInfoOf(textNode);
    runs.push({
      text,
      block,
      marks: block.kind === "pre" ? {} : marksOf(textNode),
      raw: block.kind === "pre",
    });
  }
  return runs;
}

/** Wrap a run's text in its inline markers, keeping whitespace outside. */
function applyMarks(text: string, marks: Marks): string {
  const lead = /^\s*/.exec(text)?.[0] ?? "";
  const trail = /\s*$/.exec(text)?.[0] ?? "";
  let core = text.slice(lead.length, text.length - trail.length);
  if (core === "") return text;
  if (marks.code === true) core = "`" + core + "`";
  if (marks.strike === true) core = "~~" + core + "~~";
  if (marks.italic === true) core = "*" + core + "*";
  if (marks.bold === true) core = "**" + core + "**";
  if (marks.href !== undefined && marks.href !== "") {
    core = "[" + core + "](" + marks.href + ")";
  }
  return lead + core + trail;
}

/** Emit one grouped block's markdown. */
function emitBlock(kind: string, level: number, inQuote: boolean, body: string): string {
  if (kind === "pre") {
    return "```\n" + body.replace(/\n+$/, "") + "\n```";
  }
  const text = body.replace(/^\s+/, "").replace(/\s+$/, "");
  if (text === "") return "";
  if (kind === "heading") return "#".repeat(level) + " " + text;
  if (kind === "li") return "- " + text;
  if (inQuote) {
    return text
      .split("\n")
      .map((l) => (l === "" ? ">" : "> " + l))
      .join("\n");
  }
  return text;
}

/**
 * Reconstruct markdown for the current selection. Returns `null` only when
 * the selection is empty. `bodyEl` is unused today (the runs come from the
 * range); kept for call-site stability and future per-cell scoping.
 */
export function selectionToTranscriptMarkdown(
  selection: Selection,
  _bodyEl: HTMLElement,
): string | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;
  const runs = collectRuns(selection.getRangeAt(0));
  if (runs.length === 0) return null;

  // Group consecutive runs by their block element.
  const out: string[] = [];
  let curEl: Element | null = null;
  let curKind = "p";
  let curLevel = 0;
  let curQuote = false;
  let body = "";
  const flush = (): void => {
    if (curEl === null) return;
    const block = emitBlock(curKind, curLevel, curQuote, body);
    if (block.trim() !== "") out.push(block);
    body = "";
  };
  for (const run of runs) {
    if (run.block.el !== curEl) {
      flush();
      curEl = run.block.el;
      curKind = run.block.kind;
      curLevel = run.block.level;
      curQuote = run.block.inQuote;
    }
    body += run.raw ? run.text : applyMarks(run.text, run.marks);
  }
  flush();

  const md = out.join("\n\n").trim();
  return md.length > 0 ? md : null;
}
