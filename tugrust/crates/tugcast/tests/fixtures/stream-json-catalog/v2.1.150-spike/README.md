# Spike captures — raw `claude -p` output

This directory holds **raw `claude -p --output-format=stream-json` captures** taken for time-boxed spikes. It is intentionally separate from the proper version directories (`v2.1.104/`, `v2.1.148/`, etc.) because:

- The proper catalog reflects the **post-tugcast / post-tugcode** layer that `CodeSessionStore` consumes, with placeholder normalization (`{{uuid}}`, `{{iso}}`, `{{text:len=N}}`) so re-captures are byte-identical.
- Spike captures are the **raw upstream** `claude -p` stream — unnormalized, single-run, no schema. They exist to answer a specific design question in a specific commit, not to gate drift regression.

If a spike capture proves load-bearing for an ongoing test, promote it to a proper probe-table entry per the runbook in `../README.md` and re-capture through the framework. Otherwise leave it here as a frozen artifact.

## Files

| File | Captured | Spike | Notes |
|------|----------|-------|-------|
| `test-task-tools-c-calculator-raw.jsonl` | `claude 2.1.150`, 2026-05-23 | Step 24.1 — TodoList → pinned `Z2A` rework | Documents the Anthropic-side rename from `TodoWrite` (single atomic-replacement tool, ≤ v2.1.112) to the `TaskCreate` / `TaskUpdate` family (per-item CRUD, ≥ v2.1.148). See `roadmap/tide-assistant-rendering.md` § Step 24.1 for the findings derived from this capture. |
| `test-monitor-wake-raw.jsonl` | `claude 2.1.150`, 2026-05-24 | `tugplan-tide-session-wake.md` Step 1 — wake event-shape characterization | 90-line capture of `claude -p --output-format=stream-json --verbose --include-partial-messages --permission-mode=bypassPermissions` running a 5s-timeout Monitor that times out and resumes. Documents the wake signal in stream-json format: a `{type:"system", subtype:"task_notification", task_id, tool_use_id, status, summary, output_file}` event (matches `SDKTaskNotificationMessage` at `@anthropic-ai/claude-agent-sdk/sdk.d.ts:1659-1668`) appears between the prior turn's `result` and the wake turn's first `message_start`. The wake turn's final `result` carries `origin:{kind:"task-notification"}` as a retrospective marker. See `roadmap/tugplan-tide-session-wake.md` § Step 1 for the full [Q01] resolution derived from this capture. |
