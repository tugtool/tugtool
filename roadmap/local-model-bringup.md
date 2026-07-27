<!-- devise-skeleton v4 -->

## Local-Model Bring-Up — On-Device Ternary Bonsai for Shell Routing and Pulse Overviews {#local-model-bringup}

**Purpose:** Ship an opt-in on-device model (Ternary-Bonsai-8B, 2-bit, on stock MLX via `mlx-swift` in Tug.app) that powers two features for users who opt in during TugSetup: model-assisted shell/prompt disambiguation in the Session card's prompt entry, and a new high-level "overview" line in the Pulse strip. Users who opt out get neither feature and lose nothing that exists today.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | dash worktree (mlx-swift work explicitly dash-first; release the dash if the SPM dependency proves unacceptable) |
| Last updated | 2026-07-26 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The Bonsai evaluation (`roadmap/local-model-investigations.md`, the durable record; harness at `~/bonsai-eval/`) established that a small local model is excellent at short-context bounded work and poor at long-context comprehension. Scribe therefore stays on Sonnet, but two jobs fit: **shell-line classification** (the 1-bit 8B scored 26/26 on real typed lines at ~198 ms) and a **Pulse "part one" overview headline** (accurate synthesized session summaries in <1.5 s from a compact digest). The heuristic shell classifier already on main is parked off (`AUTO_SHELL_DETECTION_ENABLED = false` in `tugdeck/src/lib/shell-line-classifier.ts`) precisely because a first-word/PATH heuristic misfires on prose openers that are also executables (`write …`, `apply …`) — the code comment says detection stays off "until a model classifier can judge intent." This plan is that model classifier.

The eval's 26/26 and pulse results belong to the **1-bit** Bonsai-8B, whose kernels live only in the PrismML MLX fork (upstream tracking: `ml-explore/mlx#3161`). The shipping choice is the **ternary 2-bit 8B on stock MLX**, which dodges the fork entirely — but ternary has only ever been measured on scribe (where it was weak-but-format-clean). The whole plan is therefore gated on a front-loaded spike ([P01]): re-validate this specific model on these two specific tasks, and prove `mlx-swift` can actually run the pack. If the spike fails its bar, we stop before any integration legwork.

#### Strategy {#strategy}

- **Spike first, everything else second.** Steps 1–2 validate the exact shipping model on the exact two tasks and prove the exact runtime, with explicit STOP criteria ([P01]). Both tasks must come out *fast, solid, reliable, and a real improvement* or the plan halts.
- **Never bundle the weights.** ~2 GB downloads post-install, opt-in, from HuggingFace at a pinned revision with per-file sha256 ([P03], [P04]). No Tug CDN yet — that is a follow-on.
- **The downloader must be boringly robust.** Resumable, checksummed, cancellable, atomic, and self-healing across relaunches — TugSetup must never strand a half-downloaded user ([P04], Risk R03).
- **One opt-in flag drives everything.** `dev.tugtool.local-model/enabled` (default OFF) is the single source of user intent; disk presence is probed, never trusted from a flag ([P05]). Every consumer degrades gracefully when the flag is off or the model is absent ([P11]).
- **Inference lives in the Swift host** (`mlx-swift`, runtime option A from the investigation doc), reached over the two IPC channels that already exist: the WKWebView script-message bridge for deck-originated classify calls ([P07]) and the UDS control socket for tugcast-originated summarize calls ([P08]).
- **The Session card never blocks on inference.** The heuristic stays the fast path for shell routing; the model is consulted asynchronously only for the ambiguous middle band ([P09], Spec S06).
- **PulseVoice (part two) is untouched.** The overview line is a new tugcast-side component emitting a new `kind: "overview"` pulse frame; the tugpulse daemon and its wire tap are not modified ([P10]).
- **mlx-swift lands on a dash.** It is tugapp's first SPM dependency ever (the pbxproj has zero `XCRemoteSwiftPackageReference` entries today); if it proves truly awful, release the dash and reconsider.

#### Success Criteria (Measurable) {#success-criteria}

- Spike: ternary-2bit-8B scores ≥ 25/26 on the classify corpus and produces accurate, preamble-free headlines on all six pulse digest fixtures, each classify ≤ 400 ms and each summarize ≤ 3 s on the dev machine (measured by the `~/bonsai-eval/` harness, Step 1).
- Spike: the same pack loads and generates under `mlx-swift`/MLXLLM with classify ≤ 500 ms warm and RAM ≤ 3 GB resident (measured by the scratch runner, Step 2).
- A fresh instance with `enabled=true` and no model directory downloads, verifies, and finalizes the pack; killing tugcast mid-download and relaunching resumes and completes without re-downloading finished files (verified by Rust integration test against a local HTTP server + manual kill test).
- TugSetup shows the optional step on first run; Skip leaves the flag off and every existing behavior identical; opting in shows determinate progress and lands on "done" (manual verification in the debug app; `bunx vite build` green).
- With the model installed and enabled: typing `make the button bigger` routes to Claude, `make test` routes to shell, submit latency for unambiguous lines is unchanged (heuristic path — no model call issued, assertable in unit tests of the band logic).
- With the model installed and enabled: an active session's Pulse strip shows a stable overview line above the live beat line within ~30 s of turn activity; with the flag off or model absent, the strip renders exactly as today (app-test assertable for the absent case; manual for the live case).
- `cd tugrust && cargo nextest run` green, `just test-ts` green, `bunx vite build` green, `just app-test-changed` green at every step boundary.

#### Scope {#scope}

1. Spike: re-validate ternary-2bit-8B on classify + pulse-headline tasks; prove `mlx-swift` runs the pack; capture the pinned HF manifest.
2. tugcast: model store (paths, manifest, verify, presence probe) + robust downloader (control actions, progress frames, resume, cancel, startup auto-resume).
3. tugdeck: local-model store + TugSetup opt-in step with determinate download progress.
4. Tug.app: `mlx-swift`/MLXLLM SPM dependency + `LocalModelService` (lazy load, warm-while-active, idle unload) + both IPC endpoints.
5. tugdeck: shell disambiguation — heuristic bands + async model tiebreak, un-parking the feature for opted-in users.
6. tugcast + tugdeck: Pulse part-one overview (digest builder, cadence, summarize round-trip, `kind:"overview"` frame, two-line strip).

#### Non-goals (Explicitly out of scope) {#non-goals}

- Scribe changes of any kind — commit drafting stays on Sonnet, and no code path may silently route it locally (Risk R05).
- The 1-bit model, the PrismML MLX fork, the 27B, llama.cpp, or any Python runtime in the product.
- A Tug CDN for weights (HuggingFace pinned-revision is the v1 source; CDN is a follow-on).
- A general settings surface for the opt-in toggle (deferred, [Q04]) — v1 re-entry for already-set-up users is the tugbank flag itself ([P05]).
- Ledger persistence for overview lines (deferred, [Q05]) — v1 overviews are broadcast-only and re-emitted on cadence.
- The larger Pulse redesign (multi-session Lens awareness etc.) — this plan lands only the part-one overview line that redesign will build on.
- SC/TC CJK, IndexedDB, or any other adjacent deck infra.

#### Dependencies / Prerequisites {#dependencies}

- `~/bonsai-eval/` harness intact (Python `.venv` with the PrismML fork for reference runs; `classify_8b.py`, `pulse_8b.py`, `eval_mlx.py`; `Ternary-Bonsai-8B-mlx-2bit` pack under `Bonsai-demo/models/`). Note: the *stock-MLX* re-validation in Step 1 must run the ternary pack on **stock** `mlx-lm`, not the fork — the ternary pack was chosen precisely because it needs no fork.
- Network access to `huggingface.co` for the pinned-revision download.
- Xcode toolchain able to resolve SPM packages (`ml-explore/mlx-swift`, `ml-explore/mlx-swift-examples`).
- A dash worktree for the tugapp/SPM steps (user creates the dash; this plan never creates one on its own).

#### Constraints {#constraints}

- **WARNINGS ARE ERRORS** across the Rust workspace (`tugrust/.cargo/config.toml`).
- No >1 GB blob in the install package — weights are download-only (product decision, restated from the investigation doc).
- No localStorage/sessionStorage/IndexedDB — persistent deck state goes through tugbank `/api/defaults/<domain>/<key>`.
- Deck work obeys tuglaws ([L01], [L02], [L03], [L06]); the State Zone Mapping below is normative.
- App-tests run selectively (`just app-test-changed`); every new test carries `@covers`.
- bun, never npm; tugdeck HMR is live; `bunx vite build` before declaring any tugdeck change done.
- Only the user commits on main; implementation happens on a dash via `tugutil dash commit`.

