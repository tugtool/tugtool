# Tide Assistant Rendering — Empirical Session Audit

*Output of [tugplan-tide-assistant-rendering Step 0](./tide-assistant-rendering.md#step-0). Calibrates thresholds and tool coverage in subsequent steps. Re-run via `bun run tugdeck/scripts/audit-claude-sessions.ts`; current numbers from 2026-05-08.*

**Owner:** Ken Kocienda
**Status:** Audit complete; calibration recommendations integrated into the parent plan.
**Machine-readable companion:** `roadmap/tide-assistant-rendering-session-audit.json`.

---

## 1. Method

### 1.1 Corpus

- **Source:** `~/.claude/projects/-Users-kocienda-Mounts-u-src-tugtool/`
- **Size:** 1,031 session JSONL files, ~2.0 GB total, **232,031 JSONL lines** parsed.
- **Parse errors:** 0.
- **Files skipped:** 0.

The corpus reflects ~5 weeks of real Claude Code dogfooding on this very project, mostly Opus model traffic.

### 1.2 Format note

These are Claude Code's **session-log** JSONLs — the CLI's own state-directory format. This is RELATED to but DISTINCT from the **stream-json wire format** captured in `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/`.

| Session log | ↔ | Stream-json |
|-------------|---|-------------|
| `assistant.message.content[type=text]` | → | `assistant_text` |
| `assistant.message.content[type=thinking]` | → | `thinking_text` |
| `assistant.message.content[type=tool_use]` | → | `tool_use` |
| `user.message.content[type=tool_result]` | → | `tool_result` (no separate `_structured`) |
| `user.message.content[type=image]` | → | inbound image attachment |

**Things NOT in session logs** (so this audit cannot calibrate them):

- `control_request_forward` (permission / question events) — wire-only.
- `cost_update` per turn — wire-only.
- `tool_use_structured` typed wrapper shapes — session log has the raw `tool_result` text only.
- True subagent recursion depth — session log flattens nested invocations; depth requires wire-level `subagent_spawn` tracking.

These four are documented as **measurement limitations** in §6.

### 1.3 Reproduction

```bash
bun run tugdeck/scripts/audit-claude-sessions.ts \
  --json roadmap/tide-assistant-rendering-session-audit.json \
  > /tmp/audit-report.txt
```

Add `--sample N` for a quick check on the most-recent N files. The full pass takes seconds because the script streams each file (no whole-file buffering).

---

## 2. Executive summary

1. **Three tools dominate.** Bash 39.7%, Edit 23.8%, Read 21.4% — together **84.9% of all `tool_use` events**. The plan's [Step 5–11](./tide-assistant-rendering.md#step-5) sequencing (Terminal+Bash → File+Read → Diff+Edit) is exactly the right priority order.
2. **Eleven new tool names surfaced** that aren't in [Table T02](./tide-assistant-rendering.md#t02-tool-wrappers). Most are low-volume management/harness tools that route cleanly through `DefaultToolWrapper`; two (TaskCreate, TaskUpdate) are higher volume and warrant explicit registry entries even if their wrapper just calls `DefaultToolWrapper`. See §4.
3. **Mermaid usage in real prose: 0 sessions out of 1,031.** Math: **14 sessions (1.4%)**. **Validates [D10] lazy-loading decisively** — eagerly bundling 1.3 MB of Mermaid + KaTeX would cost every session for content that ~99% never see.
4. **Subagent depth, conservative measure: max 1.** Real sessions never recurse beyond a single agent call. [D17]'s depth cap of 3 is generous; could safely drop to 2.
5. **Code-block language distribution.** 84.1% of fenced code blocks in assistant prose have no language tag. Of the 16% that do: ts/tsx/js dominate (~12% combined), bash (0.9%), css (0.7%), rust (0.6%). **No mermaid, latex, or math fences in prose** — those only appear via fenced math blocks (and even then rarely).
6. **Calibration adjustments recommended.** FileBlock fold threshold should bump from 50 to ~80 lines. Other thresholds (Bash 40-line, DiffBlock 40-hunk, PathList 100-paths) align well with P95 of real distributions.

---

## 3. Top-level event distribution

### 3.1 JSONL line types (n = 232,031)

| Count | Type |
|------:|------|
| 103,693 | assistant |
| 73,156 | user |
| 21,598 | attachment |
| 9,914 | last-prompt |
| 8,538 | permission-mode |
| 6,306 | file-history-snapshot |
| 3,831 | system |
| 2,624 | queue-operation |
| 2,312 | ai-title |
| 59 | worktree-state |

### 3.2 Assistant content blocks (n = 103,719)

| Count | Type | Renders to |
|------:|------|-----------|
| 64,267 | tool_use | Tool wrapper per [Table T02](./tide-assistant-rendering.md#t02-tool-wrappers) |
| 22,420 | text | MarkdownBlock |
| 17,032 | thinking | ThinkingBlock |

**Implication:** ~16 thinking blocks per session on average. Strongly validates **[D14]** ("thinking blocks always collapsed by default after `turn_complete`") — without default collapse, the transcript would be dominated by reasoning text.

### 3.3 User content blocks (n = 73,761)

| Count | Type | Notes |
|------:|------|-------|
| 64,284 | tool_result | Joined to a `tool_use` by `tool_use_id`; unmatched ones below |
| 8,989 | text | User prompts |
| 488 | image | Inbound image attachments — meaningful traffic for `ImageBlock` and atoms-attachments |

488 image attachments across 1,031 sessions = **~0.47 images per session on average**. Real but uncommon. The atoms-attachments plan and `ImageBlock` are correctly scoped.

---

## 4. Tool-use frequency

### 4.1 Full distribution (n = 64,267 tool_use events)

| Count | % | Tool name | In Table T02? | Disposition |
|------:|--:|-----------|---------------|-------------|
| 25,521 | 39.71% | Bash | ✓ | BashToolBlock |
| 15,286 | 23.79% | Edit | ✓ | EditToolBlock (alias for MultiEdit) |
| 13,748 | 21.39% | Read | ✓ | ReadToolBlock |
| 3,426 | 5.33% | **TaskUpdate** | ✗ | Add to registry → `DefaultToolWrapper` (1-line responses) |
| 2,708 | 4.21% | Grep | ✓ | GrepToolBlock |
| 1,789 | 2.78% | **TaskCreate** | ✗ | Add to registry → `DefaultToolWrapper` initially; promote to `TaskCreateToolBlock` if dogfooding warrants |
| 955 | 1.49% | Write | ✓ | WriteToolBlock |
| 342 | 0.53% | Agent | ✓ | TaskToolBlock (alias `Task`/`Agent` per [D16]) |
| 145 | 0.23% | **ToolSearch** | ✗ | `DefaultToolWrapper` |
| 104 | 0.16% | Glob | ✓ | GlobToolBlock |
| 41 | 0.06% | WebSearch | ✓ | WebSearchToolBlock |
| 38 | 0.06% | **Monitor** | ✗ | `DefaultToolWrapper` |
| 37 | 0.06% | **TaskOutput** | ✗ | `DefaultToolWrapper` |
| 35 | 0.05% | AskUserQuestion | ✓ (chrome) | QuestionDialog |
| 34 | 0.05% | **TaskList** | ✗ | `DefaultToolWrapper` |
| 22 | 0.03% | WebFetch | ✓ | WebFetchToolBlock |
| 17 | 0.03% | **ScheduleWakeup** | ✗ | `DefaultToolWrapper` |
| 10 | 0.02% | **Skill** | ✗ | `DefaultToolWrapper` |
| 7 | 0.01% | **TaskStop** | ✗ | `DefaultToolWrapper` |
| 1 | 0.00% | **EnterWorktree** | ✗ | `DefaultToolWrapper` |
| 1 | 0.00% | **ExitWorktree** | ✗ | `DefaultToolWrapper` |

**Bold rows are tools the audit surfaced that aren't currently in [Table T02](./tide-assistant-rendering.md#t02-tool-wrappers).**

### 4.2 Tools missing from Table T02 — disposition

The plan must explicitly list these. Recommendation:

- **`TaskCreate` and `TaskUpdate`** — together **8.1% of all tool calls**. Add registry entries to dispatch. Both have short, structured outputs (TaskUpdate: p99 = 34 chars, single-line; TaskCreate: p99 = 107 chars). `DefaultToolWrapper` renders them cleanly today; bespoke wrappers (`TaskCreateToolBlock`, `TaskUpdateToolBlock`) deferred unless dogfooding shows the JsonTree presentation is suboptimal.
- **The Task* management family** (`TaskList`, `TaskOutput`, `TaskStop`) — long tail under 0.06%. Through `DefaultToolWrapper`.
- **`Monitor`, `Skill`, `ScheduleWakeup`, `ToolSearch`, `EnterWorktree`, `ExitWorktree`** — harness/management tools, all under 0.25%. Through `DefaultToolWrapper`.

**Action:** Update [Table T02](./tide-assistant-rendering.md#t02-tool-wrappers) to add a "Routed through DefaultToolWrapper" section listing these 11 tool names so dispatch coverage is documented even when the wrapper is generic.

### 4.3 Naming clarification: `Agent` not `Task`

Real sessions emit `tool_name: "Agent"` for what was historically called `Task`. [D16]'s alias map `multiedit → edit` should also include `task → agent` (or vice versa) so the dispatch is robust to either name. The audit confirms:

- `Agent` events: 342 (current Claude Code emits this name).
- `Task` events: 0 in this corpus (has been renamed).

**Action:** [Table T02](./tide-assistant-rendering.md#t02-tool-wrappers) row currently labels the wrapper as "TaskToolBlock" with tool name "Task" — update to register both `Agent` and `Task` (lowercase via [D16]) keying to the same wrapper, named whichever feels right (`AgentToolBlock` or `TaskToolBlock`). Recommendation: keep filename `task-tool-block.tsx` for stability, register under both names.

### 4.4 Per-tool error rates (n_total = 65,470 ok + err results)

Useful for designing each wrapper's error state.

| Tool | OK | Err | Err% |
|------|---:|----:|-----:|
| Bash | 25,148 | 394 | 1.54% |
| Edit | 13,484 | 281 | 2.04% |
| Read | 13,257 | 228 | 1.69% |
| Grep | 2,656 | 37 | 1.37% |
| Agent | 331 | 11 | 3.22% |
| Write | 897 | 11 | 1.21% |
| WebFetch | 19 | 3 | 13.64% |
| Skill | 6 | 4 | 40.00% |
| AskUserQuestion | 21 | 10 | 32.26% |
| TaskOutput | 33 | 4 | 10.81% |

**Implication:** The high-volume tools (Bash/Edit/Read) all have ~1.5–2% error rates — error styling needs to be designed into each wrapper, not an afterthought. WebFetch and Skill have notably higher error rates (low-n caveat) but their wrappers should treat errors as a primary state.

The 1,851 "(unknown)" tool_results are events without a matching `tool_use_id` in the same file — likely from session compaction or fork boundaries that broke the join. They can't be tied back to a specific tool but represent **~2.8% of tool_results** that need fallback rendering. `DefaultToolWrapper` covers them.

---

## 5. Threshold calibration

The audit's load-bearing output: concrete recommendations for the threshold values currently set by intuition.

### 5.1 [Table T01](./tide-assistant-rendering.md#t01-body-kinds) collapse-threshold review

| Body kind | Current default | Real-world distribution | Recommendation |
|-----------|----------------|-------------------------|----------------|
| MarkdownBlock | per-block height | n/a | Keep |
| TerminalBlock | 40 lines (collapse) | Bash stdout: P50=6, **P95=40**, P99=100 | **Calibrated correctly** — 40 lines is exactly the P95. |
| TerminalBlock | 10k lines (retention) | Bash max=706 | 10k is generous; max observed is ~700. **Default 10k is safe.** |
| DiffBlock | 40 hunks (collapse) | Edit new_string: P50=12 lines, P95=84, P99=190, max=626 | Hunks ≈ lines/3 in practice. P95 = 84 lines ≈ **~28 hunks**. **40-hunk threshold catches the top ~3%** — calibrated correctly. |
| FileBlock | 50 lines (collapse) | Read: **P50=50**, P95=275, P99=658 | **Bump default to ~80 lines.** 50 is exactly the median, so half of every file fold by default — that's noisy. 80 lines catches the upper ~40%, less aggressive but still surfaces the genuinely-long files. |
| PathListBlock | 100 paths | Glob: P50=2, P95=101 | **Calibrated correctly** — 100 catches the top 5%. |
| SearchResultBlock | 50 results | Grep: P50=6, P95=46, P99=99 | **Calibrated correctly** — 50 ≈ P95. |
| JsonTreeBlock | depth 3 | n/a (no shape data) | Keep default; revisit if user feedback surfaces issues. |
| TodoListBlock | none | TaskUpdate input p50=37 chars; TodoWrite per fixtures has typical 3-7 items | Keep no-collapse (lists are usefully scannable). |
| AgentTranscriptBlock | depth 2 | **Real max observed: 1** | **Default depth cap can drop from 3 to 2.** Keep 3 as max (paranoia + room for nested agents). |
| ImageBlock | none | Per-session p50 = 0 images, max ~5 | Keep. |
| MermaidBlock | n/a | **0 sessions** | Lazy-load alone is the right call. |
| KaTeXBlock | n/a | 14 / 1031 sessions = 1.4% | Lazy-load is the right call. |
| TableBlock (rich) | 10 rows × 5 cols (promote threshold) | Not measured — would need parsing GFM tables in assistant prose | Defer empirical calibration; threshold is reasonable per design. |
| PlainTextBlock | 100 lines | n/a | Keep. |

### 5.2 [Q04] — TerminalBlock retained-line cap

The plan's [Q04](./tide-assistant-rendering.md#q04-terminal-line-cap) wonders about the cap on retained-in-memory lines for very large Bash outputs. **Real data:**

- P50 = 6 lines.
- P95 = 40 lines.
- P99 = 100 lines.
- Max observed = 706 lines.

The proposed default of **10k retained** is two orders of magnitude above the observed maximum. Confirms the proposed default is safe; the configurable tugbank knob is **not needed in v1** unless dogfooding surfaces a regression.

**Resolution to [Q04]:** Default 10k retained, no tugbank knob in v1. Revisit only if a user reports a long-running Bash output (`watch`, streaming logs) that hits the cap.

### 5.3 Stretch-content lazy-load justification

**Mermaid: 0 sessions out of 1,031.** Across 5 weeks of real dogfooding, the assistant never emitted a Mermaid diagram. Eagerly bundling Mermaid (~1 MB) would cost 100% of card-mounts for 0% benefit. **[D10] lazy-loading is decisively the right call.**

**KaTeX / math: 14 sessions (1.4%).** Heuristic match — fenced `math`/`latex` blocks plus `$...$` regex on prose. Eagerly bundling KaTeX (~350 KB) would cost 98.6% of card-mounts the bundle for the 1.4% that need it. **Lazy-load justified.**

If anything, the audit suggests we could de-prioritize Mermaid in the sequencing — 0% usage doesn't urgent it. But it's already gated to [#step-23](./tide-assistant-rendering.md#step-23) (after the high-frequency tools and the dialogs), so the sequencing is fine.

### 5.4 Code-block language priority

For [Step 7's](./tide-assistant-rendering.md#step-7) FileBlock and inside DiffBlock hunks, the Shiki language packs we should ensure are pre-warmed (or at least lazy-loaded eagerly):

| Language | % of fenced blocks (when tagged) |
|----------|----------------------------------:|
| ts | 7.96% |
| tsx | 2.02% |
| js | 1.55% |
| bash | 0.88% |
| css | 0.74% |
| rust | 0.61% |
| typescript | 0.54% (synonym for `ts`) |
| sh | 0.54% (synonym for `bash`) |
| swift | 0.34% |
| jsx | 0.20% |

**84.14% of fenced blocks have no language tag** — strongest single signal. The default-no-language code rendering must look excellent without any highlighter. Plain-monospace + line-counts is enough; Shiki kicks in only when a lang is specified.

### 5.5 Tool-input size implications

Some tool inputs are surprisingly large:

- **Edit input p99 = 13,521 chars, max = 61,227 chars.** Edit's `(old_string, new_string)` pair is the bulk. This is exactly why DiffBlock matters — rendering 60 KB of input as raw JSON would be a wall of text.
- **Write input p99 = 75,664 chars, max = 113,475 chars.** Write content gets big; FileBlock preview must virtualize for the long tail.
- **AskUserQuestion input p95 = 3,595 chars, p99 = 4,027 chars.** The questions themselves can be long (markdown-formatted with options). QuestionDialog body picker should use MarkdownBlock for the question text per [#step-19](./tide-assistant-rendering.md#step-19).
- **Bash input p99 = 1,371 chars, max = 7,804 chars.** Long commands — header truncation with hover-expand is essential. [#step-6](./tide-assistant-rendering.md#step-6) tasks already account for this.

---

## 6. Limitations

The session-log format does not capture wire-level events. The following questions cannot be answered from this corpus:

1. **Permission frequency.** `control_request_forward` events are not in session logs. The session log records the resolved outcome (the tool ran or it didn't) but not the dialog flow. Calibrating PermissionDialog priority needs wire-level capture.
2. **AskUserQuestion frequency surfaced via control_request_forward** — `AskUserQuestion` did appear as a tool name (35 events, 0.05%) but that's the assistant *invoking* the tool, not the user-facing dialog flow. The 32% error rate on AskUserQuestion is interesting (likely user-cancellations counted as errors) and suggests the dialog UX matters even at low volume.
3. **Per-turn cost data.** `cost_update` events live in the wire layer; the session log only retains coarse-grained billing data. CostChrome calibration is intuition-based for now.
4. **Structured-result shape coverage.** `tool_use_structured` is a wire wrapper; session logs have only the raw `tool_result.content`. If Anthropic adds new structured shapes, this audit doesn't surface them — drift detection [D04] is the safety net.
5. **True subagent depth.** The session log flattens nested subagent invocations into the top-level transcript. The conservative measure used here (= 1 wherever an Agent tool is invoked) is a lower bound. Wire-level `subagent_spawn`/parent-tool-id correlation would give the real number.

These limitations are noted, not blocking. Drift detection ([D04]) and DefaultToolWrapper ([D11]) provide the runtime safety net; the audit confirms the *known* shapes and frees us to ship without re-instrumenting Claude Code.

---

## 7. Action items for the parent plan

Concrete edits to integrate into [tugplan-tide-assistant-rendering.md](./tide-assistant-rendering.md):

### 7.1 Update [Table T02](./tide-assistant-rendering.md#t02-tool-wrappers)

Add an explicit "Routed through DefaultToolWrapper (audit-confirmed)" section listing: `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskOutput`, `TaskStop`, `Monitor`, `Skill`, `ScheduleWakeup`, `ToolSearch`, `EnterWorktree`, `ExitWorktree`.

### 7.2 Update [D16]'s alias map

Add `task → agent` (or vice versa) so dispatch handles both historical names.

### 7.3 Update [#step-7](./tide-assistant-rendering.md#step-7) FileBlock collapse threshold

Change "Long-content collapse (default folded if > 50 lines; calibrate per Step 0 audit findings if available)" to "Long-content collapse (default folded if > 80 lines per audit P50=50, P95=275)".

### 7.4 Resolve [Q04] in [#step-5](./tide-assistant-rendering.md#step-5)

The terminal-line cap question is resolved: 10k retained, no tugbank knob in v1. Update [Q04] resolution from OPEN to RESOLVED.

### 7.5 Update [D17] depth note

Real-session depth observed = 1; default depth cap of 3 is generous. No change to the cap, but the audit footnote should mention "no real-session depth > 1 observed in 1,031-session corpus."

### 7.6 De-prioritize Mermaid sequencing (optional)

Mermaid usage = 0 in corpus. [#step-23](./tide-assistant-rendering.md#step-23) (Mermaid) could move later in sequence or be downgraded to "after KaTeX, ship only if user feedback surfaces a need." Leaving as-is is also defensible (the work is real, just rare).

### 7.7 Decide [D14]'s default — confirmed

Real-session thinking blocks = 17,032 across 1,031 sessions ≈ **16/session**. Without default-collapse, the transcript would be dominated by reasoning. **[D14]'s default-collapse rule is empirically validated.**

---

## 8. Appendix — full distributions

### 8.1 tool_use input size (chars JSON-stringified)

| Tool | n | P50 | P95 | P99 | Max |
|------|--:|----:|----:|----:|----:|
| Bash | 25,521 | 174 | 614 | 1,371 | 7,804 |
| Edit | 15,286 | 1,259 | 6,508 | 13,521 | 61,227 |
| Read | 13,748 | 119 | 138 | 156 | 181 |
| TaskUpdate | 3,426 | 37 | 39 | 102 | 651 |
| Grep | 2,708 | 168 | 231 | 294 | 684 |
| TaskCreate | 1,789 | 227 | 431 | 568 | 906 |
| Write | 955 | 8,192 | 38,717 | 75,664 | 113,475 |
| Agent | 342 | 646 | 5,756 | 12,975 | 14,627 |
| ToolSearch | 145 | 65 | 65 | 89 | 109 |
| Glob | 104 | 39 | 97 | 114 | 138 |
| WebSearch | 41 | 85 | 127 | 134 | 134 |
| Monitor | 38 | 552 | 599 | 599 | 599 |
| TaskOutput | 37 | 53 | 53 | 53 | 53 |
| AskUserQuestion | 35 | 749 | 3,595 | 4,027 | 4,027 |
| TaskList | 34 | 2 | 2 | 2 | 2 |
| WebFetch | 22 | 388 | 720 | 1,073 | 1,073 |
| ScheduleWakeup | 17 | 179 | 293 | 293 | 293 |
| Skill | 10 | 66 | 5,586 | 5,586 | 5,586 |
| TaskStop | 7 | 23 | 23 | 23 | 23 |

### 8.2 tool_result output size (chars)

| Tool | n | P50 | P95 | P99 | Max |
|------|--:|----:|----:|----:|----:|
| Bash | 25,542 | 264 | 2,938 | 7,273 | 27,403 |
| Edit | 13,765 | 184 | 208 | 231 | 5,744 |
| Read | 13,485 | 2,317 | 13,849 | 32,109 | 64,103 |
| TaskUpdate | 3,426 | 23 | 24 | 34 | 56 |
| Grep | 2,693 | 336 | 4,028 | 8,442 | 16,638 |
| (unknown) | 1,851 | 187 | 4,249 | 9,858 | 23,864 |
| TaskCreate | 1,789 | 69 | 94 | 107 | 148 |
| Write | 908 | 177 | 209 | 216 | 226 |
| Agent | 342 | 3,226 | 15,483 | 25,161 | 34,263 |

### 8.3 tool_result line-count distribution

| Tool | n | P50 | P95 | P99 | Max |
|------|--:|----:|----:|----:|----:|
| Bash | 25,542 | 6 | 40 | 100 | 706 |
| Read | 13,485 | 50 | 275 | 658 | 1,548 |
| Grep | 2,693 | 6 | 46 | 99 | 253 |
| Agent | 342 | 51 | 217 | 348 | 476 |
| WebFetch | 22 | 34 | 397 | 1,189 | 1,189 |
| Glob | 104 | 2 | 101 | 101 | 101 |

### 8.4 Edit-tool diff size (lines)

| Field | n | P50 | P95 | P99 | Max | Mean |
|-------|--:|----:|----:|----:|----:|-----:|
| old_string | 15,280 | 8 | 47 | 104 | 491 | 14.33 |
| new_string | 15,279 | 12 | 84 | 190 | 626 | 23.99 |

### 8.5 Fenced code-block languages in assistant text

| Count | % | Lang |
|------:|--:|------|
| 1,247 | 84.14% | (none) |
| 118 | 7.96% | ts |
| 30 | 2.02% | tsx |
| 23 | 1.55% | js |
| 13 | 0.88% | bash |
| 11 | 0.74% | css |
| 9 | 0.61% | rust |
| 8 | 0.54% | typescript |
| 8 | 0.54% | sh |
| 5 | 0.34% | swift |
| 3 | 0.20% | jsx |
| 2 | 0.13% | json |
| 2 | 0.13% | sql |
| 2 | 0.13% | makefile |
| 1 | 0.07% | markdown |

(Total fenced blocks in assistant prose: 1,482.)

### 8.6 Per-session feature presence

| Feature | Sessions / total | Pct |
|---------|-----------------:|----:|
| Total sessions | 1,031 | 100% |
| Sessions with Task/Agent invocation | 53 | 5.14% |
| Sessions with mermaid fenced block | 0 | 0.00% |
| Sessions with math fenced block or `$...$` heuristic | 14 | 1.36% |
| Max observed agent depth (in-session, conservative) | 1 | — |

---

## 9. Re-running the audit

The script is intentionally lightweight — runs in seconds against the full corpus on a typical machine, no dependencies beyond Bun's stdlib (uses Node's `readline`).

Re-run on corpus growth:

```bash
bun run tugdeck/scripts/audit-claude-sessions.ts \
  --json roadmap/tide-assistant-rendering-session-audit.json
```

The JSON sidecar can be diffed across runs to surface drift in tool frequency or content sizes. If a future audit shows a tool name that wasn't in the previous run, that's a candidate for a registry promotion.

The script is **deletable after this audit per [Step 0](./tide-assistant-rendering.md#step-0)** — but worth keeping until the parent plan ships, since later steps reference its calibration outputs.
