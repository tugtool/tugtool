/**
 * gallery-bash-tool-block.tsx — visual fixture for `BashToolBlock`.
 *
 * Mounts the wrapper in four canonical states so the smart-pick routing
 * (introduced in #step-10-7) can be vetted visually without standing up a
 * live tugcode bridge:
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
 * 100-line stdout — exceeds `FOLD_THRESHOLD_LINES` (40) so the
 * uncontrolled TerminalBlock defaults to collapsed, and exceeds
 * `VISIBLE_THRESHOLD` (40) so the virtualizer's inner scroller is
 * built. Both surfaces are what AT0067 and AT0068 drive against:
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
  { length: 100 },
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
    </div>
  );
}