#### Assumptions {#assumptions}

- The Ternary-Bonsai-8B 2-bit pack is redistributable (Bonsai is Apache-2.0) and remains available on HuggingFace at a pinnable revision.
- The pack's architecture is loadable by MLXLLM's model factory (llama-family config) — verified, not assumed, by Step 2; if it needs a small custom model definition in Swift, Step 2 sizes that work before the gate decision.
- ~2 GB disk and ~2–3 GB transient RAM while warm are acceptable costs for an opt-in feature.
- The `session_capabilities`/CONTROL plumbing and tugbank DEFAULTS-frame subscriptions behave as they do today (no protocol rework needed).

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Does ternary-2bit-8B hold the 1-bit's quality on the two shipping tasks? (OPEN) {#q01-ternary-quality}

**Question:** The 26/26 classify and the six good pulse headlines were measured on the fork-only 1-bit model. Does the ternary 2-bit pack — on stock MLX — match them within the Success Criteria bars?

**Why it matters:** If ternary underperforms, the runtime decision reopens (fork vs wait for `mlx#3161`) and the whole plan halts per the user's gate: if the two features aren't fast, solid, reliable, and a true improvement, the bring-up legwork isn't worth doing.

**Plan to resolve:** Step 1 (Spike A) runs `classify_8b.py` and `pulse_8b.py` against the ternary pack on stock `mlx-lm`, records scores and latencies into this document.

**Resolution:** OPEN — Step 1 is the gate. STOP rule: classify < 25/26 or any headline hallucinated/preambled after one round of prompt tightening → halt and report.

#### [Q02] Can mlx-swift/MLXLLM load and run the ternary pack? (OPEN) {#q02-mlx-swift-loads}

**Question:** Does the stock `mlx-swift` stack (MLXLLM model factory + swift-transformers tokenizer) load the ternary 2-bit safetensors pack from a local directory and generate at acceptable speed, or does the architecture/quant format need custom Swift-side support?

**Why it matters:** [P02] rests on it. If MLXLLM cannot load the pack, the fallback is writing a model definition in Swift (sized in Step 2) or abandoning option A.

**Plan to resolve:** Step 2 (Spike B) — a scratch SwiftPM executable outside the repo that loads the local pack and runs both task prompts.

**Resolution:** OPEN — Step 2 resolves; findings recorded here.

#### [Q03] Exact HF repo, revision, file manifest, and sha256 set (OPEN) {#q03-model-manifest}

**Question:** The pack exists locally at `~/bonsai-eval/Bonsai-demo/models/Ternary-Bonsai-8B-mlx-2bit/`; what is its canonical HuggingFace repo id, which git revision do we pin, which files constitute the pack, and what are their sha256 digests?

**Why it matters:** Spec S01 (the manifest compiled into tugcast) cannot be filled without it; pinning exact bytes is the download-integrity story.

**Plan to resolve:** During Step 2, identify the repo (check the local pack's provenance/README, or PrismML's HF org), pin the revision, `sha256sum` every file, and fill Spec S01 in this document.

**Resolution:** OPEN — resolved by Step 2.

#### [Q04] Post-setup opt-in surface for already-set-up users (DEFERRED) {#q04-settings-reentry}

**Question:** TugSetup shows steps only on first run (or while logged out); where does an existing user opt in from the UI?

**Why it matters:** Without re-entry, only fresh installs get the feature from the UI.

**Resolution:** DEFERRED. Per [P05], all consumers key off the tugbank flag and the auto-resume downloader, so opting in today is one CLI write (`tugbank` CLI or a PUT to `/api/defaults/dev.tugtool.local-model/enabled`) and the next tugcast launch (or an immediate `local_model_download` control frame) does the rest. A proper settings surface rides the future settings/Lens work. Revisit when the Pulse/Lens redesign lands.

#### [Q05] Should overview lines persist in the pulse ledger? (DEFERRED) {#q05-overview-ledger}

**Question:** Beat lines are ledgered (`PULSE_LEDGER_CAP` rows, tail-seeded on daemon respawn and served via `list_pulse_lines`); should overview lines persist too?

**Why it matters:** Without persistence, a freshly connected deck has no overview until the next cadence tick (≤ ~30 s of activity).

**Resolution:** DEFERRED — acceptable v1 gap; the cadence re-emit covers it. Revisit with the larger Pulse redesign, which will want overview history anyway.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Ternary quality below bar (R01) | high | med | Spike gate with STOP rule | Step 1 results |
| MLXLLM can't load the pack (R02) | high | med | Spike B before any tugapp work; size custom-model fallback | Step 2 results |
| Download frustration in TugSetup (R03) | high | med | Resume + checksum + atomic finalize + startup auto-resume + honest error/retry UI | any failed-download bug report |
| First SPM dep destabilizes app build/signing (R04) | med | med | Dash-first; release the dash if awful | Step 8 experience |
| Local path silently takes over scribe (R05) | high | low | No scribe code touched; service API is task-shaped (`classify`/`summarize` only) | any scribe diff in review |
| Misroute prose to shell (R06) | med | low | Asymmetric bands (Spec S06): unsure+no-verdict → Code; auto-routed rows keep the visible "send to Claude instead" attribution | user misroute reports |

