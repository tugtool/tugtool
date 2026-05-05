// The migration parser surface is authored ahead of the supervisor
// wiring that consumes it; suppress dead-code warnings until the
// `bootstrap_turns_from_jsonl` ledger method and supervisor invocation
// land. Same pattern `session_ledger.rs` and `payload_inspector.rs` use
// for phased rollouts.
#![allow(dead_code)]

//! Minimal JSONL parser for the SessionLedger turns-table migration.
//!
//! The TS-side translator in `tugcode/src/replay.ts` is the
//! production parser of claude's per-session JSONLs — it produces the
//! full content stream (`user_message_replay`, `tool_use`, `tool_result`,
//! `thinking_text`, `assistant_text`, `turn_complete`). This Rust
//! parser exists for one specific job: scan an existing JSONL once
//! per legacy session and produce the per-turn metadata
//! (`user_text`, `user_attachments`, `claude_message_id`, completion
//! state) that the ledger's `bootstrap_turns_from_jsonl` migration
//! needs to mint `tug_turn_id`s and insert rows.
//!
//! Scope is intentionally narrow:
//!   - We don't reconstruct the assistant content stream (`runReplay`
//!     does that on every replay via `extractTurnContent`); we only
//!     need the terminal assistant entry's `message.id` per turn so
//!     the ledger row carries `claude_message_id` for the JSONL
//!     content lookup.
//!   - Tool-use / tool-result bookkeeping is skipped — bootstrap only
//!     cares about turn boundaries.
//!   - Malformed lines are silently dropped (mirroring the TS
//!     translator's permissiveness); the migration's caller can wire
//!     a warn at the file level if desired.
//!
//! Turn-boundary rules mirror the surveyed JSONL shape:
//!   - A `user` entry whose content has at least one `text` block (or
//!     `image` block, with no text) opens a new turn.
//!   - A `user` entry whose content is `tool_result`-only is a
//!     continuation of the current turn (no boundary).
//!   - An `assistant` entry whose `message.stop_reason == "end_turn"`
//!     closes the current turn as **complete**.
//!   - Any pending turn at end-of-file (no terminal `end_turn`) is
//!     flushed as **interrupted** — mirrors the TS translator's
//!     orphan-synthesis path. Bootstrap classifies these as
//!     `interrupted` rather than `pending` because they're historical
//!     by definition (the prior tugcode is gone — by the time
//!     bootstrap runs, the ledger has no live ActiveTurn for them).

use serde::{Deserialize, Serialize};

/// Per-turn metadata extracted from a JSONL session for ledger
/// bootstrap. Keys the row's `tug_turn_id` (minted by the caller),
/// `user_text`, `user_attachments` (raw `serde_json::Value` blocks
/// preserved verbatim — typically `image` content blocks),
/// `claude_message_id` (the terminal assistant entry's `message.id`,
/// or the latest seen if the turn never reached `end_turn`), and the
/// row state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedTurn {
    pub user_text: String,
    pub user_attachments: Vec<serde_json::Value>,
    pub claude_message_id: Option<String>,
    pub state: ParsedTurnState,
}

/// Bootstrap-time state for a parsed JSONL turn. Maps directly to
/// `TurnState` at insert time:
///   - `Complete` → `TurnState::Complete`
///   - `Interrupted` → `TurnState::Interrupted`
///
/// Bootstrap never produces `Pending` because the JSONL is historical
/// data — by the time we're scanning it, no live tugcode is bound to
/// the turn. A trailing-orphan turn (no terminal `end_turn`) is
/// `Interrupted`, not `Pending`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ParsedTurnState {
    Complete,
    Interrupted,
}

/// Parse a JSONL session string into per-turn metadata. The lines are
/// split on `\n`; trailing-newline-or-not is tolerated. Malformed
/// lines (JSON parse error) are skipped silently. An empty input or
/// a JSONL with no `user` / `assistant` entries returns an empty
/// `Vec`. The output preserves JSONL order so the caller can assign
/// monotonic ordinals starting from 0.
pub fn parse_turns_from_jsonl(jsonl: &str) -> Vec<ParsedTurn> {
    let mut state = ParserState::new();
    for line in jsonl.split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        state.process(&value);
    }
    state.finalize()
}

struct ParserState {
    pending: Option<PendingTurn>,
    output: Vec<ParsedTurn>,
}

struct PendingTurn {
    user_text: String,
    user_attachments: Vec<serde_json::Value>,
    claude_message_id: Option<String>,
}

