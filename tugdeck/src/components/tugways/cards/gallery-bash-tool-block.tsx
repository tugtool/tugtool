/**
 * gallery-bash-tool-block.tsx — visual fixture for `BashToolBlock`.
 *
 * Mounts the wrapper across the smart-pick routing (introduced in
 * #step-10-7) and the footer-badge states, without standing up a live
 * tugcode bridge:
 *
 *  1. `echo "hello from bash"` — success path. TerminalBlock body, exit 0,
 *     footer chrome suppressed (the dominant non-error case).
 *  2. `git show HEAD` — diff-shaped output. The wrapper routes the body
 *     through `DiffBlock` instead of `TerminalBlock`, complete with hunk
 *     gutters and adds / removes coloring.
 *  3. `git diff lib/foo.ts` — bare unified diff (no commit header).
 *     Confirms the heuristic still fires when only `diff --git` / `@@`
 *     markers are present.
 *  4. `git status` — plain bash output that mentions "branch" / "commit"
 *     but is NOT a diff. Stays on TerminalBlock; the heuristic must not
 *     false-positive.
 *  5. `npm run build` — non-zero exit. `isError` synthesizes `exit 1`;
 *     the footer paints the strong-red exit badge.
 *  6. `sleep 600` — interrupted. The footer shows the `interrupted`
 *     badge, which wins over any exit code.
 *  7. `ls --color` — ANSI-rich stdout. TerminalBlock renders the SGR
 *     escape sequences as styled spans.
 *  8. `cd /tmp` — empty-success. No body; the footer shows the
 *     `(no output)` hint so the row doesn't read as missing data.
 *
 * @module components/tugways/cards/gallery-bash-tool-block
 */

import React from "react";

import { BashToolBlock } from "./tool-wrappers/bash-tool-block";
import type { ToolWrapperProps } from "./tool-wrappers/types";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

// ---------------------------------------------------------------------------
// Long-stdout fixture for the mount-in-saved-state app-tests
// ---------------------------------------------------------------------------

/**
 * 400-line stdout — exceeds `DEFAULT_COLLAPSE_THRESHOLD` (25) so the
 * uncontrolled TerminalBlock defaults to collapsed, and exceeds
 * `VISIBLE_THRESHOLD` (300) so the expanded body builds the
 * virtualizer's inner scroller. Both surfaces are what AT0067 and
 * AT0068 drive against:
 *
 *   - AT0067 expands the block, saves, reloads, and asserts the
 *     TerminalBlock's `data-collapsed` attribute reflects the saved
 *     "expanded" state from the very first DOM observation — no
 *     intermediate frame where the default-collapsed state painted
 *     before the saved value applied.
 *   - AT0068 scrolls the inner virtualized scroller to a non-zero
 *     position, saves, reloads, and asserts the scroller's first
 *     observable `scrollTop` matches the saved value — no jump from
 *     0 to saved.
 */
const MOUNT_IN_SAVED_STATE_STDOUT = Array.from(
  { length: 400 },
  (_, i) =>
    `line ${String(i + 1).padStart(3, "0")}: contents of a synthetic Bash run that exceeds the fold threshold`,
).join("\n");

const MOUNT_IN_SAVED_STATE_PROPS: ToolWrapperProps = {
  // Stable across reload so `componentStatePreservationKey` matches
  // (the BashToolBlock derives its preservation key from `toolUseId`).
  toolUseId: "toolu_mount_in_saved_state_e8",
  toolName: "Bash",
  msgId: "gallery-mount-in-saved-state-msg",
  seq: 0,
  input: { command: "echo many lines" },
  structuredResult: {
    stdout: MOUNT_IN_SAVED_STATE_STDOUT,
    stderr: "",
    interrupted: false,
  },
  isError: false,
  status: "ready",
  durationMs: 12,
};

/**
 * `gallery-bash-mount-in-saved-state` — fixture for AT0067/AT0068.
 * Renders a single BashToolBlock whose stdout is long enough to engage
 * both the fold state (TerminalBlock collapsed/expanded) and the
 * virtualizer (inner scrollport with `data-tug-scroll-key`). Each
 * surface is a separate axis of `bag.components` / `bag.regionScroll`
 * and each axis must mount in its saved state on cold boot.
 */
