/**
 * transcript.ts — content-hash sidecar verification for committed
 * tugcode transcripts.
 *
 * ## Why a sidecar
 *
 * Transcripts that ship with the test repo (e.g.,
 * `tests/app-test/fixtures/tugcode/em-smoke.transcript.json`) are
 * captured against a specific tugcode build and then committed.
 * If the file is edited without rerunning the capture script,
 * downstream tests would replay corrupted IPC sequences and fail
 * mysteriously. The `.sha256` sidecar is a guardrail: the test
 * loader recomputes the file's hash and refuses to load on
 * mismatch, with an instruction to rerun
 * `scripts/reapprove-transcript.ts` after a legitimate capture.
 *
 * ## Why not Subresource Integrity / signed manifests
 *
 * Sidecars are simple, human-greppable, and round-trip cleanly
 * through git. Tugcode transcripts are a closed test ecosystem
 * (no third-party consumers), so a single hash file per transcript
 * is all the integrity check we need.
 *
 * ## What's here vs. the capture/reapprove scripts
 *
 * This module is the load-time verifier — what runtime tests use
 * to load a fixture safely. The capture script (`scripts/
 * capture-tugcode-transcript.ts`, deferred to Step 7) drives a
 * real tugcode session and records the sequence; the reapprove
 * script recomputes a sidecar after a legitimate re-capture.
 * Both share the `computeTranscriptHash` helper here.
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

import { TugcodeTranscriptMismatchError } from "./errors";

/**
 * Compute the SHA-256 hash of `bytes`, returned as a lowercase
 * hex string. Bytes are taken verbatim (no canonicalization or
 * whitespace stripping) — the sidecar pins the exact on-disk
 * representation so editors that reformat JSON cannot drift the
 * file silently. The reapprove script is the single legitimate
 * way to update the hash.
 */
export function computeTranscriptHash(bytes: Buffer | string): string {
  const buf = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Convention: `<transcript>.json` ↔ `<transcript>.json.sha256`.
 */
export function sidecarPathFor(transcriptPath: string): string {
  return `${transcriptPath}.sha256`;
}

/**
 * Verify that `transcriptPath`'s on-disk SHA-256 matches its
 * `.sha256` sidecar. Throws `TugcodeTranscriptMismatchError` on
 * mismatch with the expected and actual hash plus the path —
 * enough context for the test author to know whether the file
 * was edited or the sidecar is stale.
 *
 * Missing sidecar is an error: the convention is "every committed
 * transcript has a sidecar"; an absent sidecar means the file was
 * partially landed.
 */
export function verifyTranscriptSidecar(transcriptPath: string): void {
  const sidecar = sidecarPathFor(transcriptPath);
  if (!existsSync(sidecar)) {
    throw new TugcodeTranscriptMismatchError(
      `Sidecar missing at ${sidecar}. Run scripts/reapprove-transcript.ts ${transcriptPath} after capturing a transcript.`,
      transcriptPath,
      "",
      "",
    );
  }
  const expected = readFileSync(sidecar, "utf8").trim();
  const actual = computeTranscriptHash(readFileSync(transcriptPath));
  if (expected !== actual) {
    throw new TugcodeTranscriptMismatchError(
      `Transcript hash mismatch at ${transcriptPath} (expected ${expected}, actual ${actual}). The transcript was edited without re-approval; run scripts/reapprove-transcript.ts ${transcriptPath} if the new content is intentional.`,
      transcriptPath,
      expected,
      actual,
    );
  }
}

/**
 * Load a transcript JSON file and verify its sidecar in one step.
 * Throws `TugcodeTranscriptMismatchError` on hash miss, or a
 * generic `Error` on parse failure. Returns the parsed JSON
 * object (untyped — callers cast to `TugcodeTranscript` if they
 * also import the harness's transcript types).
 */
export function loadTranscriptWithSidecar(
  transcriptPath: string,
): Record<string, unknown> {
  verifyTranscriptSidecar(transcriptPath);
  const raw = readFileSync(transcriptPath, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(
      `loadTranscriptWithSidecar: ${transcriptPath} does not contain a JSON object`,
    );
  }
  return parsed as Record<string, unknown>;
}
