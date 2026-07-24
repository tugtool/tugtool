/**
 * commit-meta-fields.ts — which metadata the History shade's commit rows carry.
 *
 * Readers disagree about this: some want the committer's name, some the date,
 * some the clock, and a long list is worth more subject width than any of them.
 * So it is a choice — a `TugOptionGroup` in the shade — persisted deck-wide
 * through tugbank defaults (`/api/defaults/dev.commit-meta/history-row`,
 * [D07], `feedback_no_localstorage`), not per card: the reading preference is
 * about the reader, not about one session.
 *
 * The stored form is a comma-joined field list (`"date,time"`), with the empty
 * string meaning "no metadata at all" — a real, selectable state, which is why
 * a missing entry (never set) and an empty entry (set to nothing) must stay
 * distinguishable: the former falls back to the default, the latter doesn't.
 *
 * Laws: [L02] the tugbank cache enters React through `useTugbankValue`.
 *
 * @module lib/commit-meta-fields
 */

import { useCallback } from "react";

import { getTugbankClient } from "@/lib/tugbank-singleton";
import { useTugbankValue } from "@/lib/use-tugbank-value";
import type { TaggedValue } from "@/lib/tugbank-client";
import type { CommitMetaField } from "@/components/tugways/commit-presentation";

export const COMMIT_META_DOMAIN = "dev.commit-meta";
export const COMMIT_META_KEY = "history-row";

/** Date + time — a complete stamp, the reading a bare date can't give. */
export const DEFAULT_COMMIT_META_FIELDS: readonly CommitMetaField[] = ["date", "time"];

const KNOWN: readonly CommitMetaField[] = ["author", "date", "time"];

/** Parse a persisted field list; `null` when nothing has ever been stored. */
export function parseCommitMetaFields(
  entry: TaggedValue | undefined,
): readonly CommitMetaField[] | null {
  if (entry === undefined || typeof entry.value !== "string") return null;
  const parts = entry.value.split(",").map((s) => s.trim());
  return KNOWN.filter((f) => parts.includes(f));
}

/**
 * Persist the field list: optimistic local-cache write (so `useTugbankValue`
 * readers re-render instantly) plus the HTTP PUT. A failed PUT logs and
 * otherwise vanishes — the cache holds for the session.
 */
export function writeCommitMetaFields(fields: readonly CommitMetaField[]): void {
  const value = fields.join(",");
  const client = getTugbankClient();
  if (client !== null) {
    client.setLocalValue(COMMIT_META_DOMAIN, COMMIT_META_KEY, { kind: "string", value });
  }
  fetch(`/api/defaults/${COMMIT_META_DOMAIN}/${COMMIT_META_KEY}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "string", value }),
  }).catch((err) => {
    console.warn("[commit-meta] PUT failed:", err);
  });
}

/** The persisted field list plus its setter — the shade's option group's state. */
export function useCommitMetaFields(): {
  fields: readonly CommitMetaField[];
  setFields: (next: readonly string[]) => void;
} {
  const stored = useTugbankValue<readonly CommitMetaField[] | null>(
    COMMIT_META_DOMAIN,
    COMMIT_META_KEY,
    parseCommitMetaFields,
    null,
  );
  const setFields = useCallback((next: readonly string[]) => {
    writeCommitMetaFields(KNOWN.filter((f) => next.includes(f)));
  }, []);
  return { fields: stored ?? DEFAULT_COMMIT_META_FIELDS, setFields };
}
