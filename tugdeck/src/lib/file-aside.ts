/**
 * file-aside.ts — set-aside autosave records for the File card's manual
 * save mode.
 *
 * A manual-mode buffer's unsaved edits never touch the real file; instead
 * they are periodically written to a single JSON "aside" record per
 * document under `~/Library/Application Support/Tug/Autosave Information/`.
 * A crash or quit therefore never loses work — reopening the document
 * finds the aside and restores the edits (dirty), the way NSDocument's
 * autosave-elsewhere (`autosavesInPlace == false`) preserves unsaved
 * changes without modifying the on-disk file.
 *
 * The aside file is keyed by an FNV-1a 64-bit hash of the document's
 * canonical path (or the draft id, for untitled buffers). The record
 * embeds its own `path`/`draftId`, verified on read, so a hash collision
 * degrades to "no aside", never to a wrong restore.
 *
 * Writes are hash-chained conditional writes (the same create-new →
 * on-conflict-retry-with-reported-hash pattern the store uses for
 * `saveAs`), so a stale aside left by a crash is absorbed by the first
 * conflict-retry and the fs endpoint's every-write-is-conditional
 * invariant stays intact.
 *
 * @module lib/file-aside
 */

import type { LineEnding } from "@/lib/file-editor-store";
import {
  readFileFromDisk,
  writeFileToDisk,
  type FileWriteOutcome,
} from "@/lib/file-io";

/** The set-aside autosave directory (tilde-expanded by the fs endpoints). */
const ASIDES_ROOT = "~/Library/Application Support/Tug/Autosave Information";

/** Current aside record schema version. */
const ASIDE_VERSION = 1;

/** One set-aside autosave record (Spec S01). */
export interface AsideRecord {
  version: number;
  /** Canonical document path; null for an untitled buffer. */
  path: string | null;
  /** Draft id; non-null for an untitled buffer. */
  draftId: string | null;
  /** Full buffer text, `\n`-normalized. */
  content: string;
  /** The line ending the buffer will be serialized with on real save. */
  lineEnding: LineEnding;
  /** Disk sha the edits are based on; null for untitled. */
  baselineSha256: string | null;
  /** ms since epoch when the aside was last written. */
  editedAt: number;
}

/**
 * FNV-1a 64-bit hash of a UTF-8 string, as zero-padded 16-char hex.
 * BigInt-based so it needs no `crypto.subtle` and is deterministic.
 */
export function fnv1a64Hex(input: string): string {
  const OFFSET = 0xcbf29ce484222325n;
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let hash = OFFSET;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/** Aside path for a document bound to a real (canonical) file path. */
export function asidePathFor(canonicalPath: string): string {
  return `${ASIDES_ROOT}/aside-${fnv1a64Hex(canonicalPath)}.json`;
}

/** Aside path for an untitled buffer, keyed by its draft id. */
export function asidePathForUntitled(draftId: string): string {
  return `${ASIDES_ROOT}/aside-untitled-${draftId}.json`;
}

/**
 * Parse and strictly validate an aside JSON string against the document
 * identity it is expected to belong to. Returns the record on a full
 * match, or `null` when the JSON is unparseable, the wrong version/shape,
 * or keyed to a different path/draftId (collision safety).
 *
 * `expected` carries whichever identity the caller opened with: a
 * `path` for a titled document, a `draftId` for an untitled buffer.
 */
export function parseAside(
  json: string,
  expected: { path: string } | { draftId: string },
): AsideRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;

  if (record.version !== ASIDE_VERSION) return null;
  if (typeof record.content !== "string") return null;
  if (
    record.lineEnding !== "LF" &&
    record.lineEnding !== "CRLF" &&
    record.lineEnding !== "CR"
  ) {
    return null;
  }
  if (typeof record.editedAt !== "number") return null;

  const path = record.path === null ? null : record.path;
  const draftId = record.draftId === null ? null : record.draftId;
  if (path !== null && typeof path !== "string") return null;
  if (draftId !== null && typeof draftId !== "string") return null;

  if ("path" in expected) {
    if (path !== expected.path) return null;
    if (record.baselineSha256 !== null && typeof record.baselineSha256 !== "string") {
      return null;
    }
  } else {
    if (draftId !== expected.draftId) return null;
  }

  return {
    version: ASIDE_VERSION,
    path,
    draftId,
    content: record.content,
    lineEnding: record.lineEnding,
    baselineSha256:
      typeof record.baselineSha256 === "string" ? record.baselineSha256 : null,
    editedAt: record.editedAt,
  };
}

/**
 * Outcome of reading an aside. `record` is a valid restore payload
 * (with the aside file's own current sha, to seed the write chain);
 * `invalid` is a parseable-but-wrong/corrupt file that is safe to delete;
 * `unreadable` covers not_found / transport error / too_large — the
 * caller MUST NOT delete an `unreadable` aside (it never read the payload
 * it would be destroying).
 */
export type AsideReadResult =
  | { kind: "record"; record: AsideRecord; sha256: string }
  | { kind: "invalid" }
  | { kind: "unreadable" };

/** Read + validate the aside for `expected` at `asidePath`. Never throws. */
export async function readAside(
  asidePath: string,
  expected: { path: string } | { draftId: string },
): Promise<AsideReadResult> {
  const outcome = await readFileFromDisk(asidePath);
  if (!outcome.ok) {
    // not_found, too_large, network, denied, binary, internal — never
    // delete a payload we failed to read.
    return { kind: "unreadable" };
  }
  const record = parseAside(outcome.file.content, expected);
  if (record === null) return { kind: "invalid" };
  return { kind: "record", record, sha256: outcome.file.sha256 };
}

/**
 * Hash-chained writer for a single aside file ([P08]). Tracks the aside's
 * own last-written sha256 and conditions each rewrite on it: the first
 * write is create-new (`baselineSha256: null`); a `conflict` (a stale
 * aside from a prior crash, or a torn chain) is absorbed by one retry
 * with the reported disk hash; subsequent writes chain off the last ok
 * sha.
 */
export class AsideWriter {
  private _sha256: string | null = null;

  constructor(public readonly path: string) {}

  /** Re-seed the chain from a freshly-read aside (or reset with null). */
  seed(sha256: string | null): void {
    this._sha256 = sha256;
  }

  /** Write the record, retrying once through a conflict. Never throws. */
  async write(
    record: AsideRecord,
    opts?: { keepalive?: boolean },
  ): Promise<FileWriteOutcome> {
    const content = JSON.stringify(record);
    let outcome = await writeFileToDisk(
      { path: this.path, content, baselineSha256: this._sha256 },
      opts,
    );
    if (!outcome.ok && outcome.error === "conflict") {
      outcome = await writeFileToDisk(
        { path: this.path, content, baselineSha256: outcome.diskSha256 },
        opts,
      );
    }
    if (outcome.ok) this._sha256 = outcome.sha256;
    return outcome;
  }

  /** Delete the aside (conditional; retries once through a conflict). */
  async delete(opts?: { keepalive?: boolean }): Promise<FileWriteOutcome> {
    let outcome = await writeFileToDisk(
      { path: this.path, content: "", baselineSha256: this._sha256, delete: true },
      opts,
    );
    if (!outcome.ok && outcome.error === "conflict") {
      outcome = await writeFileToDisk(
        {
          path: this.path,
          content: "",
          baselineSha256: outcome.diskSha256,
          delete: true,
        },
        opts,
      );
    }
    // Whether or not the delete settled, a subsequent write starts fresh.
    this._sha256 = null;
    return outcome;
  }
}
