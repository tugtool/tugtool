/**
 * `FileBlock` — Layer-1 body kind for read-only file viewing.
 *
 * A thin chrome around `TugCodeView`. FileBlock owns the framed look
 * (header strip with path / language pill / line counts / `Search` and
 * `Collapse` icon buttons), the long-file collapse-by-default behavior,
 * the embedded-mode variant for `ReadToolBlock` composition, and
 * nothing else. The CM6 substrate that actually renders the file
 * lives in `TugCodeView`; the bespoke per-line renderer that this
 * file used to ship was retired because it reimplemented features
 * the project already owns through `tug-text-editor`'s CM6
 * integration — and reimplemented them badly (per-line scrollbars,
 * stale search overlay, parallel-engine drift).
 *
 * Composition:
 *  - Header (chrome strip) — `path basename` + optional language pill
 *    + "N lines" / "Showing N of M lines" counts + `Search`
 *    `<TugIconButton>` (opens CM6's find panel via the viewer ref).
 *    Hidden when `embedded=true` because the host wrapper (e.g.
 *    `ToolWrapperChrome`) owns identity in those cases.
 *  - Fold cue — a `<TugCue role="active">` rendered whenever the file
 *    is `overThreshold`, in both states. Icon + label swap by state
 *    (chevron-down + "N lines folded — click to expand" vs chevron-up
 *    + "click to collapse"). This is the persistent toggle handle:
 *    embedded-mode hosts hide the header, so without a cue that
 *    spans both states the user could expand but not collapse back.
 *  - Body — `<TugCodeView>` (expanded) or nothing (collapsed). CM6
 *    isn't mounted while collapsed so a huge file doesn't pay the
 *    mount cost until the user reveals it.
 *
 * Long-file collapse:
 *  - Lines above `collapseThreshold` (default 80, per audit §5.1) fold
 *    by default. The fold cue invites the user to reveal. The
 *    threshold is visual policy; the audit measured Read P50 at 50
 *    lines, so the 80-line threshold catches the upper ~40% — long
 *    enough to scan-or-skip, short enough not to fold the average
 *    file.
 *  - The toggle dispatches a bubbling `tug-disengage-follow-bottom`
 *    `CustomEvent` *before* the React state update. A host like
 *    `TugListView` listens on its scroll container and calls
 *    `SmartScroll.disengageFollowBottom()`, so the ResizeObserver
 *    flush triggered by the cell-height change does not call
 *    `pinToBottom` (the post-commit pin effect bails on
 *    `!isFollowingBottom`). Without this, expanding a file inside a
 *    `followBottom` list scrolls the cue off-screen — violating
 *    "interacting with a control does not move that control out of
 *    view."
 *
 * Embedded mode:
 *  - `embedded=true` drops the standalone frame (background, border,
 *    radius, outer margin) and the header strip. The host wrapper
 *    owns identity and affordances. CM6 still renders the body, so
 *    the embedded host gets line wrapping + selection + a find UI
 *    for free.
 *
 * What this body kind does NOT do (and never will):
 *  - Render text with a bespoke DOM tree. CM6 is the canonical text
 *    engine for any file-based content (`tuglaws/component-authoring.md`
 *    §Text content); FileBlock composes the substrate, not bytes.
 *  - Implement its own find / Cmd-F bar. The substrate ships
 *    `@codemirror/search`; the header's `Search` button opens that
 *    panel via the viewer delegate.
 *  - Implement click-line-to-copy. CM6's native selection + Cmd-C
 *    handles region copy more naturally and consistently across the
 *    rest of the codebase. (The bespoke per-line click gesture used
 *    to exist; it has been retired with the rest of the bespoke
 *    renderer.)
 *  - Implement syntax highlighting. The substrate is wired today
 *    with the prop, and a follow-up step bridges Shiki (or a
 *    Lezer-based grammar) into CM6 decorations without changing
 *    this file's API.
 *
 * Laws:
 *  - [L06] all FileBlock-visible state (collapse) lives in React
 *    state because it controls *what* is rendered (one of two
 *    branches), not *how* a rendered element looks. The substrate's
 *    own appearance state lives in CM6 per its module docstring.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="file-body"` on the root, this docstring.
 *  - [L20] component-token sovereignty — owns the `--tugx-file-*`
 *    slot family; consumes `--tugx-block-*` directly for the shared
 *    block-surface scaffold.
 *
 * Decisions:
 *  - [D05] two-layer split: body kind (this file) vs. tool wrapper
 *    (`read-tool-block.tsx`).
 *  - CM6 is the canonical engine for file-based text content
 *    (`tuglaws/component-authoring.md` §Text content).
 *
 * @module components/tugways/body-kinds/file-block
 */