impl ParserState {
    fn new() -> Self {
        Self {
            pending: None,
            output: Vec::new(),
        }
    }

    fn process(&mut self, value: &serde_json::Value) {
        let entry_type = value.get("type").and_then(|v| v.as_str());
        match entry_type {
            Some("user") => self.handle_user(value),
            Some("assistant") => self.handle_assistant(value),
            // Any other type — `system`, `result`, `summary`, etc. —
            // is bookkeeping the bootstrap doesn't care about; skip.
            _ => {}
        }
    }

    fn handle_user(&mut self, value: &serde_json::Value) {
        let Some(content_arr) = value
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
        else {
            return;
        };

        let mut text_parts: Vec<String> = Vec::new();
        let mut attachments: Vec<serde_json::Value> = Vec::new();
        let mut has_tool_result = false;

        for block in content_arr {
            let block_type = block.get("type").and_then(|v| v.as_str());
            match block_type {
                Some("text") => {
                    if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                        text_parts.push(t.to_string());
                    }
                }
                Some("image") => {
                    attachments.push(block.clone());
                }
                Some("tool_result") => {
                    has_tool_result = true;
                }
                _ => {
                    // Future / unknown block types — skip silently.
                }
            }
        }

        // A `tool_result`-only user entry is a continuation of the
        // current turn (claude's previous tool_use is being answered).
        // No turn boundary; no new pending turn.
        if has_tool_result && text_parts.is_empty() && attachments.is_empty() {
            return;
        }

