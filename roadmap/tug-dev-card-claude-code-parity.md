<!-- tugplan-skeleton v2 -->

## Dev-Card / Claude Code Parity {#dev-card-claude-code-parity}

**Purpose:** Close the experience gap between Claude Code's terminal TUI and the dev-card by landing the chrome (permission-mode / model / rate-limit / session badges in Z4B with `Shift+Tab` cycling), reimplementing the slash commands the terminal renders locally (`/rewind`, `/resume`, `/diff`, `/permissions` rules editor, `/context` HUD, `/memory`, `/agents`, `/mcp`, `/hooks`), and polishing the streaming + approval surface (`control_request_forward` UI, `api_retry`, `thinking_text` empty-state, `@`-file completion, image drag/paste).

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-05-28 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The dev-card has been a faithful streaming-conversation surface for months — user types, claude streams back, tool calls render as structured blocks — but it stops at "transcript." Everything around the transcript that makes Claude Code feel like a tool you *control* (permission mode, session lifecycle, plan-mode workflow, slash commands that produce zero stream-json events) is either missing or hardcoded. The 35-probe transport-exploration catalog ([transport-exploration.md](transport-exploration.md)) and the freshly-landed v2.1.154 golden baseline (commit `3b925484`) give us complete coverage of what events flow and what's terminal-rendered-locally; this plan turns that knowledge into a phased build-out.

Three things changed recently that make this the moment to close the gap. First, the stream-json baseline is fresh — we know exactly what 2.1.154 emits, what's new (`rate_limit_event`, new tools surfaced in `system/init`, `claude-opus-4-8[1m]` model identifier), and where the differ tolerates variance. Second, tugcode now forwards new event types we can build chrome on — commit `9af307fe` added `RateLimitEvent` passthrough, the per-turn subscription-quota broadcast we lacked plumbing for. Third, the Z4B prompt-indicator slot is wired (`dev-card.tsx:2391-2401`) and sitting empty in most cards — waiting for the permission-mode badge, the model badge, the rate-limit countdown, and the session-state chip.

#### Strategy {#strategy}

