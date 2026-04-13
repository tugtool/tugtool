<!-- tugplan-skeleton v2 -->

## Golden Stream-JSON Catalog (Layer A, pre-T3.4.a) {#golden-stream-json-catalog}

**Purpose:** Land a versioned, machine-readable golden catalog of Claude Code's stream-json event shapes plus a drift regression test, so T3.4.a's `CodeSessionStore` can take a dependency on event shapes without silent breakage when Anthropic ships a new Claude Code version.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | in progress |
| Target branch | main |
| Last updated | 2026-04-13 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

`roadmap/transport-exploration.md` is a 35-test empirical prose catalog of the Claude Code stream-json protocol, captured against `claude 2.1.87` via `tugtalk/probe.ts` (the legacy name for what is now `tugcode`) and spot-verified at `2.1.104` during the multi-session router Step 10 integration tests. T3.4.a is about to build `CodeSessionStore` — a turn-state machine that consumes those event shapes directly. Stream-json is not a stable public API; Anthropic ships new Claude Code versions frequently. Without a regression test, silent drift between `claude 2.1.N` and `2.1.(N+1)` would corrupt `CodeSessionStore`'s state with no warning.

This plan lands the safety net: a capture binary that freezes the catalog as versioned machine-readable JSONL fixtures, a hand-rolled shape differ, a drift regression test, and the prose catalog's demotion from "authoritative" to "human-readable summary." Scope is deliberately static shape-diffing only — runtime divergence telemetry, UI surfacing, and version-adaptive reducers are [P15 in tide.md](tide.md#p15-stream-json-version-gate).

#### Strategy {#strategy}

- **Capture at the WebSocket layer** (via `TestTugcast` + `TestWs`), not at direct `tugcode` stdout. This is the layer `CodeSessionStore` will consume — drift anywhere between `claude` stdout and the WebSocket frame is captured in one place.
- **Per-probe `TestTugcast` isolation.** Each probe spins up a fresh tugcast subprocess. Slower than a shared-instance mode, but eliminates cross-probe state bleed and exercises the multi-session router's fresh-boot path 35 times.
- **All 35 probes, no curated subset.** These tests are not in the default nextest suite and are not run on every commit; they run on Claude Code version bumps or a manual cadence. Correctness matters more than speed.
- **Hand-rolled shape differ**, ~100–150 lines, no external crate. Depth-limited object walks, union-by-discriminant for polymorphic payloads, per-probe event-sequence invariants.
- **Placeholder normalization** at fixture-write time so re-captures of unchanged shapes produce byte-stable JSONL — git diffs stay readable, real drift stands out.
- **Fixture JSONL is the source of truth**; the derived `schema.json` is a regenerable index. If the two disagree, JSONL wins.
- **Supervisor bugs from session-command probes are findings, not blockers.** Probes 13/17/20 exercise uncharted multi-session router territory. Any bug they expose becomes a §T0.5 follow-up, the affected probe is marked skipped with a pointer, and the plan proceeds.

#### Success Criteria (Measurable) {#success-criteria}

- **SC1.** `TUG_STABILITY=3 TUG_REAL_CLAUDE=1 cargo test --test capture_stream_json_catalog -- --ignored` against `claude 2.1.104` produces all 35 probe fixtures with shape-stable results across 3 runs.
- **SC2.** `TUG_REAL_CLAUDE=1 cargo test --test stream_json_catalog_drift -- --ignored` against `claude 2.1.104` passes with zero failures and zero warnings against the committed baseline.
- **SC3.** `cargo nextest run -p tugcast` (default suite) includes and passes the pure-Rust unit tests for `normalize_event`, `derive_schema`, and the shape differ.
- **SC4.** `roadmap/transport-exploration.md` contains zero `tugtalk` references outside the historical methodology footnote (`grep -c tugtalk` returns 0 or 1).
- **SC5.** `roadmap/transport-exploration.md` carries a version banner at the top and a "Known divergences from prose catalog" section.
- **SC6.** `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/README.md` exists with placeholder vocabulary + recovery workflow + probe classification guide.
- **SC7.** `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.104/` contains 35 normalized probe JSONL files + `manifest.json` + `schema.json`.
- **SC8.** Every supervisor bug exposed during Step 4 baseline capture is logged as a P16/P17/... entry in `roadmap/tide.md` §T0.5 with pointers to the offending probe and a clear symptom description, or the absence of such bugs is explicitly noted in Step 8's checkpoint.
- **SC9.** Neither the capture binary nor the drift test is picked up by `cargo nextest run -p tugcast --run-ignored only`. Both are invoked exclusively via their own `cargo test --test <name> -- --ignored` commands.

#### Scope {#scope}

1. Audit and (conditionally) widen tugcast's `CODE_INPUT` router path so it opaquely passes any well-formed tugcode JSON, not just `user_message` shapes.
2. Extend `TestWs` with control-flow senders for `interrupt`, `tool_approval`, `question_answer`, `session_command`, `model_change`, `permission_mode`.
3. Write `tests/capture_stream_json_catalog.rs`: probe table (35 entries), per-probe execution harness, retry/skip policy, `TUG_STABILITY=N` mode, fixture normalization, `manifest.json` + `schema.json` derivation.
4. Run the baseline capture against `claude 2.1.104` with `TUG_STABILITY=3` and commit `v2.1.104/` as the golden reference.
5. Rename `tugtalk` → `tugcode` in `roadmap/transport-exploration.md`; add version banner and "Known divergences from prose catalog" section.
6. Write `tests/stream_json_catalog_drift.rs`: hand-rolled shape differ, 35-probe replay, structured failure report, inline differ unit tests.
7. Write `tests/fixtures/stream-json-catalog/README.md`: placeholder vocabulary, recovery workflow, probe classification guide.
8. Dress rehearsal: run the full pipeline end-to-end, verify all success criteria, log any surprises as §T0.5 follow-ups.

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Runtime divergence telemetry.** No new `SUPERVISOR_TELEMETRY` FeedId, no `stream_json_divergence` events, no tugdeck drift banner. All Layer B / P15.
- **Version-adaptive reducer.** `CodeSessionStore`'s handling of multiple claude versions is P15 Layer C.
- **Automatic CI integration.** Neither the capture binary nor the drift test runs on every commit, every PR, or in the default nextest suite. They are manual verification tools invoked by the developer on a cadence.
- **Version fallback.** No "use `v(N-1)/` fixtures if `v(N)/` missing" behavior — every version bump requires an explicit capture commit.
- **Cross-version diff tool.** No batch comparison of `v2.1.104/` vs `v2.1.87/`. The drift test compares live claude against one golden version.
- **Fixing tugcode event mapping.** If the baseline capture reveals that tugcode mis-wraps a claude event, the fix belongs to the tugcode side and is out of scope here (unless the fix is trivial).
- **Broadening the 35 probes.** This plan captures the existing catalog verbatim. New probes for T3.4.a's specific invariants can be added in a follow-up once T3.4.a reveals what it actually depends on.

#### Dependencies / Prerequisites {#dependencies}

