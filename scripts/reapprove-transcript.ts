#!/usr/bin/env bun
/**
 * reapprove-transcript.ts — recompute the SHA-256 sidecar for a
 * tugcode transcript file (parent harness plan #step-6).
 *
 * Usage:
 *
 *   bun run scripts/reapprove-transcript.ts <transcript-path>
 *
 * The script reads the transcript bytes verbatim, computes
 * SHA-256, and writes (or overwrites) `<transcript-path>.sha256`
 * with the lowercase-hex digest.
 *
 * ## When to run
 *
 * Whenever a transcript JSON is *legitimately* edited or
 * recaptured. The runtime sidecar verifier in
 * `tests/in-app/_harness/transcript.ts` refuses to load a
 * transcript whose hash drifts from the sidecar — the test
 * failure message points back here.
 *
 * Companion to `scripts/capture-tugcode-transcript.ts` (Pass 7C
 * deferred — drives a live tugcode session and writes the
 * captured transcript + initial sidecar).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { computeTranscriptHash, sidecarPathFor } from "../tests/in-app/_harness/transcript";

function main(): number {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    process.stderr.write(
      "usage: bun run scripts/reapprove-transcript.ts <transcript-path>\n",
    );
    return 2;
  }
  const transcriptPath = pathResolve(args[0]);
  let bytes: Buffer;
  try {
    bytes = readFileSync(transcriptPath);
  } catch (err) {
    process.stderr.write(
      `reapprove-transcript: failed to read ${transcriptPath}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
  const hash = computeTranscriptHash(bytes);
  const sidecar = sidecarPathFor(transcriptPath);
  try {
    writeFileSync(sidecar, hash);
  } catch (err) {
    process.stderr.write(
      `reapprove-transcript: failed to write ${sidecar}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
  process.stdout.write(`${sidecar} <- ${hash}\n`);
  return 0;
}

process.exit(main());
