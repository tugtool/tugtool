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
 *    + "N lines" / "Showing N of M lines" counts + a trailing
 *    affordances area (fold cue + `Search` `<TugIconButton>`). Hidden
 *    when `embedded=true` because the host wrapper (e.g.
 *    `ToolWrapperChrome`) owns identity in those cases; the affordances
 *    portal into the host's actions slot instead so they survive into
 *    the embedded composition.
 *  - Fold cue — a chevron `<button>` rendered whenever the file is
 *    `overThreshold`, in both states. Icon + label swap by state
 *    (chevron-down + "N lines folded" vs chevron-up icon-only). This
 *    is the persistent toggle handle: embedded-mode hosts hide the
 *    header, so the cue must also portal into the host's actions slot
 *    or the user could expand but not collapse back.
 *  - Find row — `.tugx-file-find`, mounted only while `findOpen` is
 *    true. Sticky beneath the chrome / identity header. Carries the
 *    full Find UI (TugInput + nav buttons + checkboxes + match count
 *    + Done) so the resting chrome is just an icon-sized trigger and
 *    the multi-control UI is progressive disclosure.
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
 *  - [L11] FileBlock owns the find session — `findOpen`, `findQuery`,
 *    the codeViewRef delegate, the open/close lifecycle — and is
 *    therefore the responder for `FIND`, `FIND_NEXT`, and
 *    `FIND_PREVIOUS`. Each Cmd-F / Cmd-G / Shift-Cmd-G keystroke
 *    arrives via the static keybinding map → responder-chain
 *    dispatch; no document-level listeners.
 *  - [L19] file pair (`.tsx` + `.css`), exported props interface,
 *    `data-slot="file-body"` on the root, this docstring.
 *  - [L20] component-token sovereignty — owns the `--tugx-file-*`
 *    slot family; consumes `--tugx-block-*` directly for the shared
 *    block-surface scaffold. Position-coordination tokens
 *    (`--tugx-pin-stack-top`, `--tugx-toolblock-header-height`) are
 *    read but never overridden, per the L20 carve-out documented in
 *    `tuglaws/component-authoring.md`.
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
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Search,
  X,
} from "lucide-react";