export function GalleryBashMountInSavedState(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-bash-mount-in-saved-state">
      <BashToolBlock {...MOUNT_IN_SAVED_STATE_PROPS} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ECHO_HELLO: ToolWrapperProps = {
  toolUseId: "echo-1",
  toolName: "Bash",
  msgId: "gallery-msg",
  seq: 0,
  input: { command: "echo 'hello from bash'" },
  structuredResult: { stdout: "hello from bash\n", stderr: "", interrupted: false },
  isError: false,
  status: "ready",
  durationMs: 12,
};

const GIT_SHOW_FIXTURE = `commit 1234567890abcdef1234567890abcdef12345678
Author: Test User <test@example.com>
Date:   Mon Jan 1 00:00:00 2024 -0500

    Refactor greet() to use template literals

diff --git a/src/greet.ts b/src/greet.ts
index abc1234..def5678 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,5 +1,7 @@
 export function greet(name: string) {
-  return "Hello " + name;
+  return \`Hello, \${name}!\`;
 }

+export const DEFAULT_GREETING = greet("world");
+
 export const VERSION = "1.0.0";
`;

const GIT_SHOW_HEAD: ToolWrapperProps = {
  toolUseId: "git-show-1",
  toolName: "Bash",
  msgId: "gallery-msg",
  seq: 1,
  input: { command: "git show HEAD" },
  structuredResult: { stdout: GIT_SHOW_FIXTURE, stderr: "", interrupted: false },
  isError: false,
  status: "ready",
  durationMs: 84,
};

const GIT_DIFF_FIXTURE = `diff --git a/lib/foo.ts b/lib/foo.ts
index 1111111..2222222 100644
--- a/lib/foo.ts
+++ b/lib/foo.ts
@@ -10,7 +10,7 @@ export function foo() {
-  return 1;
+  return 2;
 }
`;

const GIT_DIFF: ToolWrapperProps = {
  toolUseId: "git-diff-1",
  toolName: "Bash",
  msgId: "gallery-msg",
  seq: 2,
  input: { command: "git diff lib/foo.ts" },
  structuredResult: { stdout: GIT_DIFF_FIXTURE, stderr: "", interrupted: false },
  isError: false,
  status: "ready",
  durationMs: 22,
};

const GIT_STATUS_FIXTURE = `On branch main
Your branch is ahead of 'origin/main' by 1 commit.
  (use "git push" to publish your local commits)

nothing to commit, working tree clean
`;

const GIT_STATUS: ToolWrapperProps = {
  toolUseId: "git-status-1",
  toolName: "Bash",
  msgId: "gallery-msg",
  seq: 3,
  input: { command: "git status" },
  structuredResult: { stdout: GIT_STATUS_FIXTURE, stderr: "", interrupted: false },
  isError: false,
  status: "ready",
  durationMs: 18,
};

const BUILD_FAILURE_FIXTURE = `> tugdeck@0.1.0 build
> tsc --noEmit

src/app.tsx:42:7 - error TS2322: Type 'string' is not assignable to type 'number'.

Found 1 error.
`;

/**
 * Non-zero exit. Anthropic's Bash tool result carries `is_error` rather
 * than the shell exit code, so `isError: true` synthesizes `exit 1` —
 * the footer paints the strong-red exit badge per [Table T02].
 */
const BUILD_FAILURE: ToolWrapperProps = {
  toolUseId: "build-failure-1",
  toolName: "Bash",
  msgId: "gallery-msg",
  seq: 4,
  input: { command: "npm run build" },
  structuredResult: {
    stdout: BUILD_FAILURE_FIXTURE,
    stderr: "",
    interrupted: false,
  },
  isError: true,
  status: "ready",
  durationMs: 3_400,
};

/**
 * Interrupted. The `interrupted` badge wins over any exit code — the
 * underlying process was killed, not exited — so the wrapper omits the
 * synthesized exit code entirely.
 */
const INTERRUPTED: ToolWrapperProps = {
  toolUseId: "interrupted-1",
  toolName: "Bash",
  msgId: "gallery-msg",
  seq: 5,
  input: { command: "sleep 600" },
  structuredResult: {
    stdout: "waiting...\n",
    stderr: "",
    interrupted: true,
  },
  isError: true,
  status: "ready",
  durationMs: 30_000,
};

/**
 * ANSI-rich stdout. `ls --color` and friends emit SGR escape
 * sequences; `TerminalBlock` renders them as styled spans rather than
 * leaking raw `[` bytes into the output.
 */
/** ESC (0x1B) — kept as an escape so no raw control byte lands in source. */
const ESC = "\u001b";
const ANSI_RICH_FIXTURE =
  `${ESC}[1;34mtugdeck${ESC}[0m  ${ESC}[1;34mtugrust${ESC}[0m  ` +
  `${ESC}[32mREADME.md${ESC}[0m  ${ESC}[32mjustfile${ESC}[0m\n` +
  `${ESC}[33mwarning:${ESC}[0m 2 directories, 2 files\n`;

const ANSI_RICH: ToolWrapperProps = {
  toolUseId: "ansi-rich-1",
  toolName: "Bash",
  msgId: "gallery-msg",
  seq: 6,
  input: { command: "ls --color" },
  structuredResult: {
    stdout: ANSI_RICH_FIXTURE,
    stderr: "",
    interrupted: false,
  },
  isError: false,
  status: "ready",
  durationMs: 9,
};

/**
 * Empty-success. A command that succeeds with no stdout / stderr (e.g.
 * `cd /tmp`) has no body; the footer surfaces the `(no output)` hint so
 * the row doesn't read as missing data.
 */
const NO_OUTPUT: ToolWrapperProps = {
  toolUseId: "no-output-1",
  toolName: "Bash",
  msgId: "gallery-msg",
  seq: 7,
  input: { command: "cd /tmp" },
  structuredResult: { stdout: "", stderr: "", interrupted: false },
  isError: false,
  status: "ready",
  durationMs: 4,
};

// ---------------------------------------------------------------------------
// GalleryBashToolBlock
// ---------------------------------------------------------------------------

export function GalleryBashToolBlock() {
  return (
    <div className="cg-content" data-testid="gallery-bash-tool-block">
      <div className="cg-section">
        <TugLabel className="cg-section-title">echo (success, TerminalBlock body)</TugLabel>
        <BashToolBlock {...ECHO_HELLO} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">git show HEAD — routes through DiffBlock</TugLabel>
        <BashToolBlock {...GIT_SHOW_HEAD} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">git diff (no commit header) — also routes through DiffBlock</TugLabel>
        <BashToolBlock {...GIT_DIFF} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">git status — plain bash output stays on TerminalBlock</TugLabel>
        <BashToolBlock {...GIT_STATUS} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">npm run build — non-zero exit, footer exit badge</TugLabel>
        <BashToolBlock {...BUILD_FAILURE} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">sleep 600 — interrupted, footer interrupted badge</TugLabel>
        <BashToolBlock {...INTERRUPTED} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">ls --color — ANSI-rich stdout rendered as styled spans</TugLabel>
        <BashToolBlock {...ANSI_RICH} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">cd /tmp — empty-success, footer (no output) hint</TugLabel>
        <BashToolBlock {...NO_OUTPUT} />
      </div>
    </div>
  );
}
