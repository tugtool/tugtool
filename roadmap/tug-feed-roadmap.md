# Tug-Feed Integration Roadmap

*Prove the data flow. Hook capture → correlation → feed file → tugcast → frontend. CLI-first, UI later.*

**Design document:** [tug-feed.md](tug-feed.md) — the vision and architecture.
**Downstream:** [tug-conversation.md](tug-conversation.md) — the UI that consumes this data.

---

## Why This Comes First

The conversation UI (tug-markdown, tug-prompt-input) depends on understanding what data actually flows through the system. The tug-feed design document describes a hooks-based capture and correlation strategy, but none of it exists yet. Before building UI, we need to:

1. **Prove the hook capture chain works** — do `PreToolUse(Task)`, `SubagentStart`, `SubagentStop`, `PostToolUse(Task)` fire reliably? Can we parse the orchestrator's prompt for step context?
2. **Prove the correlation logic works** — can we match `PreToolUse` to `SubagentStart` by `(session_id, agent_type, temporal sequence)`? Does the pending-agents state file survive concurrent agents?
3. **Prove feed events reach tugdeck** — can tugcast tail `feed.jsonl` and deliver frames to `TugConnection.onFrame()`?
4. **Discover the real data shapes** — what do `last_assistant_message` fields actually contain for each agent type? What's in the orchestrator prompts? This informs custom block renderer designs.

This is infrastructure work. The output is a working pipeline and a `tugcode feed` CLI for inspection, not polished UI.

---

## What Already Exists

| Layer | Status | Notes |
|-------|--------|-------|
| **Claude Code hooks API** | Stable | 24 event types. `SubagentStart`, `SubagentStop`, `PreToolUse`, `PostToolUse` all available. Async hooks don't block. |
| **Tugplug hooks** | Minimal | `hooks.json` has `PreToolUse` hooks for auto-approval (`auto-approve-tug.sh`) and init (`ensure-init.sh`). No feed capture. |
| **Agent bridge (tugcast)** | Working | `CodeOutput` (`0x40`) and `CodeInput` (`0x41`) carry conversation events. Agent bridge spawns tugtalk, relays JSON-lines. |
| **Feed file (`.tugtool/feed/`)** | Doesn't exist | No feed directory, no feed.jsonl, no capture scripts. |
| **Tugcast feed for tug-feed** | Doesn't exist | No FeedId registered, no file-tailing feed implementation. |
| **`tugcode feed` CLI** | Doesn't exist | No CLI command for feed inspection. |
| **Tugstate** | Working | `tugcode state show --json` returns step status, artifacts, checklists. Authoritative ground truth. |

---

## Phase 1: Hook Capture — Prove Events Fire

**Goal:** Add async hooks that capture agent lifecycle events and write raw event JSON to `.tugtool/feed/raw-events.jsonl`. No correlation, no semantic enrichment — just prove the data arrives.

### Work

1. **Create `.tugtool/feed/` directory convention.** Add to `tugcode init` so it's created alongside other `.tugtool/` infrastructure.

2. **Write `feed-capture.sh`** — a shell script that receives hook JSON on stdin and appends a timestamped entry to `.tugtool/feed/raw-events.jsonl`. Fields: `timestamp`, `event_type` (hook event name), `session_id`, `agent_type` (if present), `agent_id` (if present), raw `tool_input` or `last_assistant_message` (truncated for size).

3. **Add hooks to `tugplug/hooks/hooks.json`:**

   | Hook Event | Matcher | Captures |
   |-----------|---------|----------|
   | `PreToolUse` | `Task` | Orchestrator prompt (step context), subagent_type, tool_use_id |
   | `PostToolUse` | `Task` | Agent result, tool_use_id |
   | `SubagentStart` | `tugplug:.*` | agent_id, agent_type |
   | `SubagentStop` | `tugplug:.*` | agent_id, agent_type, last_assistant_message, agent_transcript_path |

   All hooks: `"async": true` to avoid blocking.

