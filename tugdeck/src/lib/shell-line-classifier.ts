/**
 * shell-line-classifier — the high-precision, submit-time PATH classifier
 * (Spec S03, [P09]).
 *
 * `classifyShellLine(text, commands)` decides whether an unprefixed, atom-free,
 * single-line draft should silently route to the shell instead of Claude. The
 * wrong-way costs are asymmetric — prose at the shell error-barfs, but a
 * command at Claude just gets answered — so the heuristic is tuned for
 * near-zero *false-shell*: everything ambiguous stays on Code, where a stray
 * `ls` degrades gracefully. Every auto-routed exchange is visibly attributed
 * with a one-click "send to Claude instead", so a rare misroute is undoable.
 *
 * Pure — no side effects, no store reads. The caller enforces the precondition
 * (the draft has no atoms; `text` is trimmed and single-line) and supplies the
 * login-PATH command set (null until it loads, which answers Code — the safety
 * net, not the steady state).
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

/**
 * Master switch for auto `!shell` detection — both the live-typing chip insert
 * ({@link autoShellOpener}) and the submit-time silent route
 * ({@link classifyShellLine}). Parked off: a first-word/PATH heuristic misfires
 * on prose openers that are also executables (`write …`, `apply …`). Detection
 * stays off until a model classifier can judge intent. The functions below keep
 * their full logic as the hook — gate the classifier's verdict here, or flip
 * this back to `true`, to re-enable.
 */
const AUTO_SHELL_DETECTION_ENABLED = false;

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
 * The live-typing companion to {@link classifyShellLine}: decide whether a
 * draft that just became `<token><space>` should auto-insert the `!shell`
 * routing chip at its head, so the routing is visible (and vetoable) while
 * the user types instead of decided silently at submit.
 *
 * Far stricter than the submit-time classifier, because at first-space time
 * there is no line context to judge — only the opener itself:
 *  - `docText` must be exactly one token + one trailing space, single-line,
 *    with the caret (`caret`) right after that space.
 *  - The token must be a known PATH executable (or `./…` / `~/…`
 *    path-shaped) AND unambiguous: an {@link AMBIGUOUS_OPENERS} or
 *    {@link STOPWORDS} member never live-inserts (`cat …`, `make sure …`) —
 *    those wait for the full-line classifier at submit.
 *
 * Returns the opener token when the chip should be inserted, else `null`.
 * Pure; the caller enforces the atom-free precondition and its own
 * once-per-draft / declined latches.
 */
export function autoShellOpener(
  docText: string,
  caret: number,
  commands: ReadonlySet<string> | null,
): string | null {
  if (!AUTO_SHELL_DETECTION_ENABLED) return null;
  if (commands === null) return null;
  if (docText.includes("\n")) return null;
  if (caret !== docText.length) return null;
  const m = /^(\S+) $/.exec(docText);
  if (m === null) return null;
  const token = m[1]!;
  if (token.startsWith("./") || token.startsWith("~/")) return token;
  if (token.startsWith("/") || token.startsWith("!") || token.startsWith("#")) {
    return null;
  }
  if (!commands.has(token)) return null;
  if (AMBIGUOUS_OPENERS.has(token) || STOPWORDS.has(token)) return null;
  return token;
}

/**
 * Classify a trimmed, single-line, atom-free draft as shell (`true`) or Code
 * (`false`) per Spec S03. Returns `false` for a null command set (the set is
 * still loading — answer Code).
 */
export function classifyShellLine(
  text: string,
  commands: ReadonlySet<string> | null,
): boolean {
  if (!AUTO_SHELL_DETECTION_ENABLED) return false;
  if (commands === null) return false;

  // 1. Length + shape gate. Slash commands are already intercepted; `#` leads a
  //    comment / prose aside.
  if (text.length === 0 || text.length > 400) return false;
  if (text.startsWith("/") || text.startsWith("#")) return false;

  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return false;

  // Skip a leading `NAME=value` env-assignment prefix (`FOO=1 make test`) so the
  // real command token is examined. The assignment itself is a strong signal.
  let cmdStart = 0;
  while (cmdStart < tokens.length && ENV_ASSIGN.test(tokens[cmdStart]!)) cmdStart += 1;
  const commandTokens = tokens.slice(cmdStart);
  if (commandTokens.length === 0) return false;
  const first = commandTokens[0]!;

  // 2. The command token must be a known PATH executable OR a path-shaped
  //    executable (`./…`, `~/…`, `/…`; tokens never contain spaces).
  const pathShaped =
    first.startsWith("./") || first.startsWith("~/") || first.startsWith("/");
  if (!commands.has(first) && !pathShaped) return false;

  const strong = hasStrongSignal(text, tokens);

  // 3. Prose vetoes.
  // A trailing `?` is a question, not a command.
  if (text.endsWith("?")) return false;
  // A bare ambiguous opener (nothing command-shaped after it) is prose-adjacent.
  if (
    AMBIGUOUS_OPENERS.has(first) &&
    !commandTokens.slice(1).some(looksLikeCommandTarget)
  ) {
    return false;
  }
  // A subsequent bare stopword marks prose, unless a strong signal outweighs it.
  if (!strong && commandTokens.slice(1).some((t) => STOPWORDS.has(t))) return false;
  // A long run of tokens with no shell punctuation reads as a sentence.
  if (!strong && tokens.length >= 8) return false;

  return true;
}
