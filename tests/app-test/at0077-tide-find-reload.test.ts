/**
 * at0077-tide-find-reload.test.ts — find row focus survives
 * Developer > Reload for a real tide-card hosting a FileBlock find
 * row [AT0077].
 *
 * ## Why this exists
 *
 * Glitch 3 from the Phase E.11 user-reported scenarios — the
 * canonical bug at the heart of the whole phase. Open a tide
 * card, open the FileBlock find row, type a query, Developer >
 * Reload — focus lands on the prompt-entry contenteditable
 * instead of the find input. AT0077 is the regression gate
 * against the exact scenario (real tide, find row, cold-boot
 * reload).
 *
 * This is the most demanding focus survival test in the Phase
 * E.11 set:
 *   1. Find row open state survives reload via
 *      `useComponentStatePreservation`.
 *   2. `bag.focus = { kind: "dom", focusKey: "..." }` flushes to
 *      disk on `appReload`'s prepareForReload save.
 *   3. Tide's transcript loads messages async after restart;
 *      the FileBlock hosting the find input mounts LATE.
 *   4. CardHost's cold-boot RESTORE runs before the FileBlock
 *      mounts — `applyBagFocus` resolves to `deferred-dom`.
 *   5. The Phase E.11 Step 4d MutationObserver retry budget
 *      (200 mutations / 5s wall-clock) fires `applyBagFocus`
 *      on each subtree mutation until the find input mounts.
 *   6. `applyBagFocus` returns `"applied"`, calls `.focus()`,
 *      and the D11 yield rule prevents subsequent re-focuses.
 *
 * ## Why this test is currently SKIPPED (Step 4l)
 *
 * Same harness gap as AT0075 — needs tool-result injection to
 * materialize a FileBlock find row inside a real tide-card.
 *
 * The structural path is covered by AT0073 (cold-boot reload
 * on engineless content-owning fixture, exercising the
 * framework-axis path including late-mount retry) + AT0078
 * (engine path on real tide-card across app-switch). The
 * integration gap — "find row mounts late on cold-boot of real
 * tide-card after reload" — is verified at the Phase E.11
 * Step 6 manual checkpoint level.
 *
 * Gating: `describe.skip`.
 */

import { describe, test } from "bun:test";

describe.skip(
  "AT0077: tide-card find row focus survives Developer > Reload",
  () => {
    test(
      "after appReload, the find input re-mounts open and focused (DEFERRED: requires tool-result injection)",
      () => {
        // Deferred. See module docstring.
      },
    );
  },
);
