/**
 * command-atom — helpers for the slash-command atom: how its value
 * becomes the wire string claude expands, and how it reads in a chip.
 *
 * ## Why a command atom is special
 *
 * Accepting a `/` completion inserts an `AtomSegment` with
 * `type: "command"` whose `value` is the *bare* command name — no
 * leading slash (`tugplug:commit`, not `/tugplug:commit`). That bare
 * name is the single source of truth: it's what claude's catalog
 * reports, what the completion match keys off, and what the
 * unsupported-command allowlist compares against. The leading slash is
 * never stored — it is added at exactly two boundaries, by the two
 * helpers here:
 *
 *  - **the wire** ({@link commandWireText}) — the text block sent to
 *    claude must be a *clean* `/name` (optionally ` args`) string;
 *    claude's CLI expands a slash command into a **user invocation**
 *    (the path that bypasses a skill's `disable-model-invocation`
 *    guard) only when the message text is exactly the command. Any
 *    other shape — the backtick-`@` mention marker, or the bare
 *    slashless name — defeats expansion: the literal reaches the model
 *    instead, which tries the Skill tool (refused on a
 *    `disable-model-invocation` skill) or improvises.
 *  - **the chip** ({@link commandChipLabel}) — a command chip displays
 *    the leading slash so it reads as a command in both the editor and
 *    the transcript.
 *
 * Keeping the slash out of `value` and in these two helpers means the
 * bare-typed path and the accepted-atom path can never disagree on how
 * the slash appears.
 *
 * Pure data helpers — no React, no DOM, no store dependency.
 *
 * @module lib/command-atom
 */

import type { ContentBlock } from "@/protocol";

/** Strip a single leading slash so the helpers are idempotent on a
 *  value that already carries one (defensive — `value` is canonically
 *  the bare name). */
function bareName(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}

/**
 * The clean wire string for a command atom: `/<name>` plus any
 * trailing argument text. This is the shape claude expands as a user
 * invocation. `args` is the editor text that followed the chip (e.g.
 * `one two` for `/cmd one two`); omit it for a bare command.
 */
export function commandWireText(value: string, args?: string): string {
  const trimmed = args?.trim();
  return "/" + bareName(value) + (trimmed ? " " + trimmed : "");
}

/**
 * The display label for a command chip — the bare name with its
 * leading slash restored (`/tugplug:commit`). Used by both chip
 * renderers so the editor and transcript read identically.
 */
export function commandChipLabel(value: string): string {
  return "/" + bareName(value);
}

/**
 * The label a chip of the given `type` should display. Command chips
 * show the leading slash ({@link commandChipLabel}); every other atom
 * type shows its stored `label` verbatim. Both chip renderers (the
 * editor data-URI baker and the React `TugAtomChip`) call this so the
 * displayed text is identical across surfaces.
 */
export function chipDisplayLabel(
  type: string,
  label: string,
  value: string,
): string {
  return type === "command" ? commandChipLabel(value) : label;
}

// ---------------------------------------------------------------------------
// Chip style descriptor — the single source of truth for chip appearance
// ---------------------------------------------------------------------------

/**
 * The four theme-token *names* a chip paints with. Names (not resolved
 * values) so the React path can reference them as `var(--…)` (live
 * cascade) and the editor data-URI path can bake them via
 * `getTokenValue(--…)` — both selecting the same tokens.
 */
export interface ChipTokens {
  /** Background fill of the chip rect. */
  surface: string;
  /** Stroke of the chip rect. */
  border: string;
  /** Stroke of the icon glyph. */
  icon: string;
  /** Fill of the label text. */
  text: string;
}

/** The geometry knobs a chip paints with. Per-type so a command chip
 *  can take a distinct shape without forking the renderers. */
export interface ChipGeometryStyle {
  /** Corner radius (`rx`) of the chip rect, in px. */
  radius: number;
  /** Horizontal padding inside the chip, in px. */
  paddingX: number;
  /** Gap between the icon and the label, in px. */
  gap: number;
  /** Whether to draw the leading icon glyph. Command chips set this
   *  `false` — their `/` already lives in the label, so an icon slash
   *  would render a redundant double slash. */
  icon: boolean;
}

/** A chip's complete appearance contract: which tokens it paints with
 *  and what shape it takes. */
export interface ChipStyle {
  tokens: ChipTokens;
  geometry: ChipGeometryStyle;
}

/**
 * The shared default style — today's exact tokens and geometry, used by
 * every non-command atom type. Keeping these here (not as literals in
 * the renderers) is what lets a command chip differ in one place.
 */
const DEFAULT_CHIP_STYLE: ChipStyle = {
  tokens: {
    surface: "--tug7-surface-atom-primary-normal-default-rest",
    border: "--tug7-element-atom-border-normal-default-rest",
    icon: "--tug7-element-atom-icon-normal-default-rest",
    text: "--tug7-element-atom-text-normal-default-rest",
  },
  geometry: { radius: 3, paddingX: 6, gap: 4, icon: true },
};