import "./file-block.css";

import React from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Search,
  X,
} from "lucide-react";

import { TugIconButton } from "@/components/tugways/tug-icon-button";
import { TugInput } from "@/components/tugways/tug-input";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import {
  TugCodeView,
  type TugCodeViewDelegate,
} from "@/components/tugways/tug-code-view";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Structured file-view data — the body's render input.
 *
 * `content` is the literal text of the (possibly windowed) file
 * region the producer wants to show. `startLine` (1-based) and
 * `numLines` describe what region of the source file this content
 * came from; `totalLines` (when known) drives the "Showing N of M"
 * header. All three are optional because they aren't always
 * meaningful (e.g., a generated paste has no source-file extent).
 */
export interface FileData {
  /**
   * Source path, used for language detection and the (consumer-owned)
   * header label. May be empty — "" disables both.
   */
  filePath: string;

  /** File contents to render, as a single newline-separated string. */
  content: string;

  /**
   * 1-based line number of the first line of `content`. Reserved for
   * future use by the substrate (e.g. seeding `lineNumbers()`'s
   * starting index). Defaults to 1.
   */
  startLine?: number;

  /**
   * Number of lines this view actually shows. When omitted, computed
   * from `content`. Mostly redundant with the parsed line count, but
   * useful when the producer knows the count up front (e.g., a Read
   * with `limit` set).
   */
  numLines?: number;

  /**
   * Total lines in the source file (not just the rendered window).
   * Drives the "Showing N of M lines" header. When equal to or less
   * than `numLines`, the header simplifies to "N lines" — a partial
   * window is the only case where M is interesting.
   */
  totalLines?: number;
}

export interface FileBlockProps {
  /**
   * The file data to render. When undefined, the block renders
   * nothing visible (empty `data-slot="file-body"` for layout
   * consistency).
   */
  data?: FileData;

  /**
   * Initial collapse state ([Spec S02]). When undefined, the
   * component picks the default from `collapseThreshold`: collapsed
   * if the line count exceeds the threshold, expanded otherwise.
   */
  collapsed?: boolean;

  /**
   * Notification callback fired when the user toggles the collapsed
   * state. Stateless when omitted (the component still tracks local
   * state internally — this is uncontrolled mode).
   */
  onToggleCollapsed?: (next: boolean) => void;

  /** Forwarded class name for cascade-scoped customization. */
  className?: string;

  /**
   * Threshold for default-folded behavior. Defaults to
   * `DEFAULT_COLLAPSE_THRESHOLD` (80, per audit §5.1). Files at or
   * below this many lines render expanded by default; files above it
   * fold by default.
   */
  collapseThreshold?: number;