**Risk R01: Ternary model quality** {#r01-ternary-quality}

- **Risk:** The shipping model underperforms the 1-bit results that motivated the plan.
- **Mitigation:** Step 1 gate; one round of prompt tightening allowed (the eval showed the pulse preamble wart fixes with one line); otherwise halt.
- **Residual risk:** The 26-line classify corpus is small; real-world lines may surface new failure shapes. The band design (Spec S06) bounds the blast radius — the model only ever decides lines the heuristic already refused to auto-route.

**Risk R03: Download robustness** {#r03-download-robustness}

- **Risk:** A flaky network or mid-download quit leaves the user stuck or restarts 2 GB from zero, souring TugSetup.
- **Mitigation:** HTTP Range resume against `.part` staging files; per-file sha256 before finalize; atomic directory rename; tugcast re-runs an incomplete opted-in download at startup with no user action; cancel is instant and clean; a pid-stamped `O_EXCL` staging lockfile with post-acquire stamp re-check serializes concurrent tugcast instances over the shared models dir (Spec S02).
- **Residual risk:** HuggingFace availability/rate limits — accepted for v1 (no Tug CDN yet); the error row in TugSetup offers Retry and Skip.

---

### Design Decisions {#design-decisions}

#### [P01] The spike is a hard gate (DECIDED) {#p01-spike-gate}

**Decision:** Steps 1–2 run before any integration work, and the plan halts if either misses its Success Criteria bar.

**Rationale:**
- Every measured result for the two tasks belongs to a different model (1-bit, fork-only); the shipping model has never run them.
- The user's explicit gate: both features must be fast, solid, reliable, and truly an improvement, or the legwork isn't worth it.

**Implications:**
- Steps 3+ carry `Depends on: #step-2` transitively; the Step Status Ledger makes the gate visible to `/tugplug:implement`.
- Spike findings (scores, latencies, manifest) are written back into this document (Q01–Q03 resolutions) so later steps and later sessions inherit them.

#### [P02] Runtime is mlx-swift in Tug.app (DECIDED) {#p02-runtime-mlx-swift}

**Decision:** Inference runs in-process in the Swift host via `mlx-swift` + MLXLLM (option A from the investigation doc); no Python, no subprocess server, no fork.

**Rationale:**
- Metal-backed, native, zero interpreter shipping burden; the rejected option B (supervised `mlx_lm.server`) means bundling a Python venv.
- The ternary pack runs on stock MLX, which is exactly what `mlx-swift` wraps.

**Implications:**
- tugapp gains its first SPM dependencies (`ml-explore/mlx-swift`, `ml-explore/mlx-swift-examples` products MLXLLM/MLXLMCommon), added to `tugapp/Tug.xcodeproj/project.pbxproj` on a dash.
- Both feature callers reach Swift over existing IPC ([P07], [P08]).

#### [P03] Model = Ternary-Bonsai-8B-mlx-2bit, pinned, downloaded (DECIDED) {#p03-model-choice}

**Decision:** The one shipping model is the ternary 2-bit 8B pack at a pinned HuggingFace revision, downloaded post-install into `~/Library/Application Support/Tug/models/`, never bundled.

**Rationale:**
- No fork dependency (1-bit kernels are fork-only; `mlx#3161` untracked-timeline).
- Hard product constraint: no >1 GB blob in the installer.
- HuggingFace-pinned is the v1 source per the user's call; a Tug CDN is follow-on infra.

**Implications:**
- Spec S01 manifest (repo, revision, files, sha256s, total bytes) is compiled into tugcast; upgrading the model is a manifest bump.
- The models tree is instance-independent (shared across tugcast instances, like `Tug/Drafts` — see `tugrust/crates/tugcast/src/fs_write.rs` for the `dirs::home_dir()`-based Application Support pattern).

#### [P04] The downloader lives in tugcast (DECIDED) {#p04-downloader-in-tugcast}

**Decision:** tugcast owns acquisition: a `local_model_download` control action drives a resumable, checksummed, cancellable download task that broadcasts progress on CONTROL, and tugcast auto-resumes an incomplete opted-in download at startup.

**Rationale:**
- The deck→tugcast control-frame round trip is the exact precedent TugSetup already uses for long native operations (`install_claude` in `tugrust/crates/tugcast/src/actions.rs` → `claude_install_result` on CONTROL).
- Rust gives us sha2 (already a dep), tokio, and easy integration testing against a local HTTP server; Swift needs only the finished files.
- Startup auto-resume makes the flag the single lever ([P05]) and is the robustness backstop (R03).

**Implications:**
- `reqwest` joins the workspace deps (tugcast has no HTTP client today; axum is server-only).
- New tugcast module `local_model.rs` (Spec S01, S02); new action arms in `dispatch_action`.

#### [P05] One opt-in flag, default OFF; disk is truth for presence (DECIDED) {#p05-optin-flag}

**Decision:** User intent is `dev.tugtool.local-model` / `enabled` (`Value::Bool`), read default-**OFF** when absent; model availability is always a filesystem probe of the finalized pack, never a flag.

**Rationale:**
- Opt-in must invert the repo's default-ON flag convention (contrast `PULSE_ENABLED_DOMAIN` in `feeds/pulse.rs`, absent ⇒ enabled) — absent here means "never asked / declined."
- Flag-driven means TugSetup, a future settings surface, and the `tugbank` CLI are all equivalent writers ([Q04]).

**Implications:**
- Constants declared in parallel Rust + TS (the `pulse/enabled` pattern): `LOCAL_MODEL_DOMAIN = "dev.tugtool.local-model"`, `LOCAL_MODEL_ENABLED_KEY = "enabled"`.
- Swift reads the same key natively via `tugapp/Sources/TugbankClient.swift` when deciding whether the service may load.

#### [P06] TugSetup grows one optional step; Skip is first-class (DECIDED) {#p06-tugsetup-step}

**Decision:** A fourth step, "Set up on-device AI (optional)", appears in `TugSetup` after sign-in: **Download** writes `enabled=true` and sends `local_model_download`; **Skip** marks the step done-without-model and never nags again. Declining costs nothing; the step never blocks the "Start a Claude Code session" step.

**Rationale:**
- The wizard's `Step` objects (`tugdeck/src/components/tugways/tug-setup.tsx`) are plain data — adding a step is additive; unhappy paths are first-class designed states there by precedent.
- Per the user: opting out simply means not getting the two features.

**Implications:**
- The `StepRow` gains an optional secondary CTA (Skip) — today it renders a single `cta`; extend the `Step` type with `secondaryCta`.
- The busy state renders determinate progress (`TugProgressIndicator` variant `bar` with `value`/`max` — the primitive already supports it; today's install step is indeterminate only because `install_claude` reports no progress).
- "Skip asked-and-declined" is recorded as `enabled=false` written explicitly (distinguishable from absent only if we care later; v1 does not).

#### [P07] Classify IPC = WKWebView script-message bridge (DECIDED) {#p07-classify-ipc}

**Decision:** The deck calls the Swift service through a new `localModel` script-message handler in `tugapp/Sources/MainWindow.swift`, correlated by `requestId`, replied via `window.__tugBridge?.onLocalModelResult?.(…)`.

**Rationale:**
- The classify caller is deck code (`tug-prompt-entry.tsx`); the bridge is the direct channel (handlers registered in `MainWindow.swift`, dispatch switch + `evaluateJavaScript` replies — the `clipboardRead`/`getSettings` pattern).
- No tugcast hop for a ~200 ms interactive call.

**Implications:**
- New deck module `tugdeck/src/lib/local-model-bridge.ts` (Spec S03): pending-request map, timeout (unavailable ⇒ null verdict), graceful no-op when the handler is absent (browser dev, app-tests).

#### [P08] Summarize IPC = UDS control socket (DECIDED) {#p08-summarize-ipc}

**Decision:** tugcast requests overview summaries from the host over the existing control socket: a new tugcast→app `local_model_request` message and a new app→tugcast `ControlMessage::LocalModelResult` variant, correlated by id.

**Rationale:**
- The digest inputs (session JSONL prompts, CODE_OUTPUT tool frames) are tugcast-side; the model is Swift-side; the socket already connects exactly these two (`tugrust/crates/tugcast/src/control.rs` ↔ `tugapp/Sources/ControlSocket.swift` / `ProcessManager.handleControlMessage`).
- Routing through the deck would put a background job on a UI surface.

**Implications:**
- tugcast writes app-bound messages via the response channel that feeds the control-socket draining task (`main.rs` — the `writer.into_inner()` drain around the shutdown path); a pending-map of oneshot senders resolves replies.
- Headless tugcast (no Tug.app parent, e.g. `just dev`) has no socket: summarize requests fail fast and the overview feature is silently absent — same graceful-degradation shape as [P11].

#### [P09] Shell routing: heuristic bands + async model tiebreak, never blocking (DECIDED) {#p09-shell-bands}

**Decision:** Refactor the submit-time classifier into three bands (Spec S06): **shell** (heuristic-certain command) routes instantly; **prompt** (heuristic-certain prose) routes instantly; **unsure** (first token is a PATH executable but the heuristic refuses) is decided by a cached/awaited model verdict with a hard 250 ms submit budget — no verdict in time ⇒ Code. The model is pre-consulted on a 300 ms typing debounce so the verdict is usually ready before Enter. The whole feature is live only when opted-in AND the model is installed AND the service answers; otherwise behavior is exactly today's (parked off).

**Rationale:**
- Preserves the asymmetric-cost doctrine already written into `shell-line-classifier.ts` (prose at the shell error-barfs; a command at Claude degrades gracefully) — the model can only *add* shell routes to lines the heuristic already declined, and only when confident.
- ~200 ms model latency is acceptable on a debounce, unacceptable on the submit critical path.

**Implications:**
- `AUTO_SHELL_DETECTION_ENABLED` (the parked constant) is replaced by a live gate on local-model availability; the live-typing chip (`autoShellOpener`) un-parks for unambiguous openers under the same gate, unchanged in logic.
- New pure function `bandShellLine(text, commands): "shell" | "prompt" | "unsure"` derived from the existing `classifyShellLine` internals (Spec S06 defines the mapping); existing exported signatures kept for tests.

#### [P10] Pulse part-one is a new tugcast component emitting `kind:"overview"` (DECIDED) {#p10-overview-component}

**Decision:** A new tugcast module (`feeds/session_overview.rs`) taps the same CODE_OUTPUT broadcast the pulse bridge taps, builds per-session digests, requests summaries over [P08] on a cadence, and broadcasts PulseLine-shaped frames with a new optional `kind: "overview"` field on the PULSE feed. The tugpulse daemon, `PulseVoice`, and the forward allowlist are untouched.

**Rationale:**
- Part two is deliberately not model-driven (verbatim `assistant_text`); bolting the overview into the daemon would put user-prompt data through a pipe that deliberately mutes user messages.
- The pulse wire tap mutes user messages, so goal prompts must come from the session JSONL — exactly the `scribe::session_prompts_since` path, with JSONL resolution copied from `feeds/draft_engine.rs::session_user_prompts` (ledger `claude_projects_root()` + `encode_claude_project_name(project_dir)` + `<claude_id>.jsonl`).
- **Session-identity source (load-bearing):** the tug-session→claude-session mapping lives in `AgentSupervisor`'s **in-memory** session map — the `SessionResolver` closure `draft_engine.rs` uses is built inline over it (`agent_supervisor.rs`, the `try_lock` closure in the draft-request handler) and is not reachable from a free-standing `main.rs` task. The overview emitter therefore receives its identity access **from the supervisor at wiring time**: main.rs constructs the emitter with (a) a `SessionResolver` built over an `Arc` clone of the supervisor's in-mem ledger (the exact closure shape from the draft path — `try_lock`, degrade to "no claude id" under contention), and (b) a `project_dir` lookup via the SQLite `SessionLedger` (`SessionRow.project_dir`). A session whose claude id or project dir can't be resolved simply skips its cadence tick — same degrade-to-nothing posture as the draft prompt path.

**Implications:**
- `parsePulseFrame` (`tugdeck/src/protocol.ts`) and `PulseLine` (`tugcode/src/pulse/types.ts`) gain the optional `kind` field; absent ⇒ beat (backward compatible).
- `pulse-store.ts` tracks latest overview per scope; `session-pulse-strip.tsx` renders it as a first line above the existing beat line.
- Overview frames are not ledgered in v1 ([Q05]).

#### [P11] Strict enhancement: every consumer degrades to today (DECIDED) {#p11-graceful-degradation}

**Decision:** Flag off, model absent, download incomplete, service unloaded/dead, headless tugcast, browser deck, app-test runs — in every one of these states, shell routing behaves exactly as current main (parked off) and the Pulse strip renders exactly as current main (one line). No error surfaces to the user from a missing model; only TugSetup and logs know.

**Rationale:**
- The investigation doc calls this load-bearing; it is also what makes the feature safely land incrementally behind the flag.

**Implications:**
- Availability is a single derived signal (deck: `useLocalModelReady()` in the new store; tugcast: presence probe + socket liveness; Swift: flag + presence before load) — consumers never half-enable.

#### [P12] Service lifecycle: lazy load, warm while active, idle unload (DECIDED) {#p12-service-lifecycle}

**Decision:** `LocalModelService` (new `tugapp/Sources/LocalModelService.swift`) loads the pack on first request, serializes requests single-flight, keeps the model resident while requests keep arriving, and unloads after 5 idle minutes to reclaim the ~2–3 GB.

**Rationale:**
- The eval's memory numbers (1.5–2.25 GB resident) are fine transiently, not permanently, on an app users leave open all day.

**Implications:**
- First classify after idle pays the load cost — the deck's 250 ms submit budget simply lapses to Code (correct per [P09]); the debounce pre-consult is what warms it.
- Generation defaults: temperature 0, small max-token caps per task (classify ~8, summarize ~32).

---

### Deep Dives {#deep-dives}

#### End-to-end flows {#e2e-flows}

**Opt-in + download (first run):** TugSetup step CTA → deck writes `dev.tugtool.local-model/enabled=true` (tugbank PUT via `settings-api.ts` helper) → deck sends control frame `local_model_download` → tugcast `dispatch_action` spawns the download task → progress frames on CONTROL (~4 Hz) → deck `local-model-store` folds them → step row shows a determinate bar → `local_model_download_result {ok:true}` → store probes status → step flips done. Quit mid-download: next tugcast startup sees `enabled=true` + incomplete staging → auto-resumes silently; the deck learns state via `local_model_probe` at connect.

**Classify (typing):** prompt-entry updateListener detects an unsure-band draft on a 300 ms debounce → `requestClassify(text)` in `local-model-bridge.ts` → `window.webkit.messageHandlers.localModel.postMessage({requestId, task:"classify", text})` → `MainWindow` dispatch → `LocalModelService.classify` → `evaluateJavaScript("window.__tugBridge?.onLocalModelResult?.({requestId, ok, verdict})")` → verdict cached keyed on exact draft text. Submit: band = shell → shell; prompt → Code; unsure → cached verdict, else await in-flight ≤ 250 ms, else Code.

**Overview (session activity):** `session_overview` task subscribes `code_tx` → accumulates per-session `tool_use` digests (allowlist-independent; it filters `tool_use` itself and respects replay mute brackets exactly like `forwardable_session` in `feeds/pulse.rs`) → cadence fires (Spec S05) → reads goal prompts from session JSONL → composes the digest prompt → `local_model_request` over the control socket → `LocalModelResult` → broadcasts `{type:"pulse", kind:"overview", text, scopes:[session], beat, at}` on PULSE → `pulse-store` records latest overview per scope → strip renders it above the beat line.

#### tugcast control-socket extension details {#control-socket-extension}

Today: app→tugcast messages deserialize as `ControlMessage` (`control.rs`, serde `tag="type"`, snake_case: `Tell`/`Shutdown`/`DevMode`); tugcast→app messages are hand-built JSON lines (`send_ready`, `make_dev_mode_result`, `make_shutdown_message`) written by a draining task fed from an mpsc channel created in `main.rs` (search `writer.into_inner()`). Swift side: `ControlSocketConnection.send(_ dict:)` writes newline JSON; `ProcessManager.handleControlMessage` switches on `type` (`ready`, `dev_mode_result`, `shutdown`, `tell`). The extension: (1) tugcast exposes a cloneable sender for the app-bound channel plus a `PendingLocalModel` map (`HashMap<String, oneshot::Sender<LocalModelReply>>`); (2) new `ControlMessage::LocalModelResult { id, ok, text: Option<String>, error: Option<String> }` routed in `run_recv_loop` to the pending map; (3) Swift adds `case "local_model_request"` in `handleControlMessage`, calls the service off-main, replies with `connection.send(["type": "local_model_result", "id": id, …])`. Timeout tugcast-side: 10 s per request, then the oneshot is dropped and the tick skipped.

#### mlx-swift dependency notes {#mlx-swift-notes}

`tugapp` is a plain Xcode project (`tugapp/Tug.xcodeproj/project.pbxproj`) with zero SPM references; the app builds via `just app-debug` / `just app-release` (xcodebuild). Add `XCRemoteSwiftPackageReference`s for `https://github.com/ml-explore/mlx-swift` and `https://github.com/ml-explore/mlx-swift-examples` (products: `MLXLLM`, `MLXLMCommon` — the LLM loading/generation layer; tokenizers come transitively via swift-transformers), pinned to exact versions recorded during Step 2. Expect first-build package resolution to need network; verify `scripts/sign-bundle.sh` still signs the app with the new framework payloads, and that `just app-debug` from a clean checkout resolves packages non-interactively. Model loading: MLXLLM's factory from a local directory URL (`~/Library/Application Support/Tug/models/<slug>/…`) — confirmed loadable in Step 2, including any `ModelConfiguration` overrides the pack needs.

#### Task prompts {#task-prompts}

The validated prompts live in the harness: classify prompt in `~/bonsai-eval/classify_8b.py` (SHELL/PROMPT label task over one line), overview prompt in `~/bonsai-eval/pulse_8b.py` (compact digest → one headline; the +1 tightening line: demand a terse headline ≤ ~10 words, forbid preamble). Step 1 freezes the exact final prompt strings after re-validation; Step 8 ports them verbatim into `LocalModelService` as Swift string constants with a source comment naming the harness file. Classify output contract: the model must answer with exactly `SHELL` or `PROMPT` (first token wins, case-insensitive, anything else ⇒ null verdict ⇒ Code).

---

### Specification {#specification}

**Spec S01: Model manifest (compiled into tugcast)** {#s01-model-manifest}

`tugrust/crates/tugcast/src/local_model.rs` declares the pack as consts/struct: `MODEL_SLUG` (e.g. `ternary-bonsai-8b-2bit`), `HF_REPO`, `HF_REVISION` (full commit hash), and `MODEL_FILES: &[ModelFile]` where `ModelFile { name, sha256, bytes }`. Download URL per file: `https://huggingface.co/<HF_REPO>/resolve/<HF_REVISION>/<name>`. Install layout: `~/Library/Application Support/Tug/models/<MODEL_SLUG>/` containing the files plus a `tug-manifest.json` stamp `{slug, repo, revision, files:[{name, sha256, bytes}], verified_at}` written only after every file verifies — **the stamp's existence is the presence probe**. Staging: `…/models/.staging/<MODEL_SLUG>/<name>.part`; finalize = verify each staged file's sha256 → move files into place → write stamp → remove staging. Values for repo/revision/files/sha256s are filled by Step 2 ([Q03]) before Step 3 compiles them in.

**Spec S02: Download control vocabulary** {#s02-download-control}

Deck→tugcast actions (control frames, handled in `actions.rs::dispatch_action`): `local_model_download` (idempotent: already-installed ⇒ immediate ok result; already-running ⇒ no-op), `local_model_download_cancel`, `local_model_probe`. tugcast→deck CONTROL broadcasts: `{"action":"local_model_download_progress","file":name,"fileIndex":i,"fileCount":n,"receivedBytes":r,"totalBytes":t}` throttled to ≤ 4 Hz with `receivedBytes`/`totalBytes` aggregated across the whole pack; `{"action":"local_model_download_result","ok":bool,"error":string|null}`; `{"action":"local_model_status","installed":bool,"downloading":bool}` (answer to probe, also broadcast unsolicited on install-state change). Startup auto-resume ([P04]): during tugcast init, if `enabled=true` (tugbank read, absent ⇒ false per [P05]) and stamp absent, spawn the download task exactly as if `local_model_download` arrived. Resume mechanics: existing `.part` ⇒ `Range: bytes=<len>-` request; 200-instead-of-206 ⇒ restart that file from zero; per-file retry ×3 with backoff before failing the run. **Cross-process lock (load-bearing):** the models dir is instance-shared while the opt-in flag and auto-resume are per-instance tugcast — concurrent debug + release Tug.app instances are the *normal* dev condition, so two tugcasts can race the same staging tree. The download task must first acquire `…/models/.staging/<MODEL_SLUG>.lock` (create with `O_EXCL`, write own pid; on `EEXIST` read the pid — dead process ⇒ remove stale lock and retry once, live process ⇒ report `local_model_download_result {ok:false, error:"download in progress in another Tug instance"}` and let that instance finish), then **re-check the stamp after acquiring** (the other instance may have finalized while we waited) before touching any `.part` file. The lock is removed on finalize, failure, and cancel; `Drop` on the task guard removes it on abnormal exit.

**Spec S03: Bridge classify messages** {#s03-bridge-classify}

Deck→Swift: `window.webkit.messageHandlers.localModel.postMessage({requestId: string, task: "classify", text: string})`. Swift→deck: `window.__tugBridge?.onLocalModelResult?.({requestId, ok: bool, verdict: "shell"|"prompt"|null, error?: string})`. Deck helper `tugdeck/src/lib/local-model-bridge.ts`: `requestClassify(text: string): Promise<"shell"|"prompt"|null>` — resolves null on 1500 ms timeout, missing handler, or `ok:false`; module-scope pending map; no store, no React.

**Spec S04: Control-socket summarize messages** {#s04-socket-summarize}

tugcast→app (JSON line via the app-bound drain channel): `{"type":"local_model_request","id":string,"task":"summarize","prompt":string}`. app→tugcast: `{"type":"local_model_result","id":string,"ok":bool,"text":string|null,"error":string|null}` deserialized as `ControlMessage::LocalModelResult`. tugcast timeout 10 s. Swift refuses (ok:false, error:"unavailable") when the flag is off or the pack is absent — tugcast treats refusal as [P11] absence and backs off cadence ticks for 60 s.

**Spec S05: Overview emission** {#s05-overview-emission}

Frame: PulseLine JSON with `kind:"overview"` — `{"type":"pulse","kind":"overview","text":headline,"scopes":[tug_session_id],"beat":n,"at":ms}` broadcast on `FeedId::PULSE`. Cadence per session: fire when ≥ 8 forwarded `tool_use` frames accumulated since last emit OR 30 s elapsed since last emit with ≥ 1 new frame; hard floor 15 s between emits; skip when the digest is unchanged or the headline equals the previous one. Gating: cadence runs only while **all three** flags hold — `dev.tugtool.local-model/enabled` (default OFF), model `is_installed()`, AND `dev.tugtool.pulse/enabled` (default ON — reuse the existing enabled-closure shape from `main.rs`); the strip hides entirely when pulse is off, so inference for invisible lines is never spent. Digest inputs: up to 10 user prompts (≤ 1500 chars total) via `scribe::session_prompts_since(&jsonl, 0, 10, 1_500)`, with the JSONL path built from the supervisor-provided `SessionResolver` (tug→claude id) + `SessionRow.project_dir` per the [P10] identity-source note; plus the last ≤ 40 `tool_use` entries as `name(short-target)` lines (target = the tool input's path/command field when present, truncated ~60 chars). Unresolvable identity ⇒ skip the tick. Replay-bracketed frames are muted exactly like the pulse bridge. Headline clipped to 110 chars defensively (matching `PulseLine.text` doctrine).

**Spec S06: Shell-routing bands** {#s06-shell-bands}

New pure export in `shell-line-classifier.ts`: `bandShellLine(text, commands): "shell" | "prompt" | "unsure"`, refactored from `classifyShellLine`'s body (which becomes a thin `bandShellLine(...) === "shell"` for compatibility): after the existing shape gates and env-assign skip — first token not a PATH executable and not path-shaped ⇒ `"prompt"`; trailing `?` ⇒ `"prompt"`; current-logic-true (all vetoes passed) ⇒ `"shell"`; PATH-executable first token but vetoed (bare ambiguous opener, stopword without strong signal, ≥ 8 tokens without strong signal) ⇒ `"unsure"`. Model verdict applies only to `"unsure"`. Gating: a new `localModelShellGate` (deck store read, [P11]) replaces the `AUTO_SHELL_DETECTION_ENABLED` constant at both entry points; the constant itself is deleted. Live-typing `autoShellOpener` logic is unchanged (unambiguous openers only) behind the same gate. Submit semantics in `tug-prompt-entry.tsx`: band `"shell"` ⇒ existing auto-route path (`shellStore.exec(text, {origin:"auto"})` + history push, unchanged); `"prompt"` ⇒ Code; `"unsure"` ⇒ cached verdict for the exact submitted text, else await the in-flight classify ≤ 250 ms, else Code. Debounce pre-consult: on updateListener, single-line atom-free drafts ≤ 256 chars in the unsure band trigger `requestClassify` after 300 ms idle; cache is a plain `Map<string, "shell"|"prompt">` capped at 32 entries, cleared on submit/clear.

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone (appearance / local-data / structure) | Mechanism | Law |
|-------|--------------------------------------------|-----------|-----|
| local-model install/download state (installed, downloading, progress bytes) | external state | new `local-model-store.ts` (module singleton) + `useSyncExternalStore` hook, fed by CONTROL frames + tugbank DEFAULTS subscription | [L02] |
| opt-in flag `dev.tugtool.local-model/enabled` | external persistent | tugbank read + DEFAULTS-frame subscription inside `local-model-store` (the `pulse-store` pattern); writes via `settings-api.ts` PUT | [L02], no-localStorage |
| classify verdict cache + pending request map | local-data (non-render) | module-scope `Map` in `local-model-bridge.ts` / controller refs in `tug-prompt-entry.tsx` — never React state (it must not re-render per keystroke) | [L06] |
| TugSetup step status (new step) | derived | computed inline from `useLocalModel()` snapshot in `TugSetup` render, like `claudeStep`/`signInStep` | [L02] |
| overview line per scope | external state | `pulse-store.ts` extension (`latestOverviewForScope`), same store/subscription | [L02] |
| download progress bar fill | appearance | `TugProgressIndicator` `value`/`max` props (component-internal CSS) | [L06] |

---

### Compatibility / Migration / Rollout {#rollout}

- **Compatibility policy:** the `kind` field on pulse frames is optional and ignored by older parsers (`parsePulseFrame` accepts unknown fields); control-socket and CONTROL vocabularies are purely additive; the tugcode inbound allowlist is untouched (no new client→tugcode messages anywhere in this plan).
- **Rollout:** everything behind `dev.tugtool.local-model/enabled` default OFF; opted-out installs run zero new code paths beyond the presence probe. Rollback = flip the flag off (service refuses, features degrade per [P11]); full rollback = delete the models directory.
- **Model upgrades (future):** bump Spec S01 revision + shas; the presence probe fails against the new slug/manifest and the auto-resume re-downloads. Old packs are removed on successful finalize of a new one.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugrust/crates/tugcast/src/local_model.rs` | Spec S01 manifest, paths, presence probe, verify, downloader task, startup auto-resume |
| `tugrust/crates/tugcast/src/feeds/session_overview.rs` | Pulse part-one: digest accumulation, cadence, summarize round-trip, PULSE broadcasts |
| `tugdeck/src/lib/local-model-store.ts` | Deck store: flag + install/download snapshot, `useLocalModel()`, `useLocalModelReady()` |
| `tugdeck/src/lib/local-model-bridge.ts` | Spec S03 client: `requestClassify`, pending map, `onLocalModelResult` sink registration |
| `tugapp/Sources/LocalModelService.swift` | [P12] service: load/unload, single-flight queue, `classify`/`summarize`, prompt constants |
| `tests/app-test/at0xxx-local-model-absent.test.ts` | Degradation pin: flag off / model absent ⇒ single-line strip + no auto-chip while typing, exactly as main; typing-level only, never submits a turn (`@covers` the touched deck files) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `LOCAL_MODEL_DOMAIN` / `LOCAL_MODEL_ENABLED_KEY` | const | `local_model.rs` + `local-model-store.ts` (parallel decl) | [P05]; absent ⇒ **false** |
| `ModelFile`, `MODEL_FILES`, `models_dir()`, `is_installed()`, `download_task()` | struct/fn | `local_model.rs` | Spec S01/S02 |
| `local_model_download` / `_cancel` / `_probe` arms | match arms | `tugrust/crates/tugcast/src/actions.rs::dispatch_action` | `install_claude` pattern |
| `ControlMessage::LocalModelResult` | enum variant | `tugrust/crates/tugcast/src/control.rs` | Spec S04; routed to pending map in `run_recv_loop` |
| `bandShellLine` | fn | `tugdeck/src/lib/shell-line-classifier.ts` | Spec S06; `AUTO_SHELL_DETECTION_ENABLED` deleted |
| `PulseLine.kind?: "overview"` | field | `tugcode/src/pulse/types.ts`, `tugdeck/src/protocol.ts` (`parsePulseFrame`), `pulse-store.ts` | [P10]; absent ⇒ beat |
| `latestOverviewForScope` | fn/selector | `tugdeck/src/lib/pulse-store.ts` | strip's first line |
| `case "localModel"` + reply | handler | `tugapp/Sources/MainWindow.swift` | Spec S03; registered beside `clipboardRead` etc. |
| `case "local_model_request"` | handler | `tugapp/Sources/ProcessManager.swift::handleControlMessage` | Spec S04 |
| `Step.secondaryCta` + new step | type + data | `tugdeck/src/components/tugways/tug-setup.tsx` | [P06] |
| `reqwest` | dep | `tugrust/Cargo.toml` (workspace) + tugcast | rustls features; no openssl |

---

### Documentation Plan {#documentation-plan}

- [ ] Update `roadmap/local-model-investigations.md` status line to point here once implementation starts.
- [ ] Record spike results ([Q01]–[Q03] resolutions) in this document as part of Steps 1–2.
- [ ] If the dash survives and lands: a short tuglaws design-decision entry for the opt-in-flag-default-OFF inversion is the user's call, not this plan's.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (Rust, nextest)** | manifest/paths/verify logic; resume math; band-independent digest + cadence logic; control-message serde | Steps 3, 4, 10, 12 |
| **Integration (Rust, nextest)** | downloader against a local axum test server: happy path, kill+resume, corrupt-file sha reject, cancel | Step 4 |
| **Unit (TS, bun test)** | `bandShellLine` band table incl. the eval's 26-line corpus as fixtures; store frame-folding; `parsePulseFrame` kind passthrough | Steps 5, 11, 13 |
| **App-test (selective)** | degradation pin: model-absent instance renders strip + routing exactly as main | Step 14 |
| **Spike harness (not CI)** | model *quality* (scores, headlines, latency) | Steps 1–2, re-runnable manually |

#### What stays out of tests {#test-non-goals}

- Model output quality in CI — quality is spike-validated in `~/bonsai-eval/`; CI never runs inference (no 2 GB download in test, no flaky-LLM assertions).
- Mocked-LLM UI flows — no fake model answers driving deck assertions (banned real-not-fake pattern); the deck's unsure-band logic is tested purely (verdict injected as a function argument in unit tests of the pure band/decision helpers).
- TugSetup happy-path download as an app-test — app-tests suppress TugSetup by harness design and a real 2 GB network pull is out; covered by the Rust integration tests + manual debug-app pass.
- Swift service internals — no XCTest scaffolding exists in tugapp; the service is exercised end-to-end manually in Step 9/12 checkpoints and structurally by the build.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** Steps 1–2 are the [P01] gate: if either fails its bar, stop and report — do not proceed to Step 3.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Spike A — ternary quality on the two tasks | pending | — |
| #step-2 | Spike B — mlx-swift runs the pack + manifest capture | pending | — |
| #step-3 | tugcast model store + flag constants | pending | — |
| #step-4 | tugcast downloader + control vocabulary + auto-resume | pending | — |
| #step-5 | deck local-model store + bridge client | pending | — |
| #step-6 | TugSetup opt-in step | pending | — |
| #step-7 | Integration checkpoint — opt-in + download | pending | — |
| #step-8 | tugapp SPM deps + LocalModelService | pending | — |
| #step-9 | Bridge classify endpoint (Swift + deck round-trip) | pending | — |
| #step-10 | Control-socket summarize round-trip | pending | — |
| #step-11 | Shell disambiguation integration | pending | — |
| #step-12 | Pulse part-one emitter (tugcast) | pending | — |
| #step-13 | Pulse overview rendering (deck) | pending | — |
| #step-14 | Integration checkpoint — full feature + degradation pin | pending | — |

#### Step 1: Spike A — ternary quality on the two tasks {#step-1}

**Commit:** `plan(local-model): record ternary-2bit spike results (Q01)`

**References:** [P01] Spike gate, [P03] Model choice, [Q01], (#task-prompts, #success-criteria)

**Artifacts:**
- [Q01] resolution written into this document: classify score /26, per-line latency, six headline verdicts, summarize latency, peak RAM, the frozen final prompt strings.

**Tasks:**
- [ ] In `~/bonsai-eval/`, run the classify corpus (`classify_8b.py`) and the pulse fixtures (`pulse_8b.py`) against `Bonsai-demo/models/Ternary-Bonsai-8B-mlx-2bit` on **stock** `mlx-lm` (a fresh venv with upstream `mlx`, not the fork's editable install — the fork venv is only a reference point).
- [ ] If the headline wart appears, apply exactly one round of prompt tightening (per the eval precedent) and re-run; freeze the final prompts.
- [ ] Record everything under [Q01] in this document; flip its Resolution.

**Tests:**
- [ ] The harness scripts themselves are the test; record raw outputs alongside scores in the [Q01] resolution.

**Checkpoint:**
- [ ] Classify ≥ 25/26 at ≤ 400 ms/line; all six headlines accurate and preamble-free at ≤ 3 s. **Below bar ⇒ STOP the plan and report.**

---

#### Step 2: Spike B — mlx-swift runs the pack + manifest capture {#step-2}

**Depends on:** #step-1

**Commit:** `plan(local-model): record mlx-swift spike + pinned model manifest (Q02, Q03)`

**References:** [P01] Spike gate, [P02] Runtime, [Q02], [Q03], Spec S01, (#mlx-swift-notes)

**Artifacts:**
- [Q02] resolution: MLXLLM load path (factory config used), warm classify latency, load time, RAM; [Q03] resolution: HF repo id, pinned revision hash, file list with sha256 + byte sizes filled into Spec S01's prose.

**Tasks:**
- [ ] Create a scratch SwiftPM executable **outside the repo** depending on pinned `mlx-swift` + `mlx-swift-examples` (MLXLLM); load the local ternary pack by directory URL; run the frozen classify prompt and one summarize prompt.
- [ ] Record the exact package versions that worked (they become the pins in Step 8).
- [ ] Identify the pack's canonical HF repo + revision; `sha256sum` every pack file; fill Spec S01 values into this document.

**Tests:**
- [ ] Scratch runner output captured into the [Q02] resolution (load time, latencies, RAM from Activity Monitor / `mlx.metal` stats).

**Checkpoint:**
- [ ] Pack loads on stock MLXLLM (or the custom-definition cost is sized and explicitly accepted by the user); warm classify ≤ 500 ms. **Below bar or unsized ⇒ STOP and report.**

---

#### Step 3: tugcast model store + flag constants {#step-3}

**Depends on:** #step-2

**Commit:** `tugcast(local-model): model manifest, store paths, presence probe, opt-in flag`

**References:** [P03], [P05], Spec S01, (#symbols)

**Artifacts:**
- `tugrust/crates/tugcast/src/local_model.rs` with Spec S01 consts (real values from Step 2), `models_dir()`, `staging_dir()`, `is_installed()` (stamp probe), `verify_file()` (sha2 streaming), `write_stamp()`; `LOCAL_MODEL_DOMAIN`/`LOCAL_MODEL_ENABLED_KEY` consts + an `enabled(bank_client) -> bool` reader that answers **false** on absent/unreadable (deliberate inversion of the `pulse/enabled` default-ON reader in `main.rs` — copy that closure shape, flip the default).

**Tasks:**
- [ ] Module + wiring (`mod local_model;` in `main.rs`).
- [ ] Path layout per Spec S01 using the `dirs::home_dir().join("Library/Application Support/Tug/…")` pattern from `fs_write.rs`.

**Tests:**
- [ ] Unit: stamp round-trip; `is_installed` false on missing/partial dir; `verify_file` rejects a corrupted temp file; enabled-reader defaults false.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 4: tugcast downloader + control vocabulary + auto-resume {#step-4}

**Depends on:** #step-3

**Commit:** `tugcast(local-model): resumable checksummed downloader with control-frame progress`

**References:** [P04], [P11], Spec S02, Risk R03, (#e2e-flows, #control-socket-extension)

**Artifacts:**
- `reqwest` (rustls) in workspace + tugcast deps; `download_task()` in `local_model.rs` (Range resume, ×3 backoff, sha verify, atomic finalize, cancel token, ≤ 4 Hz aggregated progress broadcasts); `local_model_download`/`_cancel`/`_probe` arms in `actions.rs::dispatch_action` (the `install_claude` spawn-and-broadcast pattern); startup auto-resume hook in `main.rs` init (enabled && !installed ⇒ spawn task); unsolicited `local_model_status` broadcast on state change.

**Tasks:**
- [ ] Implement per Spec S02, base URL injectable for tests (default the HF resolve prefix from Spec S01).
- [ ] In-process single-flight guard (an `Arc<Mutex<Option<CancellationToken>>>` alongside the other shared state handed to `dispatch_action` — three call sites: `control.rs::run_recv_loop`, `server.rs`, `router.rs`).
- [ ] Cross-process staging lockfile per Spec S02 (O_EXCL + pid, stale-lock recovery, post-acquire stamp re-check, removal on finalize/failure/cancel/drop).

**Tests:**
- [ ] Integration (nextest, local axum server serving fixture "pack" files with Range support): happy path finalizes + stamps; kill/resume via a mid-stream abort then re-run resumes from `.part`; wrong sha rejects and deletes the staged file; cancel stops promptly and leaves resumable staging; progress frames arrive aggregated and terminal result frame is correct.
- [ ] Unit: lockfile contention (held-by-live-pid ⇒ polite failure result; stale pid ⇒ reclaimed; stamp appears while waiting ⇒ task exits ok-without-downloading).

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 5: deck local-model store + bridge client {#step-5}

**Depends on:** #step-4

**Commit:** `tugways(local-model): deck store for opt-in/install state + host bridge client`

**References:** [P05], [P07], [P11], Spec S02, Spec S03, (#state-zone-mapping)

**Artifacts:**
- `tugdeck/src/lib/local-model-store.ts`: parallel-declared flag consts; snapshot `{enabled, installed, downloading, progress: {receivedBytes, totalBytes} | null}`; folds `local_model_*` CONTROL frames; tugbank DEFAULTS subscription for live flag flips (the `pulse-store.ts` pattern, default OFF); sends `local_model_probe` at connection attach; hooks `useLocalModel()`, `useLocalModelReady()` (enabled && installed); `setLocalModelEnabled(bool)` writer in `settings-api.ts` (PUT, like `putSetupSeen`).
- `tugdeck/src/lib/local-model-bridge.ts` per Spec S03: `requestClassify`, pending map with 1500 ms timeouts, `window.__tugBridge.onLocalModelResult` sink installed at module init, hard null-path when `window.webkit?.messageHandlers?.localModel` is absent.

**Tasks:**
- [ ] Implement both modules; wire store attach where `attachPulseStore` is wired (find its call site in deck bootstrap and mirror it).

**Tests:**
- [ ] bun test: frame folding (progress → snapshot, result → probe refresh), default-OFF flag read, bridge timeout ⇒ null, absent handler ⇒ null (no throw).

**Checkpoint:**
- [ ] `just test-ts` && `cd tugdeck && bunx vite build`

---

#### Step 6: TugSetup opt-in step {#step-6}

**Depends on:** #step-5

**Commit:** `tugways(tug-setup): optional on-device AI step with determinate download progress`

**References:** [P06], [P11], Spec S02, Risk R03, (#e2e-flows, #state-zone-mapping)

**Artifacts:**
- In `tug-setup.tsx`: `Step.secondaryCta?` + `StepRow` rendering for it; a fourth `localAiStep` between `signInStep` and `openStep` derived from `useLocalModel()`: active (Download / Skip CTAs, copy per `tug-setup-copy.ts` conventions), busy (determinate `TugProgressIndicator` `variant="bar"` with aggregated bytes + `formatValue` percent — extend `StepRow` to render an optional progress node in the detail slot), error (`local_model_download_result` error + Retry / Skip), done ("On-device AI ready" or "Skipped" as a done-state detail). Download CTA = `setLocalModelEnabled(true)` + control frame `local_model_download`; Skip = `setLocalModelEnabled(false)` + local done-latch (a `useState` like `openedFirstSession`).
- Step visibility: only on genuine first run (`firstRun`), so existing set-up users are never modally interrupted ([Q04] covers their path).
- Two behaviors are by design, not bugs: (a) the optional step and `openStep` may be **simultaneously active** — the optional step must never gate "Start a Claude Code session", so a logged-in first-run user sees both CTAs at once; (b) opening the first session closes the wizard even mid-download (`needsFirstSession` flips false at `cardCount > 0`) — the download continues in tugcast and the startup auto-resume ([P04]) backstops an app quit, so the wizard's progress row is a courtesy view, not the owner of the operation.

**Tasks:**
- [ ] Implement step + CSS touch-ups in `tug-setup.css`; keep the wizard's step order and jail semantics untouched.
- [ ] Extend `gallery-tug-setup.tsx` with the new step's states for HMR iteration.

**Tests:**
- [ ] bun test in `tug-setup-copy.test.ts` style for any new copy helpers.

**Checkpoint:**
- [ ] `just test-ts` && `cd tugdeck && bunx vite build`
- [ ] Manual: gallery states render; debug app with `SESSION_FORCE_SETUP` shows the step; Skip leaves flag off.

---

#### Step 7: Integration checkpoint — opt-in + download {#step-7}

**Depends on:** #step-4, #step-6

**Commit:** `N/A (verification only)`

**References:** [P04], [P06], Spec S01, Spec S02, Risk R03, (#success-criteria)

**Tasks:**
- [ ] On a fresh instance (or after deleting the models dir + flag): opt in via the wizard, watch real HF download to completion, verify stamp + file shas on disk.
- [ ] Kill tugcast mid-download; relaunch; confirm silent resume and completion.
- [ ] Cancel mid-download; confirm clean stop and Retry works.

**Tests:**
- [ ] `just app-test-changed` (setup-suppressed corpus unaffected).

**Checkpoint:**
- [ ] All three manual flows pass; `cd tugrust && cargo nextest run` green.

---

#### Step 8: tugapp SPM deps + LocalModelService {#step-8}

**Depends on:** #step-2

**Commit:** `tugapp(local-model): mlx-swift dependency + lazy LocalModelService`

**References:** [P02], [P12], [Q02], Spec S01, Risk R04, (#mlx-swift-notes, #task-prompts)

**Artifacts:**
- Pinned `XCRemoteSwiftPackageReference`s (versions from Step 2) in `Tug.xcodeproj`; `tugapp/Sources/LocalModelService.swift`: pack-directory discovery (same path as Spec S01), tugbank-flag check via `TugbankClient`, lazy load, single-flight serial queue, 5-min idle unload timer, `classify(text:) -> String?` and `summarize(prompt:) -> String?` using the frozen prompts (temp 0, max tokens 8/32), refusal when flag off or pack absent.

**Tasks:**
- [ ] Add packages; confirm `just app-debug` resolves and builds from clean; confirm `scripts/sign-bundle.sh` output launches.
- [ ] Implement the service; log through the app's existing logging so failures are observable.

**Tests:**
- [ ] Build is the structural test (no XCTest in tugapp); a temporary debug hook is acceptable during development but must not land.

**Checkpoint:**
- [ ] `just app-debug` green from clean; app launches; with pack installed, a wired temporary call answers classify correctly (removed before commit if hooky — the Step 9 bridge is the durable exerciser).

---

#### Step 9: Bridge classify endpoint (Swift + deck round-trip) {#step-9}

**Depends on:** #step-8, #step-5

**Commit:** `tugapp(local-model): localModel bridge handler; deck round-trip live`

**References:** [P07], [P11], Spec S03, (#e2e-flows)

**Artifacts:**
- `MainWindow.swift`: `contentController.add(self, name: "localModel")` beside the existing registrations; dispatch case that calls `LocalModelService` off-main and replies via `evaluateJavaScript("window.__tugBridge?.onLocalModelResult?.(…)")` with proper JSON escaping (follow the existing reply helpers' pattern).

**Tasks:**
- [ ] Implement handler + reply; malformed payloads answer `ok:false`.

**Tests:**
- [ ] Manual in debug app console: `await requestClassify("make test")` ⇒ `"shell"`, `await requestClassify("make the button bigger")` ⇒ `"prompt"`; with flag off ⇒ `null` fast.

**Checkpoint:**
- [ ] `just app-debug` green; both console probes answer per spec; `cd tugdeck && bunx vite build` green.

---

#### Step 10: Control-socket summarize round-trip {#step-10}

**Depends on:** #step-8

**Commit:** `tugcast+tugapp(local-model): summarize request/reply over the control socket`

**References:** [P08], Spec S04, (#control-socket-extension)

**Artifacts:**
- `control.rs`: `ControlMessage::LocalModelResult` variant + serde test; pending-map plumbing and a `request_local_model_summary(prompt) -> oneshot` helper hung off the app-bound drain channel (exposed from `main.rs` wiring as a small handle struct passed to feeds); 10 s timeout.
- `ProcessManager.swift`: `case "local_model_request"` → service call off-main → `connection.send(["type":"local_model_result", …])`.

**Tasks:**
- [ ] Implement both sides; headless tugcast (no socket) makes the helper answer unavailable immediately.

**Tests:**
- [ ] Unit (nextest): `LocalModelResult` deserialization (the `test_control_message_tell_deserialization` pattern); pending-map resolve/timeout logic with a stubbed channel.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`; `just app-debug` green.

---

#### Step 11: Shell disambiguation integration {#step-11}

**Depends on:** #step-9

**Commit:** `tugways(shell-routing): heuristic bands + async local-model tiebreak, un-parked behind opt-in`

**References:** [P09], [P11], Spec S06, Risk R06, (#state-zone-mapping, #e2e-flows)

**Artifacts:**
- `shell-line-classifier.ts`: `bandShellLine` per Spec S06; `classifyShellLine` reduced to the compatibility wrapper; `AUTO_SHELL_DETECTION_ENABLED` deleted; both entry points gated on a caller-supplied `enabled: boolean` (the pure module stays store-free — callers pass `useLocalModelReady()`-derived state via the existing ref plumbing in `tug-prompt-entry.tsx`).
- `tug-prompt-entry.tsx`: debounce pre-consult in the updateListener (reusing the existing cheap pre-gates: single line, ≤ 256 chars, atom-free), verdict cache Map (cap 32, cleared on submit/clear), submit-path band logic with the ≤ 250 ms await (unsure + in-flight) falling back to Code; live-typing chip gate flipped from the deleted constant to the availability signal.

**Tasks:**
- [ ] Implement; keep the auto-routed history push and `origin:"auto"` attribution path byte-identical.

**Tests:**
- [ ] bun test: band table over the eval's 26-line corpus + the parked-off motivating cases (`write a poem`, `apply the patch` ⇒ unsure, never shell without a verdict); wrapper equivalence (`classifyShellLine === (band === "shell")`); cache cap + clear semantics as pure-helper tests.

**Checkpoint:**
- [ ] `just test-ts` && `cd tugdeck && bunx vite build`
- [ ] Manual (model installed + enabled): `make test` ⇒ shell; `make the button bigger` ⇒ Claude; flag off ⇒ everything routes to Claude exactly as main.

---

#### Step 12: Pulse part-one emitter (tugcast) {#step-12}

**Depends on:** #step-3, #step-10

**Commit:** `tugcast(pulse): session overview emitter — digest, cadence, local-model summarize`

**References:** [P10], [P11], Spec S04, Spec S05, (#e2e-flows)

**Artifacts:**
- `feeds/session_overview.rs`: per-session accumulator over a `code_tx` subscription (own replay-mute bracket handling mirroring `forwardable_session`), cadence per Spec S05, digest composer (JSONL prompts via `scribe::session_prompts_since`, path built per Spec S05's identity rules), summarize via the Step 10 handle, PULSE broadcast of `kind:"overview"` frames, 60 s back-off on unavailable, triple-gated per Spec S05 (local-model enabled from Step 3's reader + `is_installed()` + `pulse/enabled`).
- Wiring in `main.rs` beside the pulse bridge task, constructed with the identity handles per the [P10] identity-source note: a `SessionResolver` closure over an `Arc` clone of the supervisor's in-mem session map (the `try_lock` shape from the draft path) and the SQLite `SessionLedger` handle for `SessionRow.project_dir`.

**Tasks:**
- [ ] Implement; keep the module one-way (outputs = PULSE broadcast + tracing only, matching the pulse bridge's isolation doctrine).
- [ ] Unresolvable identity (no claude id yet, no project dir) skips the tick silently — never an error surface.

**Tests:**
- [ ] Unit: cadence trigger table (8-frames / 30 s / 15 s floor / unchanged-skip); digest composition from fixture frames + a fixture JSONL (resolver + project-dir injected as test closures); replay-bracket muting; frame JSON shape (`kind:"overview"`, single scope, clipped text); triple-gate truth table.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 13: Pulse overview rendering (deck) {#step-13}

**Depends on:** #step-12

**Commit:** `tugways(pulse): render the overview line above the live beat`

**References:** [P10], [P11], Spec S05, (#state-zone-mapping)

**Artifacts:**
- `protocol.ts::parsePulseFrame` + `PulseFramePayload`: optional `kind` passthrough; `tugcode/src/pulse/types.ts::PulseLine` gains the documented optional field (tugcode never emits it; the type is the wire contract).
- `pulse-store.ts`: overview lines stored separately (latest per scope; never entering the beat `lines`/history/cleared-watermark machinery), `latestOverviewForScope`, hook.
- `session-pulse-strip.tsx` + CSS: overview as a first line above the existing stage line; absent ⇒ single-line layout identical to today (no reserved empty row).

**Tasks:**
- [ ] Implement; respect the strip's min-dwell/queue design for the beat line untouched; overview swaps are instant (it is stable by construction).

**Tests:**
- [ ] bun test: `parsePulseFrame` kind passthrough + absent-default; store separation (overview never pollutes beat history/groups); selector scope rules match `latestLineForScope` semantics.

**Checkpoint:**
- [ ] `just test-ts` && `cd tugdeck && bunx vite build`

---

#### Step 14: Integration checkpoint — full feature + degradation pin {#step-14}

**Depends on:** #step-7, #step-11, #step-13

**Commit:** `test(app-test): pin model-absent degradation for local-model surfaces`

**References:** [P11], Spec S05, Spec S06, (#success-criteria, #test-non-goals)

**Artifacts:**
- `tests/app-test/at0xxx-local-model-absent.test.ts` with `@covers` lines for `local-model-store.ts`, `session-pulse-strip.tsx`, and `tug-prompt-entry.tsx`: on a model-absent instance, the strip renders single-line and typing `make ` / `git ` into the prompt entry never auto-inserts the `!shell` chip (today's parked behavior, pinned). **Typing-level only — the test never submits a turn** (a real send into a replay-backed harness session is out of bounds; real-claude flows are on-demand only). The submit-time band/verdict semantics are covered by Step 11's pure-function unit suite instead.

**Tasks:**
- [ ] Write the app-test; `just app-test-covers-check` green.
- [ ] Full manual pass with model installed: live session shows overview within ~30 s of activity; shell disambiguation behaves per Step 11's manual matrix; toggling the flag off returns both surfaces to main behavior without relaunch (store DEFAULTS subscription).

**Tests:**
- [ ] `just app-test-changed`

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` && `just test-ts` && `cd tugdeck && bunx vite build` && `just app-test-changed` all green; manual matrix passes.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** An opt-in, download-on-demand on-device model in Tug.app powering model-assisted shell routing and a Pulse overview line, degrading to exactly today's behavior in every opted-out or model-absent state.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Spike results recorded and above bar ([Q01], [Q02] resolved in this document).
- [ ] Fresh opt-in downloads, resumes across a kill, verifies, and finalizes (Step 7 flows).
- [ ] Both features work live with the model installed; both surfaces are byte-identical to main when it isn't (Step 14 matrix + app-test pin).
- [ ] `cargo nextest run`, `just test-ts`, `bunx vite build`, `just app-test-changed` green.
- [ ] Scribe untouched (no diff under `scribe.rs` or its callers).

**Acceptance tests:**
- [ ] Step 4 downloader integration suite.
- [ ] Step 11 band-table unit suite (26-line corpus + parked-off motivating cases).
- [ ] Step 14 app-test degradation pin.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Settings surface for the opt-in toggle ([Q04]).
- [ ] Overview persistence in the pulse ledger + history integration ([Q05]).
- [ ] Tug CDN self-hosting of the weights (replaces the HF dependency).
- [ ] The larger Pulse/Lens multi-session redesign that builds on the overview line.
- [ ] Model-version upgrade UX (manifest bump flow exists; no UI for it yet).

| Checkpoint | Verification |
|------------|--------------|
| Spike gate | Step 1–2 recorded results vs Success Criteria bars |
| Download robustness | Step 4 integration tests + Step 7 kill/resume manual |
| Feature parity when absent | Step 14 app-test + manual flag-off matrix |
| Workspace health | `cargo nextest run` / `just test-ts` / `bunx vite build` / `just app-test-changed` |