/**
 * The command style — a distinct teal token set (the `command` theme
 * variant, defined in `brio.css` / `harmony.css`) and a rounder rect, so
 * a slash command reads as a command rather than a file attachment. This
 * is the one surface to edit to retune the command look-and-feel; both
 * renderers follow.
 */
const COMMAND_CHIP_STYLE: ChipStyle = {
  tokens: {
    surface: "--tug7-surface-atom-primary-normal-command-rest",
    border: "--tug7-element-atom-border-normal-command-rest",
    icon: "--tug7-element-atom-icon-normal-command-rest",
    text: "--tug7-element-atom-text-normal-command-rest",
  },
  // No icon: the leading slash in the label is the command marker; an icon
  // slash glyph on top of it reads as a redundant double slash.
  geometry: { radius: 6, paddingX: 7, gap: 4, icon: false },
};

/**
 * The single type-keyed style descriptor consumed by both chip
 * renderers. `command` → the distinct command style; every other type →
 * the shared default (byte-for-byte today's appearance).
 */
export function chipStyleForType(type: string): ChipStyle {
  return type === "command" ? COMMAND_CHIP_STYLE : DEFAULT_CHIP_STYLE;
}

// ---------------------------------------------------------------------------
// Expansion-echo detection
// ---------------------------------------------------------------------------

/** A command turn recovered from claude's expansion echo. */
export interface CommandEcho {
  /** Bare command name, no leading slash (matches an editor command atom). */
  value: string;
  /** Argument text the user passed after the command, if any. */
  args?: string;
}

const COMMAND_NAME_RE = /<command-name>([^<]+)<\/command-name>/;
const COMMAND_ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/;
const COMMAND_ENVELOPE_RE =
  /<command-(?:message|name|args)>[\s\S]*?<\/command-(?:message|name|args)>/g;

/**
 * Recognize claude's slash-command expansion echo in a user message's
 * content blocks. When claude expands a typed `/command`, it rewrites
 * the user turn to a single text block of the form:
 *
 * ```
 * <command-message>NAME</command-message>
 * <command-name>/NAME</command-name>
 * <command-args>ARGS</command-args>   (only when args were passed)
 * ```
 *
 * Returns the recovered `{ value, args }` (value is the **bare** name —
 * the leading slash is stripped so it equals an editor command atom's
 * `value`, which is what keeps the optimistic and replayed echoes
 * rendering the same chip), or `null` when the blocks are not a pure
 * command envelope.
 *
 * Tolerant by design ([Q01]): the `<command-message>` and
 * `<command-args>` siblings are optional and may appear in any order;
 * only `<command-name>` is required. Guards against prose false
 * positives by requiring the block to be *only* the envelope tags plus
 * whitespace — a message that merely quotes `<command-name>` mid-prose
 * is left to the generic synthesis path.
 *
 * Pure — no DOM, no store.
 */
export function detectCommandEcho(
  blocks: ReadonlyArray<ContentBlock>,
): CommandEcho | null {
  if (blocks.length !== 1) return null;
  const only = blocks[0];
  if (only.type !== "text") return null;
  const text = only.text;

  const nameMatch = COMMAND_NAME_RE.exec(text);
  if (nameMatch === null) return null;
  const value = bareName(nameMatch[1].trim());
  if (value === "") return null;

  // The block must be ONLY the command envelope (+ whitespace). Strip the
  // known tags; anything left means this is prose that happens to mention
  // the tags, not an expansion echo.
  const residue = text.replace(COMMAND_ENVELOPE_RE, "").trim();
  if (residue !== "") return null;

  const argsMatch = COMMAND_ARGS_RE.exec(text);
  const args = argsMatch ? argsMatch[1].trim() : "";
  return args ? { value, args } : { value };
}

/**
 * Whether an editor substrate is a single command atom at the very
 * start of the message (optionally followed by argument text) — the
 * shape claude expands into a user invocation.
 *
 * The live submit path uses this to decide the *optimistic* echo: a
 * command atom is sent as a clean `/name` (markerless) so claude can
 * expand it, which means the wire can't round-trip the command-ness.
 * Re-synthesizing the optimistic substrate from that wire would render
 * plain `/name` text and then flip to a chip when claude's
 * `<command-name>` echo replays — a flicker. When this returns true the
 * caller preserves the editor's command substrate instead, so the
 * optimistic echo already shows the same chip the replay will.
 *
 * `atomChar` is the substrate placeholder (`U+FFFC`), passed in rather
 * than imported to keep this module free of a `tug-atom-img` cycle.
 * Pure.
 */
export function isLoneLeadingCommandAtom(
  text: string,
  atoms: ReadonlyArray<{ type: string }>,
  atomChar: string,
): boolean {
  return (
    atoms.length === 1 &&
    atoms[0].type === "command" &&
    text.startsWith(atomChar)
  );
}
