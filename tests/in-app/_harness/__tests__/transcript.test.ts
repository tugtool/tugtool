/**
 * transcript.test.ts — round-trip coverage for the sidecar
 * verifier.
 *
 * Three round-trips:
 *
 *   1. Compute hash of a known input matches a fresh hash on the
 *      same bytes.
 *   2. Verify-sidecar on a matching pair returns void; mismatch
 *      throws `TugcodeTranscriptMismatchError` with both hashes
 *      populated.
 *   3. `loadTranscriptWithSidecar` returns the parsed object
 *      when the sidecar matches; throws (without parsing) when
 *      it doesn't.
 *
 * The capture-script consumer shares the helper with
 * `reapprove-transcript.ts`; both rely on these tests to pin
 * hash stability against bytes-on-disk.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  computeTranscriptHash,
  loadTranscriptWithSidecar,
  sidecarPathFor,
  verifyTranscriptSidecar,
} from "../transcript";
import { TugcodeTranscriptMismatchError } from "../errors";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "harness-transcript-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("computeTranscriptHash", () => {
  test("is deterministic across byte-equal inputs", () => {
    const bytes = '{"schemaVersion":1,"tugcodeVersion":"0.8.0","turns":[]}';
    const h1 = computeTranscriptHash(bytes);
    const h2 = computeTranscriptHash(Buffer.from(bytes, "utf8"));
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  test("differs for different inputs", () => {
    expect(computeTranscriptHash("a")).not.toBe(computeTranscriptHash("b"));
  });
});

describe("sidecarPathFor", () => {
  test("appends .sha256 to the transcript path", () => {
    expect(sidecarPathFor("/tmp/t.transcript.json")).toBe(
      "/tmp/t.transcript.json.sha256",
    );
  });
});

describe("verifyTranscriptSidecar", () => {
  test("returns void on a matching pair", () => {
    const tpath = join(workdir, "t.json");
    const content = '{"schemaVersion":1}';
    writeFileSync(tpath, content);
    writeFileSync(sidecarPathFor(tpath), computeTranscriptHash(content));
    expect(() => verifyTranscriptSidecar(tpath)).not.toThrow();
  });

  test("throws TugcodeTranscriptMismatchError with both hashes on mismatch", () => {
    const tpath = join(workdir, "t.json");
    writeFileSync(tpath, '{"schemaVersion":1}');
    writeFileSync(sidecarPathFor(tpath), "deadbeef".repeat(8));
    let caught: unknown = null;
    try {
      verifyTranscriptSidecar(tpath);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TugcodeTranscriptMismatchError);
    const e = caught as TugcodeTranscriptMismatchError;
    expect(e.expectedHash).toBe("deadbeef".repeat(8));
    expect(e.actualHash).toMatch(/^[0-9a-f]{64}$/);
    expect(e.transcriptPath).toBe(tpath);
    expect(e.message).toContain("reapprove-transcript.ts");
  });

  test("throws when sidecar is missing", () => {
    const tpath = join(workdir, "t.json");
    writeFileSync(tpath, '{"schemaVersion":1}');
    expect(() => verifyTranscriptSidecar(tpath)).toThrow(
      /Sidecar missing/,
    );
  });
});

describe("loadTranscriptWithSidecar", () => {
  test("returns parsed object when sidecar matches", () => {
    const tpath = join(workdir, "t.json");
    const content = '{"schemaVersion":1,"turns":[]}';
    writeFileSync(tpath, content);
    writeFileSync(sidecarPathFor(tpath), computeTranscriptHash(content));
    const parsed = loadTranscriptWithSidecar(tpath);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.turns).toEqual([]);
  });

  test("does not parse when sidecar mismatches", () => {
    const tpath = join(workdir, "t.json");
    writeFileSync(tpath, "{ corrupt json");
    writeFileSync(sidecarPathFor(tpath), "deadbeef".repeat(8));
    let caught: unknown = null;
    try {
      loadTranscriptWithSidecar(tpath);
    } catch (err) {
      caught = err;
    }
    // Mismatch path throws BEFORE attempting JSON.parse, so we
    // get the typed error rather than a SyntaxError.
    expect(caught).toBeInstanceOf(TugcodeTranscriptMismatchError);
  });
});
