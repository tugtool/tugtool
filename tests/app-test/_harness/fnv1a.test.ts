/**
 * Pins the harness's FNV-1a token against the Rust implementation.
 *
 * The same vector is asserted in
 * `tugcore/src/instance.rs::short_token_and_tmux_label_track_instance_id`.
 * If one side changes, one of the two tests goes red instead of the
 * harness quietly addressing a tmux server that does not exist.
 *
 * @covers tests/app-test/_harness/fnv1a.ts
 * @covers tugrust/crates/tugcore/src/ports.rs
 */
import { test, expect } from "bun:test";

import { fnv1a32, shortToken, tmuxSocketLabel } from "./fnv1a";

const PINNED_ID = "apptest-27b5400c-7d5e-4a9a-99a0-4f787deb6d80";
const PINNED_TOKEN = "a419f8f0";

test("short token matches the Rust vector", () => {
  expect(shortToken(PINNED_ID)).toBe(PINNED_TOKEN);
  expect(tmuxSocketLabel(PINNED_ID)).toBe(`tug-${PINNED_TOKEN}`);
});

test("hash is the standard FNV-1a 32-bit", () => {
  // The canonical published vectors for the algorithm.
  expect(fnv1a32("")).toBe(2166136261);
  expect(fnv1a32("a")).toBe(0xe40c292c);
  expect(fnv1a32("foobar")).toBe(0xbf9cf968);
});

test("the token is always eight hex digits", () => {
  for (const id of ["a", "debug-main", "release-main", PINNED_ID]) {
    expect(shortToken(id)).toMatch(/^[0-9a-f]{8}$/);
  }
});