4. **Manual test.** Run `/implement` on a small plan. Inspect `raw-events.jsonl`. Verify:
   - All four hook types fire
   - `SubagentStart` and `SubagentStop` have matching `agent_id`
   - `PreToolUse(Task)` contains the orchestrator's prompt with step context
   - `SubagentStop` contains `last_assistant_message` with structured agent output
   - Events for parallel agents (conformance + critic) don't collide

### Output

- `.tugtool/feed/raw-events.jsonl` with raw hook data
- Confidence that the four-event correlation chain fires reliably
- Real data samples for every agent type's `last_assistant_message`

### Inspection

No CLI tool yet — just `cat` and `jq`:

```bash
# Watch events arrive in real time
tail -f .tugtool/feed/raw-events.jsonl | jq .

# Count events by type
jq -r '.event_type' .tugtool/feed/raw-events.jsonl | sort | uniq -c

# Show agent lifecycle
jq 'select(.event_type == "SubagentStart" or .event_type == "SubagentStop") | {event_type, agent_type, agent_id}' .tugtool/feed/raw-events.jsonl
```

---

## Phase 2: Correlation — Build the Semantic Layer

**Goal:** Correlate raw events into meaningful feed events with plan-step context. Write enriched events to `.tugtool/feed/feed.jsonl`.

### Work

1. **Write `feed-correlate.sh`** (or rewrite `feed-capture.sh` to do both). The correlation logic from [tug-feed.md](tug-feed.md):

   - On `PreToolUse(Task)`: parse `tool_input.prompt` for `step_anchor`, `plan_path`, `agent_role`. Stash in `.tugtool/feed/.pending-agents.json` keyed by `(session_id, agent_type)`.
   - On `SubagentStart`: look up pending context by `(session_id, agent_type)`, associate with `agent_id`. Move to active agents.
   - On `SubagentStop`: look up active agent by `agent_id`. Parse `last_assistant_message` for structured results (verdict, drift, build status). Emit enriched event.
   - On `PostToolUse(Task)`: match `tool_use_id` to original `PreToolUse`. Close the correlation loop.

2. **Define the feed event schema.** Each event in `feed.jsonl`:

   ```json
   {
     "version": 1,
     "timestamp": "ISO8601",
     "session_id": "...",
     "event_type": "agent_started|agent_completed|phase_changed|step_started|step_completed",
     "plan_path": ".tugtool/tugplan-*.md",
     "step_anchor": "step-3",
     "agent_role": "architect|coder|reviewer|committer|auditor",
     "agent_id": "agent-...",
     "data": { /* event-specific */ }
   }
   ```

3. **Parse `last_assistant_message` per agent type.** Each tugplug agent returns structured JSON. Document the actual shapes:

   | Agent | Output Shape | Key Fields |
   |-------|-------------|------------|
   | architect-agent | Strategy JSON | `expected_touch_set`, `strategy_summary` |
   | coder-agent | Implementation JSON | `files_created`, `files_modified`, `build_passed`, `tests_passed`, `drift_severity` |
   | reviewer-agent | Review JSON | `verdict` (APPROVE/REVISE), `findings[]` |
   | committer-agent | Commit JSON | `sha`, `message` |
   | auditor-agent | Audit JSON | `verdict`, `issues[]`, `build_passed`, `tests_passed` |

4. **Handle concurrency.** Two agents of different types can run in parallel (conformance + critic). Since they have different `agent_type` values, the `(session_id, agent_type)` key is unambiguous. Verify this with a real `/plan` run.

5. **Tugstate enrichment.** After `SubagentStop` for a coder, optionally query `tugcode state show --json` to get authoritative step status. Add `step_title`, `step_index`, `total_steps` to the feed event.

### Output

- `.tugtool/feed/feed.jsonl` with semantically enriched events
- `.tugtool/feed/.pending-agents.json` correlation state (ephemeral)
- Documented agent output shapes for every tugplug agent type
- Verified concurrent correlation for parallel agents