- **[T0.5 P2 multi-session router](tide.md#t05-phase-2) landed** (as of commit `6ed2492e`). Supervisor, router, `TestTugcast`, `TestWs`, per-session frame-preserving buffer are all inputs.
- **Real `claude` binary on PATH** — tested against `claude 2.1.104`. Lower bounds not tested.
- **`tmux 3.6a`+** for the tugcode session harness.
- **`bun`** for tugcode subprocess.
- **`TUG_REAL_CLAUDE=1`** env var gates every real-claude test (belt-and-suspenders alongside `#[ignore]`).
- **Working `TUGBANK_PATH` isolation** — Step 10 of the multi-session-router plan landed this in `tugcode/src/tugbank-client.ts`.

#### Constraints {#constraints}

- **Warnings-as-errors.** The Rust workspace enforces `-D warnings`. All new code compiles clean under this.
- **No new external crates.** The shape differ is hand-rolled; no `json-structural-diff` / `jsonschema` dependency.
- **Fixture files committed to git.** ~35 JSONL files + 2 JSON files per version directory. Placeholder normalization keeps them byte-stable.
- **No placeholder substitution leaks into production code.** Normalization lives in the test binary only; tugcast and tugcode operate on raw event JSON.
- **No secrets in fixtures.** Normalization redacts session ids, tool_use ids, request ids, and absolute paths. Spot-check before committing.

#### Assumptions {#assumptions}

- Claude Code's stream-json protocol is roughly backward-compatible across patch versions within a minor release. If `2.1.104 → 2.1.105` breaks every event shape, the drift test flags it and the recovery workflow fires; we do not auto-adapt.
- The 35 probes in `transport-exploration.md` cover every event type and ordering invariant T3.4.a cares about. If T3.4.a reveals a gap later, we add probes in a follow-up and re-capture.
- Shape-stable probes are the common case; a handful (streaming chunk counts, optional `thinking_text`) need REQUIRED → OPTIONAL reclassification during `TUG_STABILITY=3` but the probe table, not the capture binary's logic, absorbs this.
- `TestTugcast::spawn` + `TestWs` work well enough for sequential probes. No new isolation or frame-handling changes needed beyond the control helpers.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

Anchors follow the tugplan-skeleton v2 convention: `step-N` for execution steps, `dNN-...` for decisions, `qNN-...` for open questions, `rNN-...` for risks, `sNN-...` for specs, and noun-phrase anchors for domain sections. All heading anchors are explicit `{#anchor}` suffixes.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Does tugcast's CODE_INPUT path already pass arbitrary tugcode JSON? (RESOLVED) {#q01-code-input-passthrough}

**Question:** Does the `FeedRouter`'s `authorize_and_claim_input` path forward any well-formed tugcode JSON payload verbatim to the correct per-session bridge worker, or does it parse/validate/shape-check assuming a `user_message` shape?

**Why it matters:** Probes 6, 11, 13, 17, 20, 35 send non-`user_message` inbound shapes (`interrupt`, `tool_approval`, `question_answer`, `session_command`, `model_change`, `permission_mode`). If the router assumes `user_message`, the capture binary cannot drive these probes without widening the router.

**Options:**
- **Opaque pass-through already exists** — cleanest. Step 1 becomes a code-reading audit + N/A commit. Step 2 writes `TestWs` helpers on top.
- **User-message-only assumption** — Step 1 widens the router: remove the user_message shape-check and treat the payload as opaque JSON whose only constraint is `tug_session_id` extraction.

**Plan to resolve:** Read `tugrust/crates/tugcast/src/router.rs` + `agent_supervisor.rs` + `agent_bridge.rs` focusing on the `CODE_INPUT` path from `authorize_and_claim_input` through `dispatcher_task` into each per-session worker's input channel.

**Resolution:** **RESOLVED — opaque pass-through already exists** (2026-04-13, audit only). The CODE_INPUT path inspects payloads only for the `tug_session_id` field. It does not inspect `type`, `command`, or any other shape field. Three code sites audited:

1. **`src/router.rs::authorize_and_claim_input`** (line 578) — calls `parse_tug_session_id(payload)` only to extract the session id for ownership checking. Agnostic to `type`.
2. **`src/feeds/agent_supervisor.rs::dispatch_one`** (line 719) — calls `parse_tug_session_id` again for per-session routing, then forwards the frame verbatim into the per-session `input_tx` mpsc channel. No type inspection.
3. **`src/feeds/agent_bridge.rs::relay_session_io`** (line 456) — receives frames from `input_rx`, calls `parse_code_input` (which is just `String::from_utf8(frame.payload)` per `src/feeds/code.rs:18`), appends `\n`, writes to tugcode's stdin unchanged.

`parse_tug_session_id` itself (`src/feeds/code.rs:68`) is a full `serde_json::from_slice` followed by `value.get("tug_session_id")` — it parses the payload as JSON but only extracts the one field; it does not care what other fields are present or absent.

Tugcode is the authority on message validation. Any well-formed JSON with a `tug_session_id` field routes correctly regardless of whether `type` is `user_message`, `interrupt`, `tool_approval`, `question_answer`, `session_command`, `model_change`, or `permission_mode`. **No router widening required. Step 1 commit: N/A.**

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| R01 Session-command probes expose supervisor bugs | medium | medium | Log as §T0.5 follow-ups; mark probes skipped with reason; continue | Step 4 run |
| R02 Shape-unstable probes across `TUG_STABILITY=3` runs | medium | high | Reclassify flapping events REQUIRED → OPTIONAL in the probe table | Step 4 run |
| R03 Differ bug masks or fabricates drift | high | low | ~20 hand-crafted unit-test triples; pure-Rust, no claude dependency | Step 6 |
| R04 Over-aggressive normalization masks real shape change | high | low | Leaf-only normalization; preserve enclosing object structure; spot-check fixtures before committing | Step 3 |
| R05 Router widening regresses multi-session tests | medium | low | Re-run full multi-session real-claude suite after widening | Step 1 |

**Risk R01: Session-command probes expose supervisor bugs** {#r01-session-command-bugs}

- **Risk:** Probes 13 (`session_command: new`), 17 (`session_command: continue`), and 20 (`session_command: fork`) send inbound control shapes the multi-session router has never been exercised on. The supervisor may mishandle the claude process kill/respawn, lose the per-session `claude_session_id`, or fail to rebind state.
- **Mitigation:**
  - The plan treats any surfaced bug as a §T0.5 follow-up entry (P16/P17/...), not a blocker.
  - The affected probe is marked `skipped` with `reason: "blocked on P<N>"` in the manifest.
  - Fixture for the probe is not committed until the follow-up lands. Drift test skips the probe in the meantime.
- **Residual risk:** The `v2.1.104/` baseline may ship with 1–3 session-command probes skipped. Acceptable — the majority of probes still protect T3.4.a from drift.

**Risk R02: Shape-unstable probes across runs** {#r02-shape-instability}

- **Risk:** Claude emits `thinking_text` at its own discretion; streaming chunk counts vary; optional fields come and go. A single capture run's shape is not guaranteed to match the next run's shape.
- **Mitigation:**
  - `TUG_STABILITY=3` is mandatory before the initial baseline commit; it runs each probe 3 times and asserts shape-identity.
  - Probe table distinguishes REQUIRED and OPTIONAL events. Flapping events get demoted from REQUIRED to OPTIONAL before the baseline lands.
  - Stability-failure surfaces a clear reclassification ask: "event X appeared in run 1 but not run 2 for probe Y — mark it optional?"
- **Residual risk:** A probe may be truly non-deterministic even after reclassification. Such probes are marked `skipped` with `reason: "shape-unstable even with optional events"` and a follow-up logged.

**Risk R03: Differ bug masks or fabricates drift** {#r03-differ-bug}

- **Risk:** A bug in the hand-rolled shape differ could either (a) miss real drift and let `CodeSessionStore` break silently, or (b) flag false drift and waste version-bump time chasing phantom issues.
- **Mitigation:**
  - ~20 hand-crafted `(golden, current, expected_report)` unit-test triples covering identical shapes, new optional field, removed required field, type change, unknown event type, nested object shape change, array shape change, polymorphic union, and sequence invariant changes.
  - Unit tests live in the default nextest suite (no `#[ignore]`, no claude dependency), so a differ regression surfaces on every routine test run.
- **Residual risk:** Unit tests are not exhaustive. The first few real version bumps are the true test of the differ's fitness.

**Risk R04: Over-aggressive normalization masks real shape change** {#r04-over-normalization}

- **Risk:** `normalize_event` substitutes leaf values with typed placeholders. If the walker collapses enclosing object structure (e.g., replaces `file: {...}` with `{{object}}`), real shape drift on those nested fields becomes invisible.
- **Mitigation:**
  - Normalization is leaf-only: strings, numbers, UUIDs. Enclosing object structure is preserved intact per [D14].
  - Normalization walker lives in a helper with its own unit test suite (pure-Rust, default nextest) covering leaf substitution, nested object preservation, arrays-of-objects preservation, and polymorphic payloads.
  - Visual spot-check of 3–5 committed fixtures during Step 4.
- **Residual risk:** A future probe may introduce a new leaf type that slips through substitution. The unit tests catch common cases but cannot enumerate the future.

**Risk R05: Router widening regresses multi-session tests** {#r05-router-regression}

- **Risk:** If Step 1 widens the router's `CODE_INPUT` handling, the 9 multi-session-router integration tests from Step 10 may regress.
- **Mitigation:**
  - Step 1's checkpoint re-runs `TUG_REAL_CLAUDE=1 cargo nextest run -p tugcast --run-ignored only` after the widening.
  - All 9 tests must pass before Step 2 begins.
- **Residual risk:** The widening could introduce subtler semantic changes not covered by the existing suite. Low likelihood; router `CODE_INPUT` handling is thin.

---

### Design Decisions {#design-decisions}

#### [D01] Per-probe TestTugcast isolation (DECIDED) {#d01-per-probe-isolation}

**Decision:** Each probe spawns a fresh `TestTugcast` subprocess and tears it down before the next probe begins. No shared-tugcast mode.

**Rationale:**
- Eliminates cross-probe state bleed (per-session ledgers, tugbank mutations, tmux session names).
- Exercises the multi-session router's fresh-boot path on every probe, catching supervisor-construction bugs as well as steady-state bugs.
- Runtime cost (35 × tugcast spawn + claude spawn) is acceptable; tests are not in CI.

**Implications:**
- Capture binary runtime is roughly `35 × ~10s` ≈ 6 minutes per single run, `~18 minutes` for `TUG_STABILITY=3`. Acceptable.
- Drift test runtime likewise ~6 minutes. Acceptable as a manual tool.

#### [D02] Full 35 probes, no curated subset (DECIDED) {#d02-full-35-probes}

**Decision:** Both the capture binary and the drift regression test cover all 35 probes from `transport-exploration.md`. No "fast 10" subset.

**Rationale:**
- Tests are manual, not CI-integrated. Runtime is not a design constraint.
- Correctness (every event type, ordering invariant, polymorphic payload) matters more than speed.
- A curated subset creates maintenance burden and invites skew.

**Implications:**
- The probe table is a flat 35-entry `static` in shared test-helper code (`tests/common/probes.rs`) imported by both the capture binary and the drift test.
- Environment-dependent probes (25, 28, 34, 35) are classified `conditional`; missing prerequisites downgrade them to `skipped`.

#### [D03] Hand-rolled shape differ, no external crate (DECIDED) {#d03-hand-rolled-differ}

**Decision:** Shape differ is ~100–150 lines of hand-written Rust. No dependency on `json-structural-diff`, `jsonschema`, `serde_path_to_error`, or similar.

**Rationale:**
- The semantics we need (union-by-discriminant, REQUIRED/OPTIONAL awareness, per-probe sequence invariants) are project-specific.
- Every external crate is a potential future vendor-drift problem for a project trying to eliminate vendor drift.
- ~100 lines is small enough to own completely.

**Implications:**
- Step 6 writes the differ from scratch and its unit tests in the same commit.
- Differ unit tests run in the default nextest suite — a regression shows up on every routine test run.

#### [D04] Placeholder substitution for normalization (DECIDED) {#d04-placeholder-normalization}

**Decision:** `normalize_event` substitutes non-deterministic leaf values with typed placeholder strings: `{{uuid}}`, `{{iso}}`, `{{f64}}`, `{{i64}}`, `{{text:len=N}}`, `{{cwd}}/...`, `{{tool_use_id}}`, `{{msg_id}}`, `{{request_id}}`.

**Rationale:**
- Byte-stable fixture files across re-captures of unchanged shapes. Git diffs on re-capture highlight only real drift.
- Typed placeholders (not just `{{redacted}}`) preserve semantic hint for human review.
- Character-count-preserving text placeholder (`{{text:len=N}}`) detects catastrophic truncation without committing noisy text content.

**Implications:**
- Fixture JSONL stays valid JSON (the placeholder strings are themselves valid JSON strings). Documented at the top of the `README.md`.
- Normalization is leaf-only (see [D14] and [R04]).

#### [D05] Separate cargo test runner outside nextest (DECIDED) {#d05-separate-test-runner}

**Decision:** Both `capture_stream_json_catalog.rs` and `stream_json_catalog_drift.rs` run via their own `cargo test --test <name> -- --ignored` invocation. They are **not** picked up by `cargo nextest run -p tugcast --run-ignored only`.

**Rationale:**
- Step 10's multi-session real-claude tests already live in `--run-ignored only`. Adding catalog tests to the same bucket mixes "eventually CI-safe functional tests" with "manual protocol drift verification."
- Separation lets developers run the multi-session suite routinely without paying the catalog-capture cost every time.

**Implications:**
- Two new invocations documented in `README.md` and in `tide.md` §p2-followup.
- Developers must remember to run the drift test explicitly on version bumps. Mitigated by the recovery workflow in `fixtures/README.md`.
- To keep them out of `nextest --run-ignored only`, each test file uses a module-scoped `#[cfg(feature = "...")]` gate OR relies on `nextest` filtering by test name. The concrete mechanism is resolved in Step 6.

#### [D06] JSONL is the single source of truth (DECIDED) {#d06-jsonl-source-of-truth}

**Decision:** Per-probe `*.jsonl` files are authoritative. `schema.json` is derived on every capture run; if the two disagree, JSONL wins and `schema.json` is regenerated.

**Rationale:**
- Derived schema prevents drift between raw fixture and its summary index.
- JSONL is humanly readable — a developer can open one fixture and see the full event stream.
- `schema.json` is a fast-load index for the differ and for future P15 consumers.

**Implications:**
- Capture binary always derives schema.json at the end of a run.
- Drift test regenerates schema from live capture's JSONL before diffing against the golden `schema.json`.

#### [D07] Capture at WebSocket layer, not direct tugcode stdout (DECIDED) {#d07-websocket-layer-capture}

**Decision:** Fixtures reflect what `CodeSessionStore` receives after tugcast framing and tugcode wrapping — not raw `claude` stream-json.

**Rationale:**
- `CodeSessionStore` is the consumer; the layer it sees is the layer that matters.
- Drift in tugcast framing or tugcode wrapping is just as disruptive to `CodeSessionStore` as drift in claude. One test catches all three.

**Implications:**
- A tugcode rewrite that changes event wrapping counts as drift and requires a new fixture commit.
- `README.md` documents this explicitly.

#### [D08] REQUIRED vs OPTIONAL events per probe (DECIDED) {#d08-required-vs-optional}

**Decision:** Every probe lists its `required_events` (must appear, shape-checked) and `optional_events` (may appear, shape-checked only if present). Events default to REQUIRED; demotion to OPTIONAL happens only after `TUG_STABILITY=3` surfaces flapping.

**Rationale:**
- Distinguishes real drift from normal non-determinism.
- Conservative default prevents silent tolerance of absent events that should have appeared.

**Implications:**
- Step 4's stability loop is not just a sanity check — it is the mechanism by which REQUIRED/OPTIONAL classification is tuned.
- Adding a new probe means explicitly thinking about its REQUIRED/OPTIONAL set.

#### [D09] Polymorphic tool_use_structured handled as union by tool_name (DECIDED) {#d09-polymorphic-tool-use-structured}

**Decision:** `tool_use_structured.structured_result` has different shapes for Read / Bash / Glob / Write / Edit / Agent / etc. The schema captures one entry per `(event_type="tool_use_structured", tool_name)` combination.

**Rationale:**
- A merged/union structure would be lossy and hard to diff.
- `tool_name` is always present and stable as the discriminant.

**Implications:**
- `derive_schema` keys `tool_use_structured` entries by `(event_type, tool_name)`.
- Differ looks up the correct subtype per event.
- New tool types appear as new union arms and are flagged as "new event subtype" → warn.

#### [D10] Supervisor bugs from session-command probes become §T0.5 follow-ups (DECIDED) {#d10-supervisor-bugs-as-followups}

**Decision:** Any supervisor bug exposed during Step 4 baseline capture — especially from session-command probes (13/17/20) — is logged as a new §T0.5 P16/P17/... entry in `roadmap/tide.md` and triaged separately. The offending probe is marked `skipped` with a pointer.

**Rationale:**
- This plan's goal is the safety net, not bug-free session-command routing.
- Blocking the plan on every surfaced bug would push Layer A indefinitely.
- Surfacing bugs is a bonus finding; losing them to scope creep would waste the surfacing.

**Implications:**
- Step 4's checkpoint explicitly requires logging any surfaced supervisor bugs as new P16/P17/... entries.
- `v2.1.104/` may ship with 1–3 session-command probes skipped, with inline manifest pointers.

#### [D11] Version resolution via first system_metadata.version (DECIDED) {#d11-version-resolution}

**Decision:** The capture binary reads `claude`'s version from the first `system_metadata.version` field emitted by Test 1 (basic round-trip). All subsequent probes commit fixtures to `v<version>/`. A different version reported later aborts the whole run.

**Rationale:**
- Simple, reliable, no external version-probing command.
- Aborting on mismatch catches concurrent-install hazards.

**Implications:**
- Probe 1 must succeed for any capture run to proceed.
- Versions with non-filesystem-safe characters are sanitized (slash → dash).

#### [D12] Depth-8 shape walk + first-element arrays-of-objects (DECIDED) {#d12-shape-walk-semantics}

**Decision:** The shape differ walks nested objects to a maximum depth of 8. Arrays of objects are validated against the first element's shape.

**Rationale:**
- Observed `tool_use_structured.structured_result.file.content` is the deepest nesting we've seen (~4 levels). 8 gives headroom.
- Arrays in the protocol are either primitive or homogeneous; first-element check is sufficient.

**Implications:**
- Differ fails loudly with `depth limit exceeded` if a future event nests past 8, forcing explicit revisit.
- Differ unit tests cover the array-of-objects case explicitly.

#### [D13] No version fallback (DECIDED) {#d13-no-version-fallback}

**Decision:** The drift test fails hard if no `v<version>/` fixture directory exists for the installed claude. No fallback to `v(N-1)/`.

**Rationale:**
- Forces explicit capture per version bump — the only way the safety net stays tight.
- A silent fallback to older fixtures is exactly the drift the plan exists to prevent.

**Implications:**
- Every version bump workflow is: update claude → run capture → commit new `v<version>/` → run drift test → pass.

#### [D14] Normalization is leaf-only (DECIDED) {#d14-leaf-only-normalization}

**Decision:** `normalize_event` substitutes leaf primitive values only (strings, numbers, booleans). Enclosing object and array structures are preserved intact.

**Rationale:**
- Shape-diffing depends on structure. Collapsing nested structure during normalization would hide drift.
- See [R04](#r04-over-normalization).

**Implications:**
- Normalization walker is recursive but only modifies values at leaf positions.
- Walker unit tests cover the leaf/structure boundary explicitly.

#### [D15] Stability flag passed via TUG_STABILITY env var (DECIDED) {#d15-stability-env-var}

**Decision:** `--stability N` is expressed as the `TUG_STABILITY=N` environment variable rather than a `cargo test -- --stability N` flag.

**Rationale:**
- Cargo test flag forwarding via `--` is idiosyncratic. Env vars are reliable.
- Matches the `TUG_REAL_CLAUDE=1` pattern already in use.
- Default value is 1; the initial baseline Step 4 uses `TUG_STABILITY=3`.

**Implications:**
- Documentation (`README.md`, `tide.md`, this plan) uses env var form in every invocation example.
- Capture binary reads `std::env::var("TUG_STABILITY").ok().and_then(|s| s.parse().ok()).unwrap_or(1)`.

---

### Deep Dives (Optional) {#deep-dives}

#### Probe table structure and classification {#deep-probe-table}

Every probe is a static record in `tests/common/probes.rs`:

```rust
pub struct ProbeRecord {
    pub name: &'static str,                   // e.g., "test-05-tool-use-read"
    pub input_script: &'static [ProbeMsg],
    pub required_events: &'static [&'static str],
    pub optional_events: &'static [&'static str],
    pub prerequisites: &'static [ProbePrereq],
    pub timeout_secs: u64,
}

pub enum ProbeMsg {
    UserMessage { text: &'static str },
    UserMessageWithAttachments { text: &'static str, attachments: &'static [Attachment] },
    Interrupt,
    ToolApproval { decision: &'static str, message: Option<&'static str> },
    QuestionAnswer { answers: &'static [(&'static str, &'static str)] },
    SessionCommand { command: &'static str },
    ModelChange { model: &'static str },
    PermissionMode { mode: &'static str },
    WaitForEvent { event_type: &'static str, max_secs: u64 },
}

pub enum ProbePrereq {
    TugplugPluginLoaded,
    DenialCapableTool,
}

pub enum ProbeStatus {
    Passed,
    Skipped(&'static str),
    Failed(String),
    ShapeUnstable(String),
}
```

Classification is maintained in-source; adding a probe means writing a `ProbeRecord` literal. No external YAML / JSON probe definitions.

#### Normalization grammar {#deep-normalization}

Normalization walker rules (pseudocode):

```
normalize_event(value):
  if value is object:
    for each (key, child) in value:
      if key in LEAF_KEY_REPLACEMENTS:   # session_id, tool_use_id, msg_id, request_id
        value[key] = LEAF_KEY_REPLACEMENTS[key]
      elif key in TEXT_CONTENT_KEYS:     # "text", "output", "content"
        value[key] = "{{text:len=" + value[key].len() + "}}"
      else:
        normalize_event(child)            # recurse, preserving structure
  elif value is array:
    for each child in value:
      normalize_event(child)              # recurse into each element
  elif value is string:
    if matches ISO_TIMESTAMP_REGEX: value = "{{iso}}"
    elif matches UUID_REGEX:         value = "{{uuid}}"
    elif starts_with(home_dir):      value = "{{cwd}}/" + suffix
  elif value is number:
    if enclosing key in NUMERIC_NORMALIZE_ALLOWLIST:
      value = "{{f64}}" or "{{i64}}"
```

Key-based replacement happens before value-based. `NUMERIC_NORMALIZE_ALLOWLIST` is explicit (cost, duration, token counts) — most numeric fields (`is_partial`, `seq`) retain exact values because those values carry semantic meaning.

#### Shape differ algorithm {#deep-shape-differ}

```
diff_schemas(golden: &Schema, current: &Schema) -> DiffReport:
  for event_type in current.event_types:
    if event_type not in golden.event_types:
      report.fail(FailureKind::UnknownEventType, event_type)
      continue
    diff_event_shape(golden[event_type], current[event_type], report, path=[event_type])

  for (probe_name, probe_seq) in current.probe_sequences:
    if probe_name not in golden.probe_sequences:
      report.warn(FailureKind::NewProbe, probe_name)
      continue
    diff_probe_sequence(golden[probe_name], current[probe_name], report)

diff_event_shape(golden: &EventShape, current: &EventShape, report, path):
  for (field, type_g) in golden.required_fields:
    if field not in current.fields:
      report.fail(FailureKind::MissingRequiredField, path + [field])
    elif current.fields[field].kind != type_g.kind:
      report.fail(FailureKind::TypeMismatch, path + [field], type_g, current.fields[field])
  for field in current.fields:
    if field not in golden.required_fields and field not in golden.optional_fields:
      report.warn(FailureKind::NewField, path + [field])
  for (field, nested_g) in golden.nested_shapes:
    if depth(path) >= 8:
      report.fail(FailureKind::DepthLimitExceeded, path + [field])
    else:
      diff_event_shape(nested_g, current.nested_shapes[field], report, path + [field])
```

Per-probe event-sequence invariant check: golden records probe X's sequence as `[system_metadata, thinking_text?, assistant_text, cost_update, assistant_text, turn_complete]` where `?` marks optional slots. Current run must match with optional slots absorbing absence.

Polymorphism: `tool_use_structured` entries in the schema are keyed by `(event_type, tool_name)`. Differ looks up `("tool_use_structured", "Read")` vs `("tool_use_structured", "Glob")` separately.

---

### Specification {#specification}

#### Spec S01: Fixture layout {#s01-fixture-layout}

```
tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/
├── README.md                                 # recovery workflow, placeholder vocab, classification guide
└── v2.1.104/
    ├── manifest.json                         # per-run probe status, runtime, skip reasons
    ├── schema.json                           # derived shape schema per event type
    ├── test-01-basic-round-trip.jsonl
    ├── test-02-longer-response-streaming.jsonl
    ├── test-05-tool-use-read.jsonl
    ├── test-06-interrupt-mid-stream.jsonl
    ├── ... (35 total)
    └── test-35-askuserquestion-flow.jsonl
```

#### Spec S02: manifest.json schema {#s02-manifest-schema}

```json
{
  "claude_version": "2.1.104",
  "captured_at": "{{iso}}",
  "stability_runs": 3,
  "probes": [
    {
      "name": "test-01-basic-round-trip",
      "status": "passed",
      "event_count": 8,
      "runtime_ms": "{{i64}}"
    },
    {
      "name": "test-13-session-new",
      "status": "skipped",
      "skip_reason": "blocked on P16 supervisor session_command routing"
    }
  ]
}
```

`captured_at` and `runtime_ms` are normalized placeholders — otherwise every re-capture would produce a different manifest.json byte.

#### Spec S03: schema.json structure {#s03-schema-structure}

```json
{
  "claude_version": "2.1.104",
  "event_types": {
    "session_init": {
      "required_fields": { "type": "string", "session_id": "string" },
      "optional_fields": {}
    },
    "system_metadata": {
      "required_fields": { "type": "string", "session_id": "string", "tools": "array<string>", "model": "string", "version": "string" },
      "optional_fields": { "permissionMode": "string", "plugins": "array<object>" }
    },
    "tool_use_structured": {
      "by_tool_name": {
        "Read": { "required_fields": { "tool_use_id": "string", "structured_result": "object{file: object{filePath: string, content: string, numLines: number, startLine: number, totalLines: number}}" } },
        "Glob": { "required_fields": { "tool_use_id": "string", "structured_result": "object{type: string}" } }
      }
    }
  },
  "probe_sequences": {
    "test-01-basic-round-trip": {
      "required_sequence": ["session_init", "system_metadata", "assistant_text", "cost_update", "assistant_text", "turn_complete"],
      "optional_slots": [{"after": "system_metadata", "event": "thinking_text"}]
    }
  }
}
```

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugrust/crates/tugcast/tests/common/probes.rs` | Shared probe table (`PROBES`, `ProbeRecord`, `ProbeMsg`, `ProbeStatus`) imported by both capture and drift tests |
| `tugrust/crates/tugcast/tests/capture_stream_json_catalog.rs` | Capture binary (per-probe harness, normalization, schema derivation, `TUG_STABILITY=N` mode) |
| `tugrust/crates/tugcast/tests/stream_json_catalog_drift.rs` | Drift regression test + hand-rolled shape differ + inline differ unit tests |
| `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/README.md` | Placeholder vocabulary, recovery workflow, probe classification guide |
| `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.104/manifest.json` | Per-run probe status + skip reasons (normalized `captured_at`, `runtime_ms`) |
| `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.104/schema.json` | Derived shape schema per event type, polymorphic tool_use_structured, probe sequences |
| `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.104/test-*.jsonl` | 35 normalized probe event streams |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TestWs::send_interrupt` | fn | `tests/common/mod.rs` | New helper |
| `TestWs::send_tool_approval` | fn | `tests/common/mod.rs` | New helper |
| `TestWs::send_question_answer` | fn | `tests/common/mod.rs` | New helper |
| `TestWs::send_session_command` | fn | `tests/common/mod.rs` | New helper |
| `TestWs::send_model_change` | fn | `tests/common/mod.rs` | New helper |
| `TestWs::send_permission_mode` | fn | `tests/common/mod.rs` | New helper |
| CODE_INPUT handling | code path | `src/router.rs` | **Conditional:** widen to opaque pass-through if currently user_message-only |
| `ProbeRecord`, `ProbeMsg`, `ProbePrereq`, `ProbeStatus` | types | `tests/common/probes.rs` | Probe table types |
| `PROBES` | static | `tests/common/probes.rs` | 35-entry flat probe table |
| `normalize_event` | fn | `tests/capture_stream_json_catalog.rs` | Leaf-only placeholder substitution |
| `derive_schema` | fn | `tests/capture_stream_json_catalog.rs` | JSONL → schema.json |
| `execute_probe` | fn | `tests/capture_stream_json_catalog.rs` | Runs one probe against one TestTugcast |
| `capture_with_stability` | fn | `tests/capture_stream_json_catalog.rs` | TUG_STABILITY=N loop |
| `write_fixtures` | fn | `tests/capture_stream_json_catalog.rs` | Writes normalized JSONL + manifest + schema |
| `Schema`, `EventShape`, `DiffReport`, `FailureKind` | types | `tests/stream_json_catalog_drift.rs` | Differ types |
| `load_schema` | fn | `tests/stream_json_catalog_drift.rs` | Parses `v<version>/schema.json` |
| `diff_schemas` | fn | `tests/stream_json_catalog_drift.rs` | Hand-rolled shape differ |
| `diff_event_shape` | fn | `tests/stream_json_catalog_drift.rs` | Per-event-type shape comparison |
| `diff_probe_sequence` | fn | `tests/stream_json_catalog_drift.rs` | Per-probe event-sequence comparison |

---

### Documentation Plan {#documentation-plan}

- [ ] `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/README.md` — placeholder vocabulary, recovery workflow, probe classification guide
- [ ] `roadmap/transport-exploration.md` — version banner, `tugtalk` → `tugcode` rename, "Known divergences from prose catalog" section
- [ ] `roadmap/tide.md` §T0.5 — new P16/P17/... entries for any supervisor bugs surfaced during Step 4 (conditional)

---

### Test Plan Concepts {#test-plan-concepts}

| Category | Purpose | Where it lives |
|----------|---------|----------------|
| **Unit** | Pure-Rust tests for `normalize_event` and `derive_schema` | Inline `#[cfg(test)]` module in `capture_stream_json_catalog.rs`, default nextest |
| **Unit** | Pure-Rust tests for the shape differ (~20 triples) | Inline `#[cfg(test)]` module in `stream_json_catalog_drift.rs`, default nextest |
| **Integration (real-claude)** | Per-helper round-trip tests proving each new `TestWs` control send reaches tugcode | `tests/multi_session_real_claude.rs`, `#[ignore]` + `TUG_REAL_CLAUDE=1` |
| **Integration (real-claude)** | Capture binary itself — single `#[ignore]`-gated test driving the full 35-probe capture | `tests/capture_stream_json_catalog.rs`, invoked via `cargo test --test capture_stream_json_catalog -- --ignored` |
| **Drift regression (real-claude)** | The drift test — replays 35 probes and shape-diffs against golden | `tests/stream_json_catalog_drift.rs`, invoked via `cargo test --test stream_json_catalog_drift -- --ignored` |
| **Golden / Contract** | The committed `v2.1.104/` fixtures themselves | `tests/fixtures/stream-json-catalog/v2.1.104/` |

---

### Execution Steps {#execution-steps}

#### Step 1: Router CODE_INPUT pass-through audit + conditional widening {#step-1}

**Status:** **DONE** (2026-04-13) — audit only, no commit. [Q01] resolved: opaque pass-through already exists; no widening required.

**Commit:** `N/A (audit only — opaque pass-through confirmed)`

**References:** [D07] WebSocket layer capture, [Q01] CODE_INPUT pass-through audit, [R05] Router widening regression, (#strategy)

**Artifacts:**
- Resolution of [Q01] in this plan with specific file/line citations (audit finding: opaque pass-through already exists).
- ~~Conditional: patch to `src/router.rs` widening `CODE_INPUT` handling~~ — **not needed**.

**Tasks:**
- [x] Read `FeedRouter::authorize_and_claim_input` (`src/router.rs:578`) — confirmed it inspects payload only for `tug_session_id` field via `parse_tug_session_id`.
- [x] Trace the dispatcher → bridge → stdin-writer path — confirmed no `type == "user_message"` shape-check at any of the three sites (`agent_supervisor.rs:719`, `agent_bridge.rs:456`, `code.rs:18`).
- [x] Pass-through already opaque: [Q01] marked RESOLVED; moving to Step 2 with no commit.
- [ ] ~~If user-message-only: write the widening patch~~ — not applicable.
- [x] [Q01] resolution section updated with audit findings and file/line citations.

**Tests:**
- [x] ~~Conditional: re-run `--run-ignored only`~~ — not applicable (no widening landed).

**Checkpoint:**
- [x] `cargo nextest run -p tugcast` passes with zero warnings. **(318 passed, 13 skipped, 0 failed, 0 warnings.)**
- [x] [Q01] marked RESOLVED.
- [x] Conditional: ~~multi-session real-claude suite~~ — not needed; no widening.

---

#### Step 2: Extend TestWs with control-flow send helpers {#step-2}

**Depends on:** #step-1

**Commit:** `test(tugcast): extend TestWs with interrupt, tool_approval, session_command helpers`

**References:** [D02] full 35 probes, [D07] WebSocket layer capture, (#deep-probe-table)

**Artifacts:**
- `tests/common/mod.rs` — six new pub async fns on `TestWs`: `send_interrupt`, `send_tool_approval`, `send_question_answer`, `send_session_command`, `send_model_change`, `send_permission_mode`.
- `tests/multi_session_real_claude.rs` — one `#[ignore]`-gated round-trip test per new helper proving the inbound message reaches tugcode.

**Tasks:**
- [ ] Add `send_interrupt(tug_session_id)` — sends `{ "type": "interrupt", "tug_session_id": ... }` on CODE_INPUT.
- [ ] Add `send_tool_approval(tug_session_id, request_id, decision, updated_input, message)`.
- [ ] Add `send_question_answer(tug_session_id, request_id, answers: serde_json::Value)`.
- [ ] Add `send_session_command(tug_session_id, command)` — command ∈ {"new", "continue", "fork"}.
- [ ] Add `send_model_change(tug_session_id, model)`.
- [ ] Add `send_permission_mode(tug_session_id, mode)`.
- [ ] Every helper serializes via `serde_json::json!(...)`, encodes as `Frame::new(FeedId::CODE_INPUT, bytes)`, sends via `inner.send(Message::Binary(...))`.

**Tests:**
- [ ] `test_send_interrupt_reaches_tugcode` — spawn session, start long stream, `send_interrupt`, assert `turn_complete` with `result == "error"` within 5s.
- [ ] `test_send_tool_approval_roundtrip` — drive a denial-capable tool, `send_tool_approval` with `decision: "deny"`, assert `tool_result` with `is_error: true`.
- [ ] `test_send_session_command_new_respawns` — `send_session_command("new")`, assert fresh `session_init` with new session_id.
- [ ] `test_send_session_command_continue_preserves` — establish a memory marker, `send_session_command("continue")`, assert marker remembered next turn.
- [ ] `test_send_model_change_synthetic_confirmation` — `send_model_change("claude-sonnet-4-6")`, assert synthetic `assistant_text` confirming the change.
- [ ] `test_send_question_answer_roundtrip` — **may defer to Step 6** if `AskUserQuestion`-capable probe setup is non-trivial.

**Checkpoint:**
- [ ] `cargo nextest run -p tugcast` passes (no warnings).
- [ ] `TUG_REAL_CLAUDE=1 cargo nextest run -p tugcast --run-ignored only` passes — all previous 9 multi-session tests + new per-helper round-trip tests.

---

#### Step 3: Capture binary + probe table + normalization + schema derivation {#step-3}

**Depends on:** #step-2

**Commit:** `test(tugcast): add stream-json catalog capture binary + probe table + normalization`

**References:** [D01] per-probe isolation, [D02] full 35 probes, [D04] placeholder substitution, [D06] JSONL source of truth, [D08] REQUIRED vs OPTIONAL, [D09] polymorphic tool_use_structured, [D11] version resolution, [D14] leaf-only normalization, [D15] TUG_STABILITY env var, Spec S01, Spec S02, Spec S03, (#deep-probe-table, #deep-normalization)

**Artifacts:**
- `tests/common/probes.rs` — shared probe table types and `PROBES: &[ProbeRecord]` with all 35 entries.
- `tests/capture_stream_json_catalog.rs` — capture binary with:
  - `normalize_event`, `derive_schema`, `execute_probe`, `capture_with_stability`, `write_fixtures`
  - Single `#[tokio::test] #[ignore]` entry point: version detection → per-probe execution → stability loop → fixture write
  - `TUG_STABILITY` env var reader (default 1)
  - Inline `#[cfg(test)] mod tests` with pure-Rust unit tests for `normalize_event` (8+ cases) and `derive_schema` (6+ cases)

**Tasks:**
- [ ] Create `tests/common/probes.rs` with `ProbeRecord`, `ProbeMsg`, `ProbePrereq`, `ProbeStatus` types.
- [ ] Write the 35-entry `PROBES` table (start with REQUIRED-only classification; reclassify during Step 4).
- [ ] Update `tests/common/mod.rs` to export `pub mod probes;`.
- [ ] Create `tests/capture_stream_json_catalog.rs` with `#[ignore]` + env gate on `TUG_REAL_CLAUDE`.
- [ ] Implement `normalize_event(value: &mut serde_json::Value)` per [D04]/[D14]/[#deep-normalization].
- [ ] Implement `derive_schema(events: &[(FeedId, serde_json::Value)]) -> Schema` per [#deep-shape-differ] and Spec S03.
- [ ] Implement `execute_probe(probe, ws, tug_session_id) -> ProbeResult` — runs input_script, collects CODE_OUTPUT + SESSION_METADATA frames until terminal event or timeout.
- [ ] Implement `capture_with_stability(probes, n) -> Vec<ProbeResult>` — runs each probe n times, asserts shape-identity, reports flapping as `ShapeUnstable`.
- [ ] Implement `write_fixtures(results, version)` — writes normalized JSONL + manifest.json + schema.json under `tests/fixtures/stream-json-catalog/v<version>/`.
- [ ] Read `TUG_STABILITY` env var (default 1).
- [ ] Add inline `#[cfg(test)] mod tests` covering `normalize_event` leaf substitution, object-structure preservation, array-structure preservation, polymorphic tool_result, and `derive_schema` basic / optional fields / polymorphic tool_use_structured / probe sequences.

**Tests:**
- [ ] Pure-Rust unit tests for `normalize_event` (8+ cases) pass in default nextest.
- [ ] Pure-Rust unit tests for `derive_schema` (6+ cases) pass in default nextest.
- [ ] `cargo test --test capture_stream_json_catalog -- --ignored --list` prints the single real-claude test name.

**Checkpoint:**
- [ ] `cargo check --tests -p tugcast` passes with zero warnings.
- [ ] `cargo nextest run -p tugcast` passes (includes new unit tests).
- [ ] No fixtures committed yet (capture binary exists, but no `v*/` directory).

---

#### Step 4: Baseline capture run + commit v2.1.104/ fixtures {#step-4}

**Depends on:** #step-3

**Commit:** `test(tugcast): commit v2.1.104 golden stream-json catalog baseline`

**References:** [D01] per-probe isolation, [D02] full 35 probes, [D08] REQUIRED vs OPTIONAL, [D10] supervisor bugs as follow-ups, [D11] version resolution, [D15] TUG_STABILITY env var, [R01] session-command probes, [R02] shape instability, Spec S01, (#success-criteria)

**Artifacts:**
- `tests/fixtures/stream-json-catalog/v2.1.104/` with 35 normalized probe JSONL files + `manifest.json` + `schema.json`.
- **Conditional:** new P16/P17/... entries in `roadmap/tide.md` §T0.5 if supervisor bugs surfaced.
- **Conditional:** amendments to `tests/common/probes.rs` reclassifying flapping events REQUIRED → OPTIONAL (may land in this same commit or a preceding tweak to Step 3).

**Tasks:**
- [ ] Run `TUG_STABILITY=3 TUG_REAL_CLAUDE=1 cargo test --test capture_stream_json_catalog -- --ignored`.
- [ ] Review `manifest.json`.
- [ ] For each probe marked `ShapeUnstable`: reclassify flapping events REQUIRED → OPTIONAL in `tests/common/probes.rs`, re-run.
- [ ] For each probe marked `Failed` from session-command routing (probes 13/17/20): log a new P16/P17/... entry in `roadmap/tide.md` §T0.5 (pointer to probe name + symptom), mark probe `skipped` with `reason: "blocked on P<N>"`, re-run.
- [ ] For each probe marked `Skipped` due to missing prerequisites (probes 25/28/34/35 if tugplug not loaded): leave skipped with `reason: "tugplug plugin not loaded"`.
- [ ] Iterate until the stability run passes with all 35 probes either `Passed` or explicitly `Skipped` with a logged reason.
- [ ] Visually spot-check 3–5 committed fixture files — no unnormalized UUIDs, no absolute paths, no raw text leaks, structure preserved.
- [ ] `git add tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.104/`.

**Tests:**
- [ ] `TUG_STABILITY=3 TUG_REAL_CLAUDE=1 cargo test --test capture_stream_json_catalog -- --ignored` passes.
- [ ] `TUG_REAL_CLAUDE=1 cargo test --test capture_stream_json_catalog -- --ignored` (default stability 1) passes against the committed baseline.

**Checkpoint:**
- [ ] `git status` shows `tests/fixtures/stream-json-catalog/v2.1.104/` with 35 JSONL files + `manifest.json` + `schema.json`.
- [ ] `grep -rE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}' tests/fixtures/stream-json-catalog/v2.1.104/*.jsonl` returns nothing (no unnormalized UUIDs).
- [ ] Manifest.json lists all 35 probes with explicit status.
- [ ] Any new §T0.5 P16/P17/... follow-ups committed alongside (or in a preceding fixup commit) and linked from manifest.json skip reasons.

---

#### Step 5: Prose rename + version banner + known divergences {#step-5}

**Depends on:** #step-4

**Commit:** `docs(transport): rename tugtalk to tugcode, add stream-json fixture version banner`

**References:** [D06] JSONL source of truth, Spec S01, (#context)

**Artifacts:**
- `roadmap/transport-exploration.md` — all `tugtalk` → `tugcode` replacements (except historical methodology footnote for `tugtalk/probe.ts`), top-of-doc version banner, "Known divergences from prose catalog" section.

**Tasks:**
- [ ] Find all `tugtalk` references in `roadmap/transport-exploration.md`. Replace with `tugcode` unless the context specifically refers to the legacy `tugtalk/probe.ts` probe harness (preserve historical accuracy in the methodology footnote).
- [ ] Add version banner at the top:
  > *This document was empirically verified against `claude 2.1.87` (initial capture, 2026-03-29) and `2.1.104` (multi-session router Step 10 integration run, 2026-04-12). The **authoritative machine-readable golden fixtures** live at `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/` and are ground truth — this prose catalog is a human-readable summary that may lag behind the fixtures. If the drift test fails, the fixtures are correct and this document is stale; update the prose to match.*
- [ ] Add a "Known divergences from prose catalog" section at the top listing any deltas Step 4 surfaced between the prose and the fixtures.
- [ ] Cross-link from the banner to [`roadmap/tide.md#p2-followup-golden-catalog`](tide.md#p2-followup-golden-catalog) and to `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/README.md`.

**Tests:**
- [ ] `grep -c tugtalk roadmap/transport-exploration.md` returns ≤ 1 (only the historical methodology footnote permitted).

**Checkpoint:**
- [ ] `roadmap/transport-exploration.md` opens with the version banner.
- [ ] "Known divergences from prose catalog" section exists at the top.
- [ ] Zero raw `tugtalk` references outside the historical methodology footnote.

---

#### Step 6: Drift regression test + hand-rolled shape differ + differ unit tests {#step-6}

**Depends on:** #step-4

**Commit:** `test(tugcast): add stream-json drift regression test + hand-rolled shape differ`

**References:** [D02] full 35 probes, [D03] hand-rolled differ, [D05] separate cargo test runner, [D06] JSONL source of truth, [D09] polymorphic tool_use_structured, [D12] depth-8 shape walk, [D13] no version fallback, [R03] differ bug risk, Spec S03 schema.json, (#deep-shape-differ)

**Artifacts:**
- `tests/stream_json_catalog_drift.rs` — single `#[ignore]`-gated real-claude test that:
  - Resolves installed claude version via probe 1
  - Loads `v<version>/schema.json` from disk (fails hard if missing, per [D13])
  - Runs all 35 probes via shared `PROBES`
  - Derives a live schema via `derive_schema` (imported or duplicated from Step 3)
  - Diffs live schema against golden schema via `diff_schemas`
  - Emits a structured failure report on any fail-severity finding
- Inline `#[cfg(test)] mod differ_tests` with ~20 hand-crafted triples.

**Tasks:**
- [ ] Create `tests/stream_json_catalog_drift.rs` with `#[ignore]` + `TUG_REAL_CLAUDE` env gate + `#[tokio::test]`.
- [ ] Confirm the test is NOT picked up by `cargo nextest run -p tugcast --run-ignored only` — if nextest's default discovery includes it, add a `#[cfg_attr(not(feature = "drift-test"), ignore)]` or rename the test so nextest filtering excludes it, or document the manual invocation convention.
- [ ] Define `Schema`, `EventShape`, `DiffReport`, `FailureKind` types.
- [ ] Implement `load_schema(path) -> Schema` parsing `v<version>/schema.json` per Spec S03.
- [ ] Implement `diff_schemas(golden, current) -> DiffReport` per [#deep-shape-differ]:
  - Unknown event type → fail
  - Missing required field → fail
  - Type mismatch → fail
  - New field → warn
  - Nested object recursion (depth 8 max, fails with `DepthLimitExceeded` beyond)
  - Array-of-objects first-element comparison
  - Polymorphic `tool_use_structured` union by `tool_name`
  - Per-probe sequence invariant (added optional slot → warn; removed required slot → fail)
- [ ] Implement structured diff report: nested bullets naming probe, event index, JSON path, golden shape, current shape, severity.
- [ ] Implement the main test function: version detect → load golden → run all 35 probes → derive current schema → diff → fail with structured report on any fail-severity finding.
- [ ] Add `#[cfg(test)] mod differ_tests` with ~20 triples:
  - Identical shapes → empty report
  - New optional field → warn only
  - Removed required field → fail
  - Type change (string → number) → fail
  - Unknown event type → fail
  - Nested object field added → warn at correct path
  - Nested object required field removed → fail at correct path
  - Array primitive type change → fail
  - Array-of-objects element shape change → fail
  - Polymorphic `tool_use_structured` Read vs Glob → diff by `tool_name` separately
  - Probe sequence: added optional slot → warn
  - Probe sequence: removed required slot → fail
  - Probe sequence: reordered required slots → fail
  - Depth-8 limit reached → fail with `DepthLimitExceeded`
  - Empty golden → fail (`no known events`)
  - Empty current → fail (`no events captured`)
  - Required field present but null → fail (null violates non-null type)
  - Optional field present with wrong type → fail
  - `tool_use_structured` with new tool_name → warn (new union arm)
  - `tool_use_structured` with removed tool_name → fail (removed union arm, required)

**Tests:**
- [ ] All ~20 differ unit tests pass in `cargo nextest run -p tugcast`.
- [ ] `TUG_REAL_CLAUDE=1 cargo test --test stream_json_catalog_drift -- --ignored` passes against the Step 4 committed baseline.

**Checkpoint:**
- [ ] `cargo nextest run -p tugcast` passes (includes differ unit tests).
- [ ] `TUG_REAL_CLAUDE=1 cargo test --test stream_json_catalog_drift -- --ignored` passes against `claude 2.1.104`.
- [ ] `TUG_REAL_CLAUDE=1 cargo nextest run -p tugcast --run-ignored only` does NOT include the drift test in its run set (confirmed via `--list` output).

---

#### Step 7: Recovery README {#step-7}

**Depends on:** #step-6

**Commit:** `docs(tugcast): add stream-json catalog recovery README`

**References:** [D04] placeholder substitution, [D06] JSONL source of truth, [D08] REQUIRED vs OPTIONAL, [D13] no version fallback, Spec S01, (#step-4, #step-6)

**Artifacts:**
- `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/README.md` with:
  - One-paragraph "what this is" summary + layer caveat from [D07]
  - Placeholder vocabulary table (`{{uuid}}`, `{{iso}}`, `{{f64}}`, `{{i64}}`, `{{text:len=N}}`, `{{cwd}}/...`, `{{tool_use_id}}`, `{{msg_id}}`, `{{request_id}}`)
  - Fixture layout section (from Spec S01)
  - Recovery workflow numbered steps (benign / semantic / ambiguous classification)
  - "How to add a new probe to the table" section
  - "How to classify REQUIRED vs OPTIONAL" section
  - Cross-links to [`roadmap/tide.md#p2-followup-golden-catalog`](../../../../../../roadmap/tide.md#p2-followup-golden-catalog) and [`roadmap/transport-exploration.md`](../../../../../../roadmap/transport-exploration.md)

**Tasks:**
- [ ] Draft the README.
- [ ] Ensure every section from the Artifacts list is present.
- [ ] Cross-link from `roadmap/transport-exploration.md`'s version banner (update that file if needed).

**Tests:**
- [ ] (none — documentation only)

**Checkpoint:**
- [ ] `tests/fixtures/stream-json-catalog/README.md` exists.
- [ ] `transport-exploration.md` version banner links to it.

---

#### Step 8: Integration Checkpoint — pre-T3.4.a dress rehearsal {#step-8}

**Depends on:** #step-4, #step-5, #step-6, #step-7

**Commit:** `N/A (verification only)`

**References:** [D10] supervisor bugs as follow-ups, all success criteria, (#success-criteria)

**Tasks:**
- [ ] Run the full end-to-end pipeline against current `claude` version, as a fresh developer would:
  1. `TUG_STABILITY=3 TUG_REAL_CLAUDE=1 cargo test --test capture_stream_json_catalog -- --ignored`
  2. Review `manifest.json` — no unexpected skips, no stability failures
  3. `TUG_REAL_CLAUDE=1 cargo test --test stream_json_catalog_drift -- --ignored` — passes
  4. `cargo nextest run -p tugcast` — passes (includes all unit tests from Steps 3 and 6)
  5. `TUG_REAL_CLAUDE=1 cargo nextest run -p tugcast --run-ignored only` — passes (multi-session regression guard)
- [ ] Confirm SC1–SC9 all hold.
- [ ] Log any supervisor bugs or other surprises as new §T0.5 entries in `roadmap/tide.md`.
- [ ] Mark this plan's `Status` field as `landed` in [#plan-metadata].

**Tests:**
- [ ] All five commands from the task list succeed.

**Checkpoint:**
- [ ] `TUG_STABILITY=3 TUG_REAL_CLAUDE=1 cargo test --test capture_stream_json_catalog -- --ignored` passes.
- [ ] `TUG_REAL_CLAUDE=1 cargo test --test stream_json_catalog_drift -- --ignored` passes.
- [ ] `cargo nextest run -p tugcast` passes.
- [ ] `TUG_REAL_CLAUDE=1 cargo nextest run -p tugcast --run-ignored only` passes.
- [ ] SC1–SC9 all verified.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A versioned machine-readable golden catalog of Claude Code stream-json event shapes, a hand-rolled shape differ, and a drift regression test — ready to protect T3.4.a's `CodeSessionStore` from silent version drift.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Step 1 landed: [Q01] resolved; router opaque pass-through confirmed or widened with no multi-session regressions.
- [ ] Step 2 landed: 6 `TestWs` control helpers + per-helper round-trip integration tests passing.
- [ ] Step 3 landed: capture binary + probe table + normalization + schema derivation, with pure-Rust unit tests passing in default nextest.
- [ ] Step 4 landed: `v2.1.104/` baseline fixtures committed; all 35 probes either `passed` or explicitly `skipped` with a logged reason.
- [ ] Step 5 landed: `roadmap/transport-exploration.md` has version banner, "Known divergences" section, zero `tugtalk` references outside historical footnote.
- [ ] Step 6 landed: drift regression test + hand-rolled shape differ + ~20 inline unit tests passing in default nextest; drift test not picked up by `--run-ignored only`.
- [ ] Step 7 landed: recovery README exists with placeholder vocabulary, recovery workflow, probe classification guide.
- [ ] Step 8 passed: full dress-rehearsal pipeline passes against `claude 2.1.104`; SC1–SC9 verified.
- [ ] §T0.5 follow-ups logged for any supervisor bugs surfaced during Step 4 (or explicit "no bugs" note in Step 8's checkpoint).

**Acceptance tests:**
- [ ] `TUG_STABILITY=3 TUG_REAL_CLAUDE=1 cargo test --test capture_stream_json_catalog -- --ignored` passes
- [ ] `TUG_REAL_CLAUDE=1 cargo test --test stream_json_catalog_drift -- --ignored` passes
- [ ] `cargo nextest run -p tugcast` passes
- [ ] `TUG_REAL_CLAUDE=1 cargo nextest run -p tugcast --run-ignored only` passes (regression guard for multi-session tests)

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] P15 Layer B runtime divergence telemetry (new `SUPERVISOR_TELEMETRY` FeedId, `stream_json_divergence` events)
- [ ] P15 Layer C version-adaptive reducer scaffold in `CodeSessionStore`
- [ ] P16/P17/... supervisor bug fixes surfaced by session-command or tugplug probes during Step 4
- [ ] Auto-capture tooling (GitHub Action triggered on claude version bump)
- [ ] Cross-version diff tool (`v2.1.104/` vs `v2.1.105/` batch comparison)
- [ ] Broadening the probe table with new T3.4.a-specific invariants once T3.4.a reveals gaps

| Checkpoint | Verification |
|------------|--------------|
| Step 1 router audit | `cargo nextest run -p tugcast --run-ignored only` passes after Step 1 |
| Step 2 TestWs helpers | Per-helper round-trip tests pass |
| Step 3 capture binary | Unit tests pass in default nextest; `--ignored --list` shows capture test |
| Step 4 baseline fixtures | `v2.1.104/` dir committed; 35 probes accounted for in manifest.json |
| Step 5 prose update | `grep -c tugtalk` ≤ 1; version banner present |
| Step 6 drift test + differ | Unit tests pass; `--ignored` run passes against baseline; not in `--run-ignored only` bucket |
| Step 7 recovery README | File exists with all required sections |
| Step 8 dress rehearsal | SC1–SC9 all verified; §T0.5 follow-ups logged (or "no bugs" note) |
