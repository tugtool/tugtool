/**
 * changes-zones — pure logic for the Changes shade's zone split ([P06]).
 *
 * Zone 1 is the card session's own buckets; Zone 2 ("Also on this project")
 * is every other owner — other sessions' entries and dash lanes — collapsed
 * by default to one summary line. This module holds the summarizer, the
 * Zone 2 row derivation, and the release discard-preflight selector ([P14]),
 * all pure over snapshot data so they test as plain functions.
 */

import type {
  DashChangesetEntry,
  ProjectChangeset,
} from "@/lib/changeset-types";

/** One Zone 2 session row: another session with work on this project. */
export interface AlsoSessionRow {
  ownerId: string;
  displayName: string;
  live: boolean;
  fileCount: number;
}

/**
 * The other-session rows for Zone 2: every session entry on the project
 * except the card's own, keeping only those with files (a fileless open
 * session is presence, not work).
 */
export function alsoSessionRows(
  project: ProjectChangeset,
  ownOwnerId: string,
): AlsoSessionRow[] {
  const rows: AlsoSessionRow[] = [];
  for (const entry of project.changesets) {
    if (entry.kind !== "session") continue;
    if (entry.owner_id === ownOwnerId) continue;
    if (entry.files.length === 0) continue;
    rows.push({
      ownerId: entry.owner_id,
      displayName: entry.display_name,
      live: entry.live,
      fileCount: entry.files.length,
    });
  }
  return rows;
}

/**
 * The Zone 2 collapsed one-liner ([P06]):
 * `Also on this project: 2 sessions · 5 files · 1 dash (snippets · 6 rounds · dirty)`.
 * A single dash carries its name/rounds/dirt inline (the common case the
 * summary optimizes for); several collapse to a count. Null when Zone 2 is
 * empty — the line does not render.
 */
export function alsoOnProjectSummary(
  sessions: readonly AlsoSessionRow[],
  dashes: readonly DashChangesetEntry[],
): string | null {
  const parts: string[] = [];
  if (sessions.length > 0) {
    const files = sessions.reduce((n, s) => n + s.fileCount, 0);
    parts.push(`${sessions.length} session${sessions.length === 1 ? "" : "s"}`);
    parts.push(`${files} file${files === 1 ? "" : "s"}`);
  }
  if (dashes.length === 1) {
    const dash = dashes[0];
    const dirty = dash.worktree_dirty ? " · dirty" : "";
    parts.push(
      `1 dash (${dash.display_name} · ${dash.rounds} round${
        dash.rounds === 1 ? "" : "s"
      }${dirty})`,
    );
  } else if (dashes.length > 1) {
    parts.push(`${dashes.length} dashes`);
  }
  if (parts.length === 0) return null;
  return `Also on this project: ${parts.join(" · ")}`;
}

/** What releasing a dash would destroy — drives the confirm's shape ([P14]). */
export interface ReleasePreflight {
  /** `light` = clean dash, today's simple confirm; `discard` = the
   *  expanded preflight naming what dies. */
  kind: "light" | "discard";
  rounds: number;
  dirty: boolean;
  /** Round subjects, newest first, when the wire carries them. */
  subjects: string[];
}

/**
 * The release discard preflight ([P14]): a dash with commits past base or a
 * dirty tree gets the expanded `discards <k> rounds · dirty worktree`
 * confirm with its round subjects listed; a clean dash keeps the light
 * confirm.
 */
export function releasePreflight(entry: DashChangesetEntry): ReleasePreflight {
  const rounds = entry.rounds;
  const dirty = entry.worktree_dirty;
  return {
    kind: rounds > 0 || dirty ? "discard" : "light",
    rounds,
    dirty,
    subjects: entry.round_subjects ?? [],
  };
}