### Inspection

```bash
# Watch enriched feed
tail -f .tugtool/feed/feed.jsonl | jq .

# Step-level summary
jq 'select(.event_type | startswith("step_")) | {event_type, step_anchor, data}' .tugtool/feed/feed.jsonl

# Agent timeline
jq '{ts: .timestamp, event: .event_type, agent: .agent_role, step: .step_anchor}' .tugtool/feed/feed.jsonl
```

---

## Phase 3: Agent-Internal Events

**Goal:** Capture fine-grained events from within agent execution — file modifications, bash commands, build/test results.

### Work

1. **Add agent-scoped hooks** to coder-agent and reviewer-agent frontmatter:

   ```yaml
   # coder-agent.md frontmatter
   hooks:
     PostToolUse:
       - matcher: "Edit|Write"
         hooks:
           - type: command
             command: "${CLAUDE_PLUGIN_ROOT}/hooks/feed-file-change.sh"
             async: true
       - matcher: "Bash"
         hooks:
           - type: command
             command: "${CLAUDE_PLUGIN_ROOT}/hooks/feed-command-result.sh"
             async: true
   ```

2. **Write `feed-file-change.sh`** — captures file path, operation (create/edit), and tags with step context from `.tugtool/feed/.pending-agents.json`.

3. **Write `feed-command-result.sh`** — captures command description, exit code, and tags with step context.

4. **New event types** in `feed.jsonl`:

   | Event Type | Source | Data |
   |-----------|--------|------|
   | `file_modified` | coder `PostToolUse(Edit\|Write)` | `file_path`, `operation` |
   | `command_ran` | coder `PostToolUse(Bash)` | `command`, `description`, `exit_code` |
   | `build_result` | Parsed from coder output | `success`, `error_count` |
   | `test_result` | Parsed from coder output | `passed`, `failed`, `skipped` |

### Output

- File-level and command-level detail within agent executions
- The "2 files modified" and "build: passing" detail for progress UI

---

## Phase 4: `tugcode feed` CLI

**Goal:** A proper Rust CLI command for inspecting and tailing the feed, replacing ad-hoc `jq` commands.

### Work

1. **`tugcode feed tail`** — live-tailing view of feed.jsonl with human-readable formatting:

   ```
   [step-1] Authentication Module           COMPLETE  (3m 22s)
   [step-2] Database Schema                 COMPLETE  (5m 41s)
   [step-3] API Endpoints                   IN PROGRESS
            architect: strategy complete
            coder: implementing... (2 files modified)
              src/api/routes.rs (created)
              src/api/handlers.rs (editing)
            build: passing
   [step-4] Frontend Integration            PENDING
   [step-5] Tests                           PENDING
   ```

2. **`tugcode feed show`** — dump feed events as JSON (for piping/scripting).

3. **`tugcode feed status`** — summary of current implementation progress (total steps, completed, in-progress, agent activity).

### Output

- `tugcode feed tail` for live progress monitoring
- `tugcode feed show` for programmatic access
- `tugcode feed status` for quick summaries

---

## Phase 5: Tugcast Feed Integration

**Goal:** Feed events reach tugdeck through tugcast's WebSocket infrastructure.

### Work

1. **Register new FeedId.** Add `TugFeed = 0x50` to:
   - `tugcast-core/src/protocol.rs` (Rust enum)
   - `tugdeck/src/protocol.ts` (TypeScript enum)

2. **Implement `TugFeedFeed`** in tugcast. A `StreamFeed` (broadcast channel) that:
   - Tails `.tugtool/feed/feed.jsonl` using `notify` file watcher (same pattern as `FilesystemFeed`)
   - Parses each new line as JSON
   - Publishes as a frame with `FeedId::TugFeed`
   - On bootstrap: sends all existing events (or last N events for bounded bootstrap)

3. **Frontend subscription.** In tugdeck:
   ```typescript
   connection.onFrame(FeedId.TUG_FEED, (payload) => {
     const event = JSON.parse(new TextDecoder().decode(payload));
     // Route to conversation card, progress UI, etc.
   });
   ```

