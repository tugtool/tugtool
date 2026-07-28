/**
 * shell-line-classifier — the high-precision PATH heuristic for deciding
 * whether an unprefixed, atom-free, single-line draft means the shell or means
 * Claude (Spec S03, [P09]).
 *
 * The heuristic answers in **three bands**, not two ({@link bandShellLine}).
 * `shell` and `prompt` are the cases syntax alone settles: a flagged, piped, or
 * pathful command line on one side, a line whose first word isn't an executable
 * at all on the other. `unsure` is the honest middle — `make the button bigger`
 * and `make test` open identically, and no amount of token inspection separates
 * them. That band is what a local model is for; without one the caller treats it
 * as Claude, which is exactly today's behavior.
 *
 * The wrong-way costs are asymmetric — prose at the shell error-barfs, but a
 * command at Claude just gets answered — so the heuristic is tuned for
 * near-zero *false-shell*: nothing reaches `shell` on a maybe. Every auto-routed
 * exchange is visibly attributed with a one-click "send to Claude instead", so a
 * rare misroute is undoable.
 *
 * Routing is decided once, at submit, over the **whole line**. There is no
 * opener-only judgement while the user types: the set of English words that are
 * also PATH executables is large (`write`, `say`, `who`, `last`, `join`,
 * `split`, `yes`, `top`, `sleep`, …) and varies by machine, so a first-word test
 * cannot tell `write me a haiku` from `write kocienda ttys001` and has no line
 * context yet to help it. The full line does: `me` is a stopword, which lands
 * the draft in `unsure`, which is what the model is asked about.
 *
 * Pure — no side effects, no store reads. The caller enforces the precondition
 * (the draft has no atoms; `text` is trimmed and single-line), supplies the
 * login-PATH command set (null until it loads, which answers Code — the safety
 * net, not the steady state), and supplies its own readiness.
 *
 * @module lib/shell-line-classifier
 */

/**
 * Openers that read as prose as often as commands. A bare one (or one with no
 * command-shaped argument after it) is prose-adjacent and vetoed to Code; a
 * bare `ls` / `git` / `pwd` (absent here) stays a command.
 */
const AMBIGUOUS_OPENERS: ReadonlySet<string> = new Set([
  "find", "man", "time", "test", "look", "touch", "sort", "head", "tail",
  "less", "more", "which", "open", "cat",
]);

/**
 * Bare lowercase English stopwords. A subsequent token that is exactly one of
 * these marks the line as prose — UNLESS the line also carries a strong shell
 * signal (a piped/redirected/flagged/pathful command outweighs an English
 * word appearing in an argument).
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "my", "me", "i", "we", "you", "is", "are", "was", "be",
  "been", "to", "of", "in", "on", "at", "it", "its", "this", "that", "these",
  "those", "and", "or", "but", "not", "do", "does", "did", "can", "could",
  "should", "would", "please", "what", "when", "where", "which", "who", "why",
  "how", "there", "about", "with", "from", "into", "over", "under", "some",
  "any", "all", "more", "most", "other", "than", "then", "if", "else", "so",
  "just", "like", "want", "need", "make", "sure",
]);

/** A leading `NAME=value` environment-assignment token (skipped to find the command). */
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** A token that looks like a shell argument, not prose: a flag, a path, or an assignment. */
function isCommandShaped(token: string): boolean {
  return token.startsWith("-") || token.includes("/") || token.includes("=");
}

/**
 * A token that reads as a command *target* — command-shaped, or a filename with
 * an extension (`README.md`, `main.rs`). Used only to decide whether an
 * ambiguous opener (`cat README.md` vs `cat and dog pictures`) has a real
 * argument; not a strong signal (it does not neutralize the stopword veto).
 */
function looksLikeCommandTarget(token: string): boolean {
  return isCommandShaped(token) || /\.[A-Za-z0-9]+$/.test(token);
}

/**
 * A strong shell signal (Spec S03 point 4): any one neutralizes the
 * stopword / length vetoes and satisfies "command-shaped after" an ambiguous
 * opener. Operators (`|`, `&&`, `||`, `;`, `>`, `<`, backtick, `$(`, `${`), a
 * flag / path / assignment token, or a quoted string.
 */
