/**
 * at0075-tide-find-app-switch.test.ts — find row focus survives the
 * app-resign / app-become-active round-trip (cmd-tab away + back)
 * for a real tide-card hosting a FileBlock find row [AT0075].
 *
 * ## Why this exists
 *
 * The user-reported Phase E.11 bug was specifically this scenario:
 * open a tide card with a Read tool result, open the FileBlock find
 * row, type a query, cmd-tab away and back — focus lands on the
 * prompt-entry contenteditable instead of the find input. Phase
 * E.11 fixes this end-to-end. AT0075 is the regression gate against
 * the exact scenario (real tide, find row, app-switch).
 *
 * ## Why this test is currently SKIPPED (Step 4l)
 *
 * The test requires materializing a FileBlock find row inside a
 * real tide-card. FileBlock renders for `Read` tool result messages
 * in the tide transcript; injecting such a message into a
 * `bindTideSession` fixture is a harness extension that doesn't
 * exist yet (the existing tide-session binding stubs the session
 * but doesn't drive transcript messages).
 *
 * The structural path AT0075 would exercise is already covered by
 * AT0071 (framework-axis on engineless content-owning fixture) +
 * AT0078 (engine path on real tide-card). The integration gap —
 * "find row on real tide-card" — is verified at the Phase E.11
 * manual checkpoint level until the harness gains tool-result
 * injection. Step 6 verifies the user-reported scenario manually.
 *
 * ## Future work
 *
 * Extend the harness with a `simulateToolResultMessage(cardId,
 * tool: "Read", payload)` helper that publishes a synthetic
 * tool-result frame to the bound tide session, materializing a
 * FileBlock in the transcript. Once available, un-skip this test
 * and the sibling AT0076 / AT0077 / AT0079.
 *
 * Gating: `describe.skip` (harness gap; tracked here so Step 6's
 * exit criteria has a concrete artifact to point at).
 */

import { describe, test } from "bun:test";

describe.skip(
  "AT0075: tide-card find row focus survives app-switch",
  () => {
    test(
      "cmd-tab away + back preserves focus on the FileBlock find input (DEFERRED: requires tool-result injection)",
      () => {
        // Deferred. See module docstring for harness-extension
        // requirement. The manual checkpoint in the Phase E.11
        // plan covers this scenario until the harness can drive
        // the find row materialization automatically.
      },
    );
  },
);