- **Z4B horizontal space groundwork first** ([#step-0]): Z4B is already at 3 single-line pills today; the four new chips would overflow. Before any chip lands, enhance `TugBadge` to support a two-line `LABEL` / `content` presentation borrowing the status-bar's letter-spaced label typography. This is a design mini-spike (`gallery-badge` demos + a tuglaws note) — no production-chip mount yet, but every subsequent chip step depends on it.
- **Foundations after the primitive** ([#step-1] through [#step-5]): land the Z4B chrome as INDICATORS only per [#d13-z4b-indicator-only] (permission-mode, model, rate-limit, session-state). All four read from `SessionMetadataStore` via the same `useSyncExternalStore` pattern AND render through the two-line TugBadge from [#step-0] — doing them together amortizes the plumbing and the placement-experiment harness churn.
- **`Shift+Tab` cycle matches terminal exactly** ([#d02-cycle-order]) — `default → acceptEdits → plan → auto`. Preserves muscle memory for users migrating from the terminal.
- **Slash commands split by category** ([#l01-slash-cmd-inventory]): skill-backed (no work, they already produce real event streams), terminal-rendered-locally (reimplement as graphical surfaces — the meat of this plan), unsupported (hidden from popup per [#d14-slash-unsupported-list]; documented in a canonical list).
- **`/rewind` matches the terminal empirically** ([#d10-rewind-matches-terminal]) — run a probe to capture what the terminal does, then design the dev-card flow to produce the same mutations. No protocol speculation.
- **`/rewind` is the canonical pane-sheet command** — designing it forces a reusable `SessionPickerSheet` primitive ([#d05-session-picker-sheet]) that `/resume` and future session-pickers consume. Built as an overlay per [#d15-pane-sheets-are-overlays].
- **Stream-side polish is cheap and high-impact** ([#step-15] through [#step-22]): `control_request_forward` UI, `api_retry` indicator, `thinking_text` empty-state, `@`-file completion, image drag/paste, `unknown_event` IPC frame. Each is a small targeted change against a stable IPC contract.
- **Round-trip mutations via tugcode** ([#d03-roundtrip-mutations]) — the badge updates from the post-mutation `system_metadata` refresh, not from the keypress directly. Keeps state truthful even if a mode change races a concurrent turn.
- **Phase boundaries are shippable.** Phase A unlocks the chrome story; Phase B unlocks "I can do what I do in the terminal"; Phase C polishes the streaming / approval surface that's been getting by on minimums. Each phase ships independently.

#### Success Criteria (Measurable) {#success-criteria}

- The Z4B indicator cluster on a freshly-mounted dev-card shows a permission-mode chip with the current mode label within 200 ms of session ready — verify by mounting a card with [session-metadata-feed.md](session-metadata-feed.md)'s snapshot feed and observing the chip text before the first turn fires.
- `Shift+Tab` in a focused dev-card cycles the permission mode through `default → acceptEdits → plan → auto → default` in order — verify with a real-claude round-trip test that asserts the chip label flips after each press and that `system_metadata.permissionMode` confirms.
- The model badge shows the active model (e.g. `Opus 4.8 · 1M`) sourced from `system_metadata.model` — verify the badge updates after a `model_change` round-trip.
- A `rate_limit_event` with `status: "allowed"` and `resetsAt` > 1 hour away does NOT render a chip; status `≠ "allowed"` or `resetsAt` within 60 min DOES render the chip — verify with mocked `RateLimitEvent` payloads via a tugcode probe.
- Typing `/rewind` in the prompt entry opens a pane-sheet listing the current session's committed turns, ordered most-recent first, with timestamps and previews — verify by sending `user_message{content: [{type:"text",text:"/rewind"}]}` and asserting the sheet mounts before any IPC round-trip.
- Picking a turn in the rewind sheet and pressing Enter sends a `session_rewind` (or `session_command` per [#q04-rewind-protocol]) inbound and the new card-state reflects forking from that turn — verify end-to-end with a real-claude test that asserts the new session's first turn references the forked-from message id.
- A permission denial (`control_request_forward` with `is_question: false`) opens a modal popover anchored to the in-flight tool block with the tool name, input preview, decision reason, allow/deny buttons, and any `permission_suggestions[]` rules as one-click options — verify with the test-08 / test-11 probe shapes.
- `api_retry` events render a transient indicator with `attempt n/max`, `retry_delay_ms` countdown, and `error` label — verify by replaying a probe with an injected `api_retry` event and asserting the indicator mounts, ticks down, and clears on `turn_complete` or `cost_update`.
- The drift regression (`stream_json_catalog_drift_regression`) stays clean across the work — verify after each step's commit lands.
- All four phases ship as separable PRs. Phase A is mergable without B or C; B without C; C standalone. Verify by reviewing the [#deliverables] checkpoint table per phase.

#### Scope {#scope}

1. Z4B chrome groundwork: enhance `TugBadge` to support a two-line `LABEL` / `content` layout in both orderings, borrowing the status-bar legend typography ([#step-0]).
2. Z4B chrome (indicators only per [#d13-z4b-indicator-only], rendered via the two-line `TugBadge`): permission-mode chip (display only; cycle via `Shift+Tab`), model chip (display only; change via `/model`), rate-limit chip, session-state chip refinement.
3. Locally-rendered slash command reimplementation: `/rewind` (empirically modeled on terminal — see [#d10-rewind-matches-terminal]), `/resume`, `/permissions` rules editor, `/model` picker, `/diff` sheet, `/context` HUD, `/memory` / `/agents` / `/hooks` listing sheets, `/help` tabbed sheet, `/btw` exclude-from-history flow, `/clear`.
4. Stream-side polish: `control_request_forward` UI for tool approval and AskUserQuestion, `api_retry` indicator, `thinking_text` empty-state (omit per [#d12-thinking-empty-state]→[#q12-thinking-empty-state]), `@`-file completion, image drag/paste, interrupt visibility, `compact_boundary` divider, `unknown_event` IPC frame + frontend banner.
5. Slash-command popup filtering: unsupported commands hidden from the popup per [#d14-slash-unsupported-list]; canonical list of unsupported commands lives in repo docs.
6. Reusable primitives: `SessionPickerSheet` primitive (overlay per [#d15-pane-sheets-are-overlays]) consumed by `/rewind` and `/resume`.
7. Tugcast `git_diff_request` / `git_diff_response` control commands for `/diff` per [#d21-diff-dedicated-command].

#### Non-goals (Explicitly out of scope) {#non-goals}

- Multi-card multi-instance coordination of tugcode processes — covered by [tug-multi-instance.md](tug-multi-instance.md).
- Tug-feed structured-progress reporting — covered by [tug-feed.md](tug-feed.md).
- Browser-frontend vs Tug.app-host division-of-labor: this plan describes *what* the dev-card shows; *where* the dev-card runs stays the host's concern.
- Settings / config UI for hooks, theme tokens — these belong to the host-app settings surface (Tug.app), not the dev-card.
- Subagent-tree visualization, turn-level cost breakdown chips, inline tool-result panes, plan-mode card-style workflow, skill-output trees — listed as [#roadmap] follow-ons but explicitly out of scope here.
- **MCP in any form.** `/mcp` slash command, MCP listing sheet, MCP auth UI — all dropped (per [#q06-mcp-auth-ownership]). Picked up in a future MCP-focused plan.
- The hunk-level "stage" affordance on `/diff` — tugcast doesn't have a `stage hunk` command yet; tracked as a future ask.
- Z4B chip click-to-open behaviors — Z4B is indicator-only per [#d13-z4b-indicator-only]. No model picker on chip click; no permission-mode popover on chip click.

#### Dependencies / Prerequisites {#dependencies}

- v2.1.154 golden catalog (committed in `3b925484`) — the protocol baseline this plan is anchored against per [D06].
- `rate_limit_event` IPC passthrough (committed in `9af307fe`) — the chrome consumer this plan builds on.
- [session-metadata-feed.md](session-metadata-feed.md) snapshot-feed proposal — recommended (not required) for the Z4B chips to populate before the first turn; without it, chips show a transient `"…"` state. With [D07]'s per-card persistence, the chip can pre-populate from tugbank as soon as the card mounts, before metadata round-trips.
- `SessionMetadataStore` (`tugdeck/src/lib/session-metadata-store.ts`) — the store every Z4B chip reads.
- `code-session-store` / `code-session-store.ts` and the `code-session-store/` reducer — owns transcript state for `/rewind` to read.
- `routeTopLevelEvent` in `tugcode/src/session.ts:612` — where new IPC translations land (rewind shape per [D10] / [#step-7a], unknown_event per [D19] / [#step-22]).
- `gallery-sheet.tsx`, `gallery-tooltip.tsx`, `gallery-radio-group.tsx`, `gallery-list-view.tsx`, `tug-arc-gauge.tsx` (reused by the `/context` HUD per [D22]) — existing gallery primitives consumed throughout.
- `feeds/FILESYSTEM 0x10` snapshot feed — the data source for `@`-file completion ([#step-18]).
- Tugbank `dev.permission-mode.<cardId>` namespace — for per-card mode persistence per [D07].

#### Constraints {#constraints}

- **Tuglaws compliance.** All React/DOM work must honor [tuglaws.md](../tuglaws/tuglaws.md). Specifically: external state enters React through `useSyncExternalStore` only ([L02]); registrations that events depend on use `useLayoutEffect` ([L03]); appearance changes go through CSS/DOM, never React state ([L06]). Z4B badges are `useSyncExternalStore` consumers of `SessionMetadataStore`.
- **AskUserQuestion ≤4-option cap.** Per [CLAUDE.md](../CLAUDE.md), AskUserQuestion is Zod-capped at 4 options per question. The `control_request_forward` polish in [#step-15] must honor this; renderer must salvage gracefully when an agent exceeds it.
- **Single text-entry destination.** Per `feedback_persistent_text_entry` memory, one *saved/restored* focus destination per card. The slash-command modal pane sheets must not steal that destination; transient modals carry their own text inputs but yield focus back on dismiss.
- **Substrate responder registration.** Per `feedback_substrate_responder` memory, any document-level capture-phase keyboard interception must register as a substrate responder. The `Shift+Tab` cycle handler in [#step-1] is a substrate responder.
- **Z4B chips are NOT width-stabilized (deliberate).** The `feedback_fixed_width_buttons` memory governs *buttons* whose content varies by state; the Z4B indicator chips opt out. They render as two-line `TugBadge` (`label-top`, `size="sm"`, `role="agent"`) whose width tracks its current content — cycling the permission mode or ticking the rate-limit countdown reflows the chip, and that is accepted. See [#r01-z4b-layout-shift].
- **No localStorage.** Per `feedback_no_localstorage` memory, persistent state flows through `tugbank /api/defaults/<domain>/<key>`. Per-card permission-mode persistence ([#q01-mode-persistence]) uses tugbank.
- **HMR is always running.** Per `feedback_hmr` memory, no manual `bun run build` for tugdeck. Tugcode changes require recompile (per `feedback_tugcode_compile`).
- **Tests use real engine / real claude.** Per `feedback_test_reality`, `feedback_no_mock_store_tests`, `feedback_no_happy_dom_tests`. Phase A / B / C tests are `bun:test` pure-logic + real-app `just app-test` per `feedback_just_app_test`.

#### Assumptions {#assumptions}

- Claude Code 2.1.x retains the `system/init` shape with `claude_code_version`, `model`, `permissionMode`, `slash_commands`, `agents`, `skills`, `plugins`, `mcp_servers`, `memory_paths` for the duration of this plan. The drift regression will catch deviation.
- Tugcode's `permission_mode`, `model_change`, `session_command`, `tool_approval`, `question_answer`, and `interrupt` inbound types are stable. No protocol changes required for Phase A or C; only [#q04-rewind-protocol] in Phase B may add `session_rewind`.
- The `FILESYSTEM` snapshot feed's content shape is suitable for `@`-file completion without modification.
- `rate_limit_event` shape stays as captured in v2.1.154 (`{status, resetsAt, rateLimitType, overageStatus, overageDisabledReason?, isUsingOverage}`); strict-typed receiver in tugcode catches shape drift.
- Image drag/paste already-shipped `image-downsample.ts`, `atom-bytes-store.ts`, `synthesize-user-message.ts` continue to work post Step-5c.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan format relies on **explicit, named anchors** and **rich `References:` lines** in execution steps. Conventions follow [tugplan-skeleton v2](../tuglaws/tugplan-skeleton.md):

- Anchors are explicit `{#anchor-name}` suffixes on headings, lowercase kebab-case, semantic and renumber-stable.
- Stable IDs: decisions `[D01]`, open questions `[Q01]`, specs `S01`, tables `T01`, lists `L01`, risks `R01`, milestones `M01` (two-digit, no reuse).
- Execution-step dependencies use `**Depends on:** #step-N` anchor references, never titles or line numbers.
- Execution-step references cite by ID and anchor (e.g. `[D02] cycle order, Spec S03, (#strategy)`).

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

> Each question is described enough that a "yes/no" or "choose option X" lands without follow-up. The user marks `OPEN → DECIDED` in review.

#### [Q01] Per-card vs per-session permission-mode persistence (DECIDED) {#q01-mode-persistence}

**Question:** When the user cycles the permission mode in card A and quits, should a freshly-opened card A reload in the same mode (per-card persistence in tugbank) or in `default` (per-session reset, matching the terminal)?

**Resolution:** DECIDED → **per-card persistence via tugbank `dev.permission-mode.<cardId>`.** Survives card relaunch. See [#d07-per-card-mode-persistence].

#### [Q02] `rate_limit_info` — own store or extend SessionMetadataStore (DECIDED) {#q02-rate-limit-store}

**Question:** Add a `rateLimit` field to `SessionMetadataSnapshot` or stand up a parallel `RateLimitStore`?

**Resolution:** DECIDED → **extend `SessionMetadataSnapshot.rateLimit: RateLimitInfo | null`.** Single source of truth, single subscription pattern. See [#d04-session-metadata-hub].

#### [Q03] Model-change synthetic confirmation — transcript or banner (DECIDED) {#q03-model-confirm}

**Question:** Tugcode emits a synthetic `assistant_text` "Set model to claude-…" after `model_change`. Render it in the transcript (audit trail, matches terminal) or as a transient banner that fades (cleaner history)?

**Resolution:** DECIDED → **render in the transcript. Match the terminal.** Audit trail preserved; no banner. See [#d09-model-confirm-in-transcript].

#### [Q04] `/rewind` protocol shape (DECIDED) {#q04-rewind-protocol}

**Question:** How does the dev-card tell tugcode "fork from message X"?

**Resolution:** DECIDED → **match the Claude Code terminal empirically.** Run a capture probe that drives `/rewind` in the terminal, observe what flows on the wire / what claude / harness state mutates, and design the dev-card flow to produce the same mutations. This becomes a prerequisite investigation step before [#step-7] designs the sheet. See [#d10-rewind-matches-terminal] and [#step-7] artifacts.

#### [Q05] `/btw` out-of-history turn shape (DECIDED) {#q05-btw-shape}

**Question:** Terminal `/btw` runs a turn that doesn't persist to session history. Does our journal need an `exclude_from_history` flag, do we synthesize a separate ephemeral session, or do we write to history with a hint?

**Resolution:** DECIDED → **exclude flag**. Add `metadata.exclude_from_history: true` on the `user_message`. **Sub-investigation required**: probe claude 2.1.154 to see whether it honors the flag natively; if absent, tugbank-only filtering carries the exclusion. See [#d11-btw-exclude-flag] and [#step-13] task list.

#### [Q06] MCP auth flow ownership (DECIDED) {#q06-mcp-auth-ownership}

**Question:** When the user clicks "Authenticate" on an MCP row in the `/mcp` sheet, where does the OAuth webview live — in-card iframe or host-app surface?

**Resolution:** DECIDED → **MCP is fully out of scope.** No `/mcp` sheet in this plan; no auth flow design. `/mcp` is dropped from [#l01-slash-cmd-inventory] and from [#step-12] scope. Surface returns when MCP is addressed in a future plan. See [#non-goals].

#### [Q07] `bypassPermissions` in the `Shift+Tab` cycle (DECIDED) {#q07-bypass-in-cycle}

**Question:** The terminal's `Shift+Tab` cycle is 4-way and excludes `bypassPermissions` / `dontAsk`. Match exactly?

**Resolution:** DECIDED → **4-way cycle matching the terminal exactly.** `bypassPermissions` not in cycle, not surfaced in dev-card (no popover access path either — see [#q08-model-scope] precedent: Z4B is indicator-only). See [#d02-cycle-order].

#### [Q08] Z4B-as-picker vs Z4B-as-indicator (DECIDED) {#q08-model-scope}

**Question (clarified during review):** Is Z4B a picker surface where the user can switch model directly, or strictly an indicator that displays the current model?

**Resolution:** DECIDED → **Z4B is INDICATOR-ONLY**, not a picker. Model is switched only via the `/model` slash command, which opens its own picker sheet. The Z4B model chip displays the active model and that's all. Same policy applies to the permission-mode chip: the chip displays mode; mode changes go through `Shift+Tab` (cycle) or `/permissions` (popover). No click-to-change on any Z4B chip. See [#d13-z4b-indicator-only] and [#step-2].

The original question about model-scope (card vs session) is consequently moot — there's no card-scoped picker to scope. Model changes via `/model` route to `model_change` IPC which is session-scoped per the existing protocol.

#### [Q09] Slash-popup filtering policy (DECIDED) {#q09-slash-popup-filter}

**Question:** `SessionMetadataStore.getCommandCompletionProvider()` exposes every command claude reports. Some have no graphical analog. Hide, grey, or include?

**Resolution:** DECIDED → **Hide unsupported commands from the popup; maintain a list of unsupported commands in repo docs.** The dev-card slash popup shows only commands with a working graphical surface. Unsupported commands (e.g. `/vim`, `/theme`, `/color`) are absent from the popup and produce no behavior if typed verbatim. The canonical list of unsupported commands lives in a new docs section so users can find it. See [#d14-slash-unsupported-list] and [#documentation-plan].

#### [Q10] Pane-sheet anchor — split-pane right half or overlay (DECIDED) {#q10-pane-sheet-anchor}

**Question:** Does the right-half of the dev-card's existing horizontal split-pane (`dev-card.tsx:2425`) become the sheet surface, or do we add a separate sheet abstraction that overlays?

**Resolution:** DECIDED → **Overlay**. Pane sheets do NOT split the dev-card horizontally. Sheets mount as overlays on top of the transcript / prompt area. The existing horizontal split (`dev-card.tsx:2425`) stays untouched and is reserved for its current use (top transcript pane / bottom prompt entry). See [#d05-session-picker-sheet] (updated) and [#d15-pane-sheets-are-overlays].

#### [Q11] Drop list for terminal-only commands (DECIDED) {#q11-drop-list}

**Question:** Beyond `/vim`, `/theme`, `/color`, should `/clear`, `/quit`, `/help` also be hidden from the popup?

**Resolution:** DECIDED → **`/clear` supported.** **`/help` supported as a tabbed sheet** similar in content to what Claude Code offers (categorized command list, key shortcuts, links to docs). `/quit` not in scope here (close-card is the affordance; revisit if needed). `/vim`, `/theme`, `/color` dropped per [#q09-slash-popup-filter]. See [#d16-clear-help-supported] and [#step-13].

#### [Q12] `thinking_text` empty-state policy (DECIDED) {#q12-thinking-empty-state}

**Question:** When a turn produces no thinking, render an empty collapsible header or omit entirely?

**Resolution:** DECIDED → **Omit**. No empty header. The thinking collapsible exists when thinking deltas arrived; absent otherwise. See [#step-17].

#### [Q13] `RateLimitEvent` shape strictness vs forward-compat (DECIDED) {#q13-rate-limit-strictness}

**Question:** Strict-typed shape or loose pass-through?

**Resolution:** DECIDED → **Keep strict.** Quality gate; capture-capabilities runbook catches drift. See [#d18-rate-limit-strict-shape].

#### [Q14] Unknown-event-type IPC frame for forward-compat (DECIDED) {#q14-unknown-event-ipc}

**Question:** Add an `unknown_event` IPC frame for the default branch of `routeTopLevelEvent`?

**Resolution:** DECIDED → **Add the frame.** Replace the silent log-and-drop with an `unknown_event` IPC carrying `original_type` and a hex preview. Frontend surfaces a soft warn banner. See [#d19-unknown-event-frame] and [#step-22].

#### [Q15] Multi-card-same-session story scope (DECIDED) {#q15-multi-card-session}

**Question:** When two cards bind to the same session, who owns the send button, the interrupt button, the prompt entry, and the keyboard focus?

**Resolution:** DECIDED → **Two cards cannot connect to the same session.** Session binding is 1:1 with card. The question is structurally impossible and therefore non-existent. Reference removed from [#non-goals]; the design constraint surfaces here in [#d20-one-card-per-session]. Related Q08 simplification also holds — model is session-scoped, session is card-scoped, model is therefore card-scoped by transitivity.

#### [Q16] `/diff` viewer source-of-truth (DECIDED) {#q16-diff-source}

**Question:** Does the sheet read from the GIT feed, or fire a dedicated command?

**Resolution:** DECIDED → **Dedicated `git_diff_request` command, single-shot response.** The GIT feed is a separate consumer with its own lifecycle; the dev-card must own its `/diff` content rather than ride on a shared feed. The command and response shape are new; tugcast adds the request handler and a typed response. See [#d21-diff-dedicated-command] and [#step-10].

#### [Q17] `/context` HUD shape — gauge or popover (DECIDED) {#q17-context-hud-shape}

**Question:** Linear gauge in Z4, arc gauge as a chip, or popover-on-hover?

**Resolution:** DECIDED → **Reuse the arc gauge from the status-bar popover.** The status bar's existing arc-gauge component already looks great and renders the same shape of data (used/total). The `/context` HUD adopts the same arc-gauge atom. See [#d22-context-arc-gauge] and [#step-11].

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| [R01] Z4B layout shift when chips populate / change | low | med | **Resolved by decision:** Z4B chips are NOT width-stabilized; the two-line agent chips reflow with their content, accepted by design | Reflow becomes visually disruptive in practice |
| [R02] `Shift+Tab` clashes with browser/IDE chord | med | low | Substrate responder consumes the event only when card is focused; bubbles otherwise | Bug report or focus-trap regression test fails |
| [R03] `/rewind` shape divergence from terminal | high | low | Capture probe in [#step-7a] before [#step-7] designs the sheet, per [D10]. The probe's findings ARE the spec | Drift between dev-card `/rewind` flow and terminal behavior surfaces |
| [R04] Claude 2.1.155+ reshapes `rate_limit_event` | low | med | Strict typing + capture-capabilities catches drift; doc warns the runbook | Drift regression FAILs on `rate_limit_event` shape |
| [R05] AskUserQuestion >4-option regression in dev-card surface | low | low | Reuse existing salvage path from Tide; renderer caps at 4 + Other | New AskUserQuestion call with 5+ options surfaces |
| [R06] Image-attach regression after Step-5c | med | low | Wire-shape pin tests exist (`replay-pending-row-injection.test.ts`); add a real-app `just app-test` case for drag-drop | Image probe test-23 starts failing |

**Risk R01: Z4B layout shift when chips populate / change** {#r01-z4b-layout-shift}

- **Risk:** Permission-mode, model, and rate-limit chips arrive at slightly different times and change content over the session (mode cycles, rate-limit ticks "5h" → "59m" → "rate-limited"). A chip whose width tracks its content reflows the Z4B cluster on each change.
- **Decision (resolves the risk):** Z4B chips are **not** width-stabilized. They render as two-line `TugBadge` (`label-top`, `size="sm"`, `role="agent"`) sized to their current content; the cluster reflows when content changes, and that is accepted. No `widthStabilize`, no reserved max-width slots, no hidden-alternate stacks. This matches the cutover already shipped for the existing Z4B chips (route / project / session).
- **Why accepted:** the chips sit in a centred indicator cluster flanked by flex spacers, so a width change re-centres rather than shoving fixed neighbours; the content changes are infrequent and user-driven (mode cycle) or slow (per-minute rate-limit tick). The complexity of cross-content reservation is not worth it here.
- **Residual risk:** a fast-changing value could make the cluster appear jittery. Trigger to revisit: reflow becomes visually disruptive in practice — at which point width-stabilization can be reintroduced per-chip without changing the two-line shape.

**Risk R03: `/rewind` shape divergence from terminal AND mount-identity loss on truncation** {#r03-rewind-divergence}

- **Risk (two parts):**
  - **Wire divergence:** Per [D10], the dev-card's `/rewind` must reproduce the same wire / state mutations as the terminal. If [#step-7a]'s empirical capture misses an edge case (e.g. how the terminal handles forking from a turn that's mid-thinking), the dev-card flow diverges.
  - **Mount-identity loss on truncation:** When the fork removes turns after `msg_id`, the transcript's remaining turns (those BEFORE `msg_id`) must keep their React reconciliation identity per [L26]. If the implementer remounts the transcript wholesale on truncation — by swapping the transcript-data-source reference, by using a phase-encoded list key, or by routing pre/post-fork rows through different cell renderers — the user loses scroll position, selection, and any in-flight DOM state in the surviving rows. This is the [L23] failure mode "internal ops never lose user-visible state."
- **Mitigation:**
  - [#step-7a]'s probe drives `/rewind` end-to-end in a real session and pins the canonical event sequence.
  - Re-run the probe after any tugcode / claude version bump that touches session-command handling.
  - Drift regression catches wire deviations between captures.
  - [#step-7]'s task list pins the three [L26] identity inputs (key, component type, renderer reference) verbatim; the L26 real-app pin in tests asserts scroll position and selection survive the fork.
- **Residual risk:** A future claude version may change `/rewind` behavior, requiring a re-capture and dev-card update — but the same is true for any terminal-modeled flow.

---

### Design Decisions {#design-decisions}

> Each decision is firm absent reviewer override.

#### [D01] Z4B is the chrome anchor for ambient session state (DECIDED) {#d01-z4b-chrome-anchor}

**Decision:** Permission-mode, model, rate-limit, and session-state chips all live in the Z4B prompt-indicator cluster (`dev-card.tsx:2391-2401`). All chips are display-only indicators per [D13].

**Rationale:**
- Z4B already exists; the placement-experiment harness already maps content into it.
- Bottom-of-prompt-entry placement preserves screen real estate for the transcript while keeping ambient state always-visible at the point of input.
- Adjacent chips share the same `useSyncExternalStore` source ([#d04-session-metadata-hub]), amortizing plumbing.

**Implications:**
- No new top-level dev-card slots required.
- **Canonical chip render:** every Z4B chip is a two-line `TugBadge` (`layout="label-top"`, `size="sm"`, `role="agent"` — escalating to `caution` on alert states like rate-limit / drift), **not** width-stabilized ([#r01-z4b-layout-shift]). The caption line is the field's name (`MODE`, `MODEL`, `LIMIT`, `SESSION`); the content line is the value.
- Z4B cluster order: `permission-mode | model | rate-limit | project-path | session-state`. Z3 stays for placement-experiment overrides per `dev-card.tsx:2400`.
- No chip-click affordance per [D13] — mutations go through slash commands or `Shift+Tab`.

#### [D02] `Shift+Tab` cycle matches the terminal exactly (DECIDED) {#d02-cycle-order}

**Decision:** The `Shift+Tab` cycle is 4-way: `default → acceptEdits → plan → auto → default`. `bypassPermissions` and `dontAsk` are reachable only via the badge popover, not via cycling.

**Rationale:**
- Preserves muscle memory for users migrating from the terminal.
- `bypassPermissions` is genuinely dangerous to cycle into accidentally; popover-only access is intentional friction.
- Matches Anthropic's stated UX for the cycle.

**Implications:**
- Substrate responder enforces 4-mode set.
- Popover lists all 6 modes for explicit selection.
- The badge popover is the only graphical surface for the 5th and 6th modes (matches `/permissions`).

#### [D03] Mode-change mutations round-trip via tugcode (DECIDED) {#d03-roundtrip-mutations}

**Decision:** Chip state updates from the post-mutation `system_metadata` refresh, not from the keypress directly. The dev-card sends `{type: "permission_mode", mode: "<name>"}` and waits for the next `system_metadata` to confirm.

**Rationale:**
- Keeps the badge truthful even if a mode change races a concurrent turn.
- Single source of truth: `SessionMetadataStore.getSnapshot().permissionMode`.
- Matches the model-change pattern already in place.

**Implications:**
- Brief flicker as the round-trip completes — acceptable, typical < 50 ms.
- An optimistic-update mode could be added later if the flicker is too noticeable; not in scope.

**Revised in [#step-1] follow-up — there is no round-trip for `permission_mode`.** Empirically (Step 1), claude answers `set_permission_mode` with a `control_response` only; it does NOT emit a fresh `system_metadata`. Neither does `model_change`. So waiting for a metadata refresh would leave the chip stuck. The dev card instead updates **optimistically**: `SessionMetadataStore.applyPermissionMode(mode)` writes the new mode into the snapshot the moment the frame is sent (matching the terminal's optimistic banner). It self-corrects — the next authoritative `system_metadata` (on respawn / re-init) replaces the snapshot wholesale, carrying the same mode tugcode applied (tugcode owns `permissionMode` via `--permission-mode` + `permissionManager`). The "truthful even under a racing turn" goal still holds: tugcode is the single authority and the optimistic value equals what it forwards.

#### [D04] `SessionMetadataStore` is the data hub for Phase A (DECIDED) {#d04-session-metadata-hub}

**Decision:** All four Z4B chips read from `SessionMetadataStore` via `useSyncExternalStore`. Rate-limit info extends `SessionMetadataSnapshot` per [#q02-rate-limit-store]'s recommendation.

**Rationale:**
- Single store, single subscription pattern, single set of [L02] tests.
- Adjacent chip rerender churn is acceptable — the snapshot only changes on `system_metadata` events (~once per turn).

**Implications:**
- `SessionMetadataSnapshot` grows a `rateLimit: RateLimitInfo | null` field.
- The `SessionMetadataFeed` proposed in [session-metadata-feed.md](session-metadata-feed.md) becomes the snapshot-feed source; without it, Z4B chips show transient `"…"` until first turn.

#### [D05] `SessionPickerSheet` is a reusable primitive (DECIDED) {#d05-session-picker-sheet}

**Decision:** `/rewind`, `/resume`, and future session-pickers share a generic `SessionPickerSheet` component with a swappable data source. Sheets mount as **overlays** per [D15] (resolves [#q10-pane-sheet-anchor]).

**Rationale:**
- Two known use-cases up front; more likely in Phase D.
- Shared primitive forces consistent UX (keyboard, scroll, dismiss, focus restore).
- Overlay pattern keeps the dev-card's primary layout intact ([D15]).

**Implications:**
- `SessionPickerSheet` is the first deliverable of Phase B ([#step-6]); `/rewind`, `/resume`, `/model` picker, and others consume it.
- The horizontal split-pane in `dev-card.tsx:2425` stays reserved for its existing top-pane / bottom-pane layout — NOT used for sheet hosting.

#### [D06] v2.1.154 is the protocol baseline (DECIDED) {#d06-protocol-baseline}

**Decision:** Every event-shape reference in this plan resolves against `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.154/`. The drift regression must stay clean across the work.

**Rationale:**
- Anchors implementation against an empirically-verified shape.
- New event types this plan reads (`rate_limit_event`, `compact_boundary`) are present in v2.1.154 fixtures.
- A future version bump triggers the version-bump runbook ([fixtures README](../tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/README.md)) before this plan's consumers can drift.

**Implications:**
- Any step that adds a new IPC event-shape reader pins it via a fixture-derived test.
- A protocol regression caught by drift between steps blocks the next step until reconciled.

#### [D07] Per-card permission-mode persistence (DECIDED) {#d07-per-card-mode-persistence}

**Decision:** Permission mode is per-card and persists across card relaunches via tugbank `dev.permission-mode.<cardId>` (resolves [#q01-mode-persistence]).

**Rationale:**
- The terminal resets because terminals are stateless; the dev-card isn't.
- Card identity is stable across relaunch (the ledger restore matches on it).
- Aligns with the broader dev-card-per-card-state pattern (split-pane sash position uses the same key shape).

**Implications:**
- A freshly relaunched card carries forward its prior mode.
- A `permission_mode` IPC mutation persists at the card scope; the next mode flip writes through tugbank.
- The terminal-parity user experience is "mostly the terminal, but stickier when you come back."

#### [D09] Model-change confirmation in transcript (DECIDED) {#d09-model-confirm-in-transcript}

**Decision:** Synthetic `assistant_text` confirmations from `model_change` render in the transcript exactly as the terminal does (resolves [#q03-model-confirm]). No banner alternative.

**Rationale:**
- Matches the terminal's audit-trail behavior.
- The terminal's "Set model to claude-sonnet-4-6" line is informational and historically welcome — model changes are deliberate user actions worth pinning in scrollback.

**Implications:**
- No suppression in the transcript renderer.
- No banner component needed.
- [#step-2] task list does NOT include banner work.

#### [D10] `/rewind` matches the Claude Code terminal empirically (DECIDED) {#d10-rewind-matches-terminal}

**Decision:** The `/rewind` flow is designed by first observing what Claude Code's terminal does on the wire — what events claude/the harness emit, what state mutates, what session is created — and then matching the dev-card's IPC and UI to reproduce the exact same mutations (resolves [#q04-rewind-protocol]).

**Rationale:**
- Eliminates protocol-design speculation; the source of truth is the existing terminal behavior.
- Avoids accidentally diverging semantics (e.g. "fork-from" vs "truncate-and-resume" vs "client-side replay") from what users already know.
- The capture-capabilities probe harness is the right tool for this empirical study.

**Implications:**
- A new capture probe (`test-N-slash-rewind`) drives `/rewind` end-to-end in a real-claude session and pins the canonical event sequence in the golden catalog.
- [#step-7] gains a prerequisite empirical step that runs the probe before sheet design.
- The eventual dev-card IPC matches whatever shape the probe reveals — could be `session_command` extension, a new inbound type, or a client-driven replay. We do not pre-commit.

#### [D11] `/btw` uses the exclude-from-history flag (DECIDED) {#d11-btw-exclude-flag}

**Decision:** Out-of-history turns set `metadata.exclude_from_history: true` on the `user_message`. Claude 2.1.154 support is investigated as a sub-step; if absent, tugbank carries the exclusion via journal-side filtering (resolves [#q05-btw-shape]).

**Rationale:**
- Preserves the "doesn't pollute history" intent users expect from `/btw`.
- Tugbank-side filtering is a known-good fallback even if claude doesn't honor the flag.
- Minimal additional shape; one optional field on user_message.

**Implications:**
- Pre-implementation probe in [#step-13] confirms claude support.
- Tugbank journal reader respects the flag whether or not claude does.
- Transcript renderer hides `exclude_from_history: true` rows under a "show side questions" toggle (out of scope as a feature; the rows are absent by default).

#### [D13] Z4B chips are INDICATORS, not pickers (DECIDED) {#d13-z4b-indicator-only}

**Decision:** Every Z4B chip is purely an indicator displaying current state. Z4B chips do NOT open pickers or popovers on click. Mode changes go through `Shift+Tab` (cycle) or the `/permissions` slash command. Model changes go through the `/model` slash command, which opens its own picker sheet. Resolves [#q08-model-scope] by reshaping the question.

**Rationale:**
- Keeps the chrome small and visually consistent — chips show state; commands change state.
- Reduces accidental modal stacking from misclicked chips.
- Slash commands are the canonical user-action surface; reinforces that pattern.

**Implications:**
- [#step-1] permission-mode badge has NO click-to-popover affordance.
- [#step-2] model badge has NO click-to-picker affordance.
- A new step is required: `/model` slash command opens the model picker (was previously baked into Step 2).
- `/permissions` slash command's badge popover behavior is replaced with the slash-command-only entry point.

#### [D14] Slash popup excludes unsupported commands (DECIDED) {#d14-slash-unsupported-list}

**Decision:** The slash popup shows only commands with a working graphical surface. Unsupported commands are hidden. The canonical list of unsupported commands lives in a docs file (`tuglaws/dev-card-unsupported-slash-commands.md` or in this plan's [#documentation-plan]). Resolves [#q09-slash-popup-filter].

**Rationale:**
- Hiding is cleaner than greying-out for muscle-memory consistency.
- The doc list keeps the policy discoverable for users wondering "why isn't `/vim` here?"

**Implications:**
- The completion-merge seam and the submit-time dispatch this filter plugs into land in [#step-1c] (per [D23]); [#step-13] adds the allowlist *filter* over claude's reported commands + the discoverable doc.
- `SessionMetadataStore.getCommandCompletionProvider()` applies the allowlist before returning completions; the local-command registry from [#step-1c] is merged in alongside.
- The allowlist source is a single constant co-located with / read by the [#step-1c] registry; the docs reference the same constant.
- Typed `/vim` (etc.) produces no behavior — silent drop at submit, not even a no-op message ([#step-13] blocklists the known-unsupported set so they do not reach claude). Local commands ([D23]) dispatch to their surface; everything else (`/commit` and other claude-owned commands) is sent to claude verbatim.

#### [D15] Pane sheets are card-scoped overlays, not split-pane right halves (DECIDED) {#d15-pane-sheets-are-overlays}

**Decision:** All pane sheets (`/rewind`, `/resume`, `/permissions` rules editor, `/diff`, `/memory`, `/agents`, `/hooks`, `/help`) mount as **card-scoped overlays** — they cover only the card's content region, dim only within the card, and trap focus only within the card. They do NOT escape the card to cover the deck, the viewport, or other panes. The horizontal split-pane in `dev-card.tsx:2425` stays reserved for its existing top-pane / bottom-pane layout. Resolves [#q10-pane-sheet-anchor], modifies [#d05-session-picker-sheet].

**Rationale:**
- Keeps the dev-card's primary layout (transcript on top, prompt on bottom) intact.
- Overlays allow richer animation and a clearer "modal in front of work" mental model.
- Avoids tangling pane-sash logic with sheet lifecycle.
- **Card-scoping respects [L09]** — the card never sets position / size / z-order outside its own boundary. A sheet that portals to `body` or to a deck-level layer would be the card reaching into Pane geometry, which the Pane owns.

**Implications:**
- [#step-6] `SessionPickerSheet` mounts within the card root (e.g. `position: absolute` against a card-relative ancestor), NOT via a `body`-portal and NOT as a fixed-position viewport overlay.
- The dimming backdrop fills the card's content region; the rest of the deck (other panes, title bar, etc.) is unaffected.
- The split-pane in `dev-card.tsx:2425` keeps its current top/bottom semantics.
- Overlay close-button + ESC + clicking on the backdrop within the card all dismiss; focus restores to the prompt entry.
- Multi-card decks: opening a sheet in card A does not dim or affect card B.

#### [D16] `/clear` supported; `/help` is a tabbed sheet (DECIDED) {#d16-clear-help-supported}

**Decision:** `/clear` is supported and maps to the existing transcript-clear / new-session affordance. `/help` opens a tabbed sheet with content modeled on what the Claude Code terminal's `/help` offers — categorized command list, key shortcuts, links to docs (resolves [#q11-drop-list]).

**Rationale:**
- `/clear` is a high-value muscle-memory command users will type.
- `/help` as a tabbed sheet is a richer presentation than the terminal can offer and is straightforward to scaffold.

**Implications:**
- [#step-13] adds `/clear` → transcript-clear, `/help` → tabbed sheet.
- New file `help-tabbed-sheet.tsx` in [#symbol-inventory].
- `/quit` not included; close-card is the affordance.

#### [D18] `RateLimitEvent` strict-typed (DECIDED) {#d18-rate-limit-strict-shape}

**Decision:** Tugcode's `RateLimitEvent` IPC translation stays strict-typed per commit `9af307fe`. New fields claude adds are dropped silently (forward-compat); shape drift is caught by the capture-capabilities runbook (resolves [#q13-rate-limit-strictness]).

**Rationale:**
- Strict types are a quality gate.
- The drift regression catches removed-field drift before it lands in production.

**Implications:**
- No type changes to `tugcode/src/types.ts:RateLimitInfo` in this plan.
- A future claude shape change triggers the version-bump runbook; no in-plan accommodation.

#### [D19] `unknown_event` IPC frame added (DECIDED) {#d19-unknown-event-frame}

**Decision:** `routeTopLevelEvent`'s default branch (`tugcode/src/session.ts:1031`) emits an `unknown_event` IPC frame instead of silently dropping (resolves [#q14-unknown-event-ipc]). Frame carries `original_type` and a hex preview of the payload.

**Rationale:**
- Forward-compat catch-all without modifying the consumer schema.
- Frontend can surface a soft banner so users know when claude has emitted something this version doesn't understand.

**Implications:**
- New `UnknownEvent` IPC type in `tugcode/src/types.ts`.
- New banner component on the frontend ([#step-22]).
- The default-branch console log stays for operator visibility.

#### [D20] One card per session (DECIDED) {#d20-one-card-per-session}

**Decision:** Session-to-card binding is strictly 1:1. Two dev-cards cannot connect to the same tugcode session (resolves [#q15-multi-card-session] by recognizing the structural impossibility).

**Rationale:**
- The tugcode session manager owns a single stdin/stdout pipe to claude; two cards would race on it.
- Card lifecycle and session lifecycle are co-owned; multi-card-same-session would require disentangling them.

**Implications:**
- No work needed to coordinate multi-card sessions — the system enforces 1:1.
- `/rewind`'s "fork-and-card" action ([#step-7]) creates a NEW session for the new card; it does not bind the new card to the existing session.

#### [D21] `/diff` fires a dedicated `git_diff_request` command (DECIDED) {#d21-diff-dedicated-command}

**Decision:** The `/diff` sheet fires a dedicated `git_diff_request` command to tugcast and receives a single-shot typed response. The sheet does NOT read from the GIT feed (resolves [#q16-diff-source]).

**Rationale:**
- The GIT feed is a separate consumer with its own lifecycle; the dev-card must own its `/diff` content rather than ride on a shared feed.
- A single-shot request matches the sheet's lifecycle (open → fetch → display → close); the feed's continuous-update semantics aren't needed here.

**Implications:**
- New `git_diff_request` and `git_diff_response` types in the tugcast control protocol.
- Tugcast handler reads `git diff` from the project root and serializes the response.
- [#step-10] adds the tugcast side alongside the dev-card sheet.

#### [D22] `/context` HUD reuses the status-bar arc gauge (DECIDED) {#d22-context-arc-gauge}

**Decision:** The persistent context-usage HUD reuses the arc-gauge atom from the status-bar popover (resolves [#q17-context-hud-shape]).

**Rationale:**
- The arc gauge already exists, already renders the right shape of data, and already has battle-tested visual polish.
- Consistent atom across HUD and status-bar means consistent affordance.

**Implications:**
- [#step-11] mounts the existing `tug-arc-gauge.tsx` atom in Z4.
- No new gauge primitive needed.
- The expand-on-`/context` interaction shows the status-bar popover content directly (or a copy of it).

#### [D23] Local slash commands dispatch through the responder chain (DECIDED) {#d23-slash-dispatch}

**Decision:** Locally-handled slash commands are recognized at submit time against a single registry (`tugdeck/src/lib/slash-commands.ts`) and dispatched as a `RUN_SLASH_COMMAND` action through the responder chain ([L11]) to the dev-card's card-content responder, which opens the command's graphical surface. They are NOT sent to claude. The same registry is the completion source for local-only commands and the allowlist [D14] reads.

**Rationale:**
- One mechanism for every terminal-rendered-locally command (#l01-slash-cmd-inventory); each new command is a registry entry + a surface, not bespoke "popup routing."
- Key-card-scoped dispatch is the exact path the existing `CYCLE_PERMISSION_MODE` shortcut travels ([L11]); the card-content responder already owns the card's command surface, so it is the natural handler — no new side channel and no responder re-parenting.
- Registry-as-source-of-truth unifies completion, dispatch, and the [D14] allowlist.

**Implications:**
- The prompt entry dispatches `RUN_SLASH_COMMAND` **key-card-scoped** (`sendToKeyCard`, the same walk `CYCLE_PERMISSION_MODE` uses), so it lands on the card-content responder directly. No responder `parentId` pinning; the targeted-control-dispatch path (which would route through the settings-form responder and was fragile) is explicitly not used.
- Skip-send is gated on the dispatch's `handled` result — a matched command that no responder handles (gallery, handler-less host) falls through to a normal send rather than being swallowed.
- The local-command completion entries merge at the **dev-card composition layer** (where the `/` provider is already assembled), keeping `SessionMetadataStore` generic and the gallery popup clean.
- The action payload carries `{ name, args }` from the start, so arg-bearing commands (`/btw <text>`, `/add-dir <path>`) need no reshape.
- **Known ceiling (C):** the prompt entry imports one *global* matcher. This is correct while the dev card is the only card type with local commands (a non-dev host has no `RUN_SLASH_COMMAND` handler, so its dispatch falls through to send). If a *second* command-bearing card type ever shares `TugPromptEntry`, the global matcher could match a command that card cannot handle and the presence-based `handled` would swallow it. Migration path is cheap and local: inject the matcher per host (a small prop), leaving dispatch unchanged. Documented now so it is a deliberate boundary, not a surprise.
- [#step-2b] / [#step-7] / [#step-8] / [#step-9] / [#step-10] / [#step-12] drop "Modified: slash-command popup routing"; they register their command and provide its surface.
- [#step-13] / [D14] reduces to the unsupported-command allowlist filter + doc + the remaining UI-affordance mappings (`/help`, `/clear`, …).
- Built in [#step-1c], before any other command step consumes it.

---

### Deep Dives (Optional) {#deep-dives}

#### Slash Command Inventory {#slash-cmd-inventory}

**List L01: Claude Code slash commands — treatment in dev-card** {#l01-slash-cmd-inventory}

| Command | Terminal behavior | Bucket | Treatment | Step |
|---|---|---|---|---|
| `/cost` | Skill-backed, formatted cost table | 1 | Already works as skill turn; also surface as HUD ([#step-11]) | — |
| `/compact` | Skill-backed, compaction | 1 | Already works; `compact_boundary` divider in [#step-21] | — |
| `/commit`, `/review`, `/security-review`, `/code-review`, `/init`, `/clear` (skill) | Skill-backed | 1 | Already works | — |
| `/deep-research`, `/run-skill-generator`, `/loop`, `/schedule`, `/batch`, `/debug`, `/simplify`, `/verify`, `/run` | Skill-backed | 1 | Already works | — |
| `/claude-api`, `/fewer-permission-prompts`, `/update-config` | Skill-backed | 1 | Already works | — |
| `/tugplug:dash`, `/tugplug:plan`, `/tugplug:implement`, `/tugplug:merge` | Tugplug orchestrator skills | 1 | Already works with correct `--plugin-dir` | — |
| `/rewind` | Pick a checkpoint to fork from | 2 | **Overlay pane sheet**, terminal-empirically-modeled ([#d10-rewind-matches-terminal]) | 7 |
| `/resume` | Pick a prior session | 2 | **Overlay pane sheet** ([#step-8]) | 8 |
| `/status` | Print model/cwd/mode/session | 2 | **Already in Z4B chrome** via [#step-1]-[#step-4]; typed `/status` no-op (chrome is the surface) | 4 |
| `/model` | Interactive model picker | 2 | **Model picker sheet** ([#step-2b]); dispatched via the [#step-1c] registry — Z4B chip is indicator-only per [#d13-z4b-indicator-only] | 1c, 2b |
| `/permissions` | Tool-permission **rules** editor (allow/ask/deny/workspace) | 2 | **Rules editor sheet** ([#step-1-6]), empirically specced by [#step-1-5], dispatched via the [#step-1c] registry. **Distinct from the permission *mode*** (default/acceptEdits/plan/auto), which is the Z4B chip + `Shift+Tab` ([#step-1]) and has no slash command. | 1c, 1.5, 1.6 |
| `/diff` | `git diff` in pager | 2 | **Diff sheet** over `git_diff_request` command ([#d21-diff-dedicated-command]) | 10 |
| `/context` | One-shot context snapshot | 2 | **Persistent HUD** reusing status-bar arc gauge ([#d22-context-arc-gauge]) | 11 |
| `/memory` | List/edit memory files | 2 | **Sheet** ([#step-12]) | 12 |
| `/agents` | List/edit agents | 2 | **Sheet** ([#step-12]) | 12 |
| `/mcp` | List MCP servers + auth | OUT | **Out of scope** ([#q06-mcp-auth-ownership]) — hidden from popup, no sheet | — |
| `/hooks` | List active hooks | 2 | **Sheet** ([#step-12]) | 12 |
| `/clear` | Clear transcript / new session | 2 | **Maps to existing transcript-clear** ([#d16-clear-help-supported]) | 13 |
| `/help` | Command help | 2 | **Tabbed sheet** modeled on terminal `/help` ([#d16-clear-help-supported]) | 13 |
| `/quit` | Quit | UNSUPPORTED | **Hidden** — close-card is the affordance | — |
| `/export` | Save conversation | 2 | **Save dialog** | 13 |
| `/copy` | Copy last response | 2 | **Inline button + Cmd+Shift+C** | 13 |
| `/btw` | Out-of-history side question | 2 | **Exclude-from-history flag** per [#d11-btw-exclude-flag] | 13 |
| `/add-dir` | Add working root | 2 | **Directory picker dialog** | 13 |
| `/bug` | File a bug report | 2 | **External link** to GitHub issues | 13 |
| `/login`, `/logout` | Auth | UNSUPPORTED | **Host-app surface** — hidden from popup | — |
| `/vim`, `/theme`, `/color` | Terminal-only UI flags | UNSUPPORTED | **Hidden from popup** ([#d14-slash-unsupported-list]) | 13 |
| `/usage`, `/insights`, `/goal`, `/team-onboarding`, `/usage-credits`, `/extra-usage`, `/heapdump`, `/reload-skills` | Subscription/admin/dev | UNSUPPORTED | **Hidden from popup; case-by-case external link in docs** | — |

#### Z4B chrome cluster layout {#z4b-chrome-layout}

Z4B cluster, left-to-right when all chips are populated. **All chips are display-only indicators ([#d13-z4b-indicator-only]).** No click-to-popover, no click-to-picker.

```
[permission-mode] [model] [rate-limit?] [project-path] [session-state]
```

- `permission-mode`: two-line `label-top` chip, width tracks the current mode label (not width-stabilized per [R01]). Display-only. Mode changes via `Shift+Tab` or `/permissions`.
- `model`: format `Opus 4.8 · 1M`. Display-only. Model changes via `/model` slash command.
- `rate-limit`: appears only when `status !== "allowed"` or `resetsAt < 60min`; otherwise absent (removed, no placeholder slot). Display-only.
- `project-path`: existing chip, already cut over to the two-line `label-top` / `size="sm"` / `role="agent"` config (caption `PROJECT`).
- `session-state`: existing chip, already cut over to the same two-line config (caption `SESSION`); lifecycle-state refinement in [#step-4].

#### `/rewind` interaction flow {#rewind-flow}

**Spec S01: `/rewind` interaction flow** {#s01-rewind-flow}

1. User types `/rewind` in prompt entry, or invokes via slash popup.
2. Sheet mounts in split-pane right-half ([#d05-session-picker-sheet]), prompt entry collapses to half-width.
3. Sheet loads `code-session-store.transcript` — committed turns only, most-recent first. Each row: timestamp, preview (first 100 chars of `userText`), per-row token-cost annotation, msg_id.
4. User navigates with arrow keys (or mouse). Selection highlights the row.
5. Selection populates the side preview pane with the full message + claude's response.
6. **Primary action** (Enter): sends `{type: "session_rewind", msg_id: "<selected>"}` (assuming [#q04-rewind-protocol] → option b). Sheet dismisses; transcript reflects the new session (turns after `msg_id` removed).
7. **Secondary action** (Cmd+Enter): sends the same, but tugcode handles by opening a new card bound to the forked session ("fork-and-card").
8. ESC dismisses without action.
9. Empty-state: session with one or zero turns does not show `/rewind` in the slash popup.

---

### Specification {#specification}

#### Inputs and Outputs {#inputs-outputs}

**Inbound IPC types added in this plan:**

- `session_rewind` (Phase B, [#step-7]) — `{type: "session_rewind", msg_id: string}`. Tugcode respawns claude resumed from the session, truncating turns after `msg_id`.

**Outbound IPC types added in this plan:**

- `unknown_event` (optional per [#q14-unknown-event-ipc]) — `{type: "unknown_event", original_type: string, payload_hex_preview: string, ipc_version: number}`. Default-branch catch-all for forward-compat.

**Existing IPC types this plan consumes (no changes):**

- Outbound: `system_metadata`, `rate_limit_event`, `assistant_text`, `tool_use`, `tool_result`, `tool_use_structured`, `control_request_forward`, `api_retry`, `cost_update`, `turn_complete`, `compact_boundary`.
- Inbound: `permission_mode`, `model_change`, `session_command`, `tool_approval`, `question_answer`, `interrupt`, `user_message`.

#### Modes / Policies {#modes-policies}

- Permission modes cycle (per [#d02-cycle-order]): `default → acceptEdits → plan → auto → default`. `bypassPermissions` and `dontAsk` reachable only via badge popover.
- Rate-limit chip visibility (per [#step-3] / [#q02-rate-limit-store]): hidden when `status === "allowed"` && `resetsAt > 60min`; visible otherwise.
- Slash-popup filter (per [#q09-slash-popup-filter]): graphical-supported allowlist; dev-flag shows full list.

#### Semantics {#semantics}

- All Z4B chip data flows from `SessionMetadataStore.getSnapshot()` via `useSyncExternalStore` (L02-compliant).
- Mutations (permission mode, model) round-trip via tugcode ([#d03-roundtrip-mutations]); chip updates from post-mutation `system_metadata`.
- `SessionPickerSheet` consumes a `dataSource` prop; `/rewind` and `/resume` differ only in the source.
- Pane sheets close on ESC and on clicking the card-scoped backdrop ([D15]).
- Tick-driven displays (rate-limit countdown, api_retry countdown) use [L22] direct-DOM mutation for the tick text — never `useSyncExternalStore` for the per-second value. See [#step-3] and [#step-16].

#### State zone mapping {#state-zones}

> Per [L24], every piece of state belongs to exactly one zone. The mechanism follows the zone. This table maps every new state slot in this plan to its zone so the implementer doesn't choose the wrong mechanism by default.

**Table T01: State zone for each new field** {#t01-state-zones}

| Component / field | Zone | Mechanism | Notes / law citations |
|---|---|---|---|
| `TugBadge` — `layout` + `label` props | Local data | Component props | Pure-function rendering; no internal state |
| `TugBadge` — label-line typography (uppercase, tracked) | Appearance | CSS rules in `tug-badge.css` reading shared label-typography tokens | [L06]; visual vocabulary shared with status-bar legend via `--tug7-element-field-text-normal-label-rest` token, NOT by reaching into TugBox's slot per [L20] |
| `TugBadge` — two-line intra-chip sizing (width = wider of the two rows) | Appearance | CSS inline-flex column intrinsic sizing | [L06]; this is the chip sizing to its own content, NOT cross-content reservation — Z4B chips are not width-stabilized per [R01] |
| `PermissionModeChip` — current mode label | Structure | `useSyncExternalStore(SessionMetadataStore)` | [L02]; reads `permissionMode` |
| `PermissionModeChip` — hover / focus / active visuals | Appearance | CSS via `data-state` attribute | [L06]; no React state for visuals |
| `PermissionModeChip` — persisted mode for restore | Structure | tugbank `dev.permission-mode.<cardId>` | [D07]; written by Shift+Tab handler, read on card mount |
| `Shift+Tab` substrate responder registration | Structure | `useLayoutEffect` at card mount | [L03]; per `feedback_substrate_responder` memory |
| `Shift+Tab` cycle-next computation | Local data | Pure function of current mode | No state owned by the handler |
| `ModelChip` — current model label | Structure | `useSyncExternalStore(SessionMetadataStore)` | [L02]; reads `model` |
| `ModelChip` — hover / focus visuals | Appearance | CSS | [L06] |
| `RateLimitChip` — structural state (`status`, `resetsAt`, `isUsingOverage`) | Structure | `useSyncExternalStore(SessionMetadataStore)` | [L02]; triggers React commit on shape change |
| `RateLimitChip` — visibility predicate result | Local data | Derived from structural state via memo | Pure derivation |
| `RateLimitChip` — color / overage indication | Appearance | CSS via `data-status` / `data-overage` attributes | [L06]; no React state |
| `RateLimitChip` — countdown text per tick | Appearance via store→DOM | `useLayoutEffect` + `setInterval` writes `textContent` directly | [L22]; structural data drives shell, DOM mutation drives tick |
| `SessionMetadataSnapshot.rateLimit` | Structure | Extension of `SessionMetadataStore` | [D04], [Q02]; single source of truth |
| `SessionPickerSheet` — open/closed | Local data | `useState` in card | Sheet is card-local, no cross-card coordination |
| `SessionPickerSheet` — current selection index | Local data | `useState` in sheet | Internal navigation state |
| `SessionPickerSheet` — scroll position on dismiss | Structure | tugbank `dev.session-picker-sheet.<cardId>.<sheetKind>` | [L23]; survives card relaunch |
| `SessionPickerSheet` — backdrop / focus-trap visuals | Appearance | CSS within card root, scoped per [D15] | [L06], [L09] |
| `RewindSheetDataSource` — row projection | Structure | Pure projection over `code-session-store.transcript` | Source-of-truth lives in code-session-store |
| Transcript row mount identity across `/rewind` fork | Structure (mount invariant) | Stable key + component type + renderer ref | [L26]; pinned in [#step-7] |
| `ModelPickerSheet` — selected model index | Local data | `useState` in sheet | Internal navigation state |
| `PermissionRulesEditor` — draft rule list | Local data | `useState` in editor | Each rule commit is atomic; no draft-vs-commit (not L08 mutation tx) |
| `PermissionRulesEditor` — backdrop visuals | Appearance | CSS within card root | [L06], [D15] |
| `DiffSheet` — fetched diff payload | Local data | `useState` in sheet, populated by `git_diff_request` response | Single-shot per [D21]; not a continuous feed |
| `DiffSheet` — file list scroll / hunk fold state | Appearance + Local data | CSS for fold visuals; local state for fold toggle map | [L06] for visuals; local for which-files-folded |
| `ContextHud` — current usage / context_window | Structure | `useSyncExternalStore(CodeSessionStore)` reading `cost_update.usage` | [L02] |
| `ContextHud` — arc-gauge fill | Appearance | CSS variable bound to derived ratio | [L06], [D22]; gauge visual driven by `--tug-gauge-ratio` |
| `MemorySheet` / `AgentsSheet` / `HooksSheet` — list data | Structure | `useSyncExternalStore(SessionMetadataStore)` for the source arrays | [L02], [D04] |
| `HelpTabbedSheet` — current tab | Local data | `useState` in sheet | Internal navigation state |
| `HelpTabbedSheet` — command list source | Structure | `SessionMetadataStore.slashCommands` filtered through allowlist | [L02], [D14] |
| `ToolApprovalModal` — current `control_request_forward` payload | Structure | `useSyncExternalStore` of pending-request store | [L02]; modal mounts on arrival, dismisses on response |
| `ToolApprovalModal` — input-preview expand/collapse | Appearance + Local data | CSS for visuals; `useState` for collapsed flag | [L06]; expand is a single-shot UX state |
| `ApiRetryIndicator` — structural state (attempt, max, error) | Structure | `useSyncExternalStore` of api_retry store | [L02] |
| `ApiRetryIndicator` — countdown text per tick | Appearance via store→DOM | `useLayoutEffect` + `setInterval` writes `textContent` directly | [L22]; same pattern as RateLimitChip |
| Thinking collapsible — expand/collapse | Appearance + Local data | CSS for visuals; `useState` for expanded flag | [L06] |
| `@`-file completion — popup open / selection | Local data | `useState` in completion provider | Existing completion infrastructure |
| `@`-file completion — file list source | Structure | FILESYSTEM snapshot feed (0x10) | [L02] |
| Image-attachment thumbnail strip — pending attachments | Local data | `useState` in prompt entry | Cleared on send |
| Image-attachment downsample / encode | Local data | Pure async pipeline; result attached to send | Existing `image-downsample.ts` |
| Interrupt-intent per-turn flag | Structure | Stored on active turn record in code-session-store | [L23]; survives until `turn_complete` |
| `CompactBoundaryDivider` — render | Structure | Driven by `compact_boundary` event presence in transcript | Stateless from divider's POV |
| `UnknownEventBanner` — current unknown events | Structure | `useSyncExternalStore` of unknown-event store | [L02]; dismissible per banner |
| `UnknownEventBanner` — dismissed event IDs | Local data | In-memory set; reset on card relaunch | Not worth persisting |

**Rule of thumb if a field is absent from the table:** structural data that drives renderable visuals is `useSyncExternalStore`; data that drives DOM mutations only is store-observer + direct DOM (per [L22]); data scoped to a single component instance that no other code reads is `useState`; anything that's pure visual feedback to a gesture is CSS via attribute toggles.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|---|---|
| `tugdeck/src/components/tugways/tug-badge.tsx` | **Modified** — adds `layout?: "single" \| "label-top" \| "content-top"` and `label?: string` props per [#step-0] / Spec S02 |
| `tugdeck/src/components/tugways/tug-badge.css` | **Modified** — new layout rules + label typography borrowed from `tug-box.css` legend/label-above style |
| `tugdeck/src/components/tugways/cards/gallery-badge.tsx` | **Modified** — gallery card sections demonstrating all three layouts ([#step-0]) |
| `tugdeck/src/components/tugways/cards/gallery-badge.css` | **Modified** — gallery layout for the new sections |
| `tugdeck/src/components/tugways/cards/permission-mode-chip.tsx` | Z4B permission-mode indicator chip ([#step-1]) — display-only per [D13]; rendered via `TugBadge` `label-top` / `size="sm"` / `role="agent"` per [#step-0], not width-stabilized per [R01]. Compositional component: `.tsx`-only, no `.css` (composes `TugBadge`, adds no styling). |
| `tugdeck/src/lib/permission-mode.ts` | Pure cycle / label / parse helpers ([#step-1]) |
| `tugdeck/src/lib/use-permission-mode.ts` | Cycle callback + per-card tugbank persistence + mount-restore hook ([#step-1]) |
| `tugdeck/src/components/tugways/cards/model-chip.tsx` | Z4B model indicator chip ([#step-2]) — display-only per [D13] |
| `tugdeck/src/components/tugways/cards/model-picker-sheet.tsx` | `/model` picker overlay sheet ([#step-2b]) |
| `tugdeck/src/components/tugways/cards/rate-limit-chip.tsx` | Z4B rate-limit countdown ([#step-3]) |
| `tugdeck/src/components/tugways/cards/session-picker-sheet.tsx` | Reusable overlay session-picker primitive ([#step-6]) |
| `tugdeck/src/components/tugways/cards/session-picker-sheet.css` | Sheet layout (overlay) |
| `tugdeck/src/components/tugways/cards/rewind-sheet-data-source.ts` | `/rewind` data source over `code-session-store.transcript` ([#step-7]) |
| `tugdeck/src/components/tugways/cards/resume-sheet-data-source.ts` | `/resume` data source over tugbank session journal ([#step-8]) |
| `tugdeck/src/components/tugways/cards/permission-rules-editor.tsx` | `/permissions` picker + rules editor sheet ([#step-9]) |
| `tugdeck/src/components/tugways/cards/diff-sheet.tsx` | `/diff` overlay sheet ([#step-10]) |
| `tugdeck/src/components/tugways/cards/context-hud.tsx` | Persistent context-usage HUD reusing status-bar arc gauge ([#step-11]) |
| `tugdeck/src/components/tugways/cards/memory-sheet.tsx` | `/memory` file listing + editor launcher ([#step-12]) |
| `tugdeck/src/components/tugways/cards/agents-sheet.tsx` | `/agents` listing ([#step-12]) |
| `tugdeck/src/components/tugways/cards/hooks-sheet.tsx` | `/hooks` listing ([#step-12]) |
| `tugdeck/src/components/tugways/cards/help-tabbed-sheet.tsx` | `/help` tabbed sheet ([#step-13]) per [D16] |
| `tugdeck/src/lib/slash-commands.ts` | `LOCAL_SLASH_COMMANDS` registry + `matchLocalSlashCommand` — the locally-handled-command dispatch source of truth ([#step-1c]) per [D23] |
| `tugdeck/src/lib/slash-supported.ts` | Canonical `GRAPHICAL_SUPPORTED_COMMANDS` allowlist per [D14] ([#step-13]; reads / co-located with `slash-commands.ts`) |
| `tugdeck/docs/dev-card-unsupported-slash-commands.md` | Discoverable list of unsupported commands per [D14] |
| `tugdeck/src/components/tugways/cards/tool-approval-modal.tsx` | `control_request_forward` (`is_question: false`) modal ([#step-15]) |
| `tugdeck/src/components/tugways/cards/api-retry-indicator.tsx` | `api_retry` indicator ([#step-16]) |
| `tugdeck/src/components/tugways/cards/at-file-completer.ts` | `@`-file completion provider ([#step-18]) |
| `tugdeck/src/components/tugways/cards/compact-boundary-divider.tsx` | Transcript divider on `compact_boundary` ([#step-21]) |
| `tugdeck/src/components/tugways/cards/unknown-event-banner.tsx` | Soft warn banner for `unknown_event` IPC frames per [D19] ([#step-22]) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|---|---|---|---|
| `SessionMetadataSnapshot.rateLimit` | field | `tugdeck/src/lib/session-metadata-store.ts` | New optional field `RateLimitInfo \| null`; parsed from `rate_limit_event` payload per [D02→Q02] |
| `SessionMetadataStore._onRateLimitUpdate` | method | same | Reads the most-recent `rate_limit_event` |
| `UnknownEvent` | type | `tugcode/src/types.ts` | Added per [D19] — `{type:"unknown_event", original_type, payload_hex_preview, ipc_version}` |
| `routeTopLevelEvent` default branch | branch | `tugcode/src/session.ts:1031` | Emits `unknown_event` IPC frame per [D19] (in addition to existing console log) |
| `SHIFT_TAB_RESPONDER` | constant | `tugdeck/src/lib/substrate-responders.ts` (new or existing module) | Substrate responder for the Z4B cycle |
| `GRAPHICAL_SUPPORTED_COMMANDS` | constant | `tugdeck/src/lib/slash-supported.ts` | Per [D14] |
| `LOCAL_SLASH_COMMANDS` / `matchLocalSlashCommand` | constant + fn | `tugdeck/src/lib/slash-commands.ts` | Per [D23] / [#step-1c]; registry + exact-match lookup |
| `RUN_SLASH_COMMAND` | action | `tugdeck/src/components/tugways/action-vocabulary.ts` | Per [D23] / [#step-1c]; key-card-scoped dispatch from the prompt entry to the card-content responder; payload `{ name, args }` |
| `useKeyCardDispatch` | hook | `tugdeck/src/components/tugways/` | Per [#step-1c]; key-card-scoped dispatch of `RUN_SLASH_COMMAND` (the `CYCLE_PERMISSION_MODE` path) |
| local-command completion merge | wiring | `tugdeck/src/components/tugways/cards/dev-card.tsx` | Per [#step-1c]; composes the local-command provider into the `/` provider (`SessionMetadataStore` stays generic) |
| `useSessionMetadata.permissionMode` selector | hook | `tugdeck/src/components/tugways/cards/use-dev-card-observer.ts` | Wraps `useSyncExternalStore` |
| `SessionPickerSheet<TRow>` | component | new file | Generic over data-source row type; overlay per [D15] |
| Tugcast `git_diff_request` / `git_diff_response` | control protocol | tugcast control module | New typed request/response per [D21] for `/diff` |
| `/rewind` IPC types | TBD | `tugcode/src/types.ts` and tugdeck `protocol.ts` | Shape determined empirically by [#step-7a] per [D10] |

---

### Documentation Plan {#documentation-plan}

- [x] Add a short design note to [tuglaws/component-authoring.md](../tuglaws/component-authoring.md) (or a small standalone doc) documenting the `TugBadge` two-line layout per [#step-0] / Spec S02 — when to use `label-top` vs `content-top` vs `single`. (Landed as the "Two-line label / content layout (TugBadge)" subsection under Component Patterns.)
- [ ] Update [transport-exploration.md](transport-exploration.md) "Terminal-Only Features" section to mark resolved rows with their dev-card landing-step (e.g. "`/rewind` — Overlay sheet ([dev-card-claude-code-parity.md#step-7])"). Add the empirical `/rewind` findings from [#step-7a].
- [ ] Author `tugdeck/docs/dev-card-unsupported-slash-commands.md` per [D14] — every command the popup hides, with a brief reason. Linked from the slash popup's "?" help affordance and from `/help`.
- [ ] Update [transport-exploration.md](transport-exploration.md) IPC inbound table with whatever shape `/rewind` adopts after the empirical study (could be a new type, an extension, or a client-driven flow).
- [ ] Add a Z4B chrome diagram to [tuglaws/pane-model.md](../tuglaws/pane-model.md) — Z4B was undocumented as a chrome surface; this plan makes it canonical. Annotate chips as indicator-only per [D13].
- [ ] Add a `SessionPickerSheet` doc note in [tuglaws/component-authoring.md](../tuglaws/component-authoring.md) if the primitive becomes a tuglaw fixture (overlay pattern per [D15]).
- [ ] Update the dev-card chrome docstring in `dev-card.tsx` near `Z4B — prompt-entry indicator slot` comment to reference the chip-cluster order and the indicator-only policy.
- [ ] Document the tugcast `git_diff_request` / `git_diff_response` control commands in the tugcast control-protocol docs.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|---|---|---|
| **Pure-logic (`bun:test`)** | Reducer transitions, store updates, type guards, completion-provider behavior | All non-DOM logic; per `feedback_no_happy_dom_tests`, no jsdom |
| **Real-app (`just app-test`)** | End-to-end mount, focus, keyboard, badge text-content verification | Per `feedback_just_app_test`; every chrome chip and pane sheet gets at least one |
| **Probe / real-claude** | Round-trip behavior against live claude | When a new inbound IPC type is added (e.g. `session_rewind`); when control_request_forward UI lands |
| **Drift regression** | Pin the stream-json contract | Run after each step that touches event-shape reading; `just capture-capabilities` after `tugcode` IPC changes |

#### What stays out of tests {#test-exclusions}

- Mock-store unit tests of stores (per `feedback_no_mock_store_tests`) — use real `SessionMetadataStore` against fixture payloads instead.
- jsdom RTL tests (per `feedback_no_happy_dom_tests`).
- Time-budget assertions (per `feedback_no_time_budgets`).

---

### Execution Steps {#execution-steps}

> Every step has explicit `**Depends on:**` and `**References:**` lines. Phase A is [#step-0] through [#step-5] (Step 0 is the TugBadge two-line spike that all Z4B chips depend on; [#step-1c] is the local slash-command dispatch foundation that lands `/permissions` and that every later command step builds on); Phase B is [#step-6] through [#step-14] (includes [#step-2b] `/model` picker and [#step-7a] empirical capture); Phase C is [#step-15] through [#step-22]; the final integration checkpoint is [#step-23].

#### Step 0: TugBadge two-line presentation — design mini-spike {#step-0}

**Commit:** `feat(tugways): TugBadge two-line label/content layout + gallery card`

**References:** [D01] Z4B chrome anchor, [D13] Z4B indicator-only, Risk R01 Z4B layout shift, [L06] appearance via CSS/DOM, [L15] token-driven control states, [L19] component-authoring compliance, [L20] tokens scoped to component slot, (#z4b-chrome-layout, #context, #strategy)

**Problem statement.** Current Z4B already shows three single-line chips (`Claude Code 2.1.x`, `Project: <path>`, `Session: <id>`). This plan adds four more (`permission-mode`, `model`, `rate-limit`, `session-state`). Seven single-line pills will overflow a reasonably-narrow card. The status bar at the top of the dev-card uses a two-line presentation (`STATE` letter-spaced label over `Idle` content; same for `TIME`, `TOKENS`, `CONTEXT`, `TASKS`) that packs information without taking more horizontal space. Borrow that pattern for TugBadge so Z4B chips can present `LABEL` over `content` in the same band.

**Goal.** Land a TugBadge variant that supports two-line label/content presentation in both orderings, demo it in the gallery, and decide which ordering the dev-card chips will use — before any Z4B chip ([#step-1] through [#step-4]) consumes it.

**Artifacts:**
- Modified: `tugdeck/src/components/tugways/tug-badge.tsx` — new `layout` prop with three variants and new `label` prop separate from content
- Modified: `tugdeck/src/components/tugways/tug-badge.css` — new layout rules + label typography reusing the status-bar style (`text-transform: uppercase`, `letter-spacing: 0.08em`, weight 600, `--tug7-element-field-text-normal-label-rest` color) so the chip and the status-bar legend share a single visual vocabulary
- Modified: `tugdeck/src/components/tugways/cards/gallery-badge.tsx` + `gallery-badge.css` — new gallery card sections demonstrating both two-line orderings alongside the existing single-line layout
- New: short design note in [tuglaws/component-authoring.md](../tuglaws/component-authoring.md) (or a small follow-on doc) documenting the two-line shape and when to use which ordering

**Spec S02: TugBadge two-line presentation** {#s02-two-line-badge}

- Props additions:
  - `layout?: "single" | "label-top" | "content-top"` — default `"single"` (no breaking change to existing call sites).
  - `label?: string` — only meaningful when `layout !== "single"`; rendered as the letter-spaced uppercase line. Single-layout call sites continue passing only `children`.
- Layout rules:
  - `single`: existing pill, content is `children`.
  - `label-top`: two stacked rows; row 1 = `label` styled per [#s02-label-typography]; row 2 = `children` styled as existing content text.
  - `content-top`: same two rows in reverse vertical order.
- Intra-chip width: the badge's outer width is the max of the label-line and content-line widths (inline-flex column intrinsic sizing). This is the chip sizing to its own content only — there is no cross-content pre-allocation. Z4B chips are deliberately NOT width-stabilized across content changes per [#r01-z4b-layout-shift]; the consumer-side reservation pattern is demonstrated in the gallery as a reference but not used by the Z4B chrome.
- Height series: the two-line layouts take a fixed per-size height mirroring the `TugPushButton` height scale by value (`--tugx-badge-twoline-height-*`: 20/24/28/32/36 px for `2xs`→`lg`; 40/44 px for `xl`/`2xl`) so a chip reads as tall as a button. The `lg` face equals the dev-card submit button (`TugPushButton size="lg"`); Z4B chips use `lg`. Tokens are badge-scoped per [L20] — derived from, not borrowed from, TugButton.

**Spec S02-typography: label-line typography** {#s02-label-typography}

The label line borrows directly from the status-bar's existing legend / label-above style (already documented in `tug-box.css:74-91`):

- `font-weight: 600`
- `text-transform: uppercase`
- `letter-spacing: 0.08em`
- `color: var(--tug7-element-field-text-normal-label-rest)`
- size: one notch smaller than the content line — likely a new component-scoped token `--tugx-badge-label-text-size`

The visual vocabulary is intentionally shared with the status bar so a user reading either surface sees the same label discipline.

**Decision deferred to spike outcome:** which ordering (`label-top` vs `content-top`) the dev-card Z4B chips use. The screenshot's status bar uses `label-top`. The recommended starting point for Z4B is `label-top` for consistency, but the gallery card demonstrates both so the team can compare in context.

**Tasks:**
- [x] Audit existing TugBadge call sites (`grep` `TugBadge` across `tugdeck/src`) to ensure adding the `layout` and `label` props is non-breaking (they're optional with `"single"` default). Confirmed: all existing call sites omit `layout`/`label` and keep the `single` default; full `bun test` (3039 tests) stays green.
- [x] Add the `layout` + `label` props to `TugBadge`. Per-layout DOM structure: `single` renders as today; `label-top` and `content-top` render two `<span>`s in a vertical flex with column ordering driven by CSS (`column` vs `column-reverse`), not by reordered DOM children (caption is always DOM-first).
- [x] Borrow the status-bar legend typography per [#s02-label-typography]. Added component-scoped `--tugx-badge-label-text-size` (em-relative, one notch under content) and `--tugx-badge-label-tracking` under TugBadge's own slot per [L20] — TugBox's tokens are untouched.
- [x] Width-stabilize: the badge's effective width is the wider of the label line and content line (per [R01]) — an inline-flex column sizes its cross axis to the widest row, so the chip is as wide as its widest line with no fixed width. (Cross-*content* reservation is the consumer's job, demoed in the gallery.)
- [x] Height series derived from `TugPushButton`. Two-line chips take a fixed per-size height mirroring the button scale by value (`--tugx-badge-twoline-height-*`: 20/24/28/32/36 px for `2xs`→`lg`, extending to 40/44 px for `xl`/`2xl`) so a chip stands as tall as a button. The `lg` face = the dev-card submit button (`TugPushButton size="lg"`, 36 px); the gallery two-line demos and Z4B chips use `lg`. Tokens live in the badge's own slot ([L20] — derived from, not borrowed from, TugButton).
- [x] Confirm token sourcing: label color is `--tug7-element-field-text-normal-label-rest` (the shared field-label token) per [L18]; no new color tokens minted. `audit:tokens lint` passes.
- [x] Add gallery card sections demonstrating all three layouts side-by-side: `single` (current), `label-top`, `content-top`. Realistic Z4B content rows (`MODE / accept`, `MODEL / Opus 4.8 · 1M`, `LIMIT / 5h 23m`, `SESSION / 6d77f06e`) plus a width-stabilized rate-limit slot. **Note:** landed in the real, registered `GalleryBadge` showcase (`gallery-registrations.tsx`) — the `gallery-badge.tsx` named in the artifacts list is an orphaned, unregistered exploratory mockup that does not use the real `TugBadge`; demoing there would prove nothing.
- [x] Add a short design note to `tuglaws/component-authoring.md` ("Two-line label / content layout (TugBadge)") documenting when to use each layout: `single` for transient/single-fact pills; `label-top` for chrome that mirrors status-bar conventions; `content-top` for the rare value-first case.
- [~] Decide the Z4B chip ordering. **Recommendation: `label-top`** for status-bar visual parity. Final sign-off pending a by-hand gallery view (requires the macOS Accessibility grant on Tug.app — see Checkpoint).

**Tests:**
- [x] Existing single-layout call sites continue to pass (non-breaking) — full `bun test` suite green (3039 pass / 0 fail).
- [x] New-layout DOM shape (two children with the right class names, CSS-driven visual order) — covered by `at0087-tug-badge-two-line.test.ts` (real DOM; tugdeck has no DOM-rendering unit layer).
- [x] Real-app: `at0087` opens the badge gallery card and asserts both two-line layouts render with the borrowed caption typography (uppercase, weight 600, non-zero tracking) and the correct visual stacking order.
- [x] Real-app: `at0087` confirms width-stabilization — toggles the rate-limit value between "5h 23m" and "rate-limited" in a `label-top` slot and asserts the reserved slot width does not move.

**Checkpoint:**
- [x] `cd tugdeck && bun test` — 3039 pass / 0 fail.
- [~] `just app-test tug-badge-two-line` — test written and reaches `launchTugApp`; blocked on the one-time macOS Accessibility grant for `dev.tugtool.app.debug` (System Settings → Privacy & Security → Accessibility). Re-run after granting.
- [ ] Open the badge gallery card by hand; sign off on the chosen Z4B chip ordering (recommended `label-top`) before Step 1 starts consuming it.

**What this step does NOT do:**
- Does not mount any Z4B chip — that's [#step-1] through [#step-4].
- Does not change the existing single-line TugBadge default behavior — every existing call site keeps working without modification.
- Does not touch the status bar — only borrows its typography. The status bar's existing TugBox-driven layout is unchanged.

---

#### Step 1: Permission-mode indicator + `Shift+Tab` cycle in Z4B {#step-1}

**Depends on:** #step-0

**Commit:** `feat(dev-card): permission-mode indicator in Z4B with shift+tab cycle`

**References:** [D01] Z4B chrome anchor (canonical chip render), [D02] cycle order matches terminal, [D03] round-trip via tugcode, [D04] SessionMetadataStore data hub, [D07] per-card mode persistence, [D13] Z4B indicator-only, Risk R01 (no width-stabilization), Risk R02, (#z4b-chrome-layout, #constraints, #strategy)

**Artifacts (as built):**
- New: `tugdeck/src/components/tugways/cards/permission-mode-chip.tsx` — display-only chip. **No `.css`**: it composes `TugBadge` and adds no styling, so per the component-authoring "Compositional Component" rule it is `.tsx`-only (deviation from the artifact list's `permission-mode-chip.css`).
- New: `tugdeck/src/lib/permission-mode.ts` — pure helpers (`PERMISSION_MODE_CYCLE`, `cyclePermissionMode`, `formatPermissionMode`, `parsePersistedPermissionMode`, `PERMISSION_MODE_DOMAIN`).
- New: `tugdeck/src/lib/use-permission-mode.ts` — the cycle callback + per-card persistence (`writePersistedPermissionMode`, mirroring `diff-view-pref.ts`) + mount-restore effect.
- New: `tugdeck/src/__tests__/permission-mode.test.ts` — pure-logic coverage.
- **`Shift+Tab` wiring uses the existing keybinding + responder pattern, not a new `substrate-responders.ts`** (deviation): `CYCLE_PERMISSION_MODE` added to `action-vocabulary.ts`; a `{ key: "Tab", shift: true, scope: "key-card" }` binding in `keybinding-map.ts`; the handler registered on the dev card's existing `card-content` responder. This is the idiomatic mechanism (same as `FOCUS_PROMPT` ⌘K) and the `substrate-responders.ts` file the artifacts imagined does not exist in the codebase.
- Modified: `tugdeck/src/components/tugways/cards/dev-card.tsx` — `usePermissionMode` call, `CYCLE_PERMISSION_MODE` handler, and `<PermissionModeChip>` mounted **leftmost directly in `indicatorsContent`** (deviation: direct mount like the route/project/session chips, not via the dev placement-experiment harness, which is for experiments not production indicators).
- Modified: `tugdeck/src/lib/code-session-store.ts` + `code-session-store/{events,reducer}.ts` — `setPermissionMode()` method → `set_permission_mode` event → `send-frame` reducer effect (no transcript-state change, per [D03]).
- Modified: `tugcode/src/permissions.ts` + `types.ts` — added `"auto"` to the `PermissionMode` / `PermissionModeMessage.mode` unions so the type is honest about the 4th cycle mode (confirmed real via the terminal; runtime already forwarded any mode string, so this is a type-correctness change, not a protocol change).
- Verified: `tugdeck/src/lib/session-metadata-store.ts` already exposes `permissionMode`.
- New: tugbank key `dev.permission-mode/<cardId>` for per-card persistence per [D07].

**Tasks:**
- [x] Implement `PermissionModeChip` reading `SessionMetadataStore` via `useSyncExternalStore`. Display-only per [D13] — no click affordance. Renders a two-line `TugBadge` (`layout="label-top"`, `label="Mode"`, `size="sm"`, `role="agent"`) per [#step-0] / [D01]; pre-populates from the per-card tugbank value before live metadata lands ([D07]).
- [x] Do NOT width-stabilize — the chip's width tracks the current mode label and reflows when the mode cycles, per [R01].
- [x] Register the `Shift+Tab` cycle (4-way per [D02]: `default → acceptEdits → plan → auto → default`). Built via the `CYCLE_PERMISSION_MODE` keybinding (`scope: "key-card"`, no `preventDefaultOnMatch` so ⇧⇥ falls through to reverse-tab nav on non-dev cards per [R02]) + a handler on the dev card's `card-content` responder. **`auto` confirmed as a real mode** (user-supplied terminal screenshots show `accept edits → plan mode → auto mode → default`); `tugcode`'s type union was extended with `"auto"` to match.
- [x] Persist mode per-card via tugbank `dev.permission-mode/<cardId>` per [D07]; restore on card mount and send `permission_mode` IPC once the session reports its initial mode, aligning the live session (race-free: waits for both live mode known AND persisted value loaded; a manual cycle supersedes a pending restore).
- [x] Mount chip into Z4B at leftmost position (direct in `indicatorsContent`).

**Tests:**
- [x] Pure-logic: `cyclePermissionMode(current) → next` for all 4 modes + wrap; null / out-of-cycle modes reset to `default` (`permission-mode.test.ts`).
- [x] Pure-logic: `formatPermissionMode` labels + `null → "…"` + unknown-mode fallback; `parsePersistedPermissionMode` tagged-value parsing (the testable half of the tugbank round-trip).
- [~] Real-app: mount a card, observe chip text, send `Shift+Tab`, assert label flips — **deferred: app-tests offline (recent build changes).** Re-enable when app-tests are back.
- [~] Real-app: cycle mode, close card, reopen; assert chip restores — **deferred (app-tests offline).**
- [~] Real-claude: round-trip `permission_mode`; assert `system_metadata.permissionMode` confirms — **deferred (app-tests offline).**

**Checkpoint:**
- [x] `cd tugrust && cargo nextest run` — 1313 passed, 9 skipped (warnings-as-errors clean).
- [x] `cd tugcode && bun test` — 484 pass / 0 fail. (Also fixed the pre-existing `tugcode` `tsc` baseline: `ActiveTurn` 2-arg constructor, `UserMessage.content` shape, `ContentBlock[]` typing — `tsc --noEmit` now exits 0.)
- [x] `cd tugdeck && bun test` — 3047 pass / 0 fail (8 new); `tsc` clean; token lint clean.
- [x] `just app-test permission-mode-chip` — `at0088-permission-mode-chip.test.ts` PASSES (app-tests back online): asserts the chevron renders, `Shift+Tab` advances the mode, and the chevron menu sets it.

**Step 1 follow-ups (post-implementation, user-directed):**
- [x] Chip moved to the **right** end of the Z4B cluster (`route | project | session | permission-mode`).
- [x] `Shift+Tab` now updates the chip — via the optimistic-update path (see the [D03] revision; there is no metadata round-trip).
- [x] **Chevron popup menu on `TugBadge`** (revisits [D13] for this chip — the permission chip is now interactive). New `TugBadge` props `menuItems` / `menuSenderId` / `chevron` / `menuAriaLabel`: when `menuItems` is present the badge becomes a `TugPopupMenu` trigger and renders a chevron hint vertically centred to the right of the content (two-line content is wrapped in a `.tug-badge-stack` so the chevron never disturbs the text layout). Menu items dispatch their `action` through the chain [L11] (mirrors `TugPopupButton`). The permission chip's items dispatch `set-value` (not `select-value`, which the prompt entry claims for route selection) routed to the dev card's **form responder** `setValueString` slot → `setMode` — because the card-content responder is a *sibling*, not an ancestor, of the form responder in the chain (hooks read parent context at call-site), so the control-dispatch walk from the prompt entry reaches the form responder but not card-content. Gallery demo added; `data-item-id` added to `TugPopupMenu` items for testability.
- [x] `auto` confirmed real via user terminal screenshots; cycle order `default → acceptEdits → plan → auto` stands.
- [x] **Mode chip width-stabilized for its own values** (this chip only — [R01]'s opt-in path). The value line stacks the shown label and a hidden sizer per menu mode in one grid cell (`permission-mode-chip.css`), reserving the widest label so cycling never reflows the chip. `at0088` pins it: chip width is identical across two different-length modes.
- [x] **Mode menu opens above the chip.** `TugPopupMenu` gained a `side` prop; `TugBadge` derives it from the chevron direction (`chevron="up"` → `side="top"`), so the bottom-anchored chip's menu pops upward.
- [x] **Value centered, bigger chevron, menu left-aligned.** Value centered within the reserved width (`justify-items: center`); chevron bumped `0.75em` → `1em`; menu `align` `"end"` → `"start"` (left edge lines up with the badge). All in the components.
- [x] **Menu teaching header.** `TugPopupMenu` label entries gained an optional `icon`; `TugBadge` gained a `menuHeader` prop (a non-interactive label + separator at the top). The Mode menu shows "⬆ Tab to cycle" (`ArrowBigUp`) — a non-selectable hint that the mode can also be cycled with the keyboard. `at0088` pins that the header is present and carries no `data-item-id` (unselectable).

---

#### Step 1c: Local slash-command dispatch + completion integration {#step-1c}

**Depends on:** #step-1

**Commit:** `feat(dev-card): local slash-command dispatch + /permissions`

**References:** [D23] local slash-command dispatch model, [D14] slash popup excludes unsupported, [D13] Z4B indicator-only, [L02] external state via store, [L11] controls emit actions through the responder chain, (#slash-cmd-inventory, #strategy)

**Problem statement.** Slash commands today are 100% claude-sourced and pass-through. `SessionMetadataStore.getCommandCompletionProvider()` (`session-metadata-store.ts:244`) returns only what claude reports in `system_metadata` (`slash_commands` + `skills` + `agents`, merged/deduped). At submit, `performSubmit` (`tug-prompt-entry.tsx:844`) strips only the route prefix and calls `codeSessionStore.send()` — there is **no interception**. So a typed `/permissions` is sent to claude as a user message, and claude (stream-json / print mode) answers "`/permissions` isn't available in this environment." Every terminal-rendered-locally command in [#l01-slash-cmd-inventory] (`/model`, `/rewind`, `/diff`, …) bounces the same way. Steps 2b / 7 / 8 / 9 / 10 / 12 each list "Modified: slash-command popup routing" as if a routing layer exists — none does. This step builds it once so those steps become a one-line registry entry plus their surface.

**Goal.** One dispatch layer with three parts: (1) a registry of locally-handled commands, (2) the registry merged into the slash popup, (3) submit-time interception that routes a typed local command to a graphical surface via the responder chain instead of sending it to claude. Ship `/permissions` as the first consumer — reusing the mode sheet the chip already opens.

**Artifacts:**
- New: `tugdeck/src/lib/slash-commands.ts` — `LOCAL_SLASH_COMMANDS` registry (`{ name, description, takesArgs? }[]`, popup order) + `matchLocalSlashCommand(text) → { name, args } | null` (args `""` for no-arg commands; arg-accepting commands capture the remainder). Pure data + lookup — the single source of truth that [#step-2b] / [#step-7] / … extend and that [D14]'s allowlist ([#step-13]) reads.
- New: `RUN_SLASH_COMMAND` action in `action-vocabulary.ts`, payload `{ value: <command-name>, args: string }` (args `""` for no-arg commands) — carries args from the start so `/btw <text>` / `/add-dir <path>` ([#step-13]) need no reshape.
- New: a small `useKeyCardDispatch` hook (or an existing equivalent) over `ResponderChainContext` returning `(event) => manager?.sendToKeyCard(event) ?? false` — the key-card-scoped dispatch the prompt entry uses (the same walk `CYCLE_PERMISSION_MODE` travels).
- Modified: `dev-card.tsx` — the local-command completion entries are merged at the **dev-card composition layer**, where the `/` provider is already assembled (`dev-card.tsx:386`, wrapping `getCommandCompletionProvider()` in `wrapPositionZero`). Compose the store provider with a local-command provider there, deduped. `SessionMetadataStore` stays generic — local commands do not leak into the gallery popup, and the store's `category` union is untouched. [D14] allowlist *filtering* of claude's commands stays [#step-13].
- Modified: `tug-prompt-entry.tsx` `performSubmit` — before `codeSessionStore.send()`, recognize a command in either form (a bare `/name` typed without the popup, or a lone accepted command atom — the U+FFFC placeholder is the only text) and run `matchLocalSlashCommand`. A *local* match → dispatch `RUN_SLASH_COMMAND` **key-card-scoped**; handled → clear + return; otherwise (claude command atom, plain text, or no handler — gallery) → fall through to `send()`. Runs before the send-readiness gates (transport-independent). The completion engine is untouched — accepting any command inserts an atom uniformly.
- Modified: `tug-text-editor/completion-extension.ts` + `tug-text-editor/keymap.ts` — **two latent keyboard-pipeline fixes** (see Spec S03): the active typeahead, and the editor's submit-Enter handler, each `stopPropagation` the Enter they consume, so an Enter that opens a sheet mid-event can't bubble on to the document pipeline's Stage-2 default-button activation and dismiss the just-opened sheet (the "flash").
- Modified: `dev-card.tsx` — register the `RUN_SLASH_COMMAND` handler on the **card-content responder** (next to `CYCLE_PERMISSION_MODE`); key-card dispatch lands there directly (no `parentId` pin). The prompt entry's `useKeyCardDispatch` does the dispatch on submit; this handler resolves the command via the registry and opens its surface.
- Modified: `permission-mode-chip.tsx` / `dev-card.tsx` — host the permission sheet at `DevCardBody` (one `useTugSheet`); the chip's `onClick` and the `RUN_SLASH_COMMAND` handler share that single opener (the chip stops owning its own sheet). Focus restores to the prompt editor on dismiss ([L23], confirmed by `at0089`).

**Spec S03: local slash-command dispatch — completion is uniform; local/remote splits at submit** {#s03-slash-dispatch}
- **Completion is generic and uniform.** Accepting *any* slash-command suggestion (Tab / Enter / click) inserts a `type:"command"` atom and dismisses the popup — identical for local and remote (claude) commands. The completion engine draws **no** local/remote distinction and has no command-specific code. The local-command provider's items are the same shape as claude's; they're merged into the `/` popup for discoverability.
- **The split happens once, at submit.** `performSubmit` recognizes a command in either form — a bare `/name` typed without the popup, or a **lone accepted command atom** (the U+FFFC placeholder is the only text; `atom.value` is the name) — and runs `matchLocalSlashCommand`. A *local* command dispatches `RUN_SLASH_COMMAND`; everything else (a claude command atom, plain text) flows on to `send()` unchanged.
- `RUN_SLASH_COMMAND` is **key-card-scoped** ([L11]) — the same walk `CYCLE_PERMISSION_MODE` uses — landing on the card-content responder, which owns the surface. The match runs **before** the `canSubmit` / disabled / blocked-submit gates (transport-independent, like `Shift+Tab`). If no responder handles it (a host with no card-content handler, e.g. the gallery), it falls through to `send()`.
- **The card-content handler is compile-time-exhaustive over the registry (B).** `RUN_SLASH_COMMAND` is `handled` by handler *presence*, so an unmapped entry would be silently swallowed. The handler is a total `Record<LocalCommandName, …>` (`never` check) and reads state fresh from the store ([L07]).
- **Two latent keyboard-pipeline fixes (found here).** A key the editor/typeahead fully handles must not *also* drive the document pipeline's Stage-2 *Enter→default-button activation*. Without this, an Enter that opens a sheet mid-event (accept or submit) bubbles on and clicks the just-opened sheet's primary button, dismissing it instantly (the "flash"). Fixes: (1) the active typeahead `stopPropagation`s the keys it consumes (`completion-extension.ts`); (2) the editor keymap `stopPropagation`s an Enter it handles as submit (`keymap.ts` `handleEnter`). Both are pre-existing bugs any accept/submit-opens-a-surface flow would have hit.

**Tasks:**
- [x] Add `slash-commands.ts` with `LOCAL_SLASH_COMMANDS` (seed: `permissions`, no args) + `matchLocalSlashCommand` returning `{ name, args }`.
- [x] Add `RUN_SLASH_COMMAND` to `action-vocabulary.ts` (`value: { name, args }`).
- [x] Add `useKeyCardDispatch` over `ResponderChainContext` (no existing equivalent — `use-key-card.tsx` only reads the id; new `use-key-card-dispatch.ts` mirrors `useControlDispatch` over `sendToKeyCard*`).
- [x] **Uniform completion:** accepting any slash command (Tab/Enter/click) inserts a command atom + dismisses the popup — the completion engine has no local/remote code. Local items share claude's shape and are merged into the `/` popup.
- [x] **Split at submit:** `performSubmit` recognizes a command (bare `/name` text OR a lone command atom) and runs `matchLocalSlashCommand`; local → key-card dispatch `RUN_SLASH_COMMAND` (clear + return); else → `send()`. Runs before the send-readiness gates (transport-independent). The handled branch does not run `onAfterSubmit` (that refocuses the editor for a *sent message*).
- [x] **Two latent keyboard-pipeline fixes:** the active typeahead (`completion-extension.ts`) and the editor's submit-Enter handler (`keymap.ts`) each `stopPropagation` the Enter they consume, so an Enter that opens a sheet mid-event can't bubble to the pipeline's default-button activation and dismiss it (the "flash"). Regression-guarded by `at0089`.
- [x] Compose the local-command completion provider into the dev-card `/` provider (`dev-card.tsx:386` via new `completion-providers/local-commands.ts`); `SessionMetadataStore` left generic. The provider is a plain, no-arg generator of command-atom items.
- [x] Register the `RUN_SLASH_COMMAND` handler on the card-content responder (no `parentId` pin) driven by a **compile-time-exhaustive `Record<LocalCommandName, …>`** (B — a registry entry without a surface is a type error); the handler reads `permissionSheet` fresh each render via the responder live-lookup ([L07]) and opens the command's surface.
- [x] Lift the permission sheet to `DevCardBody` via the new `usePermissionSheet` hook; the chip's `onOpenSheet` and the `/permissions` handler share one opener; focus restore to the prompt editor on dismiss confirmed by `at0089`.

**Tests:**
- [x] Pure-logic: `matchLocalSlashCommand` — no-arg exact match, no-arg-with-args → null, unknown `/foo` → null, non-command → null (`slash-commands.test.ts`). The arg-capture branch activates only for `takesArgs` commands; the seed registry has none, so that path lands with `/btw` ([#step-13]) — pinned as a deferral in the test rather than faked.
- [x] Pure-logic: the local-command completion provider lists/filters registry commands, and `mergeCommandProviders` concatenates local-first + dedups by label against the store provider (`slash-commands.test.ts`).
- [x] Real-app (`at0089-slash-permissions.test.ts`): type `/permi`, accept from the popup → a command atom is inserted and the popup dismisses (the sheet does **not** open on accept); submit → the sheet opens, **no transcript row** appears (DOM state, not a `send()` spy), and the line clears. The sheet **stays open** through a 400 ms beat (regression guard for the flash). Pick a mode; the chip reflects it; dismiss restores focus to the editor ([L23]).
- [x] Real-app: type `/commit` and submit raw; an optimistic row appears and no sheet opens (the submit-time matcher discriminates local from pass-through).

**Checkpoint:**
- [x] `cd tugdeck && bun test` — 3059 pass / 0 fail; `tsc --noEmit` clean.
- [x] `just app-test slash-permissions` — `at0089` VERDICT: PASS (1/1). `at0088` (chip click → sheet) re-run green — the sheet-ownership lift did not regress it.

**What this step does NOT do:**
- Does not filter claude's reported commands by the [D14] allowlist — that is [#step-13]; this step only adds local commands and the merge seam.
- Does not build the `/model` picker (that surface is [#step-2b], gated on [#step-6]); `/model` joins the registry when its sheet exists.
- Ships **no live slash command** (follow-up correction): the permission *mode* control is the Z4B chip + `Shift+Tab`, **not** a slash command, so the registry is empty and the dispatch infra is dormant until [#step-1-6] (`/permissions`) or [#step-2b] (`/model`) register the first command. `/permissions` is its own feature — the rules editor — planned in [#step-1-5] / [#step-1-6], **not** this mode sheet.

---

#### Step 1.5: Empirical capture — Claude Code `/permissions` rules read/write {#step-1-5}

**Depends on:** #step-1c

**Commit:** `test(tugcast): capture how Claude Code /permissions reads + writes rules`

**References:** [D06] protocol baseline, [D10] empirical-capture-before-design (precedent), (#slash-cmd-inventory)

**Problem statement.** `/permissions` is not the permission-*mode* chip — it is Claude Code's tool-permission **rules editor** (the screenshot: tabs `Allow` / `Ask` / `Deny` / `Workspace` / `Recently denied`, tool-matcher patterns like `Bash(… init:*)`, add-rule + search). Before designing the dev-card sheet ([#step-1-6]) we must know *where the rules live and how they're read and written* — the same de-risking [#step-7a] does for `/rewind`. Building against an assumed `settings.json` shape and silently getting the scope or live-reload behavior wrong would be the [R03]-class trap.

**Goal.** Pin the rules data model and the read/write/apply mechanism as the empirical spec for [#step-1-6].

**Tasks (investigation — findings ARE the spec):**
- [x] Drive Claude Code's `/permissions` in the terminal: add and remove a rule in each of `Allow` / `Ask` / `Deny`; observe **which file** each write lands in and at **what scope** — user `~/.claude/settings.json`, project `.claude/settings.json`, local `.claude/settings.local.json` — and the default scope per tab/action. → captured via the six-tab UI + on-disk files: this repo's rules live in `.claude/settings.local.json` (Local, gitignored); Project absent, User has no `permissions` block. Precedence Managed > CLI > **Local > Project > User**, rules **merge (union)**. Add-rule default scope = Local (terminal picker offers Local/Project/User; one minor item to confirm against the picker's default — non-blocking).
- [x] Pin the on-disk **shape**: `permissions: { allow, ask, deny }` (+ `additionalDirectories` for `Workspace`) and the matcher-pattern grammar (`Bash(cmd:*)`, `Read(path)`, `WebFetch(domain:…)`, …). → confirmed 1:1 against `settings.local.json`; grammar `Tool` | `Tool(specifier)`; `defaultMode` is the *mode* (Step 1), not a rule, but shares the object.
- [x] Determine **`Recently denied`'s source**: is it persisted, or a session log of denied tool calls? Cross-check against the `control_request_forward` (`is_question:false`) deny decisions the dev card already sees on the wire ([#step-15]). → **runtime, not persisted**; UI says "denied by the auto mode classifier"; sourced 1.6-side from a session deny log cross-checking the wire denials.
- [x] Determine **apply semantics**: does the claude process tugcode spawned pick up a `settings.json` edit **live**, or only on respawn? (Decides whether [#step-1-6] writes-and-continues or writes-and-respawns.) → **LIVE** (docs: Claude Code watches settings files and reloads `permissions`/`hooks` without restart, firing `ConfigChange`). → 1.6 **writes-and-continues**. *Confirm-at-1.6-start caveat:* not yet verified for the print/stream-json child specifically — cheap mid-session deny-rule check when 1.6 begins; fall back to respawn only if it (unexpectedly) doesn't watch.
- [x] Determine the **read path for the dev card**: does any of this come over stream-json (`system/init`?) or is it purely filesystem? Decide the dev-card access route — most likely a tugcast filesystem read/write of the settings files, scope-aware. → **purely filesystem** (`system/init` carries tools + mode, not rules); route is **tugcast filesystem read/write, scope-aware**.
- [x] Record findings in `transport-exploration.md` — the concrete file / scope / shape / apply contract that [#step-1-6] implements against. → recorded under "`/permissions` rules — read/write/apply capture".

**Tests / Checkpoint:**
- [x] Findings documented: the concrete file / scope / shape / apply contract that [#step-1-6] implements against.

---

#### Step 1.6: `/permissions` rules editor — full terminal parity {#step-1-6}

**Depends on:** #step-1c, #step-1-5

**Commit:** `feat(dev-card): /permissions rules editor (allow/ask/deny/workspace/recently-denied)`

**References:** the rules data model pinned by [#step-1-5], [D14] slash popup, [D15] card-scoped overlays, [L02] store, [L11] chain, (#slash-cmd-inventory). **Supersedes [#step-9].**

**Goal.** The full `/permissions` rules editor matching the terminal — a tabbed, card-scoped sheet over the tool-permission rules — wired to the read/write/apply mechanism [#step-1-5] pinned. Registering `/permissions` here is the first live consumer of the [#step-1c] dispatch layer.

**Artifacts:**
- New: `permission-rules-editor.tsx` (tabbed `TugSheet`: `Allow` / `Ask` / `Deny` / `Workspace` / `Recently denied`) + `.css`.
- New: a rules store/data source reading + writing the settings file(s) per [#step-1-5] (via tugcast filesystem or the determined route), scope-aware.
- New: any tugcast/tugcode plumbing [#step-1-5] requires (e.g. a settings read/write control command; respawn-on-apply if not live).
- Modified: `lib/slash-commands.ts` — register `permissions` (restoring the literal-union `LocalCommandName` + the exhaustive `Record<LocalCommandName,…>` handler in `dev-card.tsx`); `/permissions` → opens this editor.
- New: `at0090-permissions-rules-editor.test.ts` real-app test.

**Tasks:**
- [ ] Tabbed sheet: `Allow` / `Ask` / `Deny` (rule lists) + `Workspace` (additional dirs) + `Recently denied` (promote-to-rule feed). Tabs via the chain ([L11]); rule lists via `TugListView`.
- [ ] Rule rows render the matcher pattern; **add a rule** (pattern input + bucket), **remove**, **search** filter — full parity with the screenshot.
- [ ] `Recently denied` sourced per [#step-1-5] (likely accumulated deny decisions); each row offers "add to Allow/Ask/Deny".
- [ ] Read + write the settings file(s) at the scope [#step-1-5] determined; honor the apply semantics (live vs respawn).
- [ ] `/permissions` slash command → opens the editor (key-card `RUN_SLASH_COMMAND`, same path as any local command); card-scoped overlay per [D15], focus restores on dismiss.

**Tests:**
- [ ] Pure-logic: rule (de)serialization, matcher-pattern parse, search filter, bucket moves.
- [ ] Real-app (`at0090`): type `/permissions`, accept → editor opens; add a rule → assert it's written to the expected file/scope; switch tabs; remove a rule.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` (if tugcast plumbing added) · `cd tugdeck && bun test` · `just app-test permissions-rules-editor`

**What this step does NOT do:**
- Does not touch the permission *mode* chip / `Shift+Tab` cycle — mode and rules are distinct features ([#step-1] vs here).
- Does not implement hunk-level or per-call approval UI — that is the `control_request_forward` flow ([#step-15]).

---

#### Step 2: Model indicator chip in Z4B {#step-2}

**Depends on:** #step-1

**Commit:** `feat(dev-card): model indicator chip in Z4B (display-only)`

**References:** [D01] Z4B chrome anchor, [D04] SessionMetadataStore hub, [D09] model-confirm in transcript, [D13] Z4B indicator-only, (#z4b-chrome-layout)

**Artifacts:**
- New: `model-chip.tsx`
- Modified: placement-experiment to mount model chip in Z4B

**Tasks:**
- [ ] Implement `ModelChip` reading `model` from `SessionMetadataStore`. Display-only per [D13] — no click affordance. Render as a two-line `TugBadge` (`layout="label-top"`, `label="Model"`, `size="sm"`, `role="agent"`) per [#step-0] / [D01].
- [ ] Format display: `Opus 4.8 · 1M` from raw `claude-opus-4-8[1m]`.
- [ ] Do NOT width-stabilize — the chip's width tracks the model label, per [R01].
- [ ] Synthetic `assistant_text` confirmation from `model_change` continues to render in the transcript per [D09] — no suppression, no banner.

**Tests:**
- [ ] Pure-logic: format function `formatModelLabel("claude-opus-4-8[1m]") === "Opus 4.8 · 1M"` for each model.
- [ ] Real-app: chip text matches `system_metadata.model` on mount and after `model_change` round-trip.

**Checkpoint:**
- [ ] `just app-test model-chip`

---

#### Step 2b: `/model` slash command opens picker sheet {#step-2b}

**Depends on:** #step-1c, #step-6

**Commit:** `feat(dev-card): /model slash command opens model picker sheet`

**References:** [D23] local slash-command dispatch, [D13] Z4B indicator-only, [D15] pane sheets are overlays, (#slash-cmd-inventory)

**Artifacts:**
- New: `model-picker-sheet.tsx`
- Modified: register `/model` in the [#step-1c] slash-command registry; its `RUN_SLASH_COMMAND` handler opens the picker sheet (no bespoke routing — the dispatch layer already exists)

**Tasks:**
- [ ] Implement `ModelPickerSheet` as an overlay per [D15], listing available models (Opus 4.8, Sonnet 4.6, Haiku 4.5, Haiku fast-mode).
- [ ] Highlight current model from `SessionMetadataStore.getSnapshot().model`.
- [ ] Selection sends `{type: "model_change", model}`; sheet dismisses on confirmation.
- [ ] Keyboard: arrow keys navigate, Enter selects, ESC dismisses.

**Tests:**
- [ ] Pure-logic: highlight predicate; selection serialization.
- [ ] Real-app: type `/model`, observe sheet; pick a model; assert `model_change` IPC outbound + chip updates after `system_metadata`; assert synthetic confirmation lands in transcript per [D09].

**Checkpoint:**
- [ ] `just app-test model-picker-sheet`

---

#### Step 3: Rate-limit chip in Z4B {#step-3}

**Depends on:** #step-1

**Commit:** `feat(dev-card): rate-limit chip surfaces subscription-quota state in Z4B`

**References:** [D01] Z4B chrome anchor, [D04] SessionMetadataStore hub, [D06] protocol baseline, [Q02] rate-limit store shape, [Q13] RateLimitEvent strictness, Risk R04, [L22] store→DOM observers, [L06] appearance via CSS/DOM, (#z4b-chrome-layout)

**Artifacts:**
- New: `rate-limit-chip.tsx`
- Modified: `session-metadata-store.ts` adds `rateLimit: RateLimitInfo | null` field, `_onRateLimitUpdate` reading the most-recent `rate_limit_event` payload from the feed
- Modified: `protocol.ts` for `RateLimitEvent` outbound IPC type (mirror tugcode's `RateLimitEvent`)

**Tasks:**
- [ ] Extend `SessionMetadataSnapshot` with `rateLimit`.
- [ ] Add `RateLimitEvent` parser; integrate with `FeedStore` subscription on the metadata feed.
- [ ] Implement `RateLimitChip` reading `rateLimit` via `useSyncExternalStore` per [L02] — structural data (status, resetsAt, isUsingOverage) drives React rendering. Render as a two-line `TugBadge` (`layout="label-top"`, `label="Limit"`, `size="sm"`) per [#step-0] / [D01].
- [ ] Visibility predicate: hidden when `status === "allowed"` and `resetsAt > 60min`; visible otherwise. Render once on structural change, not every tick.
- [ ] Role: `agent` at rest, escalating to `caution` (and `danger` for hard limits / overage) on alert states — the one Z4B chip whose role is state-driven rather than fixed.
- [ ] Do NOT width-stabilize — the countdown reflows the chip as it ticks ("5h 23m" → "59m" → "rate-limited"), accepted per [R01].
- [ ] Color / overage state via `data-status` and `data-overage` attributes on the chip root; CSS owns the color transitions per [L06]. No React state for color.
- [ ] **Countdown text ticks via direct DOM mutation per [L22]** — NOT via React state. Implementation: `useLayoutEffect` mounts a `setInterval(60_000)` that reads the current `resetsAt` from a ref and writes `textContent` of the countdown `<span>` directly. The store subscription provides resetsAt as stable structural data; the tick-text update never re-enters React's render cycle. Cleanup the interval on unmount or when the chip becomes hidden.
- [ ] Format helper `formatResetCountdown(resetsAt, now)` returns the text the DOM mutation writes (e.g. `"5h 23m"`); pure function, no side effects.

**Tests:**
- [ ] Pure-logic: `formatResetCountdown(resetsAt, now)` for various offsets; visibility predicate for combinations.
- [ ] Real-app: replay a fixture frame with `status: "warning"`, assert chip mounts; replay `status: "allowed"` with `resetsAt > 60min`, assert chip unmounts.
- [ ] Real-app: verify the chip does NOT re-render through React on tick — measure React's commit count over a 5-minute window; expect commits only on structural state changes, not on each minute boundary.

**Checkpoint:**
- [ ] `just app-test rate-limit-chip`

---

#### Step 4: Session-state chip refinement {#step-4}

**Depends on:** #step-1

**Commit:** `feat(dev-card): session-state chip surfaces lifecycle states in Z4B`

**References:** [D01] Z4B chrome anchor, [D04] SessionMetadataStore hub, (#z4b-chrome-layout)

**Artifacts:**
- Modified: existing Z4B session chip to read more lifecycle states (`new`, `continued`, `forked`, `resuming`, `ready`, `streaming`, `awaiting-approval`, `interrupted`, `error`)
- Modified: `card-services-store.ts` or `session-lifecycle.ts` if any state names need to flow

**Tasks:**
- [ ] Base render is the existing two-line `DevSessionIdBadge` already cut over to `TugBadge` `label-top` / `size="sm"` / `role="agent"` (caption `SESSION`, value the truncated id) — refinement layers lifecycle state on top, it does not re-shape the chip.
- [ ] Enumerate the lifecycle states the chip should render.
- [ ] Confirm each maps to existing reducer state; add missing states if any.
- [ ] Pick chip roles per state — `agent` at rest, escalating via the role system (`caution` / `danger` for `interrupted` / `error`); no width-stabilization per [R01].
- [ ] Update placement-experiment Z3/Z4B mapping if the chip moves position.

**Tests:**
- [ ] Pure-logic: state → label / color mapping table.
- [ ] Real-app: drive lifecycle transitions, assert chip label/color flips.

**Checkpoint:**
- [ ] `just app-test session-state-chip`

---

#### Step 5: Phase A Integration Checkpoint {#step-5}

**Depends on:** #step-0, #step-1, #step-2, #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** [D01], [D04], [D13] Z4B indicator-only, Spec S02 two-line TugBadge, (#success-criteria, #z4b-chrome-layout)

**Tasks:**
- [ ] Mount a freshly-created card; verify all 4 chips populate within 200 ms of session-ready.
- [ ] Verify chips render via the two-line `TugBadge` `label-top` / `size="sm"` / `role="agent"` config per [#step-0] / [D01]; caption line uses the borrowed status-bar typography.
- [ ] Verify the chip cluster fits within representative card widths without horizontal overflow — open the card at narrow and wide configurations.
- [ ] Verify chips are NOT width-stabilized per [R01]: cycling the mode / ticking the rate-limit value reflows the chip, and the centred cluster re-centres without disrupting the flanking zones.
- [ ] Cycle permission mode via `Shift+Tab` 4 times; verify all 4 modes are reachable and the chip updates each time.
- [ ] Verify model chip updates after a `model_change` IPC round-trip (driven via probe; the `/model` picker doesn't exist yet — it lands in [#step-2b]).
- [ ] Verify Z4B chips are indicator-only per [D13]: clicking any chip produces no popover or picker.
- [ ] Drive a rate-limit warning via tugcode probe; verify chip appears.
- [ ] Verify per-card mode persistence per [D07]: cycle mode, close card, reopen; assert chip restores.
- [ ] Run drift regression — must stay clean.

**Tests:**
- [ ] Real-app: end-to-end Z4B mount + interaction.

**Checkpoint:**
- [ ] `just app-test z4b-phase-a-integration`
- [ ] `just capture-capabilities` (drift clean)

---

#### Step 6: `SessionPickerSheet` overlay primitive {#step-6}

**Depends on:** #step-5

**Commit:** `feat(dev-card): SessionPickerSheet overlay primitive`

**References:** [D05] SessionPickerSheet, [D15] pane sheets are overlays, (#rewind-flow)

**Artifacts:**
- New: `session-picker-sheet.tsx`, `session-picker-sheet.css`
- New: portal target / overlay layer in `dev-card.tsx` for hosted overlays (or extend existing overlay infrastructure if present)

**Tasks:**
- [ ] Implement generic `SessionPickerSheet<TRow>` taking `dataSource: DataSource<TRow>`, `renderRow: (row) => ReactNode`, `onSelect: (row) => void`, `onCancel: () => void`.
- [ ] Sheet uses `TugListView` for virtualized rows, `gallery-pinned-headers` for time-bucket headers.
- [ ] Mount as **card-scoped overlay** per [D15]: `position: absolute` within the card root (NOT `position: fixed`, NOT a `body`-portal). Backdrop dims the card's content region only. Other panes / cards in the deck are unaffected.
- [ ] Keyboard: arrow keys navigate, Enter selects, Cmd+Enter "select-and-card", ESC dismisses, click on backdrop-within-card dismisses.
- [ ] Focus trap is scoped to the card — focus cannot tab outside the card while the sheet is open.
- [ ] Focus restores to the prompt entry on dismiss.
- [ ] Per-card scroll/selection memory via tugbank `dev.session-picker-sheet.<cardId>.<sheetKind>`.

**Tests:**
- [ ] Pure-logic: data-source iteration, row selection state.
- [ ] Real-app: mount sheet with a synthetic data source; verify overlay shape (no horizontal split, no escape from card boundary), keyboard navigation, focus return on dismiss.
- [ ] Real-app multi-card: open a sheet in card A in a two-card deck; verify card B remains undimmed and interactable.

**Checkpoint:**
- [ ] `just app-test session-picker-sheet`

---

#### Step 7a: Empirical capture of terminal `/rewind` behavior {#step-7a}

**Depends on:** #step-5

**Commit:** `test(tugcast): probe terminal /rewind wire shape against claude 2.1.154`

**References:** [D06] protocol baseline, [D10] rewind matches terminal, Risk R03, (#rewind-flow)

**Artifacts:**
- New: probe `test-N-slash-rewind` in `tugrust/crates/tugcast/tests/common/probes.rs` driving `/rewind` end-to-end in a real-claude session
- New: golden fixture entry under `v2.1.154/` (or whatever current version is when this step lands) pinning the canonical event sequence
- Updated: `roadmap/transport-exploration.md` adds the empirical findings of what terminal `/rewind` actually does on the wire

**Tasks:**
- [ ] Run `/rewind` in the Claude Code terminal with a multi-turn session; capture the stream-json output.
- [ ] Identify what the terminal sends (any new inbound shapes), what the harness mutates (session-id derivation, JSONL handling), what claude emits (new event types or just a replay).
- [ ] Add `test-N-slash-rewind` to the probe table with the canonical input + expected event sequence.
- [ ] Run `just capture-capabilities` to bake the fixture.
- [ ] Document the findings in `transport-exploration.md` for future reference.

**Tests:**
- [ ] Real-claude probe via `cargo nextest run -p tugcast --features real-claude-tests capture_all_probes`.
- [ ] Drift regression stays clean against the new fixture.

**Checkpoint:**
- [ ] `just capture-capabilities` (drift clean; new probe present in v<version>/)

---

#### Step 7b: `/rewind` on top of `SessionPickerSheet` {#step-7}

**Depends on:** #step-1c, #step-6, #step-7a

**Commit:** `feat(dev-card): /rewind overlay sheet`

**References:** [D05] SessionPickerSheet, [D06] protocol baseline, [D10] rewind matches terminal, [D15] overlays, [L23] preserve user-visible state, [L26] stable mount identity, Risk R03, Spec S01, (#rewind-flow)

**Artifacts:**
- New: `rewind-sheet-data-source.ts`
- New (driven by [#step-7a] findings): whatever IPC types / methods the empirical capture revealed — could be a new inbound type, an extension to `session_command`, or a client-side replay flow
- Modified: register `/rewind` in the [#step-1c] registry; its `RUN_SLASH_COMMAND` handler opens the sheet (in addition to the slash menu)
- Modified: `protocol.ts` adds the IPC type if a new one is needed
- Modified: `code-session-store/` reducer if transcript truncation requires it; surgery scoped to preserve mount identity per [L26]

**Tasks:**
- [ ] Implement `RewindSheetDataSource` over `code-session-store.transcript`. Rows include msg_id, userText preview, timestamp, cost annotation.
- [ ] Wire `/rewind` slash command + typed entry to mount the sheet via `SessionPickerSheet` (card-scoped overlay per [D15]).
- [ ] Implement the wire shape that [#step-7a] empirically determined the terminal uses.
- [ ] Side preview region shows the selected turn's full content + claude response (within the overlay).
- [ ] Empty-state: 0- or 1-turn session does not surface `/rewind` in popup.
- [ ] **Transcript truncation preserves mount identity per [L26]**: when the fork removes turns after `msg_id`, the remaining turns (the ones BEFORE `msg_id`) must keep their existing React reconciliation identity. Three pins, per [L26]'s three-input rule:
  - **Keys** derive from `turnKey` / `msg_id`, which survive the fork unchanged — never from a phase-encoded value.
  - **Component type**: one transcript-row component branches internally on phase; do NOT swap between two row-component types based on "pre-fork" vs "post-fork".
  - **Renderer reference**: the cell-renderer lambda passed to the transcript view is `useCallback`-stable across the fork; do NOT inline a new lambda per render.
  - The turns AFTER `msg_id` unmount (correct — they're gone). The turns BEFORE `msg_id` keep scroll position, selection, in-flight observable subscriptions, and any DOM-resident state.

**Tests:**
- [ ] Pure-logic: data-source projection from transcript; row count, ordering.
- [ ] Pure-logic: reducer truncation preserves pre-fork row keys verbatim.
- [ ] Real-claude: send `/rewind` selection, assert wire shape matches the [#step-7a] fixture and new turn references forked-from msg_id.
- [ ] Real-app: end-to-end keyboard select + Enter + new card-state reflects fork.
- [ ] **Real-app L26 pin**: scroll the transcript to a turn before the fork point, open `/rewind`, fork from a later turn; assert the transcript's scroll position is preserved (no remount) and that the user's selection inside a pre-fork row survives.

**Checkpoint:**
- [ ] `just app-test rewind-sheet`
- [ ] `just app-test rewind-mount-identity`
- [ ] `just capture-capabilities` (drift clean)

---

#### Step 8: `/resume` on top of `SessionPickerSheet` {#step-8}

**Depends on:** #step-1c, #step-6

**Commit:** `feat(dev-card): /resume sheet — pick a prior session to continue`

**References:** [D05] SessionPickerSheet, (#rewind-flow)

**Artifacts:**
- New: `resume-sheet-data-source.ts`
- Modified: register `/resume` in the [#step-1c] registry; its `RUN_SLASH_COMMAND` handler opens the sheet

**Tasks:**
- [ ] Implement `ResumeSheetDataSource` over the tugbank session journal — list prior sessions with first-message preview, timestamp, turn count, cost.
- [ ] Selection sends `session_command: "continue"` with the picked session id.
- [ ] Handle the readiness gap for `continue` (per transport-exploration test-17): `session_init` arrives immediate with `"pending-cont…"`; UI proceeds.

**Tests:**
- [ ] Pure-logic: session-journal projection.
- [ ] Real-app: pick a session, assert continue inbound + transcript loads.

**Checkpoint:**
- [ ] `just app-test resume-sheet`

---

#### Step 9: `/permissions` picker + rules editor sheet {#step-9}

> **Superseded — pulled forward to [#step-1-5] (empirical capture) + [#step-1-6] (rules editor).** This step conflated two distinct features: the permission **mode** (default/acceptEdits/plan/auto — shipped in [#step-1] as the Z4B chip + `Shift+Tab`, no slash command) and the tool-permission **rules** editor (`/permissions` — allow/ask/deny/workspace). With mode already done, the remaining work is the rules editor, planned as [#step-1-6] against the empirical findings of [#step-1-5]. Kept here as a pointer; no separate work.

**Checkpoint:**
- [ ] `just app-test permission-rules-editor`

---

#### Step 10: `/diff` sheet via dedicated `git_diff_request` command {#step-10}

**Depends on:** #step-1c, #step-6

**Commit:** `feat(dev-card+tugcast): /diff overlay sheet via git_diff_request command`

**References:** [D15] overlays, [D21] diff dedicated command, (#slash-cmd-inventory)

**Artifacts:**
- New: `diff-sheet.tsx` (overlay sheet per [D15])
- New: tugcast `git_diff_request` / `git_diff_response` control commands and handler
- Modified: tugcast control-protocol types to add the new request/response shapes

**Tasks:**
- [ ] On the tugcast side: implement the `git_diff_request` handler that runs `git diff` from the project root and serializes the response (file list + per-file hunks).
- [ ] On the dev-card side: implement `DiffSheet` two-pane (left file list, right hunks).
- [ ] Sheet fires `git_diff_request` on mount; receives single-shot `git_diff_response`; renders via `tugdeck/src/lib/diff/`.
- [ ] Mount as overlay per [D15].
- [ ] Refresh on user action (button / re-mount); no continuous feed subscription.

**Tests:**
- [ ] Pure-logic: file list ordering, hunk rendering, request/response shape.
- [ ] Rust unit: tugcast handler against a fixture git workspace.
- [ ] Real-app: mount sheet against a dirty working tree, assert correct file count.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`
- [ ] `just app-test diff-sheet`

---

#### Step 11: `/context` HUD via status-bar arc gauge {#step-11}

**Depends on:** #step-5

**Commit:** `feat(dev-card): /context HUD reuses status-bar arc gauge`

**References:** [D22] context arc gauge, (#z4b-chrome-layout)

**Artifacts:**
- New: `context-hud.tsx`
- Reused: `tug-arc-gauge.tsx` atom (already exists in the status-bar popover; no new gauge primitive)
- Modified: Z4 footer slot to host the HUD

**Tasks:**
- [ ] Mount the existing `tug-arc-gauge.tsx` atom in Z4 with `usage / context_window` ratio sourced from the most-recent `cost_update.usage` and `context_breakdown`.
- [ ] Visual treatment matches the status-bar popover for consistency.
- [ ] Typed `/context` expands into the same status-bar popover content (or a copy of it) showing the full token-category breakdown.
- [ ] Tick refresh on each `cost_update` and `context_breakdown` event.

**Tests:**
- [ ] Pure-logic: gauge ratio computation from `usage` fields.
- [ ] Real-app: drive a turn, assert gauge advances; type `/context`, assert popover opens with breakdown.

**Checkpoint:**
- [ ] `just app-test context-hud`

---

#### Step 12: Listing sheets — `/memory`, `/agents`, `/hooks` {#step-12}

**Depends on:** #step-1c, #step-6

**Commit:** `feat(dev-card): memory/agents/hooks listing overlay sheets`

**References:** [D04] SessionMetadataStore hub, [D15] overlays, (#slash-cmd-inventory)

**Artifacts:**
- New: `memory-sheet.tsx`, `agents-sheet.tsx`, `hooks-sheet.tsx` (overlays per [D15])
- Modified: register `/memory`, `/agents`, `/hooks` in the [#step-1c] registry; each `RUN_SLASH_COMMAND` handler opens its sheet

**Tasks:**
- [ ] `MemorySheet`: list files in `system_metadata.memory_paths.auto`; row-click opens file in embedded `gallery-text-editor.tsx`.
- [ ] `AgentsSheet`: list `system_metadata.agents`; row-click opens the agent's `.md` file in embedded editor.
- [ ] `HooksSheet`: list hooks from settings.json (via host-app or tugbank).
- [ ] All three mount as overlays; ESC / click-outside dismiss; focus restores to prompt entry.

**Tests:**
- [ ] Pure-logic: list projection from `system_metadata`.
- [ ] Real-app: open each sheet, assert correct counts against a fixture session.

**Checkpoint:**
- [ ] `just app-test listing-sheets`

> Note: `/mcp` was previously in this step but is now out of scope per [D14] / [Q06]. Hidden from slash popup.

---

#### Step 13: Slash-popup filtering + `/clear`, `/help`, `/export`, `/copy`, `/btw`, `/add-dir`, `/bug` mapping {#step-13}

**Depends on:** #step-1c, #step-5, #step-6

**Commit:** `feat(dev-card): slash-popup filtering + map UI-affordance slash commands`

**References:** [D11] btw exclude flag, [D14] unsupported-list, [D23] local slash-command dispatch, [D16] clear+help supported, [D15] overlays, (#slash-cmd-inventory)

**Artifacts:**
- New: `tugdeck/src/lib/slash-supported.ts` — canonical allowlist constant (co-located with / read by the [#step-1c] `slash-commands.ts` registry)
- New: `tugdeck/docs/dev-card-unsupported-slash-commands.md` (or under `tuglaws/`) — discoverable list of unsupported commands
- New: `help-tabbed-sheet.tsx` (overlay per [D15])
- Modified: `session-metadata-store.ts` `getCommandCompletionProvider` applies the allowlist *filter* over claude's commands (the local-command merge seam landed in [#step-1c])
- Modified: slash-command popup component to filter; submit-side blocklist swallows known-unsupported commands so they don't reach claude (per [D14])
- Wiring: register `/clear`, `/help`, `/export`, `/copy`, `/add-dir`, `/bug`, `/btw` in the [#step-1c] registry; their `RUN_SLASH_COMMAND` handlers perform the mapped action

**Tasks:**

*Slash-popup filtering:*
- [ ] Define `GRAPHICAL_SUPPORTED_COMMANDS` allowlist in `slash-supported.ts`.
- [ ] Filter popup output — unsupported commands hidden from popup per [D14].
- [ ] Author `dev-card-unsupported-slash-commands.md` listing every unsupported command + why. Link the doc from the slash popup's "?" help affordance and from `/help`.

*`/clear`, `/help`, `/export`, `/copy`, `/add-dir`, `/bug` mappings:*
- [ ] Map `/clear` → existing transcript-clear / new-session affordance per [D16]. Verify the affordance exists; if not, scope the missing piece as a sub-task.
- [ ] Implement `/help` as a tabbed sheet (card-scoped overlay per [D15]) per [D16] with categorized command list, key shortcuts, and links to docs. Tabs modeled on terminal `/help`. Source of command list: `SessionMetadataStore.slashCommands` filtered through the allowlist + a curated docs section.
- [ ] `/export`: open save dialog with format picker (JSONL / markdown).
- [ ] `/copy`: copy last assistant_text accumulation; bind Cmd+Shift+C.
- [ ] `/add-dir`: directory picker → control message (or punt if no IPC support yet — flag).
- [ ] `/bug`: open `https://github.com/anthropics/claude-code/issues/new` in host browser.

*`/btw` exclude-from-history flow (substeps in execution order, per [D11]):*
- [ ] **13.btw.1 — Probe claude 2.1.154 support for the metadata flag.** Add a real-claude probe that sends `user_message` with `metadata.exclude_from_history: true` and a marker text. After the turn completes, read the session JSONL and assert whether the marker text is present. Document the result in `transport-exploration.md` and decide the implementation path:
  - **Path A (claude honors the flag)**: the flag alone suffices; no journal-side work.
  - **Path B (claude does NOT honor)**: tugbank carries the exclusion via journal-side filtering.
- [ ] **13.btw.2 — Extend `UserMessage` type with optional metadata.** Add `metadata?: { exclude_from_history?: boolean }` to `tugcode/src/types.ts:UserMessage` and the parallel `tugdeck/src/protocol.ts` shape. Pre-Step-5c-style discipline: optional field, additive, type-pin tests in both projects. Tugcast `payload_inspector.rs` ignores unknown `metadata` shapes.
- [ ] **13.btw.3 — Tugbank journal filtering (Path B fallback or default).** If the probe in 13.btw.1 returned Path A, this substep is a no-op stub for forward-compat. If Path B: tugbank's journal-write skips entries whose user_message carries `metadata.exclude_from_history: true`. Drift-pin the filter behavior in a unit test.
- [ ] **13.btw.4 — Transcript renderer hides exclude-flagged turns by default.** The dev-card's transcript filters out turns where `metadata.exclude_from_history: true`. Toggle (out of scope here; future addition) would let the user surface them. For this step, they're invisible by default — matching `/btw`'s terminal mental model of "ephemeral, no scrollback trace."
- [ ] **13.btw.5 — Typed `/btw <text>` handler.** Strips the prefix and sends `user_message` with `metadata.exclude_from_history: true` and the content blocks for `<text>`.

**Tests:**
- [ ] Pure-logic: allowlist filter; copy formatter; `/btw` metadata flag serialization.
- [ ] Pure-logic: tugbank journal-write filter respects `exclude_from_history` (whether or not claude honors it).
- [ ] Pure-logic: transcript projection skips exclude-flagged turns.
- [ ] Real-app: each typed shortcut performs the expected UI action; `/help` sheet renders with tabs.
- [ ] Real-claude probe for `/btw` (13.btw.1): assert whether the marker text appears in the session JSONL after a turn with the flag.

**Checkpoint:**
- [ ] `just app-test slash-mappings`
- [ ] `just app-test help-tabbed-sheet`
- [ ] `just app-test btw-exclude-from-history`

---

#### Step 14: Phase B Integration Checkpoint {#step-14}

**Depends on:** #step-2b, #step-7, #step-8, #step-9, #step-10, #step-11, #step-12, #step-13

**Commit:** `N/A (verification only)`

**References:** [D05] SessionPickerSheet, [D13] Z4B indicator-only, [D14] unsupported list, [D15] overlays, [D16] clear+help, (#success-criteria, #slash-cmd-inventory)

**Tasks:**
- [ ] Open `/rewind`, navigate, fork. Open `/resume`, continue a session. Open `/permissions` picker + editor. Open `/model` picker. Open `/diff` against a dirty tree (verify uses `git_diff_request`). View `/context` HUD; expand it. Open each of `/memory`, `/agents`, `/hooks`. Verify `/help` tabbed sheet renders. Verify `/clear` clears transcript. Verify `/btw` honors exclude-from-history flag.
- [ ] Verify all slash filtering correct: `/vim`, `/theme`, `/color`, `/mcp`, `/login`, `/logout`, `/quit`, `/usage`, `/insights`, etc. are absent from popup. Verify `tugdeck/docs/dev-card-unsupported-slash-commands.md` lists each.
- [ ] Verify all overlay sheets mount as overlays (no horizontal split of the dev-card); ESC / click-outside dismisses; focus restores to prompt entry.
- [ ] Verify Z4B chips remain display-only (no popover on click anywhere).
- [ ] Run drift regression — clean.

**Tests:**
- [ ] Real-app: integration walk-through.

**Checkpoint:**
- [ ] `just app-test phase-b-integration`
- [ ] `just capture-capabilities` (drift clean)

---

#### Step 15: `control_request_forward` UI polish {#step-15}

**Depends on:** #step-5

**Commit:** `feat(dev-card): tool-approval modal + AskUserQuestion polish`

**References:** [D06] protocol baseline, Risk R05, (#constraints)

**Artifacts:**
- New: `tool-approval-modal.tsx`
- Modified: existing AskUserQuestion renderer to polish 4-option layout + salvage path

**Tasks:**
- [ ] Implement `ToolApprovalModal` mounted near the in-flight tool block on `control_request_forward` with `is_question: false`.
- [ ] Modal shows tool_name, input (truncated, expand-on-click), decision_reason, permission_suggestions as one-click "Always allow" rules, allow/deny buttons.
- [ ] AskUserQuestion: per-question radio (single-select) or checkbox (multiSelect); honor 4-option cap; "Other" with freeform text-input below.
- [ ] Both flows respond via `tool_approval` or `question_answer` IPC.

**Tests:**
- [ ] Pure-logic: input-truncation, permission-suggestion serialization.
- [ ] Real-app: drive permission deny in a probe; observe modal; click allow; assert outbound IPC.

**Checkpoint:**
- [ ] `just app-test tool-approval-modal`
- [ ] `just app-test askuserquestion-flow`

---

#### Step 16: `api_retry` indicator {#step-16}

**Depends on:** #step-5

**Commit:** `feat(dev-card): api_retry indicator during retryable failures`

**References:** [D06] protocol baseline, [L22] store→DOM observers, [L06] appearance via CSS/DOM, (#z4b-chrome-layout)

**Artifacts:**
- New: `api-retry-indicator.tsx` — mounts in Z4 footer (consistent placement with the rate-limit chip's Z4B-adjacent footer surface; chosen to disambiguate Step 3's open "Z4 or toast" wording)
- Modified: Z4 footer slot to host the indicator

**Tasks:**
- [ ] Subscribe to `api_retry` events via `useSyncExternalStore` per [L02] — structural data (attempt, max_retries, retry_delay_ms, error) drives React rendering. Render the indicator shell on `api_retry` arrival; unmount on `cost_update` or `turn_complete`.
- [ ] **Countdown text ticks via direct DOM mutation per [L22]** — NOT via React state. Implementation mirrors the rate-limit chip's pattern: `useLayoutEffect` mounts a `setInterval(1_000)` (or similar resolution) that reads the current deadline from a ref and writes `textContent` of the countdown `<span>` directly. The store subscription provides retry_delay_ms as stable structural data; the tick-text update never re-enters React's render cycle.
- [ ] Render shell: `attempt n/max in <span class="countdown">Xs</span> — error_label`.
- [ ] Cleanup the interval on unmount or on clear-event (`cost_update` / `turn_complete`).
- [ ] Pure-logic countdown helper `formatRetryCountdown(deadline, now)` returns the text the DOM mutation writes.

**Tests:**
- [ ] Pure-logic: countdown function; clear-on-event logic.
- [ ] Real-app: inject `api_retry` via probe; observe indicator shell mounts, ticks via DOM, clears on `cost_update`.
- [ ] Real-app: verify React's commit count over the retry window — expect commits only on api_retry arrival and on clear, not per tick.

**Checkpoint:**
- [ ] `just app-test api-retry-indicator`

---

#### Step 17: `thinking_text` empty-state {#step-17}

**Depends on:** #step-5

**Commit:** `fix(dev-card): thinking_text empty-state — omit when absent`

**References:** [Q12] thinking empty-state, (#test-categories)

**Artifacts:**
- Modified: `gallery-dev-thinking.tsx` to honor [Q12]'s decision

**Tasks:**
- [ ] Per [Q12] DECIDED → omit header entirely on absence.
- [ ] Verify the thinking collapsible mounts on `thinking_text` partials and renders correctly.
- [ ] Confirm against v2.1.154 stream shape (`stream_event/thinking_delta`).

**Tests:**
- [ ] Pure-logic: thinking-block presence predicate.
- [ ] Real-app: turn with thinking, assert visible; turn without, assert no header.

**Checkpoint:**
- [ ] `just app-test thinking-empty-state`

---

#### Step 18: `@`-file completion in prompt entry {#step-18}

**Depends on:** #step-5

**Commit:** `feat(dev-card): @-file completion in prompt entry`

**References:** [D06] protocol baseline, (#dependencies)

**Artifacts:**
- New: `at-file-completer.ts`
- Modified: prompt-entry to register `@` trigger via existing `CompletionProvider` interface

**Tasks:**
- [ ] Add `@` trigger to the prompt entry's completion infrastructure.
- [ ] Implement `AtFileCompleter` reading the FILESYSTEM snapshot feed (0x10).
- [ ] Fuzzy match; popup anchored under cursor.
- [ ] Selection: text file → injects content as a text content block referencing the path; image file → injects as image content block per `tugcode/src/types.ts:ContentBlockImage`.

**Tests:**
- [ ] Pure-logic: fuzzy-match scoring.
- [ ] Real-app: type `@CLAUDE`, observe completion popup; pick file; assert content block on send.

**Checkpoint:**
- [ ] `just app-test at-file-completion`

---

#### Step 19: Image drag/paste in prompt entry {#step-19}

**Depends on:** #step-5

**Commit:** `feat(dev-card): image drag/paste in prompt entry`

**References:** [D06] protocol baseline, Risk R06, (#dependencies)

**Artifacts:**
- Modified: prompt-entry to handle drop / paste events for image data
- Modified: `gallery-attachment-strip.tsx` to render thumbnails

**Tasks:**
- [ ] Detect image data on drop/paste; reject non-image text (per `feedback_persistent_text_entry`).
- [ ] Downsample via `image-downsample.ts`.
- [ ] Show thumbnail in attachment strip.
- [ ] On send, attach as `image` content block per `ContentBlockImage`.

**Tests:**
- [ ] Pure-logic: image-type detection, downsample call.
- [ ] Real-app: drop a PNG, send, observe message with image attached.

**Checkpoint:**
- [ ] `just app-test image-drag-paste`

---

#### Step 20: Interrupt visibility refinement {#step-20}

**Depends on:** #step-5

**Commit:** `fix(dev-card): interrupt produces "stopped" label, not generic error`

**References:** [D06] protocol baseline, (#test-categories)

**Artifacts:**
- Modified: turn-completion renderer to distinguish interrupt-driven `result: "error"` from genuine errors

**Tasks:**
- [ ] Track interrupt intent locally (the interrupt button click sets a per-turn flag).
- [ ] When `turn_complete` arrives with `result: "error"` AND the flag is set, label as "stopped by user".
- [ ] Otherwise: generic error banner.

**Tests:**
- [ ] Real-app: send a long prompt, click interrupt mid-stream, assert "stopped by user" label.

**Checkpoint:**
- [ ] `just app-test interrupt-stopped-label`

---

#### Step 21: `compact_boundary` divider {#step-21}

**Depends on:** #step-5

**Commit:** `feat(dev-card): compact_boundary divider in transcript`

**References:** [D06] protocol baseline, (#test-categories)

**Artifacts:**
- New: `compact-boundary-divider.tsx`
- Modified: transcript renderer to insert divider at the boundary

**Tasks:**
- [ ] Subscribe to `compact_boundary` events.
- [ ] Render an in-transcript divider: "Conversation compacted at <time>. <N> tokens summarized."
- [ ] Style as a soft separator, not an error.

**Tests:**
- [ ] Pure-logic: divider props from `compact_boundary` payload.
- [ ] Real-app: drive `/compact`, observe divider in transcript.

**Checkpoint:**
- [ ] `just app-test compact-boundary-divider`

---

#### Step 22: `unknown_event` IPC frame for forward-compat {#step-22}

**Depends on:** #step-5

**Commit:** `feat(tugcode): unknown_event IPC frame for forward-compat`

**References:** [D19] unknown-event frame, Risk R04, (#inputs-outputs)

**Artifacts:**
- Modified: `tugcode/src/session.ts:1031` default branch emits `unknown_event` frame (in addition to the existing console log, kept for operator visibility)
- Modified: `tugcode/src/types.ts` adds `UnknownEvent` type + adds it to `OutboundMessage` union
- Modified: `tugdeck/src/protocol.ts` adds inbound `UnknownEvent` reader
- New: frontend banner component for the soft-warn surface

**Tasks:**
- [ ] Add `UnknownEvent` type to `tugcode/src/types.ts` with fields `type: "unknown_event"`, `original_type: string`, `payload_hex_preview: string`, `ipc_version: number`.
- [ ] Replace the silent log-and-drop default branch in `routeTopLevelEvent`: emit `messages.push({type:"unknown_event", original_type, payload_hex_preview, ipc_version: 2})` and keep the `console.log` for operator visibility.
- [ ] Hex preview: first 64 bytes of the raw payload, hex-encoded.
- [ ] Frontend reads and surfaces as a soft warn banner: "dev-card doesn't understand event 'X' yet."

**Tests:**
- [ ] Pure-logic: hex preview truncation.
- [ ] Unit test in `tugcode/__tests__/session.test.ts`: inject an unknown event via the route function, assert `unknown_event` IPC frame in output.
- [ ] Real-app: inject an unknown event via probe, assert banner appears.

**Checkpoint:**
- [ ] `just app-test unknown-event-banner`

---

#### Step 23: Phase C Integration Checkpoint {#step-23}

**Depends on:** #step-15, #step-16, #step-17, #step-18, #step-19, #step-20, #step-21, #step-22

**Commit:** `N/A (verification only)`

**References:** [D06] protocol baseline, (#success-criteria)

**Tasks:**
- [ ] Drive a permission denial; verify modal. Drive AskUserQuestion; verify polish. Trigger api_retry; verify indicator. Confirm thinking empty-state. Test @-file completion. Drag-drop an image. Interrupt a turn; verify "stopped" label. Trigger /compact; verify divider. If [Q14] DECIDED, inject unknown event; verify banner.
- [ ] Run drift regression — must stay clean.

**Tests:**
- [ ] Real-app: integration walk-through.

**Checkpoint:**
- [ ] `just app-test phase-c-integration`
- [ ] `just capture-capabilities` (drift clean)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The dev-card surfaces every piece of ambient session state the terminal does (mode, model, rate-limit, lifecycle), provides graphical equivalents for every locally-rendered terminal slash command, and polishes the streaming + approval surface to first-class fidelity. Drift regression stays clean across the work.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [x] `TugBadge` supports the two-line `label-top` and `content-top` layouts per Spec S02; gallery card demos both ([#step-0]); existing single-layout call sites unchanged.
- [ ] Z4B chrome shows all 4 chips as INDICATORS on every dev-card mount, rendered via the two-line `TugBadge` (display-only per [D13]; no click-to-popover on any chip). `Shift+Tab` cycles permission mode; rate-limit chip appears when status ≠ allowed; session-state reflects lifecycle.
- [ ] Permission mode persists per-card via tugbank per [D07] — relaunching a card restores its prior mode.
- [ ] Typed `/rewind`, `/resume`, `/permissions`, `/model`, `/diff`, `/context`, `/memory`, `/agents`, `/hooks`, `/help` each produce the documented graphical surface (all overlay sheets per [D15]).
- [ ] `/vim`, `/theme`, `/color`, `/mcp`, `/login`, `/logout`, `/quit`, `/usage`, `/insights`, `/goal`, `/team-onboarding`, `/usage-credits`, `/extra-usage`, `/heapdump`, `/reload-skills` are absent from the slash popup.
- [ ] `tugdeck/docs/dev-card-unsupported-slash-commands.md` exists and lists every hidden command.
- [ ] `/clear`, `/export`, `/copy`, `/btw`, `/add-dir`, `/bug` each map to the documented UI action. `/btw` honors exclude-from-history per [D11].
- [ ] `/diff` uses a dedicated `git_diff_request` command per [D21], not the GIT feed.
- [ ] `/context` HUD uses the status-bar arc gauge per [D22].
- [ ] `/rewind` flow matches the terminal empirically per [D10]; canonical event sequence pinned in the golden catalog from [#step-7a].
- [ ] Permission denials show a modal; AskUserQuestion polished with salvage path; api_retry surfaces an indicator; thinking_text omits cleanly on absence per [Q12]; @-file completion works; image drag/paste works; interrupt labels as "stopped"; compact_boundary renders a divider; `unknown_event` IPC frame emits per [D19] with frontend banner.
- [ ] Model-change confirmation renders in the transcript per [D09].
- [ ] Drift regression clean after each step; v2.1.154 baseline unchanged (or advanced if a version bump lands mid-plan).

**Acceptance tests:**
- [ ] `just app-test z4b-phase-a-integration`
- [ ] `just app-test phase-b-integration`
- [ ] `just app-test phase-c-integration`
- [ ] `just capture-capabilities` (clean after each integration step)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Multi-card multi-session keyboard / send-button arbitration ([#q15-multi-card-session]).
- [ ] Plan-mode workflow card with Approve+Auto / Approve+AcceptEdits / Approve+Manual / Keep Planning actions.
- [ ] Subagent-tree visualization (collapsible per-Agent-call tree in the parent turn).
- [ ] Turn-level cost-breakdown chips per turn.
- [ ] Inline tool-result pane (Read block click expands into a side-by-side file viewer).
- [ ] Skill-output tree (group orchestrator skill events under a "Skill: dash" collapsible).
- [ ] Hunk-level stage affordance on `/diff` (requires `stage hunk` command in tugcast).
- [ ] MCP OAuth webview (requires host-app participation per [#q06-mcp-auth-ownership]).

| Checkpoint | Verification |
|---|---|
| Step 0 spike landed | `TugBadge` two-line layouts shipped; gallery demos signed off; chosen Z4B ordering documented. `just app-test tug-badge-two-line` |
| Phase A complete | All 4 Z4B chips populate on mount via two-line `TugBadge`; `Shift+Tab` cycles; rate-limit chip appears on demand; chip cluster fits within the card horizontally without overflow. `just app-test z4b-phase-a-integration` + `just capture-capabilities` |
| Phase B complete | All 9 locally-rendered slash commands have graphical equivalents; popup filtering correct. `just app-test phase-b-integration` + `just capture-capabilities` |
| Phase C complete | Approval UI / api_retry / thinking / @-file / image / interrupt / compact polished. `just app-test phase-c-integration` + `just capture-capabilities` |
| Drift baseline | v2.1.154 catalog still clean — `cargo nextest run -p tugcast` and `stream_json_catalog_drift_regression` |

---

### Cross-references {#cross-references}

- [transport-exploration.md](transport-exploration.md) — 35-probe stream-json catalog with full event-type catalog.
- [session-metadata-feed.md](session-metadata-feed.md) — snapshot-feed proposal for late-subscriber metadata.
- [tug-feed.md](tug-feed.md) — structured progress reporting; intersects with Phase D follow-ons.
- [ws-verification.md](ws-verification.md) — WebSocket round-trip baseline.
- [tug-multi-instance.md](tug-multi-instance.md) — multi-instance coordination story.
- `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.154/` — freshly-landed golden catalog ([#d06-protocol-baseline]).
- `capabilities/2.1.154/system-metadata.jsonl` — slash-command, agent, skill, tool inventory.
- `tugdeck/src/components/tugways/cards/dev-card.tsx` — where most surface work lands.
- `tugdeck/src/lib/session-metadata-store.ts` — store every Phase A chip reads ([#d04-session-metadata-hub]).
- `tugcode/src/session.ts:612` (`routeTopLevelEvent`) — where new IPC translations land.
- [tuglaws/tugplan-skeleton.md](../tuglaws/tugplan-skeleton.md) — this plan's format.
- [tuglaws/tuglaws.md](../tuglaws/tuglaws.md) — L02, L03, L06 compliance constraints.