        // A user entry with text or attachments opens a new turn. If
        // a previous turn is still pending (orphan — no terminal
        // `end_turn` was seen), flush it as interrupted before
        // starting the new one.
        if self.pending.is_some() {
            self.flush_pending(ParsedTurnState::Interrupted);
        }
        self.pending = Some(PendingTurn {
            user_text: text_parts.join(""),
            user_attachments: attachments,
            claude_message_id: None,
        });
    }

    fn handle_assistant(&mut self, value: &serde_json::Value) {
        let Some(pending) = self.pending.as_mut() else {
            // Orphan assistant entry with no preceding user turn.
            // Surveyed JSONLs don't produce these in practice; skip
            // defensively rather than synthesizing a turn with empty
            // user_text.
            return;
        };

        let message = value.get("message");

        // Track the latest assistant entry's message.id so the
        // terminal entry's id wins. For multi-entry turns (assistant
        // emits an intermediate `tool_use` entry then a final
        // `end_turn` entry), the terminal entry's id is what
        // `extractTurnContent` matches on.
        if let Some(id) = message
            .and_then(|m| m.get("id"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            pending.claude_message_id = Some(id.to_string());
        }

        let stop_reason = message
            .and_then(|m| m.get("stop_reason"))
            .and_then(|v| v.as_str());

        if stop_reason == Some("end_turn") {
            self.flush_pending(ParsedTurnState::Complete);
        }
        // Any other stop_reason (`tool_use`, null, etc.) keeps the
        // turn pending; the next `end_turn` (or end-of-file) closes
        // it.
    }

    fn flush_pending(&mut self, state: ParsedTurnState) {
        if let Some(p) = self.pending.take() {
            self.output.push(ParsedTurn {
                user_text: p.user_text,
                user_attachments: p.user_attachments,
                claude_message_id: p.claude_message_id,
                state,
            });
        }
    }

    fn finalize(mut self) -> Vec<ParsedTurn> {
        // Trailing in-flight turn at EOF → flush as interrupted. This
        // mirrors the TS translator's orphan synthesis (`flushTurn(ctx,
        // "error")` at end-of-iteration) and gives bootstrap a row to
        // insert so `runReplay` surfaces the historical interruption
        // as a `turn_cancelled` line in the transcript.
        if self.pending.is_some() {
            self.flush_pending(ParsedTurnState::Interrupted);
        }
        self.output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jsonl(lines: &[serde_json::Value]) -> String {
        lines
            .iter()
            .map(|v| serde_json::to_string(v).unwrap())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n"
    }

    #[test]
    fn empty_input_yields_no_turns() {
        assert!(parse_turns_from_jsonl("").is_empty());
        assert!(parse_turns_from_jsonl("\n\n").is_empty());
    }

    #[test]
    fn single_complete_turn_extracts_user_and_claude_id() {
        let j = jsonl(&[
            serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": [{ "type": "text", "text": "hello" }] }
            }),
            serde_json::json!({
                "type": "assistant",
                "message": {
                    "id": "msg_claude_1",
                    "role": "assistant",
                    "stop_reason": "end_turn",
                    "content": [{ "type": "text", "text": "hi back" }],
                }
            }),
        ]);
        let turns = parse_turns_from_jsonl(&j);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].user_text, "hello");
        assert!(turns[0].user_attachments.is_empty());
        assert_eq!(turns[0].claude_message_id.as_deref(), Some("msg_claude_1"));
        assert_eq!(turns[0].state, ParsedTurnState::Complete);
    }

    #[test]
    fn multi_turn_jsonl_yields_each_turn_in_order() {
        let j = jsonl(&[
            serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": [{ "type": "text", "text": "u1" }] }
            }),
            serde_json::json!({
                "type": "assistant",
                "message": { "id": "msg_a", "stop_reason": "end_turn",
                            "content": [{ "type": "text", "text": "a1" }] }
            }),
            serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": [{ "type": "text", "text": "u2" }] }
            }),
            serde_json::json!({
                "type": "assistant",
                "message": { "id": "msg_b", "stop_reason": "end_turn",
                            "content": [{ "type": "text", "text": "a2" }] }
            }),
        ]);
        let turns = parse_turns_from_jsonl(&j);
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].user_text, "u1");
        assert_eq!(turns[0].claude_message_id.as_deref(), Some("msg_a"));
        assert_eq!(turns[0].state, ParsedTurnState::Complete);
        assert_eq!(turns[1].user_text, "u2");
        assert_eq!(turns[1].claude_message_id.as_deref(), Some("msg_b"));
        assert_eq!(turns[1].state, ParsedTurnState::Complete);
    }

    #[test]
    fn intermediate_tool_use_assistant_then_end_turn_is_one_complete_turn() {
        // Realistic shape: claude emits an intermediate assistant
        // entry with a tool_use (stop_reason="tool_use"), then a
        // user entry with the tool_result, then a terminal assistant
        // entry with stop_reason="end_turn". The terminal entry's
        // message.id is what we keep.
        let j = jsonl(&[
            serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": [{ "type": "text", "text": "list files" }] }
            }),
            serde_json::json!({
                "type": "assistant",
                "message": {
                    "id": "msg_tool",
                    "stop_reason": "tool_use",
                    "content": [
                        { "type": "tool_use", "id": "tu_1", "name": "Bash", "input": { "command": "ls" } }
                    ]
                }
            }),
            serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": [
                    { "type": "tool_result", "tool_use_id": "tu_1", "content": "a.rs\nb.rs" }
                ] }
            }),
            serde_json::json!({
                "type": "assistant",
                "message": {
                    "id": "msg_terminal",
                    "stop_reason": "end_turn",
                    "content": [{ "type": "text", "text": "two files" }]
                }
            }),
        ]);
        let turns = parse_turns_from_jsonl(&j);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].user_text, "list files");
        // Terminal's id wins (last assistant entry of the turn).
        assert_eq!(turns[0].claude_message_id.as_deref(), Some("msg_terminal"));
        assert_eq!(turns[0].state, ParsedTurnState::Complete);
    }

    #[test]
    fn trailing_in_flight_turn_at_eof_yields_interrupted() {
        // No terminal `end_turn` — the JSONL was truncated mid-turn.
        // Bootstrap classifies as interrupted (matches the TS
        // translator's orphan-synthesis path).
        let j = jsonl(&[
            serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": [{ "type": "text", "text": "go" }] }
            }),
            serde_json::json!({
                "type": "assistant",
                "message": {
                    "id": "msg_partial",
                    "stop_reason": null,
                    "content": [{ "type": "text", "text": "partial..." }]
                }
            }),
        ]);
        let turns = parse_turns_from_jsonl(&j);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].user_text, "go");
        assert_eq!(turns[0].claude_message_id.as_deref(), Some("msg_partial"));
        assert_eq!(turns[0].state, ParsedTurnState::Interrupted);
    }

    #[test]
    fn back_to_back_user_entries_close_prior_pending_as_interrupted() {
        // Defensive: two `user` entries with no terminal in between.
        // The first turn is interrupted; the second starts fresh.
        let j = jsonl(&[
            serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": [{ "type": "text", "text": "u1" }] }
            }),
            serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": [{ "type": "text", "text": "u2" }] }
            }),
            serde_json::json!({
                "type": "assistant",
                "message": { "id": "msg_a2", "stop_reason": "end_turn",
                            "content": [{ "type": "text", "text": "a2" }] }
            }),
        ]);
        let turns = parse_turns_from_jsonl(&j);
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].user_text, "u1");
        // No assistant entry attached to u1 → claude_message_id None,
        // state Interrupted.
        assert_eq!(turns[0].claude_message_id, None);
        assert_eq!(turns[0].state, ParsedTurnState::Interrupted);
        assert_eq!(turns[1].user_text, "u2");
        assert_eq!(turns[1].claude_message_id.as_deref(), Some("msg_a2"));
        assert_eq!(turns[1].state, ParsedTurnState::Complete);
    }

    #[test]
    fn user_attachments_carry_image_blocks_verbatim() {
        let attachment = serde_json::json!({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": "base64data..."
            }
        });
        let j = jsonl(&[
            serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": [
                    { "type": "text", "text": "describe this" },
                    attachment.clone(),
                ] }
            }),
            serde_json::json!({
                "type": "assistant",
                "message": { "id": "msg_x", "stop_reason": "end_turn",
                            "content": [{ "type": "text", "text": "ok" }] }
            }),
        ]);
        let turns = parse_turns_from_jsonl(&j);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].user_text, "describe this");
        assert_eq!(turns[0].user_attachments.len(), 1);
        assert_eq!(turns[0].user_attachments[0], attachment);
    }

    #[test]
    fn user_tool_result_only_does_not_open_new_turn() {
        // A `tool_result`-only user entry must be treated as
        // continuation, not a new turn. Pin this — without the
        // guard, the bootstrap would emit a spurious turn with
        // empty user_text on every tool round-trip.
        let j = jsonl(&[
            serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": [{ "type": "text", "text": "u1" }] }
            }),
            serde_json::json!({
                "type": "assistant",
                "message": {
                    "id": "msg_tool",
                    "stop_reason": "tool_use",
                    "content": [
                        { "type": "tool_use", "id": "tu_1", "name": "Bash", "input": {} }
                    ]
                }
            }),
            serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": [
                    { "type": "tool_result", "tool_use_id": "tu_1", "content": "ok" }
                ] }
            }),
            serde_json::json!({
                "type": "assistant",
                "message": { "id": "msg_terminal", "stop_reason": "end_turn",
                            "content": [{ "type": "text", "text": "done" }] }
            }),
        ]);
        let turns = parse_turns_from_jsonl(&j);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].user_text, "u1");
        assert_eq!(turns[0].claude_message_id.as_deref(), Some("msg_terminal"));
    }

    #[test]
    fn malformed_lines_are_skipped() {
        let j = format!(
            "{}\nthis is not json\n{}\n",
            serde_json::to_string(&serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": [{ "type": "text", "text": "u" }] }
            }))
            .unwrap(),
            serde_json::to_string(&serde_json::json!({
                "type": "assistant",
                "message": { "id": "msg_x", "stop_reason": "end_turn",
                            "content": [{ "type": "text", "text": "a" }] }
            }))
            .unwrap(),
        );
        let turns = parse_turns_from_jsonl(&j);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].user_text, "u");
        assert_eq!(turns[0].claude_message_id.as_deref(), Some("msg_x"));
    }

    #[test]
    fn unknown_top_level_types_are_skipped() {
        // `system` / `result` / `summary` etc. — bookkeeping that
        // doesn't participate in turn boundaries.
        let j = jsonl(&[
            serde_json::json!({ "type": "system", "subtype": "init" }),
            serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": [{ "type": "text", "text": "go" }] }
            }),
            serde_json::json!({ "type": "result", "subtype": "success" }),
            serde_json::json!({
                "type": "assistant",
                "message": { "id": "msg_x", "stop_reason": "end_turn",
                            "content": [{ "type": "text", "text": "ok" }] }
            }),
        ]);
        let turns = parse_turns_from_jsonl(&j);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].user_text, "go");
        assert_eq!(turns[0].claude_message_id.as_deref(), Some("msg_x"));
    }

    #[test]
    fn assistant_entry_with_empty_id_is_ignored_for_claude_message_id() {
        let j = jsonl(&[
            serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": [{ "type": "text", "text": "go" }] }
            }),
            serde_json::json!({
                "type": "assistant",
                "message": {
                    "id": "",
                    "stop_reason": "end_turn",
                    "content": [{ "type": "text", "text": "ok" }]
                }
            }),
        ]);
        let turns = parse_turns_from_jsonl(&j);
        assert_eq!(turns.len(), 1);
        assert_eq!(
            turns[0].claude_message_id, None,
            "empty-string message.id must not be captured",
        );
        assert_eq!(turns[0].state, ParsedTurnState::Complete);
    }
}
