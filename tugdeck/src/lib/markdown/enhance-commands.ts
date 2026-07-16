/**
 * `enhanceCommands` — DOM-walks a rendered markdown block and tags
 * inline `<code>` spans that are *commands* so the transcript can
 * hover-underline them and expose click / right-click affordances.
 *
 * Two command families are recognized, each with its own click gesture
 * but the same decoration and the same right-click copy menu:
 *
 *  - **Slash commands** — a span like `/tugplug:implement roadmap/x.md`
 *    that parses against {@link parseSlashCommandLine} *and* whose bare
 *    name passes the caller-supplied known-command predicate. Tagged with
 *    {@link COMMAND_CLASS} + `data-slash-command` / `data-slash-args`; a
 *    click seeds the command as a ready-to-run prompt draft.
 *
 *  - **Shell commands** — a span whose text begins with a known project
 *    CLI tool (`just` / `tug`) followed by a subcommand,
 *    matched by {@link parseShellCommandLine}. Tagged with
 *    {@link COMMAND_CLASS} + `data-shell-command` (the whole command
 *    line); a click seeds it into the Code route as a one-shot `/shell`
 *    invocation.
 *
 * The transcript's delegated click listener reads whichever dataset is
 * present to pick the gesture; CSS keys the hover affordance off the
 * shared class; the transcript cell's context menu keys the Copy /
 * Copy as Plain Text items off the same class.
 *
 * For slash commands the grammar is necessary but not sufficient: the
 * predicate is the authoritative gate. Matching the grammar first lets
 * this pass cheaply reject the overwhelming majority of code spans before
 * consulting the predicate, and splits `name` from `args`. Shell commands
 * have no runtime catalog to gate against — the leading tool name is the
 * gate, so the grammar alone decides.
 *
 * Store-free by construction: the predicate carries the only live
 * dependency (the command catalog), so this module stays a pure DOM pass
 * beside the other `enhance-*` siblings. Applying the check *during*
 * enhancement (not in a later effect) means a streaming DOM rebuild
 * re-tags atomically — a later pass would be wiped by the next delta's
 * `innerHTML` rewrite.
 *
 * Scope guard: `<code>` inside a fenced block (`pre > code`) is content,
 * not a command hint, and is skipped — mirroring how `enhanceLinks`
 * ignores `CODE`/`PRE`.
 *
 * Laws: [L06] appearance via DOM, not React state.
 *
 * @module lib/markdown/enhance-commands
 */

/** The class stamped on a `<code>` that is a clickable command (slash or shell). */
export const COMMAND_CLASS = "tugx-md-cmd";

/** A parsed slash-command line: bare name plus trailing argument text. */
export interface ParsedSlashCommand {
  /** Bare command name, no leading slash — `tugplug:implement`, `diff`. */
  name: string;
  /** Trimmed argument text after the name, or `""` when there is none. */
  args: string;
}

/**
 * The slash-command-line grammar. `/` then a command token —
 * `plugin:command` or bare `command`, each segment lowercase alnum with
 * interior `_`/`-` (no leading/trailing separator, at most one `:`) and
 * **no interior `/`** — then optional whitespace + argument remainder.
 *
 * The lowercase-led, no-interior-`/` shape rejects path-like text
 * (`/Users/…` fails on the uppercase, `/usr/bin` on the second `/`) so
 * the grammar alone already excludes the common false positives; the
 * known-command predicate is the strict backstop.
 */
const SLASH_COMMAND_RE =
  /^\/([a-z0-9](?:[a-z0-9_-]*[a-z0-9])?(?::[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?)?)(?:\s+([\s\S]+))?$/;

/**
 * The project CLI tools whose transcript command lines are linkified.
 * A span whose text is one of these followed by a subcommand is treated
 * as a shell command; there is no per-subcommand catalog — the leading
 * tool name is the whole gate.
 */
const SHELL_COMMAND_TOOLS = ["just", "tug"] as const;

/**
 * The shell-command grammar: a known tool name, then whitespace, then at
 * least one more non-whitespace token (the subcommand / target / flag),
 * on a single line. `.` does not match a newline, so a multi-line code
 * span never matches — inline command hints are single-line. A bare tool
 * name with no subcommand (`just` alone) is deliberately rejected: it is
 * not an actionable command line and the word could be prose.
 */
const SHELL_COMMAND_RE = new RegExp(
  `^(?:${SHELL_COMMAND_TOOLS.join("|")})\\s+\\S.*$`,
);

/**
 * Parse an inline code span's text as a slash-command line. Returns the
 * `{ name, args }` pair, or `null` when the text is not a well-formed
 * command line. Pure — no DOM, no store.
 */
export function parseSlashCommandLine(text: string): ParsedSlashCommand | null {
  const match = SLASH_COMMAND_RE.exec(text.trim());
  if (match === null) return null;
  return { name: match[1], args: (match[2] ?? "").trim() };
}

/**
 * Parse an inline code span's text as a project shell-command line.
 * Returns the trimmed command line (`just launch-debug`, `tug dash join
 * --preview`) when it begins with a known tool + subcommand, or `null`
 * otherwise. Pure — no DOM, no store. The returned string is what a
 * click seeds into the Code route as `/shell <command>`.
 */
export function parseShellCommandLine(text: string): string | null {
  const trimmed = text.trim();
  return SHELL_COMMAND_RE.test(trimmed) ? trimmed : null;
}

/**
 * Sync the command tags on every inline `<code>` in `container` to the
 * current known-command set. A span that parses as a known slash command
 * gets {@link COMMAND_CLASS} + `data-slash-command` / `data-slash-args`;
 * a span that parses as a project shell command gets {@link COMMAND_CLASS}
 * + `data-shell-command`; a span that no longer qualifies has them all
 * removed. Fenced-block code is skipped. `isKnown` is the authoritative
 * gate for the slash family; the shell family gates on the leading tool
 * name alone.
 *
 * Idempotent and re-runnable: safe to call again over already-rendered DOM
 * when the command catalog changes (the on-resume case — the transcript
 * replays from JSONL before the handshake catalog lands, so the first
 * build sees an empty catalog; a later re-run tags the slash spans once
 * the catalog arrives). Add/remove rather than add-only so a shrinking
 * catalog un-tags too, and so a span that flips families re-tags cleanly.
 */
export function enhanceCommands(
  container: HTMLElement,
  isKnown: (name: string) => boolean,
): void {
  const codes = container.querySelectorAll<HTMLElement>("code");
  for (const code of codes) {
    // Fenced code (`pre > code`) is content, not a command hint.
    if (code.parentElement?.tagName === "PRE") continue;
    const text = code.textContent ?? "";

    const slash = parseSlashCommandLine(text);
    if (slash !== null && isKnown(slash.name)) {
      code.classList.add(COMMAND_CLASS);
      code.dataset.slashCommand = slash.name;
      code.dataset.slashArgs = slash.args;
      delete code.dataset.shellCommand;
      continue;
    }

    const shell = parseShellCommandLine(text);
    if (shell !== null) {
      code.classList.add(COMMAND_CLASS);
      code.dataset.shellCommand = shell;
      delete code.dataset.slashCommand;
      delete code.dataset.slashArgs;
      continue;
    }

    if (code.classList.contains(COMMAND_CLASS)) {
      code.classList.remove(COMMAND_CLASS);
      delete code.dataset.slashCommand;
      delete code.dataset.slashArgs;
      delete code.dataset.shellCommand;
    }
  }
}