import { TugInput } from "@/components/tugways/tug-input";
import { TugCheckbox } from "@/components/tugways/tug-checkbox";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugIconButton } from "@/components/tugways/tug-icon-button";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import { useOptionalResponder } from "@/components/tugways/use-responder";
import { useResponderChain } from "@/components/tugways/responder-chain-provider";
import { TUG_ACTIONS, type TugAction } from "@/components/tugways/action-vocabulary";
import type { ActionHandler } from "@/components/tugways/responder-chain";
import {
  TugCodeView,
  type TugCodeViewDelegate,
} from "@/components/tugways/tug-code-view";
import { useChromeActionsTarget } from "@/components/tugways/cards/tool-wrappers/tool-wrapper-chrome";

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
   *   - FileBlock's own header (basename + lang badge + line counts)
   *     is hidden — the wrapper owns the file's identity in its own
   *     header.
   *   - The resting affordances (fold cue, Search trigger) portal
   *     into the host's chrome actions slot via
   *     `ChromeActionsTargetContext`. This is the load-bearing
   *     contract: `embedded={true}` MUST be used under a
   *     `ToolWrapperChrome` so the affordances have somewhere to
   *     surface. Using `embedded={true}` outside a chrome is
   *     unsupported — the affordances have no host and the user
   *     loses access to Search and the fold toggle.
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

  // Computed-value collapse pattern. Mirrors the existing `viewMode`
  // resolution in DiffBlock: the parent's prop wins when provided,
  // local state covers the uncontrolled case. No `useEffect` syncs a
  // prop into state — that pattern would create a "controlled prop
  // says X, local state says Y" divergence after a click in
  // uncontrolled mode. Reading the prop directly on every render keeps
  // controlled and uncontrolled cleanly separable.
  const [localCollapsed, setLocalCollapsed] =
    React.useState<boolean>(overThreshold);
  const collapsed = collapsedProp !== undefined ? collapsedProp : localCollapsed;

  // Root ref — used to dispatch the disengage-follow-bottom event so
  // the host (e.g. `TugListView`) releases its auto-pin lock before
  // the cell height change. Without that, the user clicks "expand",
  // the cell grows, `ResizeObserver` requests a bottom pin, and the
  // click target scrolls off-screen — violating "interacting with a
  // control does not move that control out of view."
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  // Header ref — used by the telescoping-pin ResizeObserver below to
  // write the visible header's measured height into
  // `--tugx-file-header-height` on the root so the find row can pin
  // BELOW the identity header in standalone mode. Null when
  // `embedded={true}` (no header rendered — affordances portal into
  // the host's chrome instead).
  const headerRef = React.useRef<HTMLDivElement | null>(null);

  // Telescoping pin — write the live measured identity-header height
  // into `--tugx-file-header-height` on the root so the find row can
  // pin at `top: calc(var(--tugx-pin-stack-top, 0px)
  //          + var(--tugx-toolblock-header-height, 0px)
  //          + var(--tugx-file-header-height, 0px))`.
  // In embedded mode the header isn't rendered, so the ref is null
  // and the variable stays unset (`0px` via the `calc()` fallback) —
  // the find row then telescopes under the chrome's
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

  // Chrome actions target — non-null when this FileBlock is composed
  // inside a `ToolWrapperChrome` that has rendered its actions slot.
  // Phase D consolidates the resting affordance row INTO the chrome /
  // identity header rather than rendering it as a separate sticky
  // strip beneath. When the target is present (embedded composition),
  // the affordance node portals into it; when absent (standalone),
  // affordances render inside `.tugx-file-header` directly. The body
  // kind never depends on this being non-null — `embedded={false}` and
  // a missing chrome both fall through to the inline-in-header path.
  const chromeActionsTarget = useChromeActionsTarget();

  // Stable id for FileBlock's own responder — declared up here so the
  // find form below can register as its child (see `parentId` below)
  // and so the `toggleCollapsed` callback can promote FileBlock to
  // first-responder after the user clicks a focus-refusing
  // affordance. Sibling hook calls in the same component all read the
  // same outer `ResponderParentContext` value at hook-call time, so
  // without the explicit parentId the find form would register as a
  // SIBLING of fileBlockResponder, not a child. Chain walks from the
  // find input would then skip past fileBlockResponder entirely and
  // Cmd-G / Shift-Cmd-G would not reach the FIND_NEXT / FIND_PREVIOUS
  // handlers.
  const fileBlockResponderId = React.useId();

  // Chain manager — used to programmatically promote
  // `fileBlockResponder` to first-responder after the user clicks one
  // of the in-block focus-refusing affordances (fold cue, Find
  // button). Those buttons carry `data-tug-focus="refuse"`, so the
  // chain provider's pointerdown listener skips chain promotion
  // entirely on their clicks — correct for buttons in outer chrome
  // (no focus theft from active editors), but leaves first-responder
  // pointing at wherever it was BEFORE the user touched the block.
  // Cmd-F afterward then walks from a stale responder and misses
  // our FIND handler. Promoting `fileBlockResponder` after the toggle
  // lands keystrokes on the block the user is clearly interacting
  // with. The manager is `null` outside a `ResponderChainProvider`
  // (gallery cards, unit tests); the promote calls below short-
  // circuit via `?.`.
  const chainManager = useResponderChain();

  const toggleCollapsed = React.useCallback(() => {
    // Dispatch BEFORE the state update so the listener (TugListView's
    // SmartScroll, when present) flips `isFollowingBottom` to false
    // before React commits the new cell size; the subsequent
    // ResizeObserver flush then bails out of `pinToBottom` (see
    // `tug-list-view.tsx`:`isFollowingBottom` gate). Bubbles up
    // through the DOM tree; non-list hosts simply ignore it.
    rootRef.current?.dispatchEvent(
      new CustomEvent("tug-disengage-follow-bottom", { bubbles: true }),
    );
    // Promote FileBlock to first-responder. The fold cue is a
    // `TugPushButton` with `data-tug-focus="refuse"`, so the chain
    // provider's pointerdown listener skipped chain promotion on its
    // own. The user is clearly interacting with THIS block, so
    // keystrokes after this click should land here — Cmd-F walking
    // from FileBlock then reaches our FIND handler. Idempotent: if
    // we already own first-responder, makeFirstResponder is a no-op.
    chainManager?.makeFirstResponder(fileBlockResponderId);
    // Controlled mode: parent owns the prop, so we only notify; local
    // state stays out of it. Uncontrolled mode: local state flips and
    // notifies. Both paths converge on `onToggleCollapsed` so the
    // host can observe regardless of who owns the value.
    const next = !collapsed;
    if (collapsedProp === undefined) {
      setLocalCollapsed(next);
    }
    onToggleCollapsed?.(next);
  }, [chainManager, collapsed, collapsedProp, fileBlockResponderId, onToggleCollapsed]);

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
  // so the query string isn't a form slot here. `parentId` opts into
  // a child relationship with fileBlockResponder so chain walks from
  // inside the form reach FileBlock's FIND_NEXT / FIND_PREVIOUS
  // handlers.
  const findCaseId = React.useId();
  const findRegexpId = React.useId();
  const findWordId = React.useId();
  const findForm = useResponderForm({
    parentId: fileBlockResponderId,
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
  //
  // `useLayoutEffect` so the match-highlight repaint lands in the
  // same paint as the input update. With `useEffect` the effect runs
  // AFTER the browser paints, producing a one-frame lag between the
  // input character commit and the highlights repainting against the
  // new query.
  React.useLayoutEffect(() => {
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
      if (collapsedProp === undefined) {
        setLocalCollapsed(false);
      }
      onToggleCollapsed?.(false);
    }
    // Promote FileBlock to first-responder. Same reasoning as
    // toggleCollapsed: the Find button (when invoked by click) is
    // a `TugPushButton` with `data-tug-focus="refuse"`, so the
    // chain provider skipped chain promotion on its pointerdown.
    // The focus useLayoutEffect below will eventually move
    // first-responder to the find form via the input's focus event,
    // but doing this here also guarantees that Cmd-F dispatches
    // arriving while the chain is still settling find their way
    // home. Idempotent if we already own first-responder.
    chainManager?.makeFirstResponder(fileBlockResponderId);
    setFindOpen(true);
    // Focus + select land in the useLayoutEffect below — keyed on
    // `findOpen` so it fires after React commits the find-row mount
    // and the input ref is set. [L05] forbids `requestAnimationFrame`
    // for operations that depend on a React state commit; the
    // useLayoutEffect-on-mount pattern is the canonical alternative.
  }, [
    chainManager,
    collapsed,
    collapsedProp,
    fileBlockResponderId,
    onToggleCollapsed,
  ]);

  // Focus + select the find input when the find row mounts.
  // `useLayoutEffect` runs after React commits the new tree but
  // before the browser paints, so the input ref has been assigned
  // and the focus call lands on a real element. The early-return
  // guards the "find row unmounted" pass so we don't try to focus
  // a stale ref. [L05] alternative to rAF.
  React.useLayoutEffect(() => {
    if (!findOpen) return;
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, [findOpen]);

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

  // ---- Responder registration ------------------------------------------------
  //
  // FileBlock owns the find session — `findOpen`, `findQuery`, the
  // codeViewRef delegate, and the open / close lifecycle. Per [L11]
  // ("Controls emit actions; responders own state that actions operate
  // on") it must be the responder for the find-related actions.
  //
  // Registered actions:
  //  - `FIND` — opens the find row. Reachable from anywhere inside
  //    FileBlock's subtree (CM6 focus, find input focus, button focus,
  //    cell focus). Dispatched by ⌘F via the static keybinding map.
  //  - `FIND_NEXT` / `FIND_PREVIOUS` — advance / retreat through
  //    matches against the active query. Empty / invalid query is a
  //    silent no-op so the keystroke doesn't accidentally seed a
  //    query from the current selection (CM6's `searchCommand`
  //    fallback would otherwise resurrect a prior query).
  //    Dispatched by ⌘G / ⇧⌘G via the static keybinding map.
  //
  // Latest-refs for the handlers — the responder is registered ONCE
  // at mount with stable handlers ([L07]: handlers must read current
  // state through refs, never stale closures). The handlers below
  // read `findQueryRef.current` / `codeViewRef.current` at fire time.
  const findQueryRef = React.useRef(findQuery);
  React.useLayoutEffect(() => {
    findQueryRef.current = findQuery;
  }, [findQuery]);
  const openFindRef = React.useRef(openFind);
  React.useLayoutEffect(() => {
    openFindRef.current = openFind;
  }, [openFind]);

  const fileBlockActions = React.useMemo<
    Partial<Record<TugAction, ActionHandler>>
  >(
    () => ({
      [TUG_ACTIONS.FIND]: () => {
        openFindRef.current?.();
      },
      [TUG_ACTIONS.FIND_NEXT]: () => {
        if (findQueryRef.current.length === 0) return;
        codeViewRef.current?.findNext();
      },
      [TUG_ACTIONS.FIND_PREVIOUS]: () => {
        if (findQueryRef.current.length === 0) return;
        codeViewRef.current?.findPrevious();
      },
    }),
    [],
  );
  const fileBlockResponder = useOptionalResponder({
    id: fileBlockResponderId,
    actions: fileBlockActions,
  });

  // Composed root ref — forwards to both the local `rootRef` (used to
  // dispatch the disengage-follow-bottom event) and the responder
  // chain's ref-callback (writes `data-responder-id` on the same
  // element). Stable across renders so neither side tears down and
  // re-attaches on every render.
  const composedRootRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      fileBlockResponder.responderRef(el);
    },
    [fileBlockResponder.responderRef],
  );

  // Empty data: render an empty marker for layout consistency. Same
  // contract as before — consumers may depend on the data-empty
  // attribute (e.g. for CSS rules that suppress the frame).
  if (data === undefined || lines.length === 0) {
    return (
      <div
        ref={composedRootRef}
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

  // Fold cue: a compact click target with stable shape. Always
  // rendered when `overThreshold` so the user has a steady handle
  // across the collapse <-> expand cycle. The button shape (icon +
  // count label) is invariant across states — only the chevron
  // direction flips. The label stays the same regardless of fold
  // state ("N lines"); the aria-label carries the action verb
  // ("Expand file" / "Collapse file") for screen readers.
  const showCue = overThreshold;
  const cueIcon = collapsed ? <ChevronsDown /> : <ChevronsUp />;
  const cueCountWord = lines.length === 1 ? "line" : "lines";
  const cueLabel = `${lines.length.toLocaleString()} ${cueCountWord}`;

  // Compose the affordances node ONCE. It renders either inline at
  // the trailing edge of `.tugx-file-header` (standalone, has its own
  // header) or via a portal into the host's chrome actions slot
  // (embedded composition, header suppressed but affordances still
  // need to surface in the chrome). Per Phase D the dedicated
  // `.tugx-file-actions` sticky row retires entirely — one less pinned
  // strip, fewer near-empty bars stacking.
  //
  // Affordance components are Tug primitives by contract, with stable
  // shapes across all states (a button that swaps subtype between
  // states moves the click target out from under the user's pointer
  // and is therefore not allowed):
  //  - Fold cue: `TugPushButton`, `subtype="icon-text"`,
  //    `emphasis="ghost"`, `size="2xs"`. Chevron icon flips with
  //    state; label stays "N lines" regardless of fold state
  //    (aria-label carries the verb for screen readers).
  //  - Search (Find trigger): `TugPushButton`, `subtype="icon-text"`,
  //    `emphasis="ghost"`, `size="2xs"`. ALWAYS rendered so the
  //    cluster geometry is invariant across fold state — disabled
  //    when collapsed (substrate isn't mounted) rather than removed
  //    from the DOM. Magnifier icon + "Find" text.
  //
  // The legacy `tugx-file-*` class names are forwarded onto the Tug
  // components as `className`/`data-slot` so CSS scoping and test
  // hooks stay stable across the refactor.
  const affordances = (
    <>
      {showCue ? (
        <TugPushButton
          className="tugx-file-fold-cue"
          data-slot="file-fold-cue"
          icon={cueIcon}
          subtype="icon-text"
          emphasis="ghost"
          size="2xs"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand file" : "Collapse file"}
          onClick={toggleCollapsed}
        >
          {cueLabel}
        </TugPushButton>
      ) : null}
      <TugPushButton
        className="tugx-file-search"
        data-slot="file-search"
        icon={<Search />}
        subtype="icon-text"
        emphasis="ghost"
        size="2xs"
        disabled={collapsed}
        aria-label="Search in file"
        onClick={openFind}
      >
        Find
      </TugPushButton>
    </>
  );

  // Embedded composition with a published chrome target: portal the
  // affordances into the chrome's actions slot. The chrome's slot has
  // its own layout (flex cluster); we wrap in a `data-slot` fragment
  // owner so tests can still locate "the file block's affordances"
  // unambiguously even when they live elsewhere in the DOM tree.
  const portaledAffordances =
    embedded && chromeActionsTarget !== null && affordances !== null
      ? createPortal(
          <span
            className="tugx-file-actions-cluster"
            data-slot="file-actions"
          >
            {affordances}
          </span>,
          chromeActionsTarget,
        )
      : null;

  return (
    <fileBlockResponder.ResponderScope>
    <div
      ref={composedRootRef}
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
          <span className="tugx-file-header-spacer" />
          {affordances !== null ? (
            <span
              className="tugx-file-actions-cluster"
              data-slot="file-actions"
            >
              {affordances}
            </span>
          ) : null}
        </div>
      )}
      {portaledAffordances}

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
    </fileBlockResponder.ResponderScope>
  );
};