function hasStrongSignal(text: string, tokens: readonly string[]): boolean {
  if (/[|<>`;]/.test(text)) return true;
  if (text.includes("&&") || text.includes("$(") || text.includes("${")) return true;
  if (/["']/.test(text)) return true;
  return tokens.some(isCommandShaped);
}

/**
 * The three answers syntax can give about a draft line.
 *
 * - `shell` — the line is a command by construction; route it, no model needed.
 * - `prompt` — the line isn't a command at all; send it to Claude.
 * - `unsure` — it opens like a command but reads like prose. Only intent
 *   separates these, so this is the band a local model is asked about; with no
 *   model the caller treats it as `prompt`.
 */
export type ShellBand = "shell" | "prompt" | "unsure";

/**
 * Band a trimmed, single-line, atom-free draft per Spec S07.
 *
 * Unconditional and readiness-free: this is the syntax half of the decision,
 * and it answers the same way whether or not a model exists. Gating belongs to
 * the caller.
 *
 * A null command set (still loading) answers `prompt` rather than `unsure` — a
 * line we can't even check the first word of isn't worth spending inference on.
 */
export function bandShellLine(
  text: string,
  commands: ReadonlySet<string> | null,
): ShellBand {
  if (commands === null) return "prompt";

  // 1. Length + shape gate. Slash commands are already intercepted; `#` leads a
  //    comment / prose aside.
  if (text.length === 0 || text.length > 400) return "prompt";
  if (text.startsWith("/") || text.startsWith("#")) return "prompt";

  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return "prompt";

  // Skip a leading `NAME=value` env-assignment prefix (`FOO=1 make test`) so the
  // real command token is examined. The assignment itself is a strong signal.
  let cmdStart = 0;
  while (cmdStart < tokens.length && ENV_ASSIGN.test(tokens[cmdStart]!)) cmdStart += 1;
  const commandTokens = tokens.slice(cmdStart);
  if (commandTokens.length === 0) return "prompt";
  const first = commandTokens[0]!;

  // 2. The command token must be a known PATH executable OR a path-shaped
  //    executable (`./…`, `~/…`, `/…`; tokens never contain spaces). A line that
  //    doesn't even open with an executable is prose outright — no model needed.
  const pathShaped =
    first.startsWith("./") || first.startsWith("~/") || first.startsWith("/");
  if (!commands.has(first) && !pathShaped) return "prompt";

  // A trailing `?` is a question whatever it opens with.
  if (text.endsWith("?")) return "prompt";

  const strong = hasStrongSignal(text, tokens);

  // 3. Prose vetoes. Past this point the line DOES open with an executable, so a
  //    veto means "reads like prose", not "is prose" — hence `unsure` rather
  //    than `prompt`. These are precisely the lines worth asking a model about.
  if (
    AMBIGUOUS_OPENERS.has(first) &&
    !commandTokens.slice(1).some(looksLikeCommandTarget)
  ) {
    return "unsure";
  }
  if (!strong && commandTokens.slice(1).some((t) => STOPWORDS.has(t))) return "unsure";
  // A long run of tokens with no shell punctuation reads as a sentence.
  if (!strong && tokens.length >= 8) return "unsure";

  return "shell";
}

/**
 * Whether a draft should route to the shell on syntax alone — the `shell` band,
 * and only when the caller says routing is live.
 *
 * `unsure` deliberately answers `false` here: this is the no-model answer, and
 * without a verdict the safe direction is Claude.
 */
export function classifyShellLine(
  text: string,
  commands: ReadonlySet<string> | null,
  ready: boolean,
): boolean {
  if (!ready) return false;
  return bandShellLine(text, commands) === "shell";
}

/**
 * Verdicts already obtained for `unsure` lines, keyed by the exact draft text.
 *
 * A model round trip costs hundreds of milliseconds, and a user editing the tail
 * of a line re-presents earlier prefixes constantly — so the same question would
 * otherwise be asked over and over. Bounded because a draft's history is
 * unbounded; cleared on submit/clear because verdicts belong to the draft being
 * composed, not to the session.
 */
export class ShellVerdictCache {
  /** Distinct drafts remembered before the oldest is dropped. */
  static readonly capacity = 32;

  private readonly entries = new Map<string, "shell" | "prompt">();

  get(text: string): "shell" | "prompt" | undefined {
    return this.entries.get(text);
  }

  set(text: string, verdict: "shell" | "prompt"): void {
    // Re-insert so a repeatedly-consulted draft stays hot rather than aging out
    // behind drafts that were asked about once.
    this.entries.delete(text);
    this.entries.set(text, verdict);
    while (this.entries.size > ShellVerdictCache.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
