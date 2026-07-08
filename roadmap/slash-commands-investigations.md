I have a complete end-to-end picture. Here is the structured report.

# Slash-command support in Tug — end-to-end map

## Executive summary

Slash commands split into **three tiers**, decided entirely on the **tugdeck (client)** side at submit time. tugcode (the Claude Code bridge) does **not** parse or intercept slash commands at all — it only (a) builds a turn-free command *catalog* at spawn and (b) forwards user turns verbatim to the Agent SDK. There is **no** **`/goal`** **support**: `goal` is explicitly in tugdeck’s `HIDDEN_SLASH_COMMANDS` set (swallowed, never sent to claude), documented as a deferred “conversation-structure / automation” feature.

## 1. tugcode (the Claude Code bridge): discovery + forwarding

tugcode never intercepts slash commands. Two relevant responsibilities:

**A. Building the turn-free command catalog** (so the client can populate the popup and its allowlist before the first turn):

- `tugcode/src/capabilities.ts` — `buildSessionCapabilities()` (line 126) parses claude’s `initialize` control-response into a `session_capabilities` IPC message. `parseCommands()` (line 87) extracts each `CapabilityCommand {name, description?, argumentHint?}`.

- `parseInitializeControlResponse()` (line 166) pulls the nested capability object out of the raw `control_response`.

- **Plugin augmentation:** `enumeratePluginCommands()` (line 204) walks the bundled `tugplug` plugin dir’s `skills/*/SKILL.md` and `commands/*.md`, emitting `<plugin>:<name>` entries; `mergePluginCommands()` (line 273) folds them into the catalog in qualified form (dropping claude’s bare twin). This exists because claude’s `initialize` handshake answers *before* it loads `--plugin-dir` plugins, so plugin commands would otherwise be missing from a fresh card.

**B. The types on the wire:**

- `tugcode/src/types.ts` — `SessionCapabilities` (line 496): `{ type:"session_capabilities", models, commands: CapabilityCommand[], agents, ... }`. `CapabilityCommand` at line 480. This is emitted **once per spawn**.

- `SystemMetadata` (line 425) is the *other* source: it carries `slash_commands?: unknown[]` (line 440) but only lands after the first turn (claude’s `system/init`). Session-lifecycle handling in `session.ts` (lines 1307, 1330) forwards `slash_commands` from the init event.

- **Inbound allowlist:** the client→tugcode contract is authored in `tugproto/src/inbound.ts` and re-exported by `tugcode/src/types.ts` (lines 28-57, `isInboundMessage`). The inbound verb list is in `inbound.ts` (line 278 `"user_message"`, etc.). A user turn is a `UserMessage { type:"user_message", content: ContentBlock[] }` (inbound.ts line 62). The header comment (line 30) is explicit: **“tugcode forwards** **`content`** **verbatim to the Agent SDK.”**

**Verdict for tugcode: slash commands are forwarded verbatim as user-message text — never intercepted or executed by tugcode.** The `/name` string just rides inside a text content block; claude expands it.

## 2. tugdeck: rendering, autocomplete, and the three-tier registry

The client owns *all* slash-command policy. Key modules:

**Registry of locally-handled commands** — `tugdeck/src/lib/slash-commands.ts`:

- `LOCAL_SLASH_COMMANDS` (line 68): the `as const satisfies` array of ~21 commands with Tug surfaces (`permissions`, `model`, `effort`, `mode`, `rewind`, `resume`, `diff`, `context`, `skills`, `agents`, `memory`, `hooks`, `copy`, `help`, `clear`, `export`, `add-dir`, `rename`, `compact`, `logout`). `LocalCommandName` (line 154) is the derived literal union.

- `matchLocalSlashCommand()` (line 187) matches a draft against the registry; `slashCommandName()` (line 256) extracts the bare `/name`; `buildSlashCommandLine()` (line 223) reconstructs a plain command line from an editor draft that carries atoms.

**Three-tier classifier** — `tugdeck/src/lib/slash-supported.ts`:

