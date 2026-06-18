/**
 * gallery-commit-block.tsx — visual fixture for the commit receipt
 * (`CommitBlock`).
 *
 * The design surface we tune the receipt against before wiring the
 * `BashToolBlock` → `git commit` routing branch. Most fixtures run the
 * REAL `parseGitCommit(command, stdout)` over realistic git command +
 * commit-output strings, so the gallery exercises the actual parse path
 * (not hand-built `CommitData`). The per-file enrichment variant passes
 * `files` explicitly to show the design ceiling once a `git show --stat`
 * source feeds it.
 *
 * Fixtures:
 *  1. This conversation's commit (450d6b28) — multi-file, body bullets.
 *  2. The single-file commit (8245846f) — small, body bullets.
 *  3. Add-heavy skew — the diffstat bar nearly all green.
 *  4. Summary only — no message body, so no "message" disclosure.
 *  5. Enriched — same commit with a per-file breakdown disclosed.
 *
 * @module components/tugways/cards/gallery-commit-block
 */

import React from "react";

import {
  CommitBlock,
  CommitHeaderTarget,
  parseGitCommit,
  type CommitData,
} from "@/components/tugways/body-kinds/commit-block";
import { ToolBlockChrome } from "./tool-blocks/tool-block-chrome";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugSeparator } from "@/components/tugways/tug-separator";

/**
 * Mount a receipt the way `BashToolBlock` eventually will: inside a real
 * `ToolBlockChrome` whose header carries the lifecycle dot + "Git Commit"
 * name + collapse chevron, matching every other tool block. The chrome
 * owns the frame; `CommitBlock` is the body.
 */
function CommitReceipt({ commit }: { commit: CommitData }): React.ReactElement {
  return (
    <ToolBlockChrome
      toolName="Git Commit"
      status="ready"
      phase="success"
      rootSlot="commit-tool-block"
      identity={<CommitHeaderTarget commit={commit} />}
      copyText={`${commit.hash} ${commit.summary}`}
    >
      <CommitBlock commit={commit} />
    </ToolBlockChrome>
  );
}

// --- Fixture 1: the commit from this very conversation -------------------

const COMMIT_450_CMD =
  `git -C /Users/kocienda/Mounts/u/src/tugtool add ` +
  `tugdeck/src/components/tugways/tug-text-editor/completion-extension.ts ` +
  `tugdeck/src/components/tugways/tug-text-editor/inline-command-completion.ts && ` +
  `git -C /Users/kocienda/Mounts/u/src/tugtool commit -m "Add separating space when accepting a completion

- acceptCompletionAt: insert atom + space, caret past the space
- acceptInlineGhost: insert command suffix + space, caret past it
- Skip the space when one already follows, to avoid a double space
- Stops typed text gluing onto the accepted token (e.g. /cmdjust)"`;

const COMMIT_450_OUT = `[main 450d6b28] Add separating space when accepting a completion
 2 files changed, 32 insertions(+), 14 deletions(-)`;

// --- Fixture 2: the smart-scroll single-file commit ----------------------

const COMMIT_824_CMD =
  `git -C /Users/kocienda/Mounts/u/src/tugtool commit -m "Guard follow-bottom disengage on non-scrollable cards

- Add isScrollable getter (scrollHeight > clientHeight) in smart-scroll.ts
- Gate wheel-up and key-up disengage paths on isScrollable
- Stops jump-to-bottom button appearing on cards with no scroll room"`;

const COMMIT_824_OUT = `[main 8245846f] Guard follow-bottom disengage on non-scrollable cards
 1 file changed, 18 insertions(+), 3 deletions(-)`;

// --- Fixture 3: add-heavy new feature (bar nearly all green) --------------

const COMMIT_ADD_CMD = `git commit -m "Add commit receipt body kind

- New CommitBlock + parser
- Gallery fixture across states"`;

const COMMIT_ADD_OUT = `[main 1f2e3d4c] Add commit receipt body kind
 3 files changed, 514 insertions(+), 2 deletions(-)`;

// --- Fixture 4: one-line message (no body disclosure) --------------------

const COMMIT_TERSE_CMD = `git commit -m "Bump tugcode to 2.1.181"`;
const COMMIT_TERSE_OUT = `[release 9a0b1c2d] Bump tugcode to 2.1.181
 1 file changed, 1 insertion(+), 1 deletion(-)`;

// --- Fixture 5: per-file breakdown, parsed from the `/tugplug:commit`
//     skill's `git commit … && git show --numstat` output. The numstat
//     lines drive the counts; the create / delete mode lines upgrade
//     status to A / D (the rest default to M).

const COMMIT_ENRICHED_CMD =
  `git commit -m "Add commit receipt body kind

- New CommitBlock + parser
- Gallery fixture across states" && git --no-pager show --numstat --format= HEAD`;

const COMMIT_ENRICHED_OUT = `[main 1f2e3d4c] Add commit receipt body kind
 4 files changed, 514 insertions(+), 23 deletions(-)
 create mode 100644 tugdeck/src/components/tugways/body-kinds/commit-block.tsx
 create mode 100644 tugdeck/src/components/tugways/body-kinds/commit-block.css
 delete mode 100644 tugdeck/src/lib/old-commit-helper.ts

312\t0\ttugdeck/src/components/tugways/body-kinds/commit-block.tsx
196\t0\ttugdeck/src/components/tugways/body-kinds/commit-block.css
6\t1\ttugdeck/src/components/tugways/cards/dev-assistant-renderer-dispatch.ts
0\t22\ttugdeck/src/lib/old-commit-helper.ts`;

// --- Build the parsed fixtures (real parse path) --------------------------

function parseOrThrow(command: string, stdout: string): CommitData {
  const data = parseGitCommit(command, stdout);
  if (data === null) {
    throw new Error("gallery-commit-block: fixture failed to parse");
  }
  return data;
}

const COMMIT_450 = parseOrThrow(COMMIT_450_CMD, COMMIT_450_OUT);
const COMMIT_824 = parseOrThrow(COMMIT_824_CMD, COMMIT_824_OUT);
const COMMIT_ADD = parseOrThrow(COMMIT_ADD_CMD, COMMIT_ADD_OUT);
const COMMIT_TERSE = parseOrThrow(COMMIT_TERSE_CMD, COMMIT_TERSE_OUT);
const COMMIT_ENRICHED = parseOrThrow(COMMIT_ENRICHED_CMD, COMMIT_ENRICHED_OUT);

export function GalleryCommitBlock(): React.ReactElement {
  return (
    <div className="cg-content" data-testid="gallery-commit-block">
      <div className="cg-section">
        <TugLabel className="cg-section-title">
          multi-file commit — parsed from real command + stdout
        </TugLabel>
        <CommitReceipt commit={COMMIT_450} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          single-file commit — smaller diffstat
        </TugLabel>
        <CommitReceipt commit={COMMIT_824} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          add-heavy — diffstat bar nearly all green
        </TugLabel>
        <CommitReceipt commit={COMMIT_ADD} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          one-line message — no body disclosure
        </TugLabel>
        <CommitReceipt commit={COMMIT_TERSE} />
      </div>

      <TugSeparator />

      <div className="cg-section">
        <TugLabel className="cg-section-title">
          enriched — per-file breakdown (M / A / D status glyphs)
        </TugLabel>
        <CommitReceipt commit={COMMIT_ENRICHED} />
      </div>
    </div>
  );
}
