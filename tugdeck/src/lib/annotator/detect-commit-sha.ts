/**
 * The commit-sha grammar — what might be a commit in transcript ink.
 *
 * A sha is the one entity here with no structure to speak of: it is a run
 * of hex, and plenty of English words are runs of hex too (`decade`,
 * `facade`, `beefed`). Like the path grammar, this does not try to be the
 * filter — the repository is, and a token that is not a commit resolves to
 * nothing and stays plain text. What this does is keep the question worth
 * asking:
 *
 *  - 7 to 40 characters, the range from git's short form to a full sha.
 *  - Lowercase hex only. Git writes shas lowercase, and prose that
 *    shouts in hex is not citing a commit.
 *  - At least one digit. This is the rule that earns its keep: it costs
 *    nothing, and it excludes the all-letter hex words, which are the
 *    entire population of accidental matches in English.
 *
 * @module lib/annotator/detect-commit-sha
 */

/** A commit sha found in ink, with the offsets it occupies. */
export interface CommitShaMatch {
  /** The sha as written — short or full. */
  sha: string;
  /** Index of the sha's first character in the scanned text. */
  start: number;
  /** Index one past the sha's last character. */
  end: number;
}

/** Runs of whitespace-free text — the unit a sha can occupy. */
const TOKEN_RE = /\S+/g;

/** Punctuation that can wrap a sha in prose without being part of it. */
const LEADING_PUNCTUATION = /^[([{<'"`,;:]+/;
const TRAILING_PUNCTUATION = /[)\]}>'"`,;:.!?]+$/;

/** Lowercase hex, git's short form through a full sha. */
const SHA_RE = /^[0-9a-f]{7,40}$/;

/** Hex that is also a word: no digit anywhere. */
const HAS_DIGIT = /[0-9]/;

/** Whether `text` is exactly one commit-sha candidate. */
export function isCommitSha(text: string): boolean {
  return SHA_RE.test(text) && HAS_DIGIT.test(text);
}

/**
 * Every commit-sha candidate in `text`, with the offsets it occupies.
 * Offsets are into `text` as given, so a caller can wrap the exact run in
 * place; wrapping punctuation is peeled and excluded from the range.
 */
export function scanCommitShas(text: string): CommitShaMatch[] {
  const matches: CommitShaMatch[] = [];
  TOKEN_RE.lastIndex = 0;
  let token: RegExpExecArray | null;
  while ((token = TOKEN_RE.exec(text)) !== null) {
    const raw = token[0];
    const leading = LEADING_PUNCTUATION.exec(raw)?.[0].length ?? 0;
    const sha = raw.slice(leading).replace(TRAILING_PUNCTUATION, "");
    if (!isCommitSha(sha)) continue;
    const start = token.index + leading;
    matches.push({ sha, start, end: start + sha.length });
  }
  return matches;
}
