/**
 * commit-filter-scope.ts — which parts of a commit the History filter reads.
 *
 * A query that should have found one commit finds thirty when it is matched
 * against everything: a word common in file paths swamps the one commit whose
 * subject says it. So the reader aims the filter — three independent surfaces,
 * all on by default:
 *
 *  - `message` — the subject and the message body.
 *  - `detail`  — who and when: author, committer, email, and the date stamps
 *                AS DISPLAYED (so `July 24` matches what the row shows).
 *  - `files`   — the paths the commit touched.
 *
 * The commit's **hash is not one of the three** — it is always matched. A sha
 * pasted from anywhere is an exact address, not a text surface, and a reader
 * who narrows to `files` has not asked to stop being able to look a commit up
 * by its id.
 *
 * All three off is a real state, not an error: the reader has switched every
 * surface off and the query then only resolves hashes. That is why a missing
 * entry (never set) and an empty entry (set to nothing) must stay
 * distinguishable — the former falls back to the default, the latter doesn't.
 * The shade says as much when a query in that state finds nothing.
 *
 * Persisted deck-wide through tugbank defaults
 * (`/api/defaults/dev.commit-filter/history-scope`, [D07],
 * `feedback_no_localstorage`), not per card: how a reader aims a filter is
 * about the reader, the same argument the row-metadata choice makes.
 *
 * Laws: [L02] the tugbank cache enters React through `useTugbankValue`.
 *
 * @module lib/commit-filter-scope
 */

import { useCallback } from "react";

import { getTugbankClient } from "@/lib/tugbank-singleton";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import type { TaggedValue } from "@/lib/tugbank-client";

/** One aimable surface of a commit. */
export type CommitFilterScope = "message" | "detail" | "files";

export const COMMIT_FILTER_SCOPE_DOMAIN = "dev.commit-filter";
export const COMMIT_FILTER_SCOPE_KEY = "history-scope";

/** Every surface, in the order the option group shows them. */
export const COMMIT_FILTER_SCOPES: readonly CommitFilterScope[] = [
  "message",
  "detail",
  "files",
];

/** All three — an unaimed filter reads the whole commit. */
export const DEFAULT_COMMIT_FILTER_SCOPE: readonly CommitFilterScope[] =
  COMMIT_FILTER_SCOPES;

/** Parse a persisted scope list; `null` when nothing has ever been stored. */
export function parseCommitFilterScope(
  entry: TaggedValue | undefined,
): readonly CommitFilterScope[] | null {
  if (entry === undefined || typeof entry.value !== "string") return null;
  const parts = entry.value.split(",").map((s) => s.trim());
  return COMMIT_FILTER_SCOPES.filter((s) => parts.includes(s));
}

/**
 * Persist the scope list: optimistic local-cache write (so `useTugbankValue`
 * readers re-render instantly) plus the HTTP PUT. A failed PUT logs and
 * otherwise vanishes — the cache holds for the session.
 */
export function writeCommitFilterScope(scope: readonly CommitFilterScope[]): void {
  const value = scope.join(",");
  const client = getTugbankClient();
  if (client !== null) {
    client.setLocalValue(COMMIT_FILTER_SCOPE_DOMAIN, COMMIT_FILTER_SCOPE_KEY, {
      kind: "string",
      value,
    });
  }
  fetch(`/api/defaults/${COMMIT_FILTER_SCOPE_DOMAIN}/${COMMIT_FILTER_SCOPE_KEY}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "string", value }),
  }).catch((err) => {
    console.warn("[commit-filter-scope] PUT failed:", err);
  });
}

/** The persisted scope plus its setter — the shade's option group's state. */
export function useCommitFilterScope(): {
  scope: readonly CommitFilterScope[];
  setScope: (next: readonly string[]) => void;
} {
  const stored = useTugbankValue<readonly CommitFilterScope[] | null>(
    COMMIT_FILTER_SCOPE_DOMAIN,
    COMMIT_FILTER_SCOPE_KEY,
    parseCommitFilterScope,
    null,
  );
  const setScope = useCallback((next: readonly string[]) => {
    writeCommitFilterScope(COMMIT_FILTER_SCOPES.filter((s) => next.includes(s)));
  }, []);
  return { scope: stored ?? DEFAULT_COMMIT_FILTER_SCOPE, setScope };
}