- `SlashSupport = "supported-local" | "pass-through" | "hidden"` (line 46).

- `classifySlashCommand()` (line 171): local registry → `supported-local`; `HIDDEN_SLASH_COMMANDS` set → `hidden`; **everything else →** **`pass-through`** **(the safe default)**.

- `HIDDEN_SLASH_COMMANDS` (line 68): the swallow-list. **`"goal"`** **is at line 90.**

- `isUnknownRemoteCommand()` (line 262): a pass-through name is only “unknown” if the catalog is non-empty AND it resolves to nothing.

- `resolveRemoteCommand()` (line 201) / `canonicalizeBareCommandLine()` (line 229): namespace-aware resolution so a bare `/devise` matches catalogued `tugplug:devise`.

**Autocomplete / popup** — `tugdeck/src/components/tugways/cards/completion-providers/local-commands.ts`:

- `localCommandCompletionProvider()` (line 50) offers the local registry.

- `filterCommandProvider()` (line 86) drops the `hidden` tier from claude’s reported commands.

- `mergeCommandProviders()` (line 115) merges local + claude’s catalog (from `SessionMetadataStore.getCommandCompletionProvider()`), local-first-wins dedup, scored ordering.

**Per-command special-casing (surfaces)** — `tugdeck/src/components/tugways/cards/dev-card.tsx`:

- `slashCommandSurfaces: Record<LocalCommandName, (args)=>void>` (line 2891) — the exhaustive map wiring each local command to its graphical surface (`/model` → `modelPicker.openModelPicker()`, `/clear` → new session, `/compact` → compaction, `/copy` → clipboard, etc.). Because it’s keyed on the literal union, a registry entry without a wired surface is a compile error.

- The `RUN_SLASH_COMMAND` action handler is at line 3240; `SHOW_SLASH_COMMAND_NOTICE` at line 3253.

**Actions** — `tugdeck/src/components/tugways/action-vocabulary.ts`: `RUN_SLASH_COMMAND` (line 334) and `SHOW_SLASH_COMMAND_NOTICE` (line 335).

**Submit-path dispatch** — `tugdeck/src/components/tugways/tug-prompt-entry.tsx` `performSubmit` (lines 1587-1701):

- Reconstruct the command line, `matchLocalSlashCommand()` (line 1609). If local → dispatch `RUN_SLASH_COMMAND` to the key card, open its surface, record in history, clear draft, **return** (never sent to claude) — lines 1611-1647.

- Else `slashCommandName()` + `isHiddenSlashCommand()` / `isUnknownRemoteCommand()` (lines 1657-1665). If **hidden** or **genuine unknown** → dispatch `SHOW_SLASH_COMMAND_NOTICE` (reason `"unsupported"` or `"unknown"`), swallow, **return** (lines 1666-1699).

- Otherwise (pass-through) → falls through to normal `send()` — the `/name` text goes to claude verbatim.

## 3. `/goal` — existing handling

**No functional support anywhere.** `goal` appears only as an entry in the **hidden/swallow** set:

- `tugdeck/src/lib/slash-supported.ts:90` — `"goal"` in `HIDDEN_SLASH_COMMANDS`, grouped under “Conversation-structure / automation deferred to a future plan.”

- `tuglaws/dev-card-unsupported-slash-commands.md:44-50` — documents `/goal` as hidden: “conversation branching, plan mode, agentic goal loops … Out of conversational-parity scope; each is a substantial standalone feature for a future plan.”

Current runtime behavior if a user types `/goal`: it is **absent from the popup**, and on submit it is **swallowed with a “Command not available” notice — never sent to claude**. (Note: because it’s hidden, it never reaches claude even though claude’s own catalog does list `goal` as a real command, per the probe capture in `tugcode/probes/...`.)

All other `goal`/`non-goal` hits across tugdeck/tuglaws/roadmap are unrelated prose (design “non-goals”, `pulse-card.tsx` animation variable, etc.).

## 4. Command output / results flow-back

Slash-command output comes back through the **replay / stdout-synthesis** path, not a dedicated wire type:

