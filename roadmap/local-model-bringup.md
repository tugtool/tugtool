<!-- devise-skeleton v4 -->

## Local-Model Infrastructure Bring-Up {#local-model-bringup}

**Purpose:** Build the capability to run local models as core Tug infrastructure — a curated model catalog, a robust acquisition subsystem, a two-backend runtime host (stock `mlx-swift` now, Apple `FoundationModels` when the OS allows), and one consistent task-shaped API consumed over both existing IPC channels — then prove it with two tenant features: shell disambiguation in the prompt entry and a Pulse overview line. The infrastructure is the deliverable; the tenants are its proof.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | dash worktree |
| Last updated | 2026-07-27 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Two prior revisions of this plan are archived and remain the raw material: the Bonsai/mlx-swift revision (`git show ca4a504d8:roadmap/local-model-bringup.md`) contributed a fully vetted acquisition subsystem; the Foundation Models revision (`roadmap/archive/local-model-bringup.md`, committed at `caff4a860`) contributed the brokered-API pattern, both IPC extensions, and fully specified tenants. Each died on its framing — the first because ~80% of it was acquisition infrastructure carrying two marginal features, the second because it tied everything to macOS 26 (Tahoe), which the owner skipped and will not run. The governing brief for this revision is `roadmap/local-model-bringup-brief.md`: **the ability to run local models is core infrastructure; the features are tenants.** Local models are a significant future direction for AI apps, and Tug cannot be structurally unable to participate.

The strategic unlock over the parked FM plan: the MLX backend runs on Apple Silicon under Sequoia **today**, so the entire infrastructure — catalog, downloader, store, runtime host, API, TugSetup — is buildable and testable on the owner's current machine. The FM backend becomes a thin, zero-acquisition second backend behind `@available` guards, and only its *live verification* waits for a future macOS ("Golden Gate") — nothing else does. The model-quality evidence base is `roadmap/archive/local-model-investigations.md` (fitness follows task *shape*: small local models are strong at short-context bounded work, weak at long-context comprehension; scribe stays Sonnet permanently), and its reusable quality bars — the 26-line classify corpus and six pulse-digest fixtures — live in the harness at `~/bonsai-eval/`.

#### Strategy {#strategy}

- **Spike first, with a STOP rule.** Step 1 measures 2–3 candidate stock-MLX models against the classify corpus and pulse fixtures on this Sequoia machine, picks the catalog seed, pins mlx-swift versions and its platform floor, and freezes prompts. Below bar ⇒ halt before any repo work ([P13]).
- **One Swift service, two transports, zero OS-awareness elsewhere.** Inference lives in Tug.app (both backends are Swift); the deck reaches it over the WKWebView bridge, tugcast over the UDS control socket. Rust and TypeScript never branch on OS or backend — they speak the task API and receive availability answers and refusals ([P02], [P08]).
- **Ownership split: tugcast owns models-on-disk, Tug.app owns models-in-memory.** The catalog, downloader, store lifecycle, and inventory live in tugcast (Rust); loading, residency, and generation live in the Swift service, which discovers installed models from their on-disk manifest stamps ([P04], [P05]).
- **The API vocabulary is designed once and held stable.** Task-shaped (`classify` / `summarize` / `generate` / `availability`), versioned, with streaming *permitted* by the shape (request ids, terminal-vs-partial reply flag reserved) but not implemented in v1 ([P06]).
- **Milestones are independently landable.** M01 runtime+API (Sequoia-provable), M02 acquisition, M03 surfaces+configuration, M04 FM backend (compiles now, verifies on Golden Gate), M05 tenants. Acquisition (M02) does not depend on the SPM work; the tracks interleave where dependencies allow.
- **Every consumer degrades to exactly today's behavior** in every unavailable state — no model, no backend, flag off, headless, browser, app-test ([P12]).

#### Success Criteria (Measurable) {#success-criteria}

- Spike: at least one candidate stock-MLX model scores ≥ 25/26 on the classify corpus (first-token contract, ≤ 400 ms warm) and produces accurate, preamble-free headlines on all six pulse digests (≤ 3 s each), at acceptable disk/RAM cost — measured on this Sequoia machine (Step 1).
- On this Sequoia machine: a catalog model downloads with resumable determinate progress, survives a mid-download tugcast kill and resumes, sha-verifies, finalizes atomically, loads into the MLX backend, and answers a classify (deck console via the bridge) and a summarize (tugcast round-trip via the socket) — with the FM backend reporting unavailable and no consumer caring.
- Flipping the task→model assignment in tugbank changes which model answers without relaunch; deleting the model degrades both tenants to today's behavior.
- With a model available and flags on: `make the button bigger` routes to Claude, `make test` routes to shell, unambiguous lines never issue a model call; an active session's Pulse strip shows an overview line within ~30 s of turn activity.
- On any machine without a model: both tenant surfaces are byte-identical to current main — pinned by the Step 16 app-test.
- `cd tugrust && cargo nextest run`, `just test-ts`, `cd tugdeck && bunx vite build`, `just app-debug`, `just app-test-changed` green at every step boundary.

#### Scope {#scope}

1. Spike: candidate stock-MLX models vs. the quality bars; catalog seeding; version pinning (M01).
2. Tug.app: first SPM dependency (mlx-swift + MLXLLM), `LocalModelBackend` protocol, MLX backend, `LocalModelService` with the availability matrix (M01).
3. API endpoints on both transports: `localModel` bridge handler; generalized `local_model_request`/`LocalModelResult` on the control socket (M01).
4. tugcast: compiled-in catalog, model store (`~/Library/Application Support/Tug/models/`), downloader with resume/verify/cancel/list/delete, cross-process lock, startup auto-resume, CONTROL vocabulary (M02).
5. tugdeck: local-model store (flags + backend availability + model inventory) and bridge client (M03).
6. TugSetup: optional on-device-AI step with catalog choice and determinate download tracking; tugbank configuration domain (M03).
7. FM backend behind `#if canImport` + `@available(macOS 26.0, *)` (M04).
8. Tenants: three-band shell disambiguation; Pulse overview emitter + rendering; degradation app-test pin (M05).

#### Non-goals (Explicitly out of scope) {#non-goals}

- Scribe changes of any kind — commit drafting stays on Sonnet; no code path may route it locally.
- Any model that does not load **unchanged** under stock `mlx-swift` (no forks, no custom kernels, no conversion steps) — this is a hard catalog admission rule.
- A model *browser* or arbitrary-model support; the catalog is curated and compiled in.
- Streaming generation (the vocabulary permits it; v1 does not implement it).
- Intel Macs (no MLX, no Apple Intelligence — the degradation doctrine covers them).
- Raising the deployment target (stays 13.0) or the minimum supported OS (stays Sequoia).
- A post-setup model-management UI surface ([Q03] deferred — control verbs + tugbank are the interim writers).
- Apple's server-tier / Private Cloud Compute anything.
- Tug CDN weight hosting (HuggingFace pinned-revision is the v1 source).
- The larger Pulse/Lens multi-session redesign (the overview line is its foundation, not its delivery).

#### Dependencies / Prerequisites {#dependencies}

- Apple Silicon Mac on Sequoia (the build machine qualifies) for the spike and all MLX-path verification. The Tart VM lab can exercise the MLX path but never FM (Apple Intelligence does not run in VMs).
- Xcode with the macOS 26 SDK for the FM backend's compilation — **already satisfied** (Xcode 26.3 on the build machine, host macOS 15.6).
- Network access to `huggingface.co` for pinned-revision downloads.
- The `~/bonsai-eval/` harness fixtures (classify corpus, pulse digests) for the spike.
- A dash worktree (user-created; this plan never creates one).

#### Constraints {#constraints}

- **WARNINGS ARE ERRORS** across the Rust workspace (`tugrust/.cargo/config.toml`).
- `MACOSX_DEPLOYMENT_TARGET = 13.0` in `tugapp/Tug.xcodeproj/project.pbxproj` is unchanged; all FM code sits behind `#if canImport(FoundationModels)` + `@available(macOS 26.0, *)` with an always-unavailable stub; the app builds and runs identically on macOS 13–15.
- One well-known models location: `~/Library/Application Support/Tug/models/` — instance-shared, hence the cross-process lock (Spec S02).
- The Session card never blocks on inference (250 ms submit budget for the classify tenant; all model calls async).
- No localStorage/sessionStorage/IndexedDB; persistent deck state via tugbank `/api/defaults/<domain>/<key>`.
- Deck work obeys tuglaws ([L01], [L02], [L06], [L07], [L24]); the State Zone Mapping is normative.
- App-tests selective (`just app-test-changed`); every new test carries `@covers`; bun never npm; `bunx vite build` before declaring tugdeck work done.
- Only the user commits on main; implementation commits on the dash via `tugutil dash commit`.

#### Assumptions {#assumptions}

