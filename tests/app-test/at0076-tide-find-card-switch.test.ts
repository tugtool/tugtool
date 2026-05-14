/**
 * at0076-tide-find-card-switch.test.ts — find row focus survives the
 * card-switch round-trip (click another card's title bar, click back)
 * for a real tide-card hosting a FileBlock find row [AT0076].
 *
 * ## Why this exists
 *
 * Glitch 2 from the Phase E.11 user-reported scenarios: open a tide
 * card's find row, click another card's title bar, click the tide
 * card's title bar again — focus lands on the prompt-entry
 * contenteditable instead of the find input. AT0076 is the
 * regression gate against the exact scenario (real tide, find row,
 * cross-card switch).
 *
 * ## Why this test is currently SKIPPED (Step 4l)
 *
 * Same harness gap as AT0075 — needs tool-result injection to
 * materialize a FileBlock find row inside a real tide-card. See
 * AT0075's docstring for the harness-extension future work.
 *
 * The structural path is already covered by AT0072 (framework-
 * axis on engineless content-owning fixture) + AT0078 (engine
 * path on real tide-card). Step 6's manual checkpoint covers the
 * user-reported scenario until the harness can drive find row
 * materialization automatically.
 *
 * Gating: `describe.skip`.
 */

import { describe, test } from "bun:test";

describe.skip(
  "AT0076: tide-card find row focus survives card-switch",
  () => {
    test(
      "click another card's title bar, click tide back: focus on find input (DEFERRED: requires tool-result injection)",
      () => {
        // Deferred. See module docstring.
      },
    );
  },
);