**tugcode side** — synthesizes assistant text from local-command output:

- `tugcode/src/session.ts:1590-1614` — a slash command returns content as a plain string; tugcode matches `<local-command-stdout>…</local-command-stdout>` and synthesizes a `content_block_start` + `assistant_text` block. Array-content variant at lines 1678-1690.

- `tugcode/src/session.ts:5460` — comment: “Slash commands (local commands) deliver output via the [replay path].”

- Scaffolding stripping: `tugcode/src/replay.ts:984` `COMMAND_SCAFFOLDING_PREFIXES` (`<command-name>`, `<command-message>`, `<command-args>`, `<local-command-stdout>`) — these markers are detected (lines 1013, 1297) and filtered so claude’s slash scaffolding isn’t shown as ordinary prose.

**tugdeck side** — parses the scaffolding for display:

- `tugdeck/src/lib/command-atom.ts:204-217` — `COMMAND_NAME_RE`, `COMMAND_ARGS_RE`; parses the `<command-message>/<command-name>/<command-args>` envelope (tolerant, only `<command-name>` required) so a submitted slash command renders as a command atom rather than raw tags.

- `tugdeck/src/lib/build-wire-payload.ts:214` and `synthesize-user-message.ts:205` — handle claude rewriting the user turn into a `<command-name>` envelope.

- `tugdeck/src/lib/code-session-store.ts:774` — recovers the typed command when claude’s `<command-name>` echo replays.

## How a NEW slash command would behave today

It depends purely on the **name**, via `classifySlashCommand()`:

- **If claude/plugins report it in the catalog and it’s not in the hidden set** → it is `pass-through`: it shows up in the `/` popup automatically (merged from `session_capabilities` / `slash_commands`) and is **sent to claude verbatim**, running a real turn. **No registration needed — it just works.**

- **If it’s a brand-new name not yet in claude’s catalog and not local/hidden** → still `pass-through` by default, so it’s not silently swallowed; but at submit, once the catalog is populated, `isUnknownRemoteCommand()` flags it as a typo and shows an “Unknown command” alert instead of burning a turn.

- **To give it a native graphical surface** (like `/model`), it must be **registered** in three coordinated places: add to `LOCAL_SLASH_COMMANDS` (slash-commands.ts) → auto-becomes `supported-local`; wire a surface in `slashCommandSurfaces` in dev-card.tsx (compile-enforced exhaustive map).

- **To hide/swallow it** (like `/goal`) → add the bare name to `HIDDEN_SLASH_COMMANDS` (slash-supported.ts) and mirror it in `tuglaws/dev-card-unsupported-slash-commands.md`.

**Overall interception verdict:** tugcode forwards verbatim; **tugdeck is the sole interceptor** — local commands are dispatched to surfaces, hidden commands are swallowed with a notice, and only pass-throughs actually reach claude.




-----------------------------------


I have a complete picture. Here are my findings.

## Summary

Tugcode is a thin, faithful bridge: it forwards user input verbatim to `claude` over stream-json stdin and forwards claude’s tool/permission requests verbatim to the deck. It applies **no slash-command filtering and no tool allowlist**. Notably, the codebase already has a fully-built “wake” subsystem for scheduled/deferred re-invocation (Monitor, CronCreate, **ScheduleWakeup**), so an unknown tool named `ScheduleWakeup` is not unknown here at all — it is a first-class, expected case.

### (1) Slash commands / skills — how forwarded, any allow/block list

- **Forwarded verbatim as plain user content.** `SessionManager.handleUserMessage` — `/Users/kocienda/Mounts/u/src/tugtool/tugcode/src/session.ts:5895-5991`. The inbound `user_message`’s `content` blocks are serialized straight into a `{type:"user", message:{role:"user", content}}` JSON line and written to claude’s stdin (lines 5931-5947). A typed `/foo` is just user text; tugcode does no slash detection, rewriting, or gating. Claude CLI itself interprets slash commands.

- **No supported/blocked slash-command list exists in tugcode.** There is only a *catalog* used to populate the `/` popup and to validate typed plugin commands, not a blocklist:

- `capabilities.ts` parses the `slash_commands`/`commands` catalog from claude’s `system:init` (`/Users/kocienda/Mounts/u/src/tugtool/tugcode/src/capabilities.ts:84-136`) and merges plugin commands enumerated from disk (`enumeratePluginCommands` / `mergePluginCommands`, lines 204-297) so plugin commands work before claude has loaded `--plugin-dir` (see rationale at lines 187-203).

- `protocol-types.ts:17` types `slash_commands` on the init message.

- Slash-command *output* is handled specially only on the read path (synthesizing text blocks from `<local-command-stdout>` / `<local-command-stderr>`): `session.ts:1592-1616` and `session.ts:1678-1707`.

- Skills catalog: `/Users/kocienda/Mounts/u/src/tugtool/tugcode/src/skills-inventory.ts` (queried via the `skills_inventory_query` verb, `inbound-dispatch.ts:169`). Again a catalog, not a gate.

### (2) Timers / scheduled re-invocation / background / cron / wakeup

This is a mature, load-bearing subsystem — not a gap.

- **Wake data model:** `WakeStarted` IPC frame — `/Users/kocienda/Mounts/u/src/tugtool/tugcode/src/types.ts:1028-1039` (doc 1002-1027). It signals “claude is resuming from idle in response to a deferred-completion tool’s async event (Monitor timing out, a cron job firing, a wakeup arriving) — without a preceding user submission.”

- **Protocol source event:** `SystemTaskNotificationMessage` — `/Users/kocienda/Mounts/u/src/tugtool/tugcode/src/protocol-types.ts:28-57`, explicitly enumerating `Monitor, CronCreate, ScheduleWakeup, PushNotification, RemoteTrigger, TaskOutput` as the deferred-completion tools that fire it. Line 41-45 note that active-polling tools (`Bash`/`Agent` with `run_in_background:true`) do NOT fire this — they use task_started/updated/status.

- **Two wake cohorts, both in** **`session.ts`****:**

- **Cohort A** (`handleTaskNotification`, `session.ts:4986-5001`): on a `system/task_notification` between turns, build a `wake_started` frame (`buildWakeStartedMessage`, `session.ts:977-1000`), emit it, set `isInWake`, and open a fresh `ActiveTurn` so the wake’s stream events route.

- **Cohort B** (`handleWakeReInit`, `session.ts:5021-5043`): the harness’s built-in scheduler fires a `ScheduleWakeup`/`CronCreate` timer and re-brackets with a fresh `system/init`; detected in `handleClaudeLine` at `session.ts:4721-4751` by distinguishing a between-turn re-init (`activeTurn === null` → wake) from a mid-turn compact re-init. Synthesizes a `wake_started` with `summary: "scheduled wake"`.

- **Bracket close:** implicit — the wake turn’s terminal `result` clears `activeTurn` and `isInWake` (`session.ts:4777-4785`); no separate `wake_complete` frame.

- **Background-agent tailers (the closest thing to a real local timer):** `/Users/kocienda/Mounts/u/src/tugtool/tugcode/src/subagent-tail.ts` polls a background agent’s output file with `setInterval` (lines 98, 115-116, 165-167). Pulse uses a flush `setInterval` at `pulse/main-pulse.ts:93`.

- **Empirical captures & tests:** `/Users/kocienda/Mounts/u/src/tugtool/tugcode/probes/wake-investigation/` (capture-cron-1m, capture-sw-60, resume captures); tests `wake-reinit.test.ts`, `wake-reinit-drift.test.ts` (Cohort B ScheduleWakeup + CronCreate wire captures), `wake-sdk-drift.test.ts`, `replay-wake-bracket.test.ts`. Design refs cite `roadmap/tugplan-dev-session-wake.md` (referenced from `replay.ts:651`, `session.ts:4776`) though that file was not found at the current path — likely archived under `roadmap/archive/`.

### (3) How a turn starts / ends