- mlx-swift + MLXLLM load community MLX packs (safetensors + config + tokenizer) from a local directory URL without modification; its package platform floor is at or below Sequoia (believed macOS 14+; **pinned in Step 1**).
- The classify output contract (model answers exactly `SHELL` or `PROMPT`; first token wins, case-insensitive; anything else ⇒ null verdict ⇒ Code) is achievable at temperature 0 on the chosen MLX model — measured, not assumed, in Step 1. The FM backend later strengthens this to a structural guarantee via guided generation.
- FoundationModels needs no special entitlement from a signed GUI app (verified cheaply when M04's live verification runs).
- ~2–5 GB disk and ~2–4 GB transient RAM while a model is warm are acceptable for an opt-in capability.
- The control socket, CONTROL feed plumbing, and tugbank DEFAULTS subscriptions behave as they do on main today.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Which MLX models seed the catalog? (OPEN — Step 1 resolves) {#q01-catalog-seed}

**Question:** Which 2–3 stock-MLX packs go into the v1 catalog, and which is the recommended default?

**Why it matters:** The catalog is compiled in; the TugSetup step offers exactly these choices; the tenants' quality rides on the default.

**Options (candidates for the spike):** current-generation small instruct models with community MLX 4-bit packs (Qwen, Llama, Gemma class, ~4–8B), plus `Ternary-Bonsai-8B-mlx-2bit` (already proven to load on stock MLX; pack present at `~/bonsai-eval/Bonsai-demo/models/`). Decide on measured classify/summarize quality, latency, and disk/RAM — not reputation.

**Resolution:** OPEN — Step 1 records scores and fills Spec S01's entries.

#### [Q02] mlx-swift pinned versions and platform floor (OPEN — Step 1 resolves) {#q02-mlx-swift-floor}

**Question:** Exact versions of `ml-explore/mlx-swift` and `ml-explore/mlx-swift-examples` (products MLXLLM/MLXLMCommon) to pin, and the true minimum macOS they demand.

**Why it matters:** The floor bounds where the MLX backend can report available; the pins go into the pbxproj in Step 2.

**Resolution:** OPEN — Step 1's scratch harness discovers both; recorded here.

#### [Q03] Post-setup model management surface (DEFERRED) {#q03-management-surface}

**Question:** Where does a set-up user change, delete, or re-download models?

**Resolution:** DEFERRED for v1, deliberately made cheap to defer: the control vocabulary ships `local_model_list` / `local_model_delete` / `local_model_download` verbs (Spec S03) and configuration is plain tugbank keys (Spec S06), so the CLI (`tugbank`, or a control-frame tell) is a complete interim writer, and a future surface (Lens section or card) is pure UI over existing verbs. Revisit with the Pulse/Lens redesign.

#### [Q04] Streaming in the API vocabulary (DECIDED — permit, don't implement) {#q04-streaming}

**Resolution:** DECIDED (see [P06]). Replies carry `done: true` in v1; the field exists so a future streaming tenant adds partial replies without breaking the vocabulary. No streaming implementation in this plan.

#### [Q05] Tenant enable defaults (OPEN — owner decides at implementation) {#q05-tenant-defaults}

**Question:** `shell-routing` and `pulse-overview` flags: default ON (light up wherever a model is ready; the visible `→ shell` attribution and one-click undo make misroutes recoverable) or OFF until a management surface exists?

**Resolution:** OPEN — the plan is written default-ON per the repo's kill-switch convention; flipping is a one-constant change in Step 14/15. Owner decides when the steps run.

#### [Q06] MLX residency policy (DECIDED — one resident model) {#q06-residency}

**Resolution:** DECIDED (see [P09]). One model resident at a time; an assignment change unloads the old before loading the new; idle unload after 5 minutes. Multi-model residency is a follow-on if a tenant ever needs two models concurrently.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| No candidate model clears the bar (R01) | high | low–med | Spike gate with STOP rule; multiple candidates; corpus is the arbiter | Step 1 results |
| First SPM dep destabilizes build/signing (R02) | med | med | Dash-first; clean-checkout resolution + `sign-bundle.sh` verification; release the dash if unacceptable | Step 2 experience |
| Download frustration (R03) | high | med | Resume + sha256 + atomic finalize + auto-resume + cross-process lock + honest error/retry UI | any failed-download report |
| Misroute prose to shell (R04) | med | low | Asymmetric bands (Spec S07): unsure+no-verdict ⇒ Code; visible auto-route attribution with one-click undo | user misroute reports |
| MLX classify output drifts from the first-token contract (R05) | med | low–med | Temperature 0 + spike-validated prompt; null-verdict fallback is always safe; FM backend later adds the structural guarantee | Step 1 / tenant QA |
| API vocabulary fragments as backends diverge (R06) | med | low | One versioned vocabulary (Spec S04/S05); backends adapt to it, never the reverse; tenants prove two call sites through one shape | any backend-specific field request |

**Risk R03: Download robustness** {#r03-download-robustness}

- **Risk:** A flaky network or mid-download quit leaves the user stuck or restarts gigabytes from zero, souring TugSetup.
- **Mitigation:** HTTP Range resume against `.part` staging; per-file sha256 before finalize; atomic finalize + stamp; tugcast auto-resumes an incomplete selected download at startup; cancel is instant and clean; the pid-stamped `O_EXCL` staging lock serializes concurrent debug+release instances over the shared models dir.
- **Residual risk:** HuggingFace availability/rate limits — accepted for v1; the TugSetup error row offers Retry and Skip.

**Risk R02: First SPM dependency** {#r02-first-spm}

- **Risk:** tugapp has zero package references today; adding mlx-swift touches pbxproj structure, package resolution in CI-less builds, and signing of new framework payloads.
- **Mitigation:** Land it as its own step with explicit clean-checkout and `scripts/sign-bundle.sh` verification; the work happens on a dash — if it proves truly bad, release the dash and reconsider.
- **Residual risk:** Xcode-version coupling on future machines; recorded pins ([Q02]) keep it reproducible.

---

### Design Decisions {#design-decisions}

#### [P01] Infrastructure is the deliverable; features are tenants (DECIDED) {#p01-infra-first}

**Decision:** The plan's product is the capability — catalog, acquisition, runtime, API — proven by two tenant features, not justified by them.

**Rationale:**
- Both archived predecessors died on feature-first framing; the owner's decision (brief, "The reframe") is that local-model ability is core and Tug cannot be left behind.

**Implications:**
- Milestone order puts runtime+API and acquisition before any tenant; a tenant slipping does not un-ship the infrastructure.
- The API is designed for future tenants (session titles, lens ranking, dedup) — task-shaped and versioned, not feature-shaped.

#### [P02] Runtime host = Tug.app; the API is brokered over two transports (DECIDED) {#p02-runtime-host}

**Decision:** All inference runs in the Swift app process. The deck consumes the API over the WKWebView script-message bridge; tugcast consumes it over the UDS control socket. No inference in Rust, no Python, no subprocess model servers.

**Rationale:**
- Both permitted backends are Swift (FoundationModels is a system framework; mlx-swift is a Swift package) — there is no viable tugcast-side inference within the chosen classes.
- Both transports exist with room: the bridge (`MainWindow.swift`, ~14 handlers, `evaluateJavaScript` replies) and the socket (`ControlSocket.swift` ↔ `control.rs`, newline JSON, tagged `ControlMessage`, cloneable app-bound drain sender created in `main.rs` as `mpsc::channel::<String>(4)` over `writer.into_inner()`).

**Implications:**
- Headless tugcast (no app parent, e.g. `just dev`) has no socket: model requests answer unavailable immediately; browser-dev decks have no bridge handler: same. Both are [P12] degradation legs, not errors.

#### [P03] Two backends behind one protocol; Sequoia floor kept (DECIDED) {#p03-two-backends}

**Decision:** A `LocalModelBackend` Swift protocol with two implementations: **MLX** (stock `mlx-swift` + MLXLLM, tugapp's first SPM dependency, loads packs from the models dir) and **FoundationModels** (`#if canImport` + `@available(macOS 26.0, *)`, always-unavailable stub below 26). Deployment target stays 13.0; minimum supported OS stays Sequoia.

**Rationale:**
- MLX makes the whole system live on Sequoia today — the strategic unlock over the parked FM plan.
- FM arrives essentially free once the API exists: zero acquisition, structural output guarantees via guided generation, maintained by the OS.
- Swift is the only language that needs OS guards; Rust/TS are guarded *by the API* ([P08]).

**Implications:**
- Step 2 is the SPM landing with first-time verification (R02); Step 13 is the FM backend, compiling now, live-verifying on Golden Gate hardware only.

#### [P04] The catalog lives in tugcast; Swift discovers models from disk stamps (DECIDED) {#p04-catalog-ownership}

**Decision:** The curated catalog (Spec S01) is compiled into tugcast, which owns everything about models-on-disk: offering, downloading, verifying, listing, deleting. The Swift service never sees the catalog — it discovers installed models by reading their `tug-manifest.json` stamps in the models dir, which carry everything loading needs (backend kind, context window, prompt-format notes). The FM "model" is a Swift-side pseudo-entry (nothing to acquire).

**Rationale:**
- One source of truth per concern: acquisition state is tugcast's (it already owns the CONTROL feed and the store); runtime capability is Swift's. Parallel Rust/Swift catalog declarations would drift.
- The deck's model inventory (installed / downloading+progress / available) therefore comes from tugcast over CONTROL frames; backend availability comes from Swift over the bridge; the deck store merges the two (Spec S03/S04).

**Implications:**
- The stamp schema is a contract between the two processes — versioned field in the stamp, additive evolution only.

#### [P05] Acquisition: tugcast-owned, catalog-wide, robust (DECIDED) {#p05-acquisition}

**Decision:** The Bonsai revision's downloader, generalized from one hardcoded manifest to the catalog: control actions on the `install_claude` dispatch pattern, CONTROL progress frames ≤ 4 Hz, HTTP Range resume against `.part` staging, per-file sha256 before atomic finalize + stamp, ×3 retry with backoff, startup auto-resume of the *selected* model when enabled and absent, instant cancel, and a pid-stamped `O_EXCL` cross-process staging lock with stale-pid recovery and post-acquire stamp re-check.

**Rationale:**
- The design was vetted in the Bonsai revision (`ca4a504d8`); the cross-process lock exists because concurrent debug+release instances over the shared models dir are the *normal* dev condition.
- The owner's requirement: complete and robust — download, resume, list, load; setup must never frustrate a user into abandonment.

**Implications:**
- `reqwest` (rustls) joins the workspace deps (tugcast has axum server-side but no HTTP client).
- `dispatch_action` gains arms and one shared-state param, threaded through its three call sites (`control.rs::run_recv_loop`, `server.rs`, `router.rs`).

#### [P06] One task-shaped, versioned API vocabulary (DECIDED) {#p06-api-vocabulary}

**Decision:** The API is task-shaped — `classify`, `summarize`, `generate`, `availability` — plus tugcast-side inventory verbs. Requests carry `v: 1`, a `requestId`/`id`, the task, and task payload; replies carry `ok`, task result, `done: true` (streaming reserved, [Q04]). Consumers name tasks and never backends; configuration resolves task→model (Spec S06); the catalog/stamps resolve model→backend. Classify output contract, backend-neutral: the verdict is one of the supplied labels; MLX satisfies it by temperature-0 prompting + first-token parse (anything else ⇒ null); FM satisfies it structurally via a `@Generable` enum.

**Rationale:**
- The brief's force 3: different runtimes must not fragment the calling convention. Backends adapt to the vocabulary, never the reverse (R06).

**Implications:**
- Spec S04 (bridge) and Spec S05 (socket) are two framings of the same vocabulary; the Swift service has one internal request type both transports decode into.

#### [P07] Configuration: `dev.tugtool.local-model` tugbank domain (DECIDED) {#p07-configuration}

**Decision:** One domain, keys per Spec S06: `model` (the selected/assigned catalog id, or `auto`), `shell-routing` and `pulse-overview` (Bool kill switches, absent ⇒ ON per repo convention — default contested in [Q05]). All live-flippable via the DEFAULTS-frame subscription pattern.

**Rationale:**
- The `dev.tugtool.pulse`/`enabled` pattern (parallel Rust/TS consts; absent ⇒ default; live subscription) is settled precedent; Swift reads the same keys natively via `tugapp/Sources/TugbankClient.swift`.

**Implications:**
- `auto` = first installed model by catalog preference order; an explicit id that isn't installed behaves as absent (degrade, never error).

#### [P08] Availability is Swift's matrix; Rust/TS never OS-branch (DECIDED) {#p08-availability-matrix}

**Decision:** The Swift service owns the full availability matrix — MLX: Apple Silicon + package floor + a loaded-or-loadable installed model; FM: Apple Silicon + macOS 26+ + Apple Intelligence enabled + assets ready; Intel: nothing. The deck queries `availability` over the bridge (cached in the store; re-queried on window focus and after errors); tugcast never tracks availability — its requests are refused (`ok:false, error:"unavailable"`) and the caller backs off (60 s doubling to 10 min, reset on success).

**Rationale:**
- This *is* the brief's answer to "`@available` for Rust/TS": those languages have no such mechanism and need none — OS-awareness is confined to one Swift seam, everything else is guarded by the API.

**Implications:**
- No consumer ever reconstructs the matrix; new backends change no consumer code.

#### [P09] MLX residency: one model, lazy load, idle unload (DECIDED) {#p09-residency}

**Decision:** At most one MLX model resident; loaded lazily on first request, kept warm while requests arrive, unloaded after 5 idle minutes; an assignment change unloads before loading; requests are single-flight serialized. FM needs none of this (the OS manages residency) — a backend difference the protocol hides.

**Rationale:**
- Multi-GB residency is fine transiently, not permanently, in an all-day app; no current tenant needs two models at once ([Q06]).

**Implications:**
- First call after idle pays the load; the classify tenant's 250 ms submit budget simply lapses to Code (correct per Spec S07); a `prewarm` request exists for surfaces that can anticipate use — triggered on demonstrated intent (e.g. the first unsure-band debounce, Step 12), never on mere focus, so residency isn't paid speculatively.

#### [P10] TugSetup offers the catalog; management stays verb-level (DECIDED) {#p10-tugsetup}

**Decision:** TugSetup gains one optional step, "Set up on-device AI": when active it presents the catalog choices (composed `TugRadioGroup`, recommended default preselected, sizes shown) with **Download** and **Skip** CTAs; busy state shows a determinate `TugProgressIndicator` bar fed by progress frames; error state offers Retry/Skip. Download writes the `model` selection + sends `local_model_download`; Skip writes `model = ""` (asked-and-declined) and latches done. The step never gates "Start a Claude Code session"; the wizard closing mid-download is by design (tugcast owns the operation; auto-resume backstops). Post-setup management is verbs + tugbank ([Q03]).

**Rationale:**
- The step model in `tugdeck/src/components/tugways/tug-setup.tsx` is plain data (`Step` objects, `StepRow` renderer) — the Bonsai revision already designed the `secondaryCta` extension and the determinate-progress row; the radio group is the one addition, and hand-rolling a picker is banned (compose the real `TugRadioGroup`).

**Implications:**
- `Step` type gains `secondaryCta?` and an optional `body?: ReactNode` slot for the active step's picker; gallery states added to `gallery-tug-setup.tsx` for HMR iteration.

#### [P11] Tenants lift from the FM revision, consuming the unified API (DECIDED) {#p11-tenants}

**Decision:** Shell disambiguation (three-band classifier, Spec S07) and the Pulse overview (emitter + rendering, Spec S08) ship as specified in the archived FM revision, with exactly one change: they call the unified API (`classify` via bridge; `summarize` via socket) instead of backend-specific paths.

**Rationale:**
- Both were fully specified and vetted there — including the supervisor-sourced session identity, the pulse-enabled gating, and the typing-level degradation pin; they now double as proof that two different call sites (deck-interactive, tugcast-background) work through one vocabulary.

**Implications:**
- `AUTO_SHELL_DETECTION_ENABLED` is deleted; the parked heuristic un-parks behind model readiness.

#### [P12] Strict enhancement: every consumer degrades to today (DECIDED) {#p12-degradation}

**Decision:** No model installed, backend unavailable, flag off, headless tugcast, browser deck, app-test run, Intel Mac — in every such state, both tenant surfaces behave byte-identically to current main, and no user-facing error originates from model unavailability.

**Implications:**
- The degradation legs: Swift stub/matrix answers, absent-bridge null path, socket refusal back-off, `auto`-with-nothing-installed. The Step 16 app-test pins the deck-visible outcome on a model-less instance — the state every user is in before opting in.

#### [P13] Spike gates the plan; FM verification gates only itself (DECIDED) {#p13-spike-gate}

**Decision:** Step 1 (MLX candidates vs. the quality bars, on this Sequoia machine) is a hard STOP gate for everything. Step 13's FM backend compiles and lands now; its *live* verification is the plan's only Golden-Gate-blocked item and blocks nothing else.

**Rationale:**
- The eval's through-line predicts success but has never measured these exact packs; and unlike the archived FM plan, the gate is runnable today.

---

### Deep Dives {#deep-dives}

#### End-to-end flows {#e2e-flows}

**Acquisition (TugSetup):** step CTA → deck writes `dev.tugtool.local-model/model = <id>` (tugbank PUT) → control frame `local_model_download {model}` → tugcast `dispatch_action` spawns the task (lock → stamp re-check → Range-resumed downloads → sha256 → atomic finalize → stamp) → `local_model_download_progress` frames ≤ 4 Hz → `local_model_download_result` → unsolicited `local_model_inventory` broadcast → deck store folds → step flips done. Kill mid-download: next tugcast startup sees a selected-but-absent model and auto-resumes silently.

**Classify (typing):** prompt-entry updateListener detects an unsure-band draft on a 300 ms debounce (existing pre-gates: single line, ≤ 256 chars, atom-free) → `requestClassify(text)` (`local-model-bridge.ts`) → `postMessage` on `localModel` → `MainWindow` dispatch → `LocalModelService` resolves task→model→backend → MLX generate (temp 0) → first-token parse → `onLocalModelResult` → verdict cached by exact draft text. Submit: band `shell` ⇒ existing auto-route (`shellStore.exec(text, {origin:"auto"})` + history push, unchanged); `prompt` ⇒ Code; `unsure` ⇒ cached verdict, else await in-flight ≤ 250 ms, else Code.

**Overview (session activity):** `session_overview` accumulates per-session `tool_use` digests from its own `code_tx` subscription → cadence fires (Spec S08) → goal prompts from the session JSONL via supervisor-provided identity → digest prompt → `local_model_request {task:"summarize"}` over the socket → `LocalModelResult` → PULSE broadcast `kind:"overview"` → `pulse-store` latest-overview-per-scope → strip renders it above the beat line.

#### Control-socket extension details {#control-socket-extension}

Today: app→tugcast deserializes as `ControlMessage` (`tugrust/crates/tugcast/src/control.rs`, serde `tag="type"`, snake_case: `Tell`/`Shutdown`/`DevMode`); tugcast→app lines are hand-built JSON written by the drain task fed from the `mpsc::channel::<String>(4)` created in `main.rs` over `writer.into_inner()` — a requester clones that sender. Swift: `ControlSocketConnection.send(_ dict:)` writes newline JSON; `ProcessManager.handleControlMessage` switches on `type` (`ready`, `dev_mode_result`, `shutdown`, `tell`). Extension: (1) a tugcast handle struct holding the drain-sender clone + `Arc<Mutex<HashMap<String, oneshot::Sender<LocalModelReply>>>>`; (2) `ControlMessage::LocalModelResult { id, ok, text: Option<String>, error: Option<String> }` routed in `run_recv_loop` to the pending map; (3) Swift `case "local_model_request"` → service call off-main (`Task { … }`) → `connection.send(["type":"local_model_result", …])`. Timeout 10 s tugcast-side; headless (no socket) ⇒ immediate unavailable.

#### Session identity for the overview digest (load-bearing) {#overview-identity}

The tug-session→claude-session mapping lives in `AgentSupervisor`'s **in-memory** session map; the `SessionResolver` closure `draft_engine.rs` uses (`pub type SessionResolver = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>`) is built inline over it in the draft-request handler (`agent_supervisor.rs`, the `try_lock` closure: degrade to `None` under contention) and is **unreachable from a bare `main.rs` task**. The overview emitter is therefore constructed at wiring time with (a) a `SessionResolver` over an `Arc` clone of the supervisor's in-mem ledger (same `try_lock` shape) and (b) a `project_dir` lookup via the SQLite `SessionLedger` (`SessionRow.project_dir`). JSONL path = ledger `claude_projects_root()` + `encode_claude_project_name(project_dir)` + `<claude_id>.jsonl` (the `draft_engine.rs::session_user_prompts` construction). Unresolvable identity ⇒ skip the tick silently.

#### FoundationModels integration notes (for M04) {#foundation-models-notes}

`SystemLanguageModel.default.availability` (`.available` / `.unavailable(reason)`: device ineligible, Apple Intelligence not enabled, assets not ready — transient, re-query later). Classify: `LanguageModelSession(instructions:)` + `respond(to:generating: ShellVerdict.self, options: .init(temperature: 0))` where `ShellVerdict` is a `@Generable` two-case enum — constrained decoding guarantees a valid label. Summarize: `respond(to:)` with `GenerationOptions(temperature: 0, maximumResponseTokens: ~48)`. `prewarm()` hides load latency. ~4 K context window (digest budgets already sit far under). Guardrail refusals ⇒ null verdict / skipped tick, never surfaced. All behind `#if canImport(FoundationModels)`; the else-branch stub answers unavailable; call sites go through the `LocalModelBackend` protocol so they carry no availability annotations.

#### MLX integration notes (for M01) {#mlx-notes}

MLXLLM's factory loads a model from a local directory URL (safetensors + `config.json` + tokenizer files — the standard community MLX pack layout). Generation via MLXLMCommon's generate APIs at temperature 0 with small token caps (classify ~8, summarize ~48). No GBNF/logit-constraint machinery is assumed — the classify contract is prompt+parse ([P06]); if the Step 1 spike finds the chosen model needs a logits processor to hold the contract, that finding gates catalog admission rather than adding machinery. Residency per [P09]. Exact package products, versions, and platform floor recorded by Step 1 ([Q02]).

#### Prompt sources {#task-prompts}

The validated prompts live in the harness: classify in `~/bonsai-eval/classify_8b.py` (SHELL/PROMPT over one line, 26-case corpus), overview in `~/bonsai-eval/pulse_8b.py` (compact digest → one headline; tightening line: terse headline ≤ ~10 words, no preamble; six real-session fixtures). Step 1 adapts per candidate model's chat template, re-validates, freezes finals into [Q01]'s resolution; Step 3 ports them as Swift constants with a source comment naming the harness file.

---

### Specification {#specification}

**Spec S01: Catalog schema (compiled into tugcast)** {#s01-catalog}

`tugrust/crates/tugcast/src/local_model.rs` declares `CATALOG: &[CatalogEntry]` where `CatalogEntry { id, display_name, recommended: bool, hf_repo, hf_revision /* full commit hash */, files: &[ModelFile], total_bytes, context_window, notes }` and `ModelFile { name, sha256, bytes }`. Download URL per file: `https://huggingface.co/<hf_repo>/resolve/<hf_revision>/<name>`. Entries and the recommended default are filled from Step 1 ([Q01]); admission rules: (a) loads unchanged under stock MLXLLM, and (b) clears the Step 1 quality bars with the **same canonical instruction text** as every other entry — per-model chat-template *wrapping* is fine (MLXLMCommon applies each pack's own template from its tokenizer config) but the instruction content is shared, because the service ships one set of frozen prompt constants and the user can switch models (Step 11); a model that only passes with its own tuned prompt text is not admitted. The FM pseudo-model is *not* in this catalog (nothing to acquire); it is a Swift-side backend fact.

**Spec S02: Store layout, stamp, and lock** {#s02-store}

Root: `~/Library/Application Support/Tug/models/` (the `dirs::home_dir().join("Library/Application Support/Tug/…")` pattern from `tugrust/crates/tugcast/src/fs_write.rs`). Installed model: `models/<id>/` holding the pack files plus `tug-manifest.json` — `{v: 1, id, hf_repo, hf_revision, files: [{name, sha256, bytes}], backend: "mlx", context_window, catalog_rank, verified_at}` — written only after every file sha-verifies; **stamp existence is the presence probe** for both tugcast and Swift ([P04]). `catalog_rank` is copied from the catalog entry's position at finalize time (0 = recommended default) — it exists so the Swift service can order installed models for `auto` resolution *without* seeing the catalog, preserving [P04]'s ownership split. Staging: `models/.staging/<id>/<name>.part`. **Cross-process lock:** acquire `models/.staging/<id>.lock` via `O_EXCL` + own pid; on `EEXIST` read pid — dead ⇒ remove stale lock, retry once; live ⇒ answer `local_model_download_result {ok:false, error:"download in progress in another Tug instance"}`; after acquiring, **re-check the stamp** (the other instance may have finalized) before touching `.part` files; remove the lock on finalize/failure/cancel and via a `Drop` guard. Delete: refuse while locked/downloading; remove dir + stamp, broadcast inventory.

**Spec S03: CONTROL vocabulary (deck ⇄ tugcast)** {#s03-control-vocabulary}

Actions (new arms in `tugrust/crates/tugcast/src/actions.rs::dispatch_action`, the `install_claude` spawn-and-broadcast pattern): `local_model_download {model}` (idempotent: installed ⇒ immediate ok; running ⇒ no-op), `local_model_download_cancel`, `local_model_delete {model}`, `local_model_list`. Broadcasts on `FeedId::CONTROL`: `local_model_download_progress {model, file, fileIndex, fileCount, receivedBytes, totalBytes}` (≤ 4 Hz, bytes aggregated pack-wide); `local_model_download_result {model, ok, error}`; `local_model_inventory {models: [{id, displayName, recommended, totalBytes, state: "installed"|"downloading"|"available", receivedBytes?}]}` (answer to `local_model_list`, also broadcast unsolicited on any state change). Startup auto-resume: if `dev.tugtool.local-model/model` names a catalog id that is neither installed nor downloading, spawn the download exactly as if the action arrived. **Delete-vs-resident:** `local_model_delete` refuses while that model is downloading but proceeds even if the Swift service has it loaded — unlinking mmap'd weights is safe on macOS (the resident model keeps working until unload), and the service's per-request stamp re-stat (Step 11) unloads it and answers unavailable on the next request, so a delete degrades cleanly rather than leaving a ghost model answering indefinitely.

**Spec S04: Bridge vocabulary (deck ⇄ Swift)** {#s04-bridge-vocabulary}

Handler `localModel`. Requests: `{v: 1, requestId, task: "classify", text, labels: ["shell","prompt"]}` · `{v:1, requestId, task: "summarize", prompt}` · `{v:1, requestId, task: "generate", prompt, maxTokens?}` · `{v:1, requestId, task: "availability"}` · `{v:1, requestId, task: "prewarm"}`. Replies via `window.__tugBridge?.onLocalModelResult?.({requestId, ok, done: true, verdict?, text?, availability?: {ready: bool, backend?: "mlx"|"foundation-models", reason?}, error?})`. Deck client `tugdeck/src/lib/local-model-bridge.ts`: `requestClassify(text) => Promise<"shell"|"prompt"|null>` (null on 1500 ms timeout / missing handler / `ok:false`), `requestSummarize`, `requestAvailability`, `prewarm`; module-scope pending map; `(w.__tugBridge ??= {})` sink registration at module init (the `native-path-picker.ts` pattern); hard null-path when `window.webkit?.messageHandlers?.localModel` is absent.

**Spec S05: Socket vocabulary (tugcast ⇄ Swift)** {#s05-socket-vocabulary}

tugcast→app: `{"type":"local_model_request","v":1,"id":string,"task":"summarize"|"generate","prompt":string,"max_tokens"?:int}`. app→tugcast: `{"type":"local_model_result","id":string,"ok":bool,"done":true,"text":string|null,"error":string|null}` as `ControlMessage::LocalModelResult`. Same service-internal request type as S04; refusal/back-off per [P08].

**Spec S06: Configuration keys** {#s06-config-keys}

Domain `dev.tugtool.local-model`. Keys: `model` (`Value::String`: a catalog id, `"auto"`, or `""` = declined; absent ⇒ `"auto"`); `shell-routing`, `pulse-overview` (`Value::Bool`, absent ⇒ true — [Q05]). Rust consts beside the catalog; TS consts in `local-model-store.ts`; Swift reads `model` via `TugbankClient` when resolving assignments. `auto` resolution (performed by the Swift service, which ranks by **stamp `catalog_rank`**, never by catalog knowledge — Spec S02): the installed model with the lowest `catalog_rank`; the FM pseudo-model participates in `auto` *after* all installed MLX models until its Golden-Gate live verification passes (Step 13), at which point the owner may promote it. An explicit id that isn't installed ⇒ treated as absent (degrade, never error).

**Spec S07: Shell-routing bands** {#s07-shell-bands}

New pure export in `tugdeck/src/lib/shell-line-classifier.ts`: `bandShellLine(text, commands): "shell" | "prompt" | "unsure"`, refactored from `classifyShellLine`'s body: after the existing shape gates (length ≤ 400, no leading `/` or `#`) and env-assign skip — first token neither a known PATH executable nor path-shaped (`./`, `~/`, `/`) ⇒ `"prompt"`; trailing `?` ⇒ `"prompt"`; all current vetoes passed ⇒ `"shell"`; PATH-executable first token but vetoed (bare `AMBIGUOUS_OPENERS` member with no command-shaped target; `STOPWORDS` hit without strong signal; ≥ 8 tokens without strong signal) ⇒ `"unsure"`. `classifyShellLine` becomes the compatibility wrapper (`band === "shell"`). `AUTO_SHELL_DETECTION_ENABLED` is deleted; both entry points take caller-supplied readiness (from the local-model store via the existing `pathCommandsStoreRef`-style ref plumbing in `tug-prompt-entry.tsx` — [L07], never per-keystroke React state). `autoShellOpener`'s logic is unchanged (unambiguous openers only) behind the same gate. Verdict cache: plain `Map<string, "shell"|"prompt">`, cap 32, cleared on submit/clear. Submit: `unsure` ⇒ cached verdict, else await in-flight ≤ 250 ms, else Code.

**Spec S08: Overview emission** {#s08-overview-emission}

Frame: `{"type":"pulse","kind":"overview","text":headline,"scopes":[tug_session_id],"beat":n,"at":ms}` on `FeedId::PULSE`. Cadence per session: ≥ 8 forwarded `tool_use` frames since last emit OR 30 s elapsed with ≥ 1 new frame; hard floor 15 s; skip when digest unchanged or headline identical. Gates (all required): `pulse-overview` flag (S06) AND `dev.tugtool.pulse`/`enabled` (the strip hides entirely when pulse is off — never spend inference on invisible lines; reuse the enabled-closure shape from `main.rs`) AND not in refusal back-off. Digest: up to 10 user prompts (≤ 1500 chars) via `scribe::session_prompts_since(&jsonl, 0, 10, 1_500)` with identity per #overview-identity; plus last ≤ 40 `tool_use` entries as `name(short-target)` lines (target = the input's path/command field, ~60 chars). Unresolvable identity ⇒ skip tick. Headline clipped to 110 chars (PulseLine doctrine). Replay-bracketed frames muted exactly like `forwardable_session` in `feeds/pulse.rs`. Deck: `parsePulseFrame` (`tugdeck/src/protocol.ts`) and `PulseLine` (`tugcode/src/pulse/types.ts`) gain optional `kind` (absent ⇒ beat; tugcode never emits it); `pulse-store.ts` keeps overviews separate from beat lines/history/cleared-watermarks (`latestOverviewForScope`); `session-pulse-strip.tsx` renders the overview as a first line, absent ⇒ single-line layout identical to today. Overviews are not ledgered in v1.

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

| State | Zone (appearance / local-data / structure) | Mechanism | Law |
|-------|--------------------------------------------|-----------|-----|
| flags + selected model + inventory + backend availability | external state | new `local-model-store.ts` (module singleton) + `useSyncExternalStore`; folds CONTROL `local_model_*` frames, tugbank DEFAULTS subscription, bridge availability queries | [L02], [L24] |
| classify verdict cache + pending request map | local-data (non-render) | module-scope `Map` in `local-model-bridge.ts` / refs in `tug-prompt-entry.tsx` — never React state (must not re-render per keystroke) | [L06], [L07] |
| TugSetup step state (incl. picker selection) | derived + local | computed from `useLocalModel()` like `claudeStep`/`signInStep`; picker selection is `useState` local to the wizard | [L02] |
| overview line per scope | external state | `pulse-store.ts` extension (`latestOverviewForScope`) | [L02] |
| download progress bar fill / two-line strip layout | appearance | `TugProgressIndicator` `value`/`max` props; CSS in `session-pulse-strip` (no reserved empty row) | [L06] |

---

### Compatibility / Migration / Rollout {#rollout}

- **Compatibility:** deployment target unchanged (13.0); minimum OS unchanged (Sequoia); `kind` on pulse frames optional and ignored by older parsers; CONTROL, bridge, and socket vocabularies purely additive and versioned (`v: 1`); tugcode inbound allowlist untouched (no new client→tugcode messages anywhere).
- **Rollout:** nothing changes for a user who never selects a model (`model` absent ⇒ `auto` ⇒ nothing installed ⇒ everything degrades). Kill switches flip live. Rollback = flip flags / delete the model; full rollback = revert the dash.
- **Model upgrades (future):** a catalog revision bump changes the entry's `hf_revision` + shas; the stamp mismatch makes the model read as not-installed for the new catalog, and the normal download path acquires it; the old directory is removed on successful finalize.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugrust/crates/tugcast/src/local_model.rs` | Spec S01 catalog, Spec S02 store/stamp/lock, downloader task, auto-resume, config consts |
| `tugrust/crates/tugcast/src/feeds/session_overview.rs` | Spec S08 emitter: digest, cadence, summarize round-trip, PULSE broadcasts |
| `tugapp/Sources/LocalModelService.swift` | [P02]/[P06] service: request type, task→model→backend resolution, availability matrix |
| `tugapp/Sources/LocalModelBackend.swift` | [P03] backend protocol + MLX implementation ([P09] residency) |
| `tugapp/Sources/FoundationModelsBackend.swift` | M04 backend: `#if canImport` + `@available(macOS 26,*)` + stub |
| `tugdeck/src/lib/local-model-store.ts` | flags + selection + inventory + availability snapshot; hooks |
| `tugdeck/src/lib/local-model-bridge.ts` | Spec S04 client: pending map, sink, task helpers |
| `tests/app-test/at0xxx-local-model-absent.test.ts` | [P12] degradation pin (typing-level; never submits a turn) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `CatalogEntry`, `CATALOG`, `ModelFile` | struct/const | `local_model.rs` | S01; values from Step 1 |
| `models_dir()`, `is_installed()`, `write_stamp()`, `download_task()` | fn | `local_model.rs` | S02/S03 |
| `local_model_download` / `_cancel` / `_delete` / `_list` arms | match arms | `tugrust/crates/tugcast/src/actions.rs::dispatch_action` | S03; `install_claude` pattern; new shared-state param threads through `control.rs`, `server.rs`, `router.rs` call sites |
| `ControlMessage::LocalModelResult` | enum variant | `tugrust/crates/tugcast/src/control.rs` | S05; pending-map routing in `run_recv_loop` |
| `LOCAL_MODEL_DOMAIN` / `MODEL_KEY` / `SHELL_ROUTING_KEY` / `PULSE_OVERVIEW_KEY` | const | `local_model.rs` + `local-model-store.ts` (parallel decl) | S06 |
| `LocalModelBackend` | protocol | `LocalModelBackend.swift` | availability, load/unload, generate |
| `ShellVerdict` | `@Generable` enum | `FoundationModelsBackend.swift` | M04 structural classify |
| `case "localModel"` + reply | handler | `tugapp/Sources/MainWindow.swift` | S04; registered beside `clipboardRead` |
| `case "local_model_request"` | handler | `tugapp/Sources/ProcessManager.swift::handleControlMessage` | S05 |
| `bandShellLine` | fn | `tugdeck/src/lib/shell-line-classifier.ts` | S07; `AUTO_SHELL_DETECTION_ENABLED` deleted |
| `PulseLine.kind?: "overview"` | field | `tugcode/src/pulse/types.ts`, `tugdeck/src/protocol.ts`, `pulse-store.ts` | S08; absent ⇒ beat |
| `latestOverviewForScope` | fn/selector | `tugdeck/src/lib/pulse-store.ts` | strip's first line |
| `Step.secondaryCta?`, `Step.body?` | type fields | `tugdeck/src/components/tugways/tug-setup.tsx` | [P10] |
| `reqwest` | dep | `tugrust/Cargo.toml` (workspace) + tugcast | rustls features; no openssl |

---

### Documentation Plan {#documentation-plan}

- [ ] Record Step 1 spike results ([Q01]/[Q02] resolutions, frozen prompts, chosen catalog) in this document.
- [ ] Update `roadmap/local-model-bringup-brief.md` status line to point here once implementation starts.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit (Rust, nextest)** | catalog/stamp/store logic; lock contention; control-message serde; cadence/digest logic (identity injected as closures); gate truth tables; back-off | Steps 4–6, 11, 14 |
| **Integration (Rust, nextest)** | downloader vs. a local axum test server with Range support: happy path, kill+resume, corrupt-sha reject, cancel, lock contention | Step 5 |
| **Unit (TS, bun test)** | band table (26-line corpus + parked-off motivating cases); wrapper equivalence; bridge timeout/absent-handler null paths; store frame folding; `parsePulseFrame` kind passthrough; overview/beat separation | Steps 7, 13, 15 |
| **App-test (selective)** | degradation pin on a model-less instance | Step 16 |
| **Spike harness (not CI)** | model quality/latency; re-run when the catalog or OS changes | Step 1, then regression |

#### What stays out of tests {#test-non-goals}

- Model output quality in CI — spike-validated; CI never runs inference and never downloads gigabytes.
- Mocked-LLM UI flows — banned; deck decision logic is tested as pure functions with verdicts injected as arguments.
- TugSetup happy-path download as an app-test — TugSetup is harness-suppressed by design and real network pulls are out; covered by Rust integration tests + the manual Step 9 pass.
- Live two-line strip / live shell routing — needs an installed model; manual matrix in Steps 12/17.
- Swift service internals — no XCTest scaffolding in tugapp; exercised end-to-end in checkpoints and structurally by the build.

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** Step 1 is the [P13] STOP gate. Milestone labels: **M01** = Steps 1–3, 6, 8 (runtime + API on both transports), **M02** = Steps 4–5 (acquisition), **M03** = Steps 7, 9–11 (deck store, proof-of-life, TugSetup, configuration), **M04** = Step 13 (FM backend), **M05** = Steps 12, 14–17 (tenants + pins). Steps are ordered so each lands green independently.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Spike — MLX candidates vs. the quality bars | pending | — |
| #step-2 | tugapp SPM dependency landing | pending | — |
| #step-3 | Backend protocol + MLX backend + service core | pending | — |
| #step-4 | tugcast catalog + model store | pending | — |
| #step-5 | tugcast downloader + CONTROL vocabulary | pending | — |
| #step-6 | Socket request/reply plumbing | pending | — |
| #step-7 | Deck local-model store + bridge client | pending | — |
| #step-8 | Bridge endpoint in MainWindow | pending | — |
| #step-9 | Integration checkpoint — download → load → answer (Sequoia) | pending | — |
| #step-10 | TugSetup on-device-AI step | pending | — |
| #step-11 | Task→model assignment resolution | pending | — |
| #step-12 | Tenant: shell disambiguation | pending | — |
| #step-13 | FoundationModels backend | pending | — |
| #step-14 | Tenant: overview emitter (tugcast) | pending | — |
| #step-15 | Tenant: overview rendering (deck) | pending | — |
| #step-16 | Degradation pin app-test | pending | — |
| #step-17 | Integration checkpoint — full matrix | pending | — |

#### Step 1: Spike — MLX candidates vs. the quality bars {#step-1}

**Commit:** `plan(local-model): record MLX candidate spike results (Q01, Q02)`

**References:** [P13], [P06], [Q01], [Q02], Risk R01, R05, (#task-prompts, #mlx-notes, #success-criteria)

**Artifacts:**
- A scratch SwiftPM CLI harness in `~/bonsai-eval/` (outside the repo) depending on mlx-swift/MLXLLM, loading candidate packs from local directories and running: the 26-line classify corpus under the first-token contract; the six pulse digests; latency and RAM measurements.
- [Q01] resolution: per-candidate scores/latencies/footprints, the chosen catalog entries + recommended default, frozen prompt strings. [Q02] resolution: pinned package versions + platform floor. Spec S01 values filled.

**Tasks:**
- [ ] Assemble candidates (manually downloaded packs): 2–3 current-generation small instruct MLX packs + `Ternary-Bonsai-8B-mlx-2bit` (already local).
- [ ] Adapt the harness prompts (#task-prompts) into **one canonical instruction text per task**, applied to every candidate through its own chat template (MLXLMCommon handles the wrapping); one tightening round allowed on the headline task, applied to all candidates alike. Per-candidate prompt tuning is disallowed — it would violate Spec S01's admission rule (b), since the service ships one frozen prompt set across a switchable catalog.
- [ ] Record `sha256sum` + byte sizes of every chosen pack file (they become Spec S01 data).

**Tests:**
- [ ] The harness is the test; raw outputs recorded with scores.

**Checkpoint:**
- [ ] At least one candidate: classify ≥ 25/26 at ≤ 400 ms warm; six accurate preamble-free headlines ≤ 3 s; acceptable disk/RAM. **No candidate clears ⇒ STOP the plan and report.**

---

#### Step 2: tugapp SPM dependency landing {#step-2}

**Depends on:** #step-1

**Commit:** `tugapp(local-model): first SPM dependency — mlx-swift + MLXLLM, pinned`

**References:** [P03], [Q02], Risk R02, (#mlx-notes)

**Artifacts:**
- `XCRemoteSwiftPackageReference` entries in `tugapp/Tug.xcodeproj/project.pbxproj` for `ml-explore/mlx-swift` and `ml-explore/mlx-swift-examples` (products MLXLLM, MLXLMCommon), pinned to Step 1's versions. No other code.

**Tasks:**
- [ ] Add packages; verify `just app-debug` resolves and builds **from a clean checkout** without interaction.
- [ ] Verify `scripts/sign-bundle.sh` signs the app with the new framework payloads and the result launches.

**Tests:**
- [ ] Build + launch are the tests.

**Checkpoint:**
- [ ] `just app-debug` green from clean; signed app launches; `git diff` shows pbxproj-only changes.

---

#### Step 3: Backend protocol + MLX backend + service core {#step-3}

**Depends on:** #step-2

**Commit:** `tugapp(local-model): LocalModelBackend protocol, MLX backend, service core`

**References:** [P02], [P03], [P06], [P08], [P09], Spec S02, Spec S04, (#mlx-notes, #task-prompts)

**Artifacts:**
- `LocalModelBackend.swift`: protocol (`availability`, `load(modelDir:stamp:)`, `unload`, `generate(request)`) + the MLX implementation: pack discovery by reading `tug-manifest.json` stamps under `~/Library/Application Support/Tug/models/`, ModelContainer load from directory URL, temp-0 generation with per-task token caps, [P09] residency (single-flight queue, 5-min idle unload, unload-before-switch), `prewarm`.
- `LocalModelService.swift`: the internal request type both transports decode into; task→model→backend resolution (model selection read via `TugbankClient`, Spec S06 semantics); classify first-token parse against supplied labels; the availability matrix ([P08]); frozen Step 1 prompts as constants with harness-source comments.

**Tasks:**
- [ ] Implement; a manually-placed pack (copied from the spike, stamp hand-written per Spec S02) is the test vehicle until M02 lands.

**Tests:**
- [ ] Build structural; a temporary debug hook may drive it during development but must not land — Step 8's bridge is the durable exerciser.

**Checkpoint:**
- [ ] `just app-debug` green; with the manually-placed pack, an in-app invocation answers `classify("make test") == shell`.

---

#### Step 4: tugcast catalog + model store {#step-4}

**Depends on:** #step-1

**Commit:** `tugcast(local-model): catalog, store layout, manifest stamps, config consts`

**References:** [P04], [P05], [P07], Spec S01, Spec S02, Spec S06, (#symbols)

**Artifacts:**
- `tugrust/crates/tugcast/src/local_model.rs`: `CATALOG` with Step 1's entries; `models_dir()`/`staging_dir()` (the `fs_write.rs` home-dir pattern); `is_installed()` (stamp probe + catalog-revision match); `verify_file()` (sha2 streaming — `sha2` is already a tugcast dep); `write_stamp()`; Spec S06 consts + readers (`model` absent ⇒ `"auto"`; flags absent ⇒ true).
- `mod local_model;` wiring in `main.rs`.

**Tasks:**
- [ ] Implement per specs.

**Tests:**
- [ ] Unit: stamp round-trip; `is_installed` false on missing/partial/revision-mismatched dirs; `verify_file` rejects corruption; config readers' absent-value semantics.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 5: tugcast downloader + CONTROL vocabulary {#step-5}

**Depends on:** #step-4

**Commit:** `tugcast(local-model): resumable checksummed downloader, inventory verbs, cross-process lock`

**References:** [P05], [P12], Spec S02, Spec S03, Risk R03, (#e2e-flows)

**Artifacts:**
- `reqwest` (rustls) in workspace + tugcast deps; `download_task()` (Range resume, ×3 backoff, sha verify, atomic finalize + stamp, cancel token, ≤ 4 Hz aggregated progress, S02 lock with stale-pid recovery + post-acquire stamp re-check + `Drop` guard); `local_model_download`/`_cancel`/`_delete`/`_list` arms in `actions.rs::dispatch_action` with the new shared-state param threaded through the three call sites (`control.rs::run_recv_loop`, `server.rs`, `router.rs`); startup auto-resume in `main.rs` init; unsolicited `local_model_inventory` broadcasts on state change; base URL injectable for tests.

**Tasks:**
- [ ] Implement per Spec S02/S03.

**Tests:**
- [ ] Integration (local axum server with Range): happy path finalizes + stamps; mid-stream abort then re-run resumes from `.part`; wrong sha rejects and deletes staged file; cancel leaves resumable staging; progress aggregation + terminal result correct; delete refuses while downloading.
- [ ] Unit: lock contention (live pid ⇒ polite failure; stale pid ⇒ reclaim; stamp appears while waiting ⇒ ok-without-downloading).

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 6: Socket request/reply plumbing {#step-6}

**Depends on:** #step-3

**Commit:** `tugcast+tugapp(local-model): task request/reply over the control socket`

**References:** [P02], [P08], Spec S05, (#control-socket-extension)

**Artifacts:**
- `control.rs`: `ControlMessage::LocalModelResult` + serde test (the `test_control_message_tell_deserialization` pattern); the handle struct (drain-sender clone + oneshot pending map) + `request_local_model(task, prompt) -> oneshot`; 10 s timeout; headless ⇒ immediate unavailable.
- `ProcessManager.swift`: `case "local_model_request"` → `LocalModelService` off-main → `connection.send(["type":"local_model_result", …])`.

**Tasks:**
- [ ] Implement both sides.

**Tests:**
- [ ] nextest: `LocalModelResult` deserialization; pending-map resolve/timeout with a stubbed channel.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`; `just app-debug` green.

---

#### Step 7: Deck local-model store + bridge client {#step-7}

**Depends on:** #step-5

**Commit:** `tugways(local-model): store for flags, inventory, availability; host bridge client`

**References:** [P07], [P08], [P12], Spec S03, Spec S04, Spec S06, (#state-zone-mapping)

**Artifacts:**
- `local-model-bridge.ts` per Spec S04 (pending map, 1500 ms timeouts, `(w.__tugBridge ??= {})` sink, absent-handler null path).
- `local-model-store.ts`: Spec S06 flag/selection reads with live DEFAULTS-subscription flips (the `pulse-store.ts` pattern); folds `local_model_*` CONTROL frames into an inventory snapshot; sends `local_model_list` at connection attach; queries bridge availability at attach / window focus / after classify errors; hooks `useLocalModel()`, `useLocalModelReady()` (per-tenant: `shellRoutingReady`, `pulseOverviewEnabled`); `setLocalModelSelection(id)` writer in `settings-api.ts` (PUT, the `putSetupSeen` pattern); store attach wired where `attachPulseStore` is wired in deck bootstrap.

**Tasks:**
- [ ] Implement both modules.

**Tests:**
- [ ] bun test: frame folding (progress → snapshot, inventory → list, result → refresh); default semantics (`model` absent ⇒ auto; flags absent ⇒ ON); bridge timeout ⇒ null; absent handler ⇒ null (no throw).

**Checkpoint:**
- [ ] `just test-ts` && `cd tugdeck && bunx vite build`

---

#### Step 8: Bridge endpoint in MainWindow {#step-8}

**Depends on:** #step-3

**Commit:** `tugapp(local-model): localModel bridge handler`

**References:** [P02], [P06], Spec S04, (#e2e-flows)

**Artifacts:**
- `MainWindow.swift`: `contentController.add(self, name: "localModel")` beside the existing registrations; dispatch case decoding Spec S04 requests, calling the service off-main, replying via `evaluateJavaScript("window.__tugBridge?.onLocalModelResult?.(…)")` with proper JSON escaping (follow the existing reply helpers); malformed payloads answer `ok:false`.

**Tasks:**
- [ ] Implement handler + reply.

**Tests:**
- [ ] Manual from the debug-app console: `availability` answers; with the Step 3 manual pack, `requestClassify("make test")` ⇒ `"shell"`, `requestClassify("make the button bigger")` ⇒ `"prompt"`.

**Checkpoint:**
- [ ] `just app-debug` green; console probes answer per spec; `cd tugdeck && bunx vite build` green.

---

#### Step 9: Integration checkpoint — download → load → answer (Sequoia) {#step-9}

**Depends on:** #step-5, #step-6, #step-7, #step-8

**Commit:** `N/A (verification only)`

**References:** [P05], [P08], Spec S02–S05, Risk R03, (#success-criteria)

**Tasks:**
- [ ] Remove the manual pack; via a control-frame tell (or temporary console call), drive `local_model_download` for the recommended model; watch real HF download to completion; verify stamp + shas on disk.
- [ ] Kill tugcast mid-download; relaunch; confirm silent resume and completion. Cancel mid-download; confirm clean stop and retry.
- [ ] With the downloaded model: deck-console classify round-trip AND a tugcast-side summarize round-trip (temporary test tell) both answer.
- [ ] `local_model_delete`; confirm inventory broadcast and that classify now answers null.

**Tests:**
- [ ] `just app-test-changed` (existing corpus unaffected).

**Checkpoint:**
- [ ] All flows pass; `cd tugrust && cargo nextest run` green. **This checkpoint is the infrastructure's proof-of-life on Sequoia.**

---

#### Step 10: TugSetup on-device-AI step {#step-10}

**Depends on:** #step-9

**Commit:** `tugways(tug-setup): optional on-device AI step with catalog choice and download tracking`

**References:** [P10], [P12], Spec S03, Spec S06, Risk R03, (#state-zone-mapping)

**Artifacts:**
- `tug-setup.tsx`: `Step.secondaryCta?` + `Step.body?` and their `StepRow` rendering; the `localAiStep` between `signInStep` and `openStep`, derived from `useLocalModel()`: active (catalog picker as a composed `TugRadioGroup` — recommended default preselected, sizes shown — with Download / Skip CTAs), busy (determinate `TugProgressIndicator` `variant="bar"` fed by aggregated bytes, `formatValue` percent), error (result error + Retry / Skip), done ("On-device AI ready" / "Skipped"). Download = `setLocalModelSelection(id)` + control frame `local_model_download {model: id}`; Skip = `setLocalModelSelection("")` + local done-latch (`useState`, the `openedFirstSession` pattern). Step visible on genuine first run (`firstRun`) only; never gates `openStep`; two behaviors by design: the optional step and `openStep` may be simultaneously active, and opening the first session may close the wizard mid-download (tugcast owns the operation; auto-resume backstops).
- Gallery states in `gallery-tug-setup.tsx` for HMR iteration; copy helpers in `tug-setup-copy.ts` as needed.

**Tasks:**
- [ ] Implement; compose `TugRadioGroup` and `TugProgressIndicator` — never hand-rolled equivalents.

**Tests:**
- [ ] bun test for new copy helpers (the `tug-setup-copy.test.ts` pattern).

**Checkpoint:**
- [ ] `just test-ts` && `cd tugdeck && bunx vite build`; gallery renders all states; debug app with `SESSION_FORCE_SETUP` shows the step; Skip leaves `model=""` and nothing downloads.

---

#### Step 11: Task→model assignment resolution {#step-11}

**Depends on:** #step-9

**Commit:** `tugapp(local-model): live task→model assignment via tugbank`

**References:** [P07], [P08], Spec S06, (#success-criteria)

**Artifacts:**
- `LocalModelService` re-reads the `model` selection per request (cheap `TugbankClient` read; the DB is per-instance and local) and applies Spec S06 semantics (`auto` = installed model with the lowest stamp `catalog_rank`; unknown/uninstalled id ⇒ unavailable); an assignment change triggers unload-before-load per [P09].
- Delete-vs-resident contract (Spec S03): resolution re-stats the model's `tug-manifest.json` on every request; a vanished stamp unloads the resident model and answers unavailable.

**Tasks:**
- [ ] Implement; verify a tugbank write flips the answering model without app relaunch.

**Tests:**
- [ ] Manual: with two models installed (spike leftovers qualify), flip `model` between them and observe the switch; set an uninstalled id and observe clean unavailability.

**Checkpoint:**
- [ ] `just app-debug` green; the flip works live.

---

#### Step 12: Tenant — shell disambiguation {#step-12}

**Depends on:** #step-7, #step-8, #step-9

**Commit:** `tugways(shell-routing): heuristic bands + async local-model tiebreak, un-parked behind readiness`

**References:** [P11], [P12], [Q05], Spec S07, Risk R04, R05, (#e2e-flows, #state-zone-mapping)

**Artifacts:**
- `shell-line-classifier.ts`: `bandShellLine` per Spec S07; `classifyShellLine` as wrapper; `AUTO_SHELL_DETECTION_ENABLED` deleted; entry points take caller-supplied readiness.
- `tug-prompt-entry.tsx`: 300 ms debounce pre-consult (existing pre-gates reused), verdict cache (cap 32, cleared on submit/clear), submit band logic with ≤ 250 ms unsure-await falling back to Code; `prewarm` fires on the **first unsure-band debounce** of a session, not on prompt-entry focus — focus-triggered prewarm would load multi-GB weights on every session focus and thrash against the 5-minute idle unload for users who rarely type ambiguous lines, whereas the first unsure debounce is the moment intent is demonstrated (that first verdict may miss its window and lapse to Code, which is correct per Spec S07); live-typing chip gate flipped from the deleted constant to `shellRoutingReady` via ref plumbing (the `pathCommandsStoreRef` pattern); auto-routed history push and `origin:"auto"` attribution byte-identical.

**Tasks:**
- [ ] Implement; honor [Q05]'s decided default (one constant).

**Tests:**
- [ ] bun test: band table over the 26-line corpus + parked-off motivating cases (`write a poem`, `apply the patch` ⇒ unsure — never shell without a verdict); wrapper equivalence; cache cap/clear as pure-helper tests.

**Checkpoint:**
- [ ] `just test-ts` && `cd tugdeck && bunx vite build`
- [ ] Model-less: typing/submitting exactly as main. Model installed: `make test` ⇒ shell, `make the button bigger` ⇒ Claude, `git status` instant with no model call.

---

#### Step 13: FoundationModels backend {#step-13}

**Depends on:** #step-3

**Commit:** `tugapp(local-model): FoundationModels backend behind availability guards`

**References:** [P03], [P08], [P13], (#foundation-models-notes)

**Artifacts:**
- `FoundationModelsBackend.swift`: `#if canImport(FoundationModels)` + `@available(macOS 26.0, *)` implementation of `LocalModelBackend` (availability from `SystemLanguageModel.default.availability`; classify via guided `@Generable ShellVerdict`; summarize via `respond(to:)` with capped tokens; `prewarm()`); `#else`/below-26 stub answering unavailable. Registered in the service's backend list; the FM pseudo-model participates in `auto` resolution only when its availability is `.available`.

**Tasks:**
- [ ] Implement; verify the app builds and behaves identically on this Sequoia machine (stub path — availability answers unavailable).

**Tests:**
- [ ] Build structural; Sequoia console: `availability` still reports the MLX story only.

**Checkpoint:**
- [ ] `just app-debug` green from clean on Sequoia. **Live FM verification (classify corpus through the same API) is deferred to Golden Gate hardware and blocks nothing else** ([P13]).

---

#### Step 14: Tenant — overview emitter (tugcast) {#step-14}

**Depends on:** #step-4, #step-6

**Commit:** `tugcast(pulse): session overview emitter — digest, cadence, local-model summarize`

**References:** [P11], [P12], Spec S05, Spec S06, Spec S08, (#overview-identity, #e2e-flows)

**Artifacts:**
- `feeds/session_overview.rs`: per-session accumulator over its own `code_tx` subscription (replay-mute brackets mirroring `forwardable_session` in `feeds/pulse.rs`); cadence + triple gate per Spec S08; digest composer; summarize via the Step 6 handle with refusal back-off (60 s → 10 min); PULSE broadcasts; module one-way (outputs = broadcast + tracing only, the pulse bridge's isolation doctrine).
- `main.rs` wiring beside the pulse bridge task, constructed with the identity handles per #overview-identity: `SessionResolver` over an `Arc` clone of the supervisor's in-mem session map (the `try_lock` shape) + the SQLite `SessionLedger` handle for `SessionRow.project_dir`; unresolvable identity skips the tick silently.

**Tasks:**
- [ ] Implement per specs.

**Tests:**
- [ ] nextest: cadence trigger table (8-frames / 30 s / 15 s floor / unchanged-skip); digest composition from fixture frames + fixture JSONL (resolver + project-dir injected as test closures); replay-bracket muting; frame shape (`kind:"overview"`, single scope, clipped text); gate truth table; back-off doubling/reset.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run -p tugcast`

---

#### Step 15: Tenant — overview rendering (deck) {#step-15}

**Depends on:** #step-14

**Commit:** `tugways(pulse): render the overview line above the live beat`

**References:** [P11], [P12], Spec S08, (#state-zone-mapping)

**Artifacts:**
- `protocol.ts::parsePulseFrame` + payload type: optional `kind` passthrough; `tugcode/src/pulse/types.ts::PulseLine` documents the field (tugcode never emits it; the type is the wire contract).
- `pulse-store.ts`: overviews stored separately (latest per scope; never entering beat lines/history/cleared-watermark machinery); `latestOverviewForScope` + hook.
- `session-pulse-strip.tsx` + CSS: overview as first line above the stage line; absent ⇒ single-line layout identical to today (no reserved empty row); beat-line min-dwell/queue design untouched; overview swaps instant.

**Tasks:**
- [ ] Implement.

**Tests:**
- [ ] bun test: `parsePulseFrame` kind passthrough + absent default; store separation; selector scope rules matching `latestLineForScope` semantics (session's own + `"app"`-wide + unscoped).

**Checkpoint:**
- [ ] `just test-ts` && `cd tugdeck && bunx vite build`

---

#### Step 16: Degradation pin app-test {#step-16}

**Depends on:** #step-12, #step-15

**Commit:** `test(app-test): pin model-less degradation for local-model surfaces`

**References:** [P12], Spec S07, Spec S08, (#test-non-goals)

**Artifacts:**
- `tests/app-test/at0xxx-local-model-absent.test.ts` with `@covers` for `local-model-store.ts`, `session-pulse-strip.tsx`, `tug-prompt-entry.tsx`: on a model-less instance (the app-test default — fresh transient workspace, nothing installed), the strip renders single-line and typing `make ` / `git ` never auto-inserts the `!shell` chip. **Typing-level only — never submits a turn** (a real send into a replay-backed harness session is out of bounds; submit-time semantics live in Step 12's pure-function suite).

**Tasks:**
- [ ] Write the test; `just app-test-covers-check` green.

**Tests:**
- [ ] `just app-test-changed`

**Checkpoint:**
- [ ] Suite green — this pins the exact state every user is in before opting in.

---

#### Step 17: Integration checkpoint — full matrix {#step-17}

**Depends on:** #step-10, #step-11, #step-12, #step-13, #step-16

**Commit:** `N/A (verification only)`

**References:** [P12], [P13], (#success-criteria)

**Tasks:**
- [ ] Fresh-instance TugSetup pass: pick a model, download with progress, land on done; both tenants live afterward.
- [ ] Live session shows an overview within ~30 s of activity; shell matrix per Step 12; assignment flip per Step 11; `local_model_delete` degrades both tenants live; flags flip both features off without relaunch.
- [ ] Headless `just dev` tugcast: overview silently absent, nothing errors.
- [ ] Model-less instance: everything byte-identical to main.

**Tests:**
- [ ] `cd tugrust && cargo nextest run` && `just test-ts` && `cd tugdeck && bunx vite build` && `just app-test-changed`

**Checkpoint:**
- [ ] Full matrix passes on this Sequoia machine. (FM live verification remains the one Golden-Gate item, per [P13].)

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** Local-model capability as core Tug infrastructure — curated catalog, robust acquisition into one well-known location, a two-backend Swift runtime behind one task-shaped API on both IPC channels, TugSetup onboarding — proven by two live tenants on Sequoia, with the FoundationModels backend compiled, guarded, and awaiting only Golden Gate hardware for its live pass.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Spike recorded and above bar ([Q01]/[Q02] resolved in this document).
- [ ] Step 9 proof-of-life: download → resume-after-kill → verify → load → classify and summarize round-trips on Sequoia.
- [ ] TugSetup offers the catalog with determinate progress; Skip costs nothing (Step 10/17).
- [ ] Both tenants live with a model; both surfaces byte-identical to main without one (Step 17 matrix + Step 16 pin).
- [ ] Deployment target still 13.0; app builds and runs unchanged on macOS 13–15; FM backend compiles behind guards.
- [ ] Scribe untouched (no diff under `scribe.rs` or its callers).
- [ ] `cargo nextest run`, `just test-ts`, `bunx vite build`, `just app-debug`, `just app-test-changed` green.

**Acceptance tests:**
- [ ] Step 5 downloader integration suite (incl. resume, corruption, lock contention).
- [ ] Step 12 band-table unit suite.
- [ ] Step 14 cadence/digest/gate unit suite.
- [ ] Step 16 app-test degradation pin.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] FM backend live verification on Golden Gate hardware (the plan's only OS-blocked item).
- [ ] Post-setup model-management surface ([Q03]) — pure UI over shipped verbs.
- [ ] Streaming generation ([Q04]) — vocabulary already permits it.
- [ ] Further tenants: session titles, lens ranking, dedup — the API is shaped for them.
- [ ] Overview persistence + history; the larger Pulse/Lens redesign.
- [ ] Tug CDN weight hosting; catalog growth beyond the seed.

| Checkpoint | Verification |
|------------|--------------|
| Spike gate | Step 1 recorded results vs. Success Criteria bars |
| Infrastructure proof-of-life | Step 9 flows on Sequoia |
| Download robustness | Step 5 integration suite + Step 9 kill/resume manual |
| Degradation parity | Step 16 app-test + Step 17 model-less matrix |
| Workspace health | `cargo nextest run` / `just test-ts` / `bunx vite build` / `just app-debug` / `just app-test-changed` |
