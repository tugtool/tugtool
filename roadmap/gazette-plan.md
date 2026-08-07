<!-- devise-skeleton v4 -->

## The Gazette — Reporter, Operator, and the Gazette card {#gazette}

**Purpose:** Ship the app-wide Gazette channel decided in [roadmap/feed-brief.md](feed-brief.md): a Reporter that narrates session work into a durable three-author transcript, an Operator that answers questions about it from Tug's ground-truth ledgers, and a sidebar Gazette card that renders the channel and hosts the question box.

**Naming note (supersedes the brief's names):** the brief calls the feature "the Feed" and the posting agent "the Herald". Both were renamed after the brief was written: the feature and card are the **Gazette**; the posting agent is the **Reporter**. The Operator keeps its name. Wherever the brief says Feed/Herald, read Gazette/Reporter; this plan uses only the new names.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-08-07 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The design is settled in [roadmap/feed-brief.md](feed-brief.md) and validated by the 2026-08-06 replay spike: Rust wakes the Reporter on cheap structural moments (turn end, sitrep timer, session end, thresholds), a Sonnet job decides editorially whether and what to post, and "post nothing" is a first-class output. The Operator is a plan/execute/answer pipeline over a table of read-only verbs executed Rust-side. Both personas ride one new Sonnet `AgentSpec` on the existing SharedAgent pool — zero new process-supervision machinery.

The two prerequisites this plan was waiting on are now met: the sidebar taxonomy from `roadmap/layouts-rework-plan.md` has landed on main (commit `0da731033` — `layoutRole: "sidebar"`, registry-driven Layouts controls, side toggles, stacked rails), and the reserved `TUG_FEED = 0x70` FeedId is confirmed consumer-free. One calibration note from the user: the spike's observed cadence of one post per ~5–7 minutes of active work (4-minute sitrep timer) reads as **too slow** — so this plan ships a faster default and makes every cadence number a runtime-tunable knob ([P05]).

#### Strategy {#strategy}

- Build bottom-up along the data path: protocol bytes → ledger table → agent jobs → the pure wake core → the **calibration harness** (before any live bridge, per the brief) → the live Reporter bridge → the Operator pipeline → the deck store → the card → chip actions.
- Keep the wake/segmentation/composition logic a **pure module** shared verbatim by the offline harness and the live bridge, so what the harness tunes is what production runs.
- Inherit, don't invent: the tap and mute machinery mirrors `feeds/pulse.rs`; the pool and job table mirror `shared_agent.rs`; the deck store mirrors `lib/pulse-store.ts`; the card registration mirrors `jots-card-registration.tsx`; the upstream transport mirrors `SHELL_OUTPUT`/`SHELL_INPUT`.
- Every cadence and sizing number is a tugbank default read through a closure at use time, so tuning never needs a restart ([P05]).
- Isolation invariants from the brief are enforced by construction and pinned by tests: the Gazette's own frames never enter the Reporter's tap, and nothing in the subsystem writes toward any work session ([P12]).

#### Success Criteria (Measurable) {#success-criteria}

- `just gazette-replay <session.jsonl>` renders the gazette the Reporter would have posted for a real transcript, with wake counts, silence counts, and per-post wake reasons visible in the output (run it on the two spike sessions; read the posts).
- With a live session doing real work, Reporter posts appear in the Gazette card within one sitrep interval of activity, each carrying a `session_id` and only refs whose targets appear verbatim in the buffered context (verified by the `r02` validation test and by reading live posts).
- Asking the Operator the brief's worked example shape ("what's the CSS file we edited yesterday that changed the border color") produces an answer post that cites `changes.for_path` + `git.show` results, within two retrieval rounds (manual acceptance; the round cap is unit-tested).
- The Gazette card registers as a sidebar card and the Layouts section shows its side control with **no Layouts-section code change** (the registry-driven `sidebarEntries()` walk picks it up — verify by opening the Lens).
- An idle session produces zero wakes (unit test on the wake core); a reconnect replay flood produces zero posts (mute-bracket unit test).
- `cd tugrust && cargo nextest run -p tugcast -p tugcast-core` green; `cd tugdeck && bun test && bun run check && bunx vite build` green; `just app-test-changed` green.

#### Scope {#scope}

1. Protocol: reclaim `0x70` as `GAZETTE`, add `GAZETTE_INPUT = 0x71` (Rust + TS mirrors).
2. Persistence: uncapped `gazette_posts` table in the per-instance session ledger, with tail/search/window reads.
3. One Sonnet `AgentSpec` ("gazette") with jobs `reporter-post`, `operator-retrieve`, `operator-answer`.
4. The pure Reporter wake core (buffers, wake reasons, input composition, envelope parsing).
5. The offline calibration harness (`gazette-replay`) — built before the live bridge.
6. The live Reporter bridge (tap → buffer → wake → post), with tugbank knobs.
7. The Operator pipeline (GAZETTE_INPUT adapter, verb executor, two-round retrieval loop).
8. Deck: `gazette-store.ts`, the Gazette sidebar card (transcript + composer), toggle command + menu row, ref chips.
9. Tests at every layer, including app-tests with `@covers`.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Cross-session digest posts (posts are per-session; interleaving is the feature).
- Conversational Operator memory (each question is self-contained; multi-turn follow-up is a redesign away from SharedAgent, deliberately deferred — brief [P05]-equivalent).
- Any change to Pulse; neither subsystem consumes the other.
- The archived hooks-based tug-feed (`roadmap/archive/tug-feed.md`): no hook capture, no `.tugtool/feed/feed.jsonl`, no plan-step correlation.
- The Gazette as a control surface: nothing here writes toward a work session.
- Narrating work done outside any session.

#### Dependencies / Prerequisites {#dependencies}

- `roadmap/layouts-rework-plan.md` landed on main (commit `0da731033`) — sidebar taxonomy, Layouts section, side toggles. **Met.**
- `FeedId::TUG_FEED = 0x70` consumer-free (`tugrust/crates/tugcast-core/src/protocol.rs`, `tugdeck/src/protocol.ts`; only name-map + byte-test references). **Verified 2026-08-07.**
- SharedAgent pool machinery (`tugrust/crates/tugcast/src/shared_agent.rs`) — a second `AgentSpec` is a value, not new machinery (pinned by its test `a_second_agent_spec_runs_on_the_same_pool_machinery`).
- Real session JSONL under `~/.claude/projects/` for the calibration harness.

#### Constraints {#constraints}

- `-D warnings` across the Rust workspace; `cargo nextest run` is the test runner.
- Writable ledger opens go through `tugcore::ledger_db` (enforced by `no_ad_hoc_ledger_opens`). The `gazette_posts` table lives in the per-instance sessions ledger, **not** shared `changes.db`, so `CHANGES_SCHEMA_VERSION` is untouched.
- App-tests must stay free/fast/deterministic: the SharedAgent pool is already gated under `TUGAPP_APP_TEST=1` (`app_test_gated()` in `shared_agent.rs`), so no Reporter or Operator model call can occur in an app-test instance.
- tugdeck laws: [L01] one render, [L02] external state via `useSyncExternalStore`, [L06] appearance via CSS/DOM, [L03]/[L22] registrations in `useLayoutEffect`. Persistent deck state goes through tugbank defaults, never Web storage.
- The Gazette card must be registered unconditionally at boot **before** layout restore (`filterRegisteredCards` drops panes whose componentId is unregistered — the invariant documented in `jots-card-registration.tsx`).

#### Assumptions {#assumptions}

- Sonnet ("sonnet" alias, per the `scribe_model` precedent in `main.rs`) is adequate for all three jobs; the spike validated `reporter-post` quality.
- The `CODE_OUTPUT` broadcast plus the code-submission channel (the pair `session_overview.rs` already taps via `SessionOverviewConfig { code_tx, submission_tx, … }`) carry everything the Reporter's diet needs; the exact allowlist is finalized in Step 6 ([Q02]).
- Megabyte-scale wake inputs are acceptable to Sonnet latency-wise because nothing user-blocking waits on `reporter-post`; the Operator jobs, which a user does wait on, have small inputs.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Names and toggle chord (DECIDED) {#q01-names-and-chord}

**Question:** What are the feature/card and posting-agent names, and which chord toggles the card?

**Why it matters:** Names permeate every identifier in this plan (protocol consts, table, jobs, modules, card id, action ids); a colliding chord fails the keymap drift tests.

**Resolution:** DECIDED 2026-08-07 with the user — the feature and card are the **Gazette** (the brief's "Feed" was judged weak); the posting agent is the **Reporter** (replacing "Herald", which collided with Gazette; Stringer/Correspondent/Crier/Chronicler were considered and rejected); the **Operator** name stays. The toggle chord is **⌃⌘G**, extending the sidebar-toggle grammar (⌃⌘L Lens, ⌃⌘J Jots). Verified free: `KeyG` appears in `command-registry.ts` only as ⌘G / ⇧⌘G (find next/previous); no ⌃⌘G binding exists there or in `at0168-menu-structure.test.ts`. See [P10].

#### [Q02] Exact Reporter tap allowlist (DEFERRED to Step 6) {#q02-reporter-allowlist}

**Question:** Which frame types cross into the Reporter's buffer?

**Why it matters:** Too little and posts lose specificity (no commit SHAs, no test totals); too much and wake inputs bloat.

**Plan to resolve:** Start from `PULSE_FORWARD_ALLOWLIST` (`feeds/pulse.rs`) plus user submissions from the code-submission channel and `turn_complete` usage fields; iterate with the Step 5 harness, finalize in Step 6. The brief explicitly anticipates this ("finalized during implementation against the wake/rubric needs").

**Resolution:** DEFERRED — resolved empirically by the calibration harness before the live bridge lands.

#### [Q03] Where do git-verbs run when a question names no session? (DECIDED) {#q03-git-cwd}

**Question:** `git.log`/`git.show`/`repo.grep` need a repo cwd; gazette hits give a `session_id`, but a cold question may not.

**Resolution:** DECIDED — verbs accept an optional `session_id` argument; when present the project dir resolves via `SessionLedger::get(session_id).project_dir`, otherwise the bootstrap workspace's `project_dir` (the `--source-tree` dir `main.rs` resolves at startup). Same fallback shape as the `GIT_LOG_QUERY` adapter in `main.rs`. See [P07].

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Reporter cadence feels wrong (too chatty / too slow) | med | med | every number is a tugbank knob ([P05]); harness built first ([P09]) | user annoyance either direction |
| Refs invented by the model (dead chips) | med | low | Rust-side verbatim validation drops unverifiable refs ([R02]) | a dropped-ref warn rate that suggests over-validation |
| Operator latency exceeds patience | med | med | bounded rounds + per-verb caps + pending-state UI; job timeouts in the spec ([P07]) | answers routinely hitting the 2-round cap |
| Wake input exceeds worker turn budget | low | med | buffer frame/byte caps with elision markers ([P04]); generous `reporter-post` timeout | harness shows truncation destroying post quality |
| All three gazette jobs share one `JobClass` lane (an Operator answer can queue behind a Reporter post) | low | med | `max_workers` default 2 lets the pool grow; knob to raise it | measured queueing in `shared agent call` logs |

**Risk R01: Rubric drift between harness and production** {#r01-rubric-drift}

- **Risk:** The harness tunes a prompt/segmentation that production doesn't actually run.
- **Mitigation:** One pure module ([P04]) supplies segmentation + composition to both; the `reporter-post` instructions are a single `&'static str` both call through `SharedAgentPool::run`.
- **Residual risk:** Live timing (real inter-frame gaps) differs from replay pacing; the sitrep knob absorbs this.

**Risk R02: A summarized-away SHA can't be linked** {#r02-refs-verbatim}

- **Risk:** Refs whose targets never appeared in the buffered context are hallucinations and make dead provenance chips.
- **Mitigation:** The bridge validates each ref's `target` is a substring of the wake's buffered context; failures are dropped from the post with a `tracing::warn!`. The buffer preserves paths and SHAs verbatim (frames cross as raw payload text, not paraphrase).
- **Residual risk:** A legitimate ref phrased differently than the buffer (e.g. abbreviated SHA) is dropped; acceptable v1 — the post body still reads fine.

---

### Design Decisions {#design-decisions}

#### [P01] GAZETTE 0x70 downstream, GAZETTE_INPUT 0x71 upstream (DECIDED) {#p01-transport}

**Decision:** Rename `FeedId::TUG_FEED` → `FeedId::GAZETTE` (byte 0x70 kept, wire name `"Gazette"`), and add `FeedId::GAZETTE_INPUT = 0x71` (`"GazetteInput"`) for deck → tugcast user posts/questions.

**Rationale:**
- The brief reclaims 0x70; the sibling-input shape follows the `SHELL_OUTPUT` (0x60) / `SHELL_INPUT` (0x61) precedent exactly, and `register_input` is the established upstream mechanism (`feed_router.register_input(FeedId::USAGE_QUERY, …)` in `main.rs`).
- A bidirectional single id would be the only one of its kind on the wire; the sibling costs one byte and zero novelty.
- `GAZETTE` also avoids the near-collision a `FeedId::FEED` would have created in a codebase where "feed" already means *any* channel (`FeedId`, `StreamFeed`).

**Implications:** Edits in `tugrust/crates/tugcast-core/src/protocol.rs` (const at the `TUG_FEED` site, `name()` arm, byte test) and the TS mirror `tugdeck/src/protocol.ts`; the "reserved for Phase T3+" comment retires.

#### [P02] gazette_posts lives uncapped in the per-instance session ledger (DECIDED) {#p02-ledger-table}

**Decision:** One `gazette_posts` table in the sessions ledger (`SessionLedger::initialize_schema`, next to `pulse_lines`), append-only and **uncapped**, with **no session cascade trigger**.

**Rationale:**
- The brief requires the Pulse *scoping* (app-scoped, one per tugcast instance) but explicitly not the Pulse *cap* — history is the point.
- `pulse_lines` already documents the no-cascade posture ("the narrative log outlives any one session"); the Gazette's provenance links must survive session eviction the same way.
- A new database would need its own `ledger_db` open, writer lock, and janitor story for zero benefit; the sessions ledger already has all three.

**Implications:** New row struct `GazettePostRow` and APIs `record_gazette_post`, `list_gazette_posts_tail`, `search_gazette_posts`, `gazette_posts_window` in `session_ledger.rs`; an index on `(session_id)`; `refs` persisted as a JSON array string like `pulse_lines.scopes`.

#### [P03] One Sonnet AgentSpec, three fixed jobs (DECIDED) {#p03-agent-spec}

**Decision:** A second `SharedAgentPool` with `AgentSpec { name: "gazette", model: <closure>, jobs: GAZETTE_AGENT_JOBS, max_workers }`; jobs `reporter-post` (timeout 120s), `operator-retrieve` (30s), `operator-answer` (120s); model resolved per spawn from tugbank `dev.tugtool.gazette`/`model`, falling back to `"sonnet"`.

**Rationale:**
- Exactly the extension `shared_agent.rs` anticipates and tests (`a_second_agent_spec_runs_on_the_same_pool_machinery`).
- The `scribe_model` closure pattern in `main.rs` (falls back to `"sonnet"` by name) is the precedent the brief names for the model default.
- Cost is a declared non-concern; timeouts are quality ceilings, not budgets — nothing user-blocking waits on `reporter-post`, and the Operator jobs get a pending UI.

**Implications:** `JobClass::of` maps all three names to `Summarize` (its catch-all) — one latency lane, acceptable because no gazette job has a 2-second-class contract; the pool grows to `max_workers` (default 2, knob) when both personas are busy. New module `feeds/gazette_agent.rs` holds the job table and instruction strings.

#### [P04] Wake structurally in a pure core module (DECIDED) {#p04-wake-core}

**Decision:** All wake logic — per-session frame buffers, wake reasons, sitrep bookkeeping, job-input composition, and Reporter envelope parsing — lives in a pure, IO-free module `feeds/reporter_wake.rs`, consumed identically by the replay harness and the live bridge.

**Rationale:**
- The harness's entire value ([P09]) depends on tuning the exact code production runs (Risk R01).
- Pure functions make idle-never-wakes, buffer-caps, and envelope-strictness unit-testable without tokio plumbing.

**Implications:** The buffer caps frames (default 256) and bytes (~256 KB) per session, dropping oldest with an explicit `[earlier frames elided]` marker in composed input; the live bridge owns only tokio wiring (taps, timers, task spawns).

#### [P05] Every cadence number is a tugbank knob, read at use time (DECIDED) {#p05-knobs}

**Decision:** All tuning values live as tugbank defaults in domain `dev.tugtool.gazette`, read through closures per wake/spawn (never cached at startup): see Table T02. The sitrep default ships at **180 seconds** — deliberately faster than the spike's 4-minute timer, per the user's read that one post per ~5–7 minutes is too slow.

**Rationale:**
- The brief makes cadence "a prompt-tunable editorial policy"; the user explicitly asked to "retain tuning knobs that we can turn as we build this and start experiencing it".
- The mechanism (closure over `TugbankClient::get`, absent-reads-as-default) is exactly `pulse_enabled` / `scribe_model` in `main.rs`.

**Implications:** No restart needed for a knob change; the deck's render-window knob rides the DEFAULTS feed the way `pulse-store.ts` watches `dev.tugtool.pulse`/`enabled`.

#### [P06] The Reporter envelope is strict JSON; malformed output is silence (DECIDED) {#p06-envelope}

**Decision:** `reporter-post` must answer with exactly `{"post": null}` or `{"post": {"body": "...", "refs": [{"kind": "...", "target": "..."}]}}` (Spec S01). Anything unparseable, or any ref with an unknown `kind`, is logged and produces **no post** — never a repaired or partial one.

**Rationale:**
- Mirrors `handle_pulse_line`'s posture ("wire delivery and persistence must never panic on daemon output") and the classify `verdict()` posture (a malformed answer is a refusal, not a guess).
- "Post nothing" being first-class means silence is always a safe failure mode.

**Implications:** Strict serde types with `deny_unknown_fields`; a unit test walks malformed shapes.

#### [P07] Operator verbs execute Rust-side, read-only, capped (DECIDED) {#p07-verbs}

**Decision:** The model emits verb *requests* (Spec S02); a Rust executor in `feeds/operator.rs` runs them read-only with per-verb output caps and a 10s per-verb timeout; retrieval is hard-capped at **two rounds**, then `operator-answer` must answer with what it has.

**Rationale:** Direct from the brief — read-only-ness structural, the job table auditable, latency bounded, the exchange scorable later.

**Implications:** Verb table T01 is the contract; git verbs run `tokio::process::Command` in the project dir resolved per [Q03]; ledger verbs read `SessionLedger` (sessions, turns, file_events, gazette_posts). No verb touches the filesystem outside `git`/`git grep` in a resolved project dir.

#### [P08] User posts echo through the ledger first; transient Operator errors don't persist (DECIDED) {#p08-user-echo}

**Decision:** A `GAZETTE_INPUT` submission is persisted as a `user` post and broadcast **before** the Operator pipeline runs. If the pipeline fails (pool unavailable, timeout), the bridge broadcasts a transient `operator` post with `"transient": true` that is **not** written to the ledger.

**Rationale:**
- The user's question is history (the Operator queries scrollback context from the ledger); an infrastructure hiccup is not.
- Persisting "shared agent unavailable" rows would pollute `gazette.search` forever.

**Implications:** The wire `GazettePost` payload has an optional `transient` flag the deck renders but the ledger writer refuses; the `request_id` from the submission is echoed on the answer/error broadcast (never persisted) so the deck can clear its pending state.

#### [P09] The calibration harness is part of the feature and lands before the live bridge (DECIDED) {#p09-harness}

**Decision:** A `gazette-replay` binary in the tugcast crate (`src/bin/gazette_replay.rs`), driven by `just gazette-replay <jsonl> [flags]`, replays real session JSONL through the wake core + the real `reporter-post` job and renders the resulting gazette as markdown to stdout, with per-wake diagnostics (reason, buffer size, post-or-silence).

**Rationale:** Direct from the brief ("built first"); the spike validated the approach — this makes it a repeatable tool with the production wake core rather than a one-off script.

**Implications:** Flags override the knobs (`--sitrep-secs`, `--last-k`, `--model`); replay pacing is simulated from JSONL timestamps, not wall clock; it spawns real `claude` via `ClaudeAgentWorkerSpawner` and therefore never runs in CI or under `TUGAPP_APP_TEST`.

#### [P10] The Gazette card is a Jots-pattern sidebar singleton; ⌃⌘G toggles it (DECIDED) {#p10-card}

**Decision:** Register componentId `"gazette"` with `layoutRole: "sidebar"`, `family: "gazette"`, `acceptsFamilies: []`, `hidden: true`, `lensGroup: "none"`, sizePolicy min 320×240 / preferred 420×900 — the `registerJotsCard()` shape verbatim. Toggle via `TUG_ACTIONS.TOGGLE_GAZETTE`, chord ⌃⌘G ([Q01]), routing `"registry"`, with a native "Show Gazette" menu row in `tugapp/Sources/AppDelegate.swift` mirroring the Jots row (`identified("maker.gazette")`).

**Rationale:**
- The layouts-rework registry makes the Layouts section side control, rails, and equal-resize allocator free on registration (`sidebarEntries()` in `layouts-section.tsx` walks `getAllRegistrations()` filtering `layoutRole === "sidebar"`).
- The sidebar-toggle grammar (⌃⌘L / ⌃⌘J) extends naturally, and G is the feature's own initial; ⌃⌘G is verified unbound ([Q01]).

**Implications:** Boot registration in `main.tsx` unconditionally before layout restore (the Jots INVARIANT); `at0168-menu-structure.test.ts` fixture and `tuglaws/menus.md` table gain a row; no Layouts-section edits.

#### [P11] The deck gazette store mirrors pulse-store (DECIDED) {#p11-gazette-store}

**Decision:** A singleton `lib/gazette-store.ts`: on connect it fetches the tail via the app-scoped CONTROL verb `list_gazette_posts`, folds live `GAZETTE` frames, exposes a `useSyncExternalStore` hook, tracks pending question state by `request_id`, and submits user posts as `GAZETTE_INPUT` frames.

**Rationale:** `lib/pulse-store.ts` is the proven shape (CONTROL tail read on mount + live fold + DEFAULTS-feed knob watch); the CONTROL verb slot is `agent_supervisor.rs::handle_control` next to `"list_pulse_lines"`.

**Implications:** The card renders the store's window (default 50 rows, knob `card_rows`); aging out is a render window, never a deletion; the store gets the same test-only frame-injection seam pulse-store has, which is what the app-test drives.

#### [P12] Isolation invariants, inherited and pinned (DECIDED) {#p12-isolation}

**Decision:** (a) Reporter/Operator/user posts travel only on `GAZETTE` and never enter the Reporter's tap (its inputs are the CODE_OUTPUT broadcast + submission channel + session-state frames — `GAZETTE` is not subscribed, so no feedback loop is constructible). (b) Nothing in the subsystem writes toward any work session: outputs are the ledger, the `GAZETTE` broadcast, and tracing. (c) Replay brackets mute exactly as in `feeds/pulse.rs::forwardable_session`; lagging receivers drop frames.

**Rationale:** Direct from the brief; both invariants are Pulse's law, already proven in `pulse.rs` and its tests.

**Implications:** The bridge holds no `code_submission_tx` *sender* toward sessions and no supervisor handle that can dispatch; a test asserts a `GAZETTE`-tagged frame never reaches the buffer.

---

### Deep Dives {#deep-dives}

#### Bridge topology {#bridge-topology}

```
CODE_OUTPUT broadcast ──allowlist tap──▶ per-session FrameBuffer ─┐
code submissions (user prompts) ──────▶ (same buffers)           ├─ wake decision ──▶ reporter-post job ──▶ envelope parse
SESSION_STATE frames (session end) ───▶ wake trigger ────────────┘        │                                    │
                                                                    "no wake"/silence               gazette_posts row + GAZETTE broadcast

GAZETTE_INPUT frame ──▶ persist user post + GAZETTE broadcast ──▶ operator-retrieve ──▶ verb executor ──▶ operator-answer
                                                                       ▲                     │ (≤2 rounds)      │
                                                                       └── optional follow-up verb list ────────┘
                                                                                            gazette_posts row + GAZETTE broadcast
```

The Reporter bridge is a `StreamFeed` (like `PulseBridge`): `feed_id() = FeedId::GAZETTE`, `channel_capacity() = 64`, default `Warn` lag policy, registered via `feed_router.register_stream_feed` in `main.rs`. It subscribes `code_tx` inside its task, receives submissions the way `session_overview_task` does (`SessionOverviewConfig` carries `submission_tx: code_submission_tx.clone()` — mirror that wiring), and watches session-state frames for session-end wakes. Each wake snapshots-and-clears that session's buffer and spawns a task running the job so a slow model turn never blocks the tap loop.

**Table T03: Wake reasons** {#t03-wake-reasons}

| Reason (wire string) | Trigger | Notes |
|---|---|---|
| `turn-end` | a `turn_complete`/`turn_cancelled` frame for the session | functions as a flush + "ready to look in" signal; the spike showed the timer dominates |
| `sitrep-timer` | ≥ `sitrep_secs` of continuous activity since the session's last post, with a non-empty buffer | an idle session (empty buffer) never wakes — silence isn't news |
| `session-end` | session-state frame reporting the session ended | the model writes wrap-up posts on this reason |
| `token-threshold` | cumulative turn-usage tokens since last post ≥ `token_wake_tokens` | knob default 0 = disabled |

#### The Operator's verb table {#verb-table}

**Table T01: Read-only verbs** {#t01-verbs}

All executed by `feeds/operator.rs`, all capped, all with a 10s timeout. `session_id` args resolve project dirs per [Q03].

| Verb | Args | Backing | Cap |
|------|------|---------|-----|
| `gazette.search` | `query`, opt `since_ms`/`until_ms`/`author`/`session_id` | `search_gazette_posts` (SQL LIKE over body+refs) | 20 posts, 240-char excerpts |
| `gazette.window` | `post_id`, `n` | `gazette_posts_window` | n ≤ 10 each side |
| `sessions.list` | opt date range, opt `active` | `sessions` table (`list_*` reads) | 50 rows: id, name/last_user_prompt incipit, created/last-used, state |
| `session.prompts` | `session_id`, opt `query` | `turns` table (`user_text`, `created_at`) | 50 prompts, 500 chars each |
| `changes.for_session` | `session_id` | `changes.file_events` by `tug_session_id` | 200 rows: path, op, origin |
| `changes.for_path` | `pattern`, opt date range | `changes.file_events` by path LIKE | 200 rows + owning session ids |
| `git.log` | opt `grep`, `pickaxe`, `path`, `since`/`until`, `n`, `session_id` | `git log` subprocess | n ≤ 30: sha, date, subject, files |
| `git.show` | `sha`, opt `path`, opt `session_id` | `git show` subprocess | message + diff capped 400 lines / 16 KB |
| `repo.grep` | `pattern`, opt `path_scope`, opt `session_id` | `git grep -n -I` subprocess | 100 matches |

`changes.for_session`/`changes.for_path` need two small new read APIs in `session_ledger.rs` (the write side and `file_event_spans_for_paths` exist; a by-session and a by-path-pattern row read do not).

#### Knobs {#knobs}

**Table T02: tugbank defaults, domain `dev.tugtool.gazette`** {#t02-knobs}

| Key | Type | Default | Read by | Meaning |
|---|---|---|---|---|
| `enabled` | bool | `true` | bridge, per frame | kill switch; disabled drops frames and wakes nothing (the `pulse_enabled` posture) |
| `model` | string | `"sonnet"` | pool, per spawn | model for all three jobs |
| `max_workers` | i64 | 2 | pool construction | worker cap for the gazette pool |
| `sitrep_secs` | i64 | **180** | bridge, per timer arm | the dominant cadence — deliberately under the spike's 240s |
| `last_k_posts` | i64 | 5 | bridge, per wake | how many of the Reporter's own prior posts for the session ride the wake input (the dedup mechanism) |
| `token_wake_tokens` | i64 | 0 (off) | bridge, per turn-complete | token-threshold wake |
| `buffer_max_frames` | i64 | 256 | wake core, per push | per-session buffer frame cap (byte cap fixed ~256 KB) |
| `card_rows` | i64 | 50 | deck gazette-store via DEFAULTS feed | render window; never a deletion |

---

### Specification {#specification}

**Spec S01: Reporter job I/O** {#s01-reporter-envelope}

Input (composed by the wake core, one self-contained turn per [shared-agent P05]): the wake reason string, the session id, the session's buffered frames rendered as JSONL lines (verbatim payloads, oldest first, elision marker when capped), and the Reporter's last K posts for that session as `- [at_ms] body` lines. The instructions carry the editorial rubric from the brief (§"The editorial rubric") and the output contract:

```json
{"post": null}
{"post": {"body": "…digest-sized write-up…", "refs": [{"kind": "commit", "target": "0da731033"}]}}
```

`kind ∈ session|file|commit|plan|brief`; strict parse, `deny_unknown_fields`; unparseable ⇒ no post ([P06]); each ref's `target` must appear verbatim in the buffered context or the ref is dropped with a warn ([R02] — `session` refs are exempt: the bridge stamps `session_id` itself).

**Spec S02: Operator job I/O** {#s02-operator-envelope}

`operator-retrieve` input: the question + the last 20 gazette posts (server-side scrollback from the ledger). Output: `{"verbs": [{"verb": "gazette.search", "args": {…}}, …]}` — ≤ 6 invocations. `operator-answer` input: question + scrollback + all verb results as labeled JSON blocks. Output: either `{"answer": {"body": "…", "refs": […]}}` or `{"verbs": […]}` (one follow-up round). After round 2 the executor re-runs `operator-answer` with a "you must answer now; say what you could not confirm" addendum. Malformed output ⇒ transient error post ([P08]).

**Spec S03: Wire GazettePost payload (GAZETTE frames, and the CONTROL tail read)** {#s03-wire-post}

```json
{"id": 42, "at_ms": 1754500000000, "author": "reporter", "session_id": "abc…", "wake_reason": "sitrep-timer", "body": "…", "refs": [{"kind": "file", "target": "tugdeck/src/x.css"}], "request_id": "…", "transient": false}
```

`author ∈ reporter|operator|user`. `id` is the ledger rowid (absent on transient posts); `request_id` only on Operator answers/errors responding to a `GAZETTE_INPUT` carrying one; `transient: true` never persisted. `GAZETTE_INPUT` payload: `{"body": "…", "request_id": "…"}`. TS types live in `tugdeck/src/protocol.ts` or a `lib/gazette-types.ts` beside the store.

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| gazette posts window + pending question | external app data | `GazetteStore` singleton + `useSyncExternalStore` | [L02] |
| composer document | editor substrate | CM6 via `TugMessageEditor` (mirrored out imperatively, never a controlled value) | [L02], [L11] |
| rail visibility / side / width | deck structure | existing deck store imposition (`sidebars` record) — no new state | [L02] |
| post hover/expand affordances | appearance | CSS `:hover` / data-attributes | [L06] |
| responder + command registrations | registration | `useLayoutEffect` / `useResponder` | [L03], [L22] |
| render-window size (`card_rows`) | persistent preference | tugbank DEFAULTS feed (never Web storage) | — |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugrust/crates/tugcast/src/feeds/reporter_wake.rs` | pure wake core: `FrameBuffer`, `WakeReason`, `compose_reporter_input`, `ReporterEnvelope` parse, ref validation |
| `tugrust/crates/tugcast/src/feeds/reporter.rs` | live bridge: `ReporterBridge` (`StreamFeed`), taps, sitrep timers, knob closures, ledger write + broadcast |
| `tugrust/crates/tugcast/src/feeds/gazette_agent.rs` | `GAZETTE_AGENT_JOBS`, instruction strings (rubric, retrieve, answer), knob key consts, `dev.tugtool.gazette` domain const |
| `tugrust/crates/tugcast/src/feeds/operator.rs` | `GAZETTE_INPUT` handling, verb executor, two-round pipeline, transient error posts |
| `tugrust/crates/tugcast/src/bin/gazette_replay.rs` | calibration harness binary ([P09]) |
| `tugdeck/src/lib/gazette-store.ts` (+ `__tests__`) | [P11] store |
| `tugdeck/src/lib/gazette-card-id.ts` | `GAZETTE_CARD_ID = "gazette"` |
| `tugdeck/src/components/gazette/gazette-card-registration.tsx` | [P10] registration |
| `tugdeck/src/components/gazette/gazette-card.tsx` + `gazette-card.css` | transcript + composer UI |
| `tests/app-test/at0xxx-gazette-card.test.ts` | app-test with `@covers` (number assigned at authoring) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `FeedId::GAZETTE`, `FeedId::GAZETTE_INPUT` | const | `tugcast-core/src/protocol.rs` | [P01]; rename of `TUG_FEED`, new 0x71; `name()` arms; byte tests |
| `GAZETTE`, `GAZETTE_INPUT` | const | `tugdeck/src/protocol.ts` | TS mirror |
| `GazettePostRow`, `record_gazette_post`, `list_gazette_posts_tail`, `search_gazette_posts`, `gazette_posts_window` | struct/fns | `tugcast/src/session_ledger.rs` | [P02] |
| `list_file_events_for_session`, `list_file_events_for_path_pattern` | fns | `tugcast/src/session_ledger.rs` | backing for T01 change verbs |
| `"list_gazette_posts"` arm + `do_list_gazette_posts` | control verb | `tugcast/src/feeds/agent_supervisor.rs` | beside `"list_pulse_lines"` |
| gazette pool + bridge + adapter wiring | wiring | `tugcast/src/main.rs` | pool construction beside `haiku_agent`; `register_stream_feed(ReporterBridge…)`; `register_input(FeedId::GAZETTE_INPUT, …)` |
| `TUG_ACTIONS.TOGGLE_GAZETTE` + command entry + dispatch handler | action | `action-vocabulary.ts`, `command-registry.ts`, `action-dispatch.ts` | mirror `TOGGLE_JOTS` exactly; chord ⌃⌘G |
| "Show Gazette" menu row | Swift | `tugapp/Sources/AppDelegate.swift` | mirror the "Show Jots" row (`identified("maker.gazette")`); update `at0168-menu-structure.test.ts` + `tuglaws/menus.md` |
| `gazette-replay` recipe | just | `justfile` | wraps the binary |

---

### Documentation Plan {#documentation-plan}

- [ ] `tuglaws/menus.md`: row for the "Show Gazette" menu item (`maker.gazette` / `toggle-gazette`) — Step 10.
- [ ] Module doc comments carry the doctrine (reporter.rs topology header modeled on pulse.rs's; gazette_agent.rs knob table) — no freestanding docs/*.md dropfiles.
- [ ] `roadmap/feed-brief.md` stays as-is (the decided design); this plan's naming note is the bridge from the brief's Feed/Herald vocabulary.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (Rust)** | wake core (idle-never-wakes, caps, envelope strictness, ref validation), ledger APIs, verb caps, round cap, mute brackets, isolation | bulk of coverage; fake spawner scripts model answers, never asserts prose |
| **Unit (deck)** | gazette-store fold/tail/pending, registration invariants | `bun test` |
| **Integration (Rust)** | bridge task with `FakeSpawner`-style scripted pool: frame in → post out; GAZETTE_INPUT → user echo + answer post | tokio tests mirroring `pulse.rs` tests |
| **App-test** | rail toggles, rows render from injected frames, composer submits | one file, `@covers` |
| **Real-model** | one `#[ignore]` + `TUG_REAL_CLAUDE=1` test running a real `reporter-post` turn (envelope parses) — the `a_real_worker_answers…` pattern | on demand |

#### What stays out of tests {#test-non-goals}

- Model prose quality — that is the calibration harness's business, read by a human.
- jsdom render tests and mock-store assertion tests — banned pattern; UI coverage is the app-test on the real app.
- End-to-end Operator answer quality — manual acceptance against the worked example; the corpus-scoring harness is a follow-on.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** Rust checkpoints run from `tugrust/`; deck checkpoints from `tugdeck/`.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Protocol: GAZETTE + GAZETTE_INPUT | pending | — |
| #step-2 | Ledger: gazette_posts | pending | — |
| #step-3 | Gazette AgentSpec + jobs | pending | — |
| #step-4 | Pure Reporter wake core | pending | — |
| #step-5 | Calibration harness | pending | — |
| #step-6 | Live Reporter bridge | pending | — |
| #step-7 | Operator verb executor | pending | — |
| #step-8 | Operator pipeline + GAZETTE_INPUT | pending | — |
| #step-9 | Deck gazette-store | pending | — |
| #step-10 | Gazette card + toggle + menu | pending | — |
| #step-11 | Ref chip actions | pending | — |
| #step-12 | App-test + doc rows | pending | — |
| #step-13 | Integration checkpoint | pending | — |

#### Step 1: Protocol — reclaim 0x70, add GAZETTE_INPUT {#step-1}

**Commit:** `tugcast-core(protocol): reclaim 0x70 as GAZETTE, add GAZETTE_INPUT 0x71`

**References:** [P01] transport, (#bridge-topology)

**Artifacts:** renamed `FeedId::GAZETTE`, new `FeedId::GAZETTE_INPUT`, TS mirror.

**Tasks:**
- [ ] In `tugrust/crates/tugcast-core/src/protocol.rs`: rename `TUG_FEED` → `GAZETTE` at the 0x70 const (retire the "reserved for Phase T3+" comment; document the channel), add `GAZETTE_INPUT = Self(0x71)`; update both `name()` arms (`"Gazette"`, `"GazetteInput"`) and the byte-value test.
- [ ] Mirror in `tugdeck/src/protocol.ts` (`TUG_FEED: 0x70` → `GAZETTE: 0x70`, add `GAZETTE_INPUT: 0x71`); fix any TS references to the old name.

**Tests:**
- [ ] Byte-value test asserts `GAZETTE == 0x70`, `GAZETTE_INPUT == 0x71`.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast-core`
- [ ] `cd tugdeck && bun run check`

---

#### Step 2: Ledger — gazette_posts table + reads {#step-2}

**Commit:** `tugcast(ledger): uncapped gazette_posts table with tail/search/window reads`

**References:** [P02] ledger table, Spec S03, Table T01 (gazette verbs), (#p02-ledger-table)

**Artifacts:** `gazette_posts` DDL in `initialize_schema` (columns: `id` PK autoincrement, `at_ms`, `author`, `session_id` NULLable, `wake_reason` NULLable, `body`, `refs` JSON text); `GazettePostRow`; `record_gazette_post`, `list_gazette_posts_tail(limit)` (newest-limit oldest-first, the `list_pulse_lines_tail` shape), `search_gazette_posts(query, filters, limit)`, `gazette_posts_window(id, n)`; index on `session_id`. Also the two file-event reads (`list_file_events_for_session`, `list_file_events_for_path_pattern`) T01 needs.

**Tasks:**
- [ ] DDL next to `pulse_lines` in `session_ledger.rs`, with the same deliberate-no-cascade comment posture; **no cap** and no pruning anywhere.
- [ ] Author enforcement in Rust (`reporter|operator|user`), refs serialized like `pulse_lines.scopes`.
- [ ] `search_gazette_posts`: LIKE over `body` and `refs`, optional `author`/`session_id`/`at_ms` range, newest-first, capped.

**Tests:**
- [ ] Round-trip, tail ordering, search filters, window bounds, survival of a `sessions` row DELETE (no cascade).

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast session_ledger`

---

#### Step 3: Gazette AgentSpec + job table {#step-3}

**Commit:** `tugcast(gazette-agent): Sonnet gazette AgentSpec with reporter-post and operator jobs`

**References:** [P03] agent spec, [P05] knobs, Spec S01, Spec S02, Table T02, (#p03-agent-spec)

**Artifacts:** `feeds/gazette_agent.rs` with `GAZETTE_DOMAIN = "dev.tugtool.gazette"`, knob key consts (Table T02), `GAZETTE_AGENT_JOBS` (three `JobSpec`s with the S01/S02 instruction strings — the rubric text carries the brief's bullet list verbatim), and pool construction in `main.rs` beside `haiku_agent` (model closure per the `scribe_model` pattern, `max_workers` knob).

**Tasks:**
- [ ] Job instructions demand pure-JSON output and state "post nothing" / round-cap contracts explicitly.
- [ ] `main.rs`: build `gazette_agent: Arc<SharedAgentPool>`; hold it for Steps 6/8 (no consumers yet — construction spawns nothing, per the pool's lazy contract).

**Tests:**
- [ ] A table test pinning job names/timeouts and that instructions contain the load-bearing contract strings (the `the_haiku_job_table_carries_every_contract…` pattern).

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast gazette_agent`

---

#### Step 4: Pure Reporter wake core {#step-4}

**Commit:** `tugcast(reporter): pure wake core — buffers, wake reasons, envelope parse`

**Depends on:** #step-3

**References:** [P04] wake core, [P06] envelope, Table T03, Spec S01, Risk R02, (#p04-wake-core)

**Artifacts:** `feeds/reporter_wake.rs`: `FrameBuffer` (frame/byte caps + elision marker), `WakeReason` (wire strings per T03), `compose_reporter_input(reason, session_id, frames, last_k_posts)`, `ReporterEnvelope`/`GazetteRef` strict serde parse, `validate_refs(envelope, buffered_context) -> (kept, dropped)`.

**Tasks:**
- [ ] The tap classifier (allowlist + replay-mute set) as a pure function modeled on `pulse.rs::forwardable_session`, with the Reporter's own starting allowlist ([Q02]): the `PULSE_FORWARD_ALLOWLIST` set plus `turn_complete` usage retention; user submissions enter the buffer through a separate push path (they arrive off the submission channel, not CODE_OUTPUT).

**Tests:**
- [ ] Idle session (empty buffer) yields no sitrep wake; caps drop oldest with marker; malformed envelopes parse to no-post; ref validation drops absent targets and exempts `session` kinds; mute brackets track exactly as pulse's classifier test does.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast reporter_wake`

---

#### Step 5: Calibration harness {#step-5}

**Commit:** `tugcast(gazette-replay): offline transcript-replay calibration harness`

**Depends on:** #step-3, #step-4

**References:** [P09] harness, [P05] knobs, Risk R01, (#p09-harness, #success-criteria)

**Artifacts:** `src/bin/gazette_replay.rs`; `justfile` recipe `gazette-replay JSONL *FLAGS`.

**Tasks:**
- [ ] Read a session JSONL, map records to the frame shapes the tap classifier reads, simulate time from record timestamps, segment into wake windows via the wake core, call `pool.run("reporter-post", …)` per window (real `ClaudeAgentWorkerSpawner`), render a markdown gazette: per-wake reason, buffer stats, post-or-silence, refs kept/dropped.
- [ ] Flags: `--sitrep-secs`, `--last-k`, `--model`, `--max-frames`; defaults from Table T02.
- [ ] Run against at least the two spike sessions' JSONL; tune the shipped knob defaults and, if needed, the rubric wording — fold conclusions into Step 6's allowlist ([Q02]).

**Tests:**
- [ ] Segmentation-only mode (`--no-model`) unit-testable: wake windows over a fixture JSONL are deterministic.

**Checkpoint:**
- [ ] `cd tugrust && cargo build -p tugcast` (binary builds; a real run is manual, costs tokens)
- [ ] `just gazette-replay <a real jsonl>` produces a readable gazette (manual read)

---

#### Step 6: Live Reporter bridge {#step-6}

**Commit:** `tugcast(reporter): live GAZETTE bridge — tap, sitrep wakes, ledger + broadcast`

**Depends on:** #step-2, #step-5

**References:** [P04], [P05], [P06], [P12] isolation, Table T02, Table T03, Spec S03, [Q02] resolution, (#bridge-topology)

**Artifacts:** `feeds/reporter.rs` `ReporterBridge` implementing `StreamFeed` (id `GAZETTE`, capacity 64); `main.rs` wiring (knob closures over `bank_client`, `register_stream_feed`, submission-channel tap mirroring `SessionOverviewConfig`); CONTROL verb `"list_gazette_posts"` + `do_list_gazette_posts` in `agent_supervisor.rs`.

**Tasks:**
- [ ] Tap loop: subscribe `code_tx` in-task; classify/mute; push to buffers; arm per-session sitrep deadlines (`tokio::select!` over a computed next-deadline, the timer only armed while a buffer is non-empty); session-end wake off session-state frames; token-threshold wake off `turn_complete` usage when the knob is non-zero.
- [ ] Wake path: snapshot+clear buffer, fetch last-K posts for the session (`list` read filtered by session), spawn a task: `run("reporter-post")` → parse ([P06]) → validate refs (R02) → `record_gazette_post` → broadcast S03 frame. Disabled knob drops frames and never wakes (the `pulse_enabled` posture).
- [ ] Finalize the allowlist from harness findings; record it as a `const` with the pulse-style doc comment ([Q02] closes here).

**Tests:**
- [ ] Tokio tests with a scripted pool (the `FakeSpawner` pattern from `shared_agent.rs::test_support`): allowlisted frame → wake → post persisted + broadcast; replay-bracketed frames produce nothing; a `GAZETTE` frame never enters the buffer ([P12]); disabled knob spawns/wakes nothing; `list_gazette_posts` CONTROL verb answers the tail.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast reporter`
- [ ] Manual: run a dash-build tugcast, do real session work, watch `GAZETTE` frames arrive (dev log / `websocat`)

---

#### Step 7: Operator verb executor {#step-7}

**Commit:** `tugcast(operator): read-only verb executor with caps`

**Depends on:** #step-2

**References:** [P07] verbs, [Q03] git cwd, Table T01, (#verb-table)

**Artifacts:** `feeds/operator.rs`: `run_verb(ctx, name, args) -> Result<serde_json::Value, String>` for all nine T01 verbs; `OperatorContext { ledger, bootstrap_project_dir }`.

**Tasks:**
- [ ] Ledger verbs over Step 2's reads; git verbs via `tokio::process::Command` with arg allowlisting (never shell interpolation; `--` path separators; reject flag-shaped user args), output caps per T01, 10s timeout each.
- [ ] Unknown verb / malformed args → an error value packed into results (the model sees its mistake), never a crash.

**Tests:**
- [ ] Per-verb cap tests against a seeded in-memory ledger + a fixture git repo (tempdir, real `git` — the crate's git feed tests' pattern); injection attempts (a `-S` payload, a `--upload-pack` path) are rejected.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast operator`

---

#### Step 8: Operator pipeline + GAZETTE_INPUT {#step-8}

**Commit:** `tugcast(operator): GAZETTE_INPUT adapter and two-round retrieve/answer pipeline`

**Depends on:** #step-3, #step-6, #step-7

**References:** [P07], [P08] user echo, Spec S02, Spec S03, (#bridge-topology)

**Artifacts:** `main.rs` `register_input(FeedId::GAZETTE_INPUT, …)` + adapter task (the `USAGE_QUERY` adapter shape: mpsc in, per-request `tokio::spawn`); pipeline in `feeds/operator.rs`.

**Tasks:**
- [ ] Adapter: parse `{body, request_id}`; persist + broadcast the `user` post first ([P08]); then pipeline: scrollback = last 20 posts from the ledger → `operator-retrieve` → execute verbs (≤6) → `operator-answer` → optional one follow-up round → forced final answer; persist + broadcast the `operator` post with `request_id` echoed.
- [ ] Failure at any stage → transient (`transient: true`, unpersisted) operator post carrying the `request_id` ([P08]).

**Tests:**
- [ ] Scripted-pool tokio tests: happy path (one round), follow-up path (two rounds), round-cap enforcement (a model that always asks for more verbs still yields an answer), pool-unavailable → transient post not in the ledger, user post persisted before any model call.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast operator`

---

#### Step 9: Deck gazette-store {#step-9}

**Commit:** `tugdeck(gazette): GazetteStore — CONTROL tail, live fold, pending questions`

**Depends on:** #step-1, #step-6, #step-8

**References:** [P11] gazette store, [P05] knobs (`card_rows`), Spec S03, (#state-zone-mapping)

**Artifacts:** `tugdeck/src/lib/gazette-store.ts` + tests; `lib/gazette-types.ts` if types don't fit in `protocol.ts`.

**Tasks:**
- [ ] Model on `lib/pulse-store.ts`: singleton, connect hook, CONTROL `list_gazette_posts` on mount, `conn.onFrame(FeedId.GAZETTE, …)` fold, render-window cap from the `dev.tugtool.gazette`/`card_rows` default via the DEFAULTS feed, `useSyncExternalStore` hook, test-only frame-injection seam.
- [ ] `submitQuestion(body)`: mint a `request_id`, send a `GAZETTE_INPUT` frame, track pending until a matching `request_id` post (or a timeout) clears it; transient posts render but never enter the persisted-window array.

**Tests:**
- [ ] Fold/ordering/cap; pending lifecycle incl. transient clear; tail-then-live merge without duplicates (dedupe by ledger `id`).

**Checkpoint:**
- [ ] `cd tugdeck && bun test gazette-store && bun run check`

---

#### Step 10: Gazette card, toggle, menu {#step-10}

**Commit:** `tugdeck(gazette): sidebar Gazette card with composer; ⌃⌘G toggle; Show Gazette menu row`

**Depends on:** #step-9

**References:** [P10] card, [Q01] names and chord, Spec S03, (#state-zone-mapping, #p10-card)

**Artifacts:** `lib/gazette-card-id.ts`, `components/gazette/gazette-card-registration.tsx`, `gazette-card.tsx` + `.css`; `TUG_ACTIONS.TOGGLE_GAZETTE` in `action-vocabulary.ts`, command entry in `command-registry.ts` (⌃⌘G, routing `"registry"`, `menuItemId: "maker.gazette"`), dispatch handler in `action-dispatch.ts` (mirror the `TOGGLE_JOTS` handler); Swift "Show Gazette" row in `tugapp/Sources/AppDelegate.swift` mirroring the "Show Jots" row.

**Tasks:**
- [ ] Registration is the `registerJotsCard()` shape verbatim ([P10]); called unconditionally in `main.tsx` boot before layout restore (copy the INVARIANT comment).
- [ ] Card UI: post rows oldest-first autoscrolled to newest — author icon (lucide `newspaper` for the Reporter; the `operator` glyph via `TugSpriteIcon`/`operatorIconNode` from `components/tugways/tug-icons.tsx`; the Session card's user icon), timestamp, body, ref chips (render-only this step), all theme-token colors, readable at rail width (min 320).
- [ ] Composer: compose `TugMessageEditor` (clipboard/undo responders ride the substrate for free per its module doc) + a submit affordance calling `gazetteStore.submitQuestion`; pending state renders a placeholder row.
- [ ] Update `at0168-menu-structure.test.ts` fixture and the `tuglaws/menus.md` table for the new menu row; re-verify the ⌃⌘G chord against the keymap drift tests ([Q01]).
- [ ] Cross-check tuglaws (`tuglaws.md`, `pane-model.md`, `component-authoring.md`); name the laws in the commit body.

**Tests:**
- [ ] Registration test rows (the card-registry drift tests pick up the new sidebar automatically — verify `layout-tree.test.ts` / `card-registry.test.ts` expectations).

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bun run check && bunx vite build`
- [ ] Manual in the running app: ⌃⌘G toggles the rail; Layouts section shows a "Gazette" side control with no section edits; posts from Step 6 render; a typed question produces an Operator answer.

---

#### Step 11: Ref chip actions {#step-11}

**Commit:** `tugdeck(gazette): ref chips act — raise session, open file, show commit`

**Depends on:** #step-10

**References:** Spec S03, [P10], (#verb-table)

**Artifacts:** chip click handlers in `gazette-card.tsx`.

**Tasks:**
- [ ] `session` → raise/focus the bound Session card via the store's activation path (`transferFocusForActivation` — the real z-raise); a session with no live card renders the chip inert with a title tooltip.
- [ ] `file`, `plan`, `brief` → open the path in the file-viewing card via the existing parameterized `show-card`/file-open dispatch (reuse, never a new mechanism).
- [ ] `commit` → open the commit's diff via the existing `GIT_DIFF_QUERY` commit flavor (`sha` field) surface.

**Tests:**
- [ ] Dispatch-level unit tests (command payloads), not fake-DOM renders.

**Checkpoint:**
- [ ] `cd tugdeck && bun test && bunx vite build`; manual chip clicks in the app

---

#### Step 12: App-test + doc rows {#step-12}

**Commit:** `tests(gazette): app-test for the Gazette card; menus law row`

**Depends on:** #step-10, #step-11

**References:** [P10], [P11], (#test-plan-concepts)

**Artifacts:** `tests/app-test/at0xxx-gazette-card.test.ts` with `@covers` lines naming `tugdeck/src/components/gazette/*` and `tugdeck/src/lib/gazette-store.ts`.

**Tasks:**
- [ ] App-test: toggle the rail (⌃⌘G and menu), inject posts through the store's test seam, assert rows + icons + chips render, type into the composer and submit — the app-test-gated pool yields the transient degraded post, which is itself the assertion that the round trip ran.
- [ ] `just app-test-covers-check` passes; run `just app-test-changed`.

**Tests:** the app-test itself.

**Checkpoint:**
- [ ] `just app-test-covers-check`
- [ ] `just app-test-changed`

---

#### Step 13: Integration Checkpoint {#step-13}

**Depends on:** #step-6, #step-8, #step-12

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #exit-criteria)

**Tasks:**
- [ ] Walk every success criterion in (#success-criteria) against the built app: live Reporter posts during real work at the 180s default; the worked-example Operator question; knob turns (`sitrep_secs`, `card_rows`) taking effect without restart.

**Tests:**
- [ ] `cd tugrust && cargo nextest run` (workspace)
- [ ] `cd tugdeck && bun test && bun run check && bunx vite build`

**Checkpoint:**
- [ ] All of the above green; manual acceptance noted in the session.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The Gazette ships end-to-end — Reporter narration with tunable cadence, Operator answers over ground-truth ledgers, and a sidebar Gazette card — plus the calibration harness that tunes it.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] All Step Status Ledger rows `done` with commits recorded.
- [ ] Success criteria in (#success-criteria) hold (harness output read; live posts observed; worked example answered; knobs turn live).
- [ ] No isolation regression: the [P12] tests pin no-feedback-loop and no-write-toward-sessions.

**Acceptance tests:**
- [ ] `cd tugrust && cargo nextest run` green (warnings are errors).
- [ ] `cd tugdeck && bun test && bun run check && bunx vite build` green.
- [ ] `just app-test-changed` green.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Operator answer-quality corpus + scoring harness (the plan/execute/answer shape was chosen partly to enable this).
- [ ] Cross-session digest posts; richer chip targets (History-card deep links); gazette export.
- [ ] Rubric/prompt tuning rounds from lived-in cadence experience (knobs exist; wording changes are code).

| Checkpoint | Verification |
|------------|--------------|
| Protocol bytes | `cargo nextest run -p tugcast-core` byte tests |
| Reporter pleasant to live with | `just gazette-replay` on real JSONL + a week of live use with the knobs |
| Operator grounded | worked-example question; refs resolve; `gazette prose locates, ledgers confirm` honored in answers |