  /**
   * "Embedded" mode — composed inside a host that already paints a
   * container and a header (e.g. `ToolWrapperChrome` in
   * `ReadToolBlock`). When `true`:
   *
   *   - The standalone frame (background / border / radius / outer
   *     margin) is dropped so the body sits flush with the host.
   *   - FileBlock's own header (basename + lang badge + line counts +
   *     icon buttons) is hidden — the wrapper owns the file's
   *     identity in its own header.
   *
   * Default `false` — standalone usage (gallery, RenderInput-routed)
   * keeps its frame and header.
   *
   * @default false
   */
  embedded?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default-collapse threshold in lines. 80 per the session-audit
 * §5.1: Read P50 = 50 so the previous threshold of 50 folded half of
 * every file by default — too aggressive. 80 lines catches the upper
 * ~40% — long enough to scan-or-skip, short enough not to fold the
 * average file.
 */
export const DEFAULT_COLLAPSE_THRESHOLD = 80;

const DATA_SLOT_ROOT = "file-body";
const DATA_SLOT_HEADER = "file-header";

// ---------------------------------------------------------------------------
// Pure helpers — exported because tests pin them
// ---------------------------------------------------------------------------

/**
 * Map filename extension → language identifier. Covers the common
 * languages used in `tugcode` sessions. Returns `undefined` when the
 * extension is unknown — the substrate then renders plain monospace,
 * which per audit §5.4 is the dominant case anyway (84% of fenced
 * blocks have no language).
 *
 * The identifiers match Shiki's vocabulary (kept so the future
 * Shiki-via-CM6 bridge can map directly), and a forward subset
 * matches Lezer's grammar names.
 */
const EXT_TO_LANG: Readonly<Record<string, string>> = Object.freeze({
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyi: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  cs: "csharp",
  fs: "fsharp",
  ml: "ocaml",
  hs: "haskell",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  clj: "clojure",
  cljs: "clojure",
  scala: "scala",
  groovy: "groovy",
  lua: "lua",
  php: "php",
  pl: "perl",
  pm: "perl",
  r: "r",
  jl: "julia",
  zig: "zig",
  v: "v",
  dart: "dart",
  vue: "vue",
  svelte: "svelte",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  fish: "shellscript",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  md: "markdown",
  markdown: "markdown",
  mdx: "mdx",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  sql: "sql",
  dockerfile: "dockerfile",
  makefile: "makefile",
  proto: "proto",
  graphql: "graphql",
  gql: "graphql",
  tex: "latex",
  diff: "diff",
  patch: "diff",
});

/**
 * Detect the language identifier for a file path, by extension.
 * Returns `undefined` when the extension is unknown.
 *
 * Special-cases bare filenames whose name is itself the language hint
 * (`Dockerfile`, `Makefile`) since they have no extension.
 */
export function detectLanguage(filePath: string): string | undefined {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  if (base === "") return undefined;
  if (base === "Dockerfile") return "dockerfile";
  if (base === "Makefile" || base === "makefile") return "makefile";

  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return undefined;
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG[ext];
}

/**
 * Split content into an array of lines. The trailing newline (if
 * present) does NOT produce a final empty line — the editor
 * convention. An empty string returns `[]`.
 */
export function splitContentLines(content: string): string[] {
  if (content.length === 0) return [];
  const parts = content.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * Compose the "Showing N of M lines" header label.
 *  - When `totalLines` is unknown or equals `numLines`, returns
 *    "N lines".
 *  - When `totalLines > numLines`, returns "Showing N of M lines".
 */
export function composeLineCountLabel(
  numLines: number,
  totalLines: number | undefined,
): string {
  if (totalLines === undefined || totalLines <= numLines) {
    return `${numLines} ${numLines === 1 ? "line" : "lines"}`;
  }
  return `Showing ${numLines} of ${totalLines} lines`;
}

/** Last segment of a path, with leading "/" stripped. Empty input → "". */
export function basename(filePath: string): string {
  if (filePath.length === 0) return "";
  const segments = filePath.split(/[\\/]/);
  return segments[segments.length - 1] ?? "";
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

export const FileBlock: React.FC<FileBlockProps> = ({
  data,
  collapsed: collapsedProp,
  onToggleCollapsed,
  className,
  collapseThreshold = DEFAULT_COLLAPSE_THRESHOLD,
  embedded = false,
}) => {
  // Derived display state — line count + language detection drive
  // the header label and the collapse default.
  const lines = React.useMemo(
    () => (data === undefined ? [] : splitContentLines(data.content)),
    [data?.content],
  );
  const language = React.useMemo(
    () => (data === undefined ? undefined : detectLanguage(data.filePath)),
    [data?.filePath],
  );
  const numLines = data?.numLines ?? lines.length;
  const headerLabel = composeLineCountLabel(numLines, data?.totalLines);

  const overThreshold = lines.length > collapseThreshold;
  const initialCollapsed =
    collapsedProp !== undefined ? collapsedProp : overThreshold;
  const [collapsed, setCollapsed] = React.useState<boolean>(initialCollapsed);

  // Root ref — used to dispatch the disengage-follow-bottom event so
  // the host (e.g. `TugListView`) releases its auto-pin lock before
  // the cell height change. Without that, the user clicks "expand",
  // the cell grows, `ResizeObserver` requests a bottom pin, and the
  // click target scrolls off-screen — violating "interacting with a
  // control does not move that control out of view."
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  // Header ref — used by the telescoping-pin ResizeObserver below to
  // write the visible header's measured height into
  // `--tugx-file-header-height` on the root so the `.tugx-file-actions`
  // row can pin BELOW the identity header in standalone mode. Null
  // when `embedded={true}` (no header rendered).
  const headerRef = React.useRef<HTMLDivElement | null>(null);
  // Actions-row ref — measured for `--tugx-file-actions-height` so the
  // Find UI row pins BELOW the actions row. Null when no actions row
  // renders (empty/collapsed-and-not-overThreshold edge case).
  const actionsRef = React.useRef<HTMLDivElement | null>(null);

  // Telescoping pin — write the live measured identity-header height
  // into `--tugx-file-header-height` on the root so the actions row
  // composed below can pin at
  // `top: calc(var(--tugx-pin-stack-top, 0)
  //          + var(--tugx-toolblock-header-height, 0)
  //          + var(--tugx-file-header-height, 0))`.
  // In embedded mode the header isn't rendered, so the ref is null
  // and the variable stays unset (`0` via the `calc()` fallback) —
  // the actions row then telescopes under the chrome's
  // `--tugx-toolblock-header-height` only.
  //
  // [L03] `useLayoutEffect` so the variable is set before paint —
  // first sticky pass uses the correct offset rather than a value
  // one frame late.
  // [L06] DOM write, never React state.
  // [L20] FileBlock owns `--tugx-file-*` (this is in that family);
  // the chrome's `--tugx-toolblock-header-height` is read but never
  // written from here.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const header = headerRef.current;
    if (root === null) return;
    if (header === null) {
      // Embedded mode (or empty data) — clear any stale value so
      // the calc() fallback to 0 takes effect.
      root.style.removeProperty("--tugx-file-header-height");
      return;
    }
    const write = (px: number): void => {
      root.style.setProperty("--tugx-file-header-height", `${px}px`);
    };
    write(header.offsetHeight);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const boxes = entry.borderBoxSize;
      const next =
        boxes !== undefined && boxes.length > 0
          ? boxes[0].blockSize
          : entry.contentRect.height;
      write(next);
    });
    observer.observe(header);
    return () => {
      observer.disconnect();
    };
  }, [embedded, data === undefined]);

  // Mirror of the header observer for the actions row. The Find row
  // pins below the actions row, so it consumes
  // `--tugx-file-actions-height` in its sticky `top` calc.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const actions = actionsRef.current;
    if (actions === null) {
      root.style.removeProperty("--tugx-file-actions-height");
      return;
    }
    const write = (px: number): void => {
      root.style.setProperty("--tugx-file-actions-height", `${px}px`);
    };
    write(actions.offsetHeight);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const boxes = entry.borderBoxSize;
      const next =
        boxes !== undefined && boxes.length > 0
          ? boxes[0].blockSize
          : entry.contentRect.height;
      write(next);
    });
    observer.observe(actions);
    return () => {
      observer.disconnect();
    };
    // Re-attach when the actions row mounts/unmounts. The dependency
    // array uses `data === undefined` as a proxy for the empty-state
    // edge case (no actions row); `embedded` is irrelevant here
    // because the actions row renders in BOTH modes.
  }, [data === undefined]);

  // Sync to controlled prop when it changes upstream so parents can
  // drive collapse from chrome elsewhere in the row.
  React.useEffect(() => {
    if (collapsedProp !== undefined) setCollapsed(collapsedProp);
  }, [collapsedProp]);

  const toggleCollapsed = React.useCallback(() => {
    // Dispatch BEFORE `setCollapsed` so the listener (TugListView's
    // SmartScroll, when present) flips `isFollowingBottom` to false
    // before React commits the new cell size; the subsequent
    // ResizeObserver flush then bails out of `pinToBottom` (see
    // `tug-list-view.tsx`:`isFollowingBottom` gate). Bubbles up
    // through the DOM tree; non-list hosts simply ignore it.
    rootRef.current?.dispatchEvent(
      new CustomEvent("tug-disengage-follow-bottom", { bubbles: true }),
    );
    setCollapsed((prev) => {
      const next = !prev;
      onToggleCollapsed?.(next);
      return next;
    });
  }, [onToggleCollapsed]);

  // Ref to the embedded TugCodeView so the Find UI can drive the
  // substrate's search state imperatively (set-query / next /
  // previous / select-all).
  const codeViewRef = React.useRef<TugCodeViewDelegate | null>(null);

  // ---- Find UI state ------------------------------------------------------
  //
  // FileBlock owns the Find UI chrome (uses `TugInput`, `TugIconButton`,
  // `TugCheckbox`) so the look matches the rest of the Tug component
  // vocabulary. State is local — closing the row resets to defaults so
  // the next open is a clean find session.
  const [findOpen, setFindOpen] = React.useState<boolean>(false);
  const [findQuery, setFindQuery] = React.useState<string>("");
  const [findCaseSensitive, setFindCaseSensitive] = React.useState<boolean>(false);
  const [findRegexp, setFindRegexp] = React.useState<boolean>(false);
  const [findWholeWord, setFindWholeWord] = React.useState<boolean>(false);
  const [findMatchCount, setFindMatchCount] = React.useState<number>(0);
  const findInputRef = React.useRef<HTMLInputElement | null>(null);

  // Responder form wires each checkbox's `senderId` to a state setter
  // so toggles land in React state without each control needing its
  // own `onChange`. TugInput uses native `onChange` (it routes typing
  // through the standard React change event, not the responder chain),
  // so the query string isn't a form slot here.
  const findCaseId = React.useId();
  const findRegexpId = React.useId();
  const findWordId = React.useId();
  const findForm = useResponderForm({
    toggle: {
      [findCaseId]: setFindCaseSensitive,
      [findRegexpId]: setFindRegexp,
      [findWordId]: setFindWholeWord,
    },
  });

  // Push query + options to CM6 whenever the user types or toggles an
  // option, then read back the live match count so the find row's
  // count display ("N matches") reflects the current query. Empty
  // query is a valid state — CM6 clears highlights when it sees an
  // empty search string, and `getMatchCount` returns 0 for invalid
  // queries.
  React.useEffect(() => {
    if (!findOpen) return;
    const delegate = codeViewRef.current;
    if (delegate === null) return;
    delegate.setSearchQuery({
      search: findQuery,
      caseSensitive: findCaseSensitive,
      regexp: findRegexp,
      wholeWord: findWholeWord,
    });
    setFindMatchCount(delegate.getMatchCount());
  }, [findOpen, findQuery, findCaseSensitive, findRegexp, findWholeWord]);

  const openFind = React.useCallback(() => {
    if (collapsed) {
      // Reveal the body first so the substrate is mounted and the
      // search state has somewhere to apply. Disengage the host list's
      // bottom-pin in the same beat (mirrors `toggleCollapsed`).
      rootRef.current?.dispatchEvent(
        new CustomEvent("tug-disengage-follow-bottom", { bubbles: true }),
      );
      setCollapsed(false);
      onToggleCollapsed?.(false);
    }
    setFindOpen(true);
    // Defer focus to the next tick so the input has mounted.
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, [collapsed, onToggleCollapsed]);

  const closeFind = React.useCallback(() => {
    setFindOpen(false);
    // Reopening should start fresh; clear local state and tell the
    // substrate to drop the query + close CM6's hidden panel so the
    // match-highlight overlay is fully torn down.
    setFindQuery("");
    setFindCaseSensitive(false);
    setFindRegexp(false);
    setFindWholeWord(false);
    setFindMatchCount(0);
    codeViewRef.current?.clearSearch();
  }, []);

  // Inline clear-X handler — wipes the query but keeps the find row
  // open so the user can type a new query without a round-trip
  // through the Search button.
  const clearFindQuery = React.useCallback(() => {
    setFindQuery("");
    findInputRef.current?.focus();
  }, []);

  const handleFindKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        // Two-step Escape: first press wipes the query (keeping the
        // find row open for a fresh search); a second press on the
        // now-empty input closes the row. Matches common editor
        // behavior (VS Code, Xcode).
        if (findQuery.length > 0) {
          clearFindQuery();
        } else {
          closeFind();
        }
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        // Same guard as the navigation buttons — Enter on an empty
        // input must NOT trigger CM6's openSearchPanel-from-selection
        // fallback, which would resurrect the previous query.
        if (findQuery.length === 0) return;
        if (e.shiftKey) {
          codeViewRef.current?.findPrevious();
        } else {
          codeViewRef.current?.findNext();
        }
      }
    },
    [closeFind, clearFindQuery, findQuery.length],
  );

  // Navigation guards — when the input is empty there is no active
  // query, so a Next/Prev call must be a no-op. CM6's bundled
  // `cmFindNext` wraps a `searchCommand` fallback that, when given an
  // invalid query, calls `openSearchPanel(view)` — and that function
  // re-seeds the query from the current selection. After a clear,
  // the user's old match is still selected, so the fallback would
  // resurrect the previous query ("for") and findNext would navigate
  // to it. Guarding at the host keeps the no-op behavior intuitive.
  const handleFindNext = React.useCallback(() => {
    if (findQuery.length === 0) return;
    codeViewRef.current?.findNext();
  }, [findQuery.length]);
  const handleFindPrevious = React.useCallback(() => {
    if (findQuery.length === 0) return;
    codeViewRef.current?.findPrevious();
  }, [findQuery.length]);

  // Cmd-G / Shift-Cmd-G (Ctrl on non-Mac) — Find-next / Find-previous
  // while the find row is open, regardless of which element has focus
  // (input, editor, or one of the row's buttons). The listener
  // attaches only while `findOpen` is true so it doesn't shadow any
  // app-level binding outside a find session. `findQueryRef` lets
  // the static listener read the latest query without re-attaching
  // on every keystroke.
  const findQueryRef = React.useRef(findQuery);
  React.useEffect(() => {
    findQueryRef.current = findQuery;
  }, [findQuery]);
  React.useEffect(() => {
    if (!findOpen) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key !== "g" && e.key !== "G") return;
      e.preventDefault();
      // Same guard as the buttons — empty query → no-op (avoids CM6's
      // openSearchPanel-from-selection fallback).
      if (findQueryRef.current.length === 0) return;
      const delegate = codeViewRef.current;
      if (delegate === null) return;
      if (e.shiftKey) {
        delegate.findPrevious();
      } else {
        delegate.findNext();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [findOpen]);

  // Empty data: render an empty marker for layout consistency. Same
  // contract as before — consumers may depend on the data-empty
  // attribute (e.g. for CSS rules that suppress the frame).
  if (data === undefined || lines.length === 0) {
    return (
      <div
        ref={rootRef}
        data-slot={DATA_SLOT_ROOT}
        data-empty="true"
        data-embedded={embedded ? "true" : undefined}
        className={
          className === undefined ? "tugx-file" : `tugx-file ${className}`
        }
      />
    );
  }

  const langClass =
    language === undefined ? "" : ` tugx-file--lang-${language}`;
  const rootClass =
    `tugx-file${langClass}` +
    (className === undefined ? "" : ` ${className}`);

  // Fold cue: a compact click target inside the actions row that swaps
  // icon + (optional) label by state. Always rendered when
  // `overThreshold` so the user has a stable handle for the collapse <->
  // expand cycle in both modes (embedded and standalone). The icon-only
  // form when expanded keeps the actions row tight — the row also hosts
  // Search, and the cue's count label is only informationally
  // interesting while the body is folded.
  const cueIcon = collapsed ? <ChevronsDown /> : <ChevronsUp />;
  const showCue = overThreshold;
  // Actions row visibility: any affordance triggers it. Search appears
  // when expanded; fold cue appears when overThreshold. Empty data was
  // already short-circuited above, so we never render an empty row.
  const showActions = showCue || !collapsed;

  return (
    <div
      ref={rootRef}
      data-slot={DATA_SLOT_ROOT}
      data-empty="false"
      data-language={language ?? "plain"}
      data-collapsed={collapsed ? "true" : "false"}
      data-embedded={embedded ? "true" : undefined}
      className={rootClass}
      tabIndex={-1}
    >
      {embedded ? null : (
        <div
          ref={headerRef}
          className="tugx-file-header"
          data-slot={DATA_SLOT_HEADER}
        >
          <span
            className="tugx-file-path"
            data-slot="file-path"
            title={data.filePath}
          >
            {basename(data.filePath)}
          </span>
          {language !== undefined ? (
            <span className="tugx-file-lang" data-slot="file-lang">
              {language}
            </span>
          ) : null}
          <span className="tugx-file-counts" data-slot="file-counts">
            {headerLabel}
          </span>
        </div>
      )}

      {showActions ? (
        <div
          ref={actionsRef}
          className="tugx-file-actions"
          data-slot="file-actions"
        >
          {showCue ? (
            <button
              type="button"
              className="tugx-file-fold-cue"
              data-slot="file-fold-cue"
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand file" : "Collapse file"}
              onClick={toggleCollapsed}
            >
              <span className="tugx-file-fold-cue-icon" aria-hidden="true">
                {cueIcon}
              </span>
              {collapsed ? (
                <span className="tugx-file-fold-cue-label">
                  {`${lines.length.toLocaleString()} lines folded`}
                </span>
              ) : null}
            </button>
          ) : null}
          <span className="tugx-file-actions-spacer" />
          {!collapsed ? (
            <TugIconButton
              icon={<Search />}
              aria-label="Search in file"
              onClick={openFind}
            />
          ) : null}
        </div>
      ) : null}

      {findOpen && !collapsed ? (
        <findForm.ResponderScope>
          <div
            ref={findForm.responderRef}
            className="tugx-file-find"
            data-slot="file-find"
            onKeyDown={(e) => {
              // Catch Escape at the row level too so any focused
              // descendant (checkboxes, buttons) can dismiss with Esc.
              // Same two-step semantics as the input handler:
              // clear-then-close.
              if (e.key === "Escape") {
                e.preventDefault();
                if (findQuery.length > 0) {
                  clearFindQuery();
                } else {
                  closeFind();
                }
              }
            }}
          >
            <div className="tugx-file-find-input-wrap">
              <TugInput
                ref={findInputRef}
                className="tugx-file-find-input"
                type="text"
                placeholder="Find"
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
                aria-label="Find in file"
                focusStyle="background"
                borderless
                size="sm"
                onKeyDown={handleFindKeyDown}
              />
              {findQuery.length > 0 ? (
                <button
                  type="button"
                  className="tugx-file-find-clear"
                  data-slot="file-find-clear"
                  aria-label="Clear search"
                  onClick={clearFindQuery}
                >
                  <X aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <TugIconButton
              icon={<ChevronUp />}
              aria-label="Previous match"
              disabled={findMatchCount === 0}
              onClick={handleFindPrevious}
            />
            <TugIconButton
              icon={<ChevronDown />}
              aria-label="Next match"
              disabled={findMatchCount === 0}
              onClick={handleFindNext}
            />
            <div className="tugx-file-find-options">
              <TugCheckbox
                senderId={findCaseId}
                checked={findCaseSensitive}
                label="match case"
                aria-label="Match case"
                size="sm"
              />
              <TugCheckbox
                senderId={findRegexpId}
                checked={findRegexp}
                label="regex"
                aria-label="Regular expression"
                size="sm"
              />
              <TugCheckbox
                senderId={findWordId}
                checked={findWholeWord}
                label="word"
                aria-label="Whole word"
                size="sm"
              />
            </div>
            <span className="tugx-file-find-spacer" />
            <span
              className="tugx-file-find-count"
              data-slot="file-find-count"
              aria-live="polite"
            >
              {findQuery.length === 0
                ? ""
                : findMatchCount === 0
                  ? "no matches"
                  : findMatchCount === 1
                    ? "1 match"
                    : `${findMatchCount.toLocaleString()} matches`}
            </span>
            <span className="tugx-file-find-spacer" />
            <TugPushButton
              size="sm"
              emphasis="ghost"
              onClick={closeFind}
              aria-label="Close find"
            >
              Done
            </TugPushButton>
          </div>
        </findForm.ResponderScope>
      ) : null}

      {collapsed ? null : (
        <TugCodeView
          ref={codeViewRef}
          value={data.content}
          language={language}
          onFindRequested={openFind}
          // File viewer defaults: wrap on, line numbers on. The CM6
          // substrate handles the per-line scrollbar bug by
          // construction — `lineWrapping` puts wide lines on their
          // own visual rows inside a single scroll container.
          wrap
          lineNumbers
        />
      )}
    </div>
  );
};
