/**
 * at0079-tide-engine-focus-wins-over-stale-find.test.ts — when
 * `bag.focus.kind === "engine"` AND a find row is also open
 * (open-state preserved), engine wins on reload [AT0079].
 *
 * ## Why this exists
 *
 * Last-save semantics: `bag.focus` captures whichever target was
 * focused at the save moment. If the user had the find row OPEN
 * but moved focus back to the prompt-entry contenteditable, the
 * save site captures `bag.focus.kind === "engine"`. On reload,
 * the framework's `applyBagFocus` must resolve to `engine` (NOT
 * to the find row's `dom` kind) and invoke the engine hook.
 *
 * This pins the engine-vs-framework precedence inside `bag.focus`
 * itself: the kind discriminator is authoritative; the framework
 * does NOT prefer dom over engine just because the find input
 * happens to exist in the saved component-state.
 *
 * ## Why this test is currently SKIPPED (Step 4l)
 *
 * Same harness gap as AT0075–AT0077 — needs tool-result injection
 * to materialize a FileBlock find row inside a real tide-card.
 *
 * The negative case (engine focus wins when no find row exists)
 * is covered by AT0078. The positive case (find-row focus wins
 * when find row WAS focused at save) is covered by AT0073 on the
 * fixture. AT0079 is the discriminator test — but it requires
 * both the engine path AND the find row to coexist, which is the
 * harness gap.
 *
 * Gating: `describe.skip`.
 */

import { describe, test } from "bun:test";

describe.skip(
  "AT0079: tide-card engine focus wins over stale find-row mount on reload",
  () => {
    test(
      "bag.focus.kind === engine + find row open: engine wins on reload (DEFERRED: requires tool-result injection)",
      () => {
        // Deferred. See module docstring.
      },
    );
  },
);
