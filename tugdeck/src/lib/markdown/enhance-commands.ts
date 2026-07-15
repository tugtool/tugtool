/**
 * `enhanceSlashCommands` — DOM-walks a rendered markdown block and tags
 * inline `<code>` spans that are *known* slash commands so the transcript
 * can hover-underline them and turn a click into a ready-to-run command
 * draft in the composer.
 *
 * A slash command like `/tugplug:implement roadmap/find-route.md` shows up
 * in assistant prose as a single-backtick `<code>` span. This pass finds
 * those spans, parses each against a strict command-line grammar
 * ({@link parseSlashCommandLine}), and — only when the command name passes
 * the caller-supplied known-command predicate — stamps the `<code>` with a
 * class and `data-slash-command` / `data-slash-args` attributes. The
 * transcript's delegated click listener reads those attributes; CSS keys
 * the hover affordance off the class.
 *
 * The grammar is necessary but not sufficient: the predicate is the
 * authoritative gate. Matching the grammar first lets this pass cheaply
 * reject the overwhelming majority of code spans before consulting the
 * predicate, and splits `name` from `args`.
 *
 * Store-free by construction: the predicate carries the only live
 * dependency (the command catalog), so this module stays a pure DOM pass
 * beside the other `enhance-*` siblings. Applying the known-check *during*
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
 * @module lib/markdown/enhance-slash-commands
 */

/** The class stamped on a `<code>` that is a known, clickable command. */
export const SLASH_COMMAND_CLASS = "tugx-md-slashcmd";

/** A parsed slash-command line: bare name plus trailing argument text. */
export interface ParsedSlashCommand {
  /** Bare command name, no leading slash — `tugplug:implement`, `diff`. */
  name: string;
  /** Trimmed argument text after the name, or `""` when there is none. */
  args: string;
}

/**
 * The command-line grammar. `/` then a command token — `plugin:command`
 * or bare `command`, each segment lowercase alnum with interior `_`/`-`
 * (no leading/trailing separator, at most one `:`) and **no interior
 * `/`** — then optional whitespace + argument remainder.
 *
 * The lowercase-led, no-interior-`/` shape rejects path-like text
 * (`/Users/…` fails on the uppercase, `/usr/bin` on the second `/`) so
 * the grammar alone already excludes the common false positives; the
 * known-command predicate is the strict backstop.
 */
const SLASH_COMMAND_RE =
  /^\/([a-z0-9](?:[a-z0-9_-]*[a-z0-9])?(?::[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?)?)(?:\s+([\s\S]+))?$/;

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
 * Sync the clickable-command tags on every inline `<code>` in `container`
 * to the current known-command set. A span that parses as a known command
 * gets {@link SLASH_COMMAND_CLASS} + `data-slash-command` /
 * `data-slash-args`; a span that no longer qualifies has them removed.
 * Fenced-block code is skipped. `isKnown` is the authoritative gate.
 *
 * Idempotent and re-runnable: safe to call again over already-rendered DOM
 * when the command catalog changes (the on-resume case — the transcript
 * replays from JSONL before the handshake catalog lands, so the first
 * build sees an empty catalog; a later re-run tags the spans once the
 * catalog arrives). Add/remove rather than add-only so a shrinking catalog
 * un-tags too.
 */
export function enhanceSlashCommands(
  container: HTMLElement,
  isKnown: (name: string) => boolean,
): void {
  const codes = container.querySelectorAll<HTMLElement>("code");
  for (const code of codes) {
    // Fenced code (`pre > code`) is content, not a command hint.
    if (code.parentElement?.tagName === "PRE") continue;
    const parsed = parseSlashCommandLine(code.textContent ?? "");
    if (parsed !== null && isKnown(parsed.name)) {
      code.classList.add(SLASH_COMMAND_CLASS);
      code.dataset.slashCommand = parsed.name;
      code.dataset.slashArgs = parsed.args;
    } else if (code.classList.contains(SLASH_COMMAND_CLASS)) {
      code.classList.remove(SLASH_COMMAND_CLASS);
      delete code.dataset.slashCommand;
      delete code.dataset.slashArgs;
    }
  }
}