4. **Verify end-to-end.** Run `/implement`, watch events arrive in tugdeck console.

### Output

- Feed events flowing from hook → shell script → feed.jsonl → tugcast → WebSocket → tugdeck
- Foundation for conversation card progress UI

---

## Phase 6: CodeOutput/CodeInput Verification

**Goal:** Verify the existing conversation transport works for the tug-markdown/tug-prompt-input use case. This is about understanding and documenting what already works, not building new infrastructure.

### Work

1. **Trace a full conversation turn.** Send a `user_message` via CodeInput, observe the full event sequence on CodeOutput:
   - `assistant_text` events (partial → complete)
   - `tool_use` + `tool_result` pairs
   - `tool_approval_request` → `tool_approval` round-trip
   - `turn_complete`
   - `interrupt` behavior

2. **Document the actual `assistant_text` streaming behavior:**
   - How frequently do partial events arrive?
   - What's in the `text` field — the full accumulated text, or just the delta?
   - Does `is_partial` reliably transition to complete?
   - What happens on interrupt — `turn_cancelled` with `partial_result`?

3. **Document tool event shapes.** For each tool type, what does `tool_use.input` and `tool_result.output` actually contain? This directly informs custom block renderer design.

4. **Identify gaps.** Is anything missing from the CodeOutput event stream that tug-markdown needs? Are there events that should trigger UI but don't have a CodeOutput representation?

### Output

- Complete documentation of the CodeOutput/CodeInput event protocol as observed in practice
- Gap analysis between what exists and what the conversation UI needs
- Confidence that tug-prompt-input → CodeInput → agent → CodeOutput → tug-markdown will work

---

## Sequencing

```
Phase 1 (Hook Capture)       ← Prove events fire
  ↓
Phase 2 (Correlation)        ← Build semantic layer
  ↓
Phase 3 (Agent-Internal)     ← Fine-grained events
  ↓                            (can overlap with Phase 4)
Phase 4 (CLI)                ← tugcode feed tail/show/status
  ↓
Phase 5 (Tugcast)            ← Events reach tugdeck
  ↓
Phase 6 (CodeOutput Verify)  ← Understand conversation transport
  ↓
Group D Dashes               ← Build conversation UI with confidence
```

Phases 1-2 are the critical path. They prove the entire feed concept works or expose fundamental problems early. Phase 3 adds richness. Phase 4 gives us inspection tools. Phase 5 bridges to the frontend. Phase 6 ensures the existing conversation transport is well-understood before building on it.

Phases 3 and 4 can overlap. Phase 6 could happen in parallel with Phases 1-2 if bandwidth allows — it's independent investigation work.

---

## Risks

1. **`PreToolUse(Task)` prompt parsing is fragile.** The orchestrator's prompt to agents is a natural-language string with embedded JSON. If the skill prompt format changes, the parser breaks. Mitigation: the orchestrator passes structured JSON payloads with well-known keys; grep for those keys.

2. **Agent-scoped hooks may not have access to project-root paths.** Hooks in agent frontmatter fire within the agent's execution context. If the agent runs in a worktree, `$CLAUDE_PROJECT_DIR` may point to the worktree, not the main project. The feed file path must resolve correctly. Verify in Phase 3.

3. **Feed file contention.** Parallel agents writing to `feed.jsonl` simultaneously. Mitigation: JSONL with atomic `O_APPEND` writes. Each line is independent.

4. **Shell script performance.** Hooks fire frequently during active implementation (every tool call for agent-internal events). Shell scripts add ~50ms overhead per invocation. If this becomes a bottleneck, consider a persistent daemon or Rust CLI command instead. Monitor in Phase 3.

5. **`last_assistant_message` parsing.** Agent outputs may not be reliably structured JSON. Some agents may return free-form text. Phase 2 will discover the actual shapes and adapt.