- **User-initiated turn start:** inbound `user_message` → `main.ts:407` (`sessionManager.handleUserMessage`). `handleUserMessage` (`session.ts:5895`) awaits the readiness gate (`claudeReadyPromise`, 5907-5909), writes the user content to claude stdin (5936-5947), and — if idle and nothing queued — installs an `ActiveTurn` and awaits `turn.completion` (`session.ts:5976-5985`). If a turn is already in flight, it queues into `pendingTurnInputs` (5986-5990) and the stdout drain opens the follow-on turn via `openTurnFromPending` (`session.ts:4759-4761`).

- **Non-user turn starts:** wake (§2) opens an `ActiveTurn` with empty content (`session.ts:5000`, `5042`); orphan/`--continue`/`/compact` continuations use `assistant_opener` (types.ts:1041+).

- **Turn end:** the drain in `handleClaudeLine` dispatches each claude event via `dispatchEventToTurn`; claude’s `result` event latches `turn.gotResult` (`session.ts:5435-5436`) and the `result`-bounded close at `session.ts:4762-4793` flushes activity, clears `activeTurn`, clears `isInWake`, and schedules any `/rewind` retraction. `turn_complete` frames are emitted around `session.ts:5507-5511` / `5802-5805`. `ActiveTurn` is defined at `session.ts:2138+`.

### (4) Tool calls → deck: allowlists, canUseTool, permissions; would `ScheduleWakeup` pass or fail?

- **No tool allowlist/denylist at the tugcode boundary.** The claude spawn args (`buildClaudeArgs`, `session.ts:849-895`) contain `--permission-prompt-tool stdio` and `--permission-mode`, but **no** **`--allowedTools`****/****`--disallowedTools`**. Confirmed by grep (zero hits repo-wide in tugcode).

- **Permission path (****`canUseTool`****):** claude emits a `control_request` with `subtype:"can_use_tool"` (typed at `protocol-types.ts:122-134`). Tugcode handles it at `session.ts:5365-5428`:

- It reads `tool_name` generically — **no name whitelist**. Any tool name is accepted.

- `bypassPermissions` mode auto-allows (except `AskUserQuestion`) via `formatPermissionAllow` and never forwards (`session.ts:5384-5397`).

- Otherwise it stores the request in `pendingControlRequests` and emits a `control_request_forward` to the deck carrying `tool_name`, `input`, `decision_reason`, `permission_suggestions`, `blocked_path`, `tool_use_id`, `is_question` (`session.ts:5399-5424`).

- The deck’s answer returns via `handleToolApproval` (`session.ts:6012+`), formatted with `behavior:"allow"/"deny"` per PN-1 in `control.ts:56-98`.

- **So** **`ScheduleWakeup`** **(or any unknown tool) passes through tugcode unconditionally.** There is no code path where an unrecognized tool name fails or is dropped at the bridge. In fact `ScheduleWakeup` is an *expected harness tool* (see §2). It normally executes without a `can_use_tool` prompt (harness-owned) and surfaces as a wake, not a permission dialog.

- **Deck-side handling (for completeness):** `/Users/kocienda/Mounts/u/src/tugtool/tugdeck/src/components/tugways/cards/dev-tool-visibility-policy.ts` classifies tool names into bespoke / hidden / default-intent. `ScheduleWakeup` is explicitly in the **hidden** bucket (`schedulewakeup`, line 181; doc lines 24-27) → routed to `NullToolBlock`, paints no ink, and `detectToolCallDrift` suppresses its `unknown_tool` caution. A *genuinely* unknown tool falls back to `DefaultToolBlock` (JsonTree) **and** raises a non-fatal `unknown_tool` caution (`dev-assistant-renderer-dispatch.ts:42-62, 217`) — it renders, it does not fail.

**Bottom line for a new** **`ScheduleWakeup`****-like tool:** at the tugcode layer it would flow through untouched (no allowlist to update, `can_use_tool` forwards generically, and the wake subsystem already brackets the resulting re-invocation). The only place that “knows” tool names is the deck’s cosmetic visibility policy, where unknowns render via the JSON-tree fallback with a soft caution rather than failing.