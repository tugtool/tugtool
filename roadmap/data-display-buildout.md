<!-- devise-skeleton v4 -->

## Session Activity API — a multi-channel telemetry substrate for compact and expanded data displays {#data-display-buildout}

**Purpose:** Replace the pulse sparkline's single "streamed characters" meter with an app-scoped, session-scoped, multi-channel **Session Activity API** — text, tokens, tools, subagents, CPU, memory, disk — that the compact pulse-bar sparkline consumes today and a future expanded Activity card consumes tomorrow, so the display stays lively across *every* kind of session work, not just Write/Edit.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-07-01 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

What reads as "Pulse" in the Dev card is two independent pipelines rendered side by side: a **label** (from the `tugpulse` daemon narrating stream-json frames) and a **sparkline** (fed by a local `ThroughputMeter` in `code-session-store.ts` that counts streamed characters per second off the `CODE_OUTPUT` feed). The two share no data. The sparkline moves richly only for **Write/Edit**, because those are the only tools that emit `tool_input_progress` byte-delta frames (`session.ts` early-returns for any tool without a file path). Skills (`tugplug` `<plugin>:<skill>`), post-`AskUserQuestion` resumes, heavy thinking, and subagent orchestration produce only tiny fixed "keep-alive" pips or nothing — so the line flatlines through most real work.

The fix is not more keep-alive hacks. The sparkline plots "characters the foreground model streamed" and mislabels it "how hard is this session working." Those are different quantities. This plan builds a proper telemetry substrate — a multi-channel, per-session **Session Activity API** — measuring real signals (token velocity, tool cadence, subagent activity, and OS-level CPU/memory/disk for the session's process subtree). The compact pulse sparkline becomes the first thin consumer; the same API is the basis for an expanded Activity card. The OS-level signals are attributed by **process subtree**, never by working directory, so two sessions in the same directory never bleed together.

#### Strategy {#strategy}

- Build the **substrate first** ([P01], [P02]): an app-scoped `SessionActivityStore` keyed by `tug_session_id`, holding one `ActivityMeter` per channel. Port the existing throughput signal onto it behavior-neutrally before adding anything new.
- **Deck-local channels next** ([P06], [P07]) — token velocity, tool cadence, subagent activity — cost zero backend work and kill the flatline cases immediately.
- **Enrich the compact view** ([P04], [P05]) — dominant-channel color + a composite intensity line that stays alive whenever *any* real work happens.
- **Then the backend instrument** ([P08]–[P11]): capture the tugcode child PID (keystone), add a per-session resource sampler walking the PID subtree, ship it on a new `SESSION_RESOURCE` feed, and consume CPU/memory/disk as further channels.
- **Finally the expanded rep** ([P12]): an Activity card that renders per-channel series and raw readouts over the same API.
- Keep all high-churn series **out of React state** ([P03]) — read imperatively on the consumer's own timer, painting straight to SVG, exactly as the sparkline does today ([L02], [L06]).

#### Success Criteria (Measurable) {#success-criteria}

> Make these falsifiable.

- Invoking a `tugplug` skill (e.g. `/tugplug:vet`) drives the pulse sparkline visibly off the baseline for the duration of the skill's work (previously flat). Verify in the real app via the `verify` skill.
- A turn that resumes after answering an `AskUserQuestion` (thinking-heavy, textless) drives the sparkline off the baseline. Verify in the real app.
- Running a Bash `cargo build` inside a session produces a distinct CPU hump on the resource channels that is **absent** from a second, idle session bound to the same project directory. Verify with two sessions in `/u/src/tugtool`.
- The compact sparkline fill color changes with the dominant activity kind (thinking/tokens vs writing/text vs subprocess/CPU). Verify visually across a scripted turn.
- `SessionActivityStore` unit tests: `record`/`series`/`compositeSeries`/`dominant`/`intensity` return correct values for constructed sample sequences (`cargo`/`bun test`, no mock-store render tests).
- `bunx vite build` succeeds and the debug app reaches the Dev card without hanging at splash ([verify-with-vite-build]).

#### Scope {#scope}

1. App-scoped `SessionActivityStore` + generalized `ActivityMeter` + per-channel descriptors (the API).
2. Deck-local producer channels: text (ported), tokens, tools, subagents.
3. Compact-view upgrade: dominant-channel color + composite intensity line in `DevPulseStrip`/`TugSparkline`.
4. Pulse **label** coverage for skills, `AskUserQuestion`, and a generic-tool fallback (`tugpulse` voice).
5. Backend: tugcode child-PID capture; per-session `SESSION_RESOURCE` sampler (CPU, memory); disk I/O via `proc_pid_rusage`.
6. Deck resource channels: consume `SESSION_RESOURCE` into cpu/memory/disk channels.
7. Expanded **Activity card** (small-multiples) as the first non-compact consumer.

#### Non-goals (Explicitly out of scope) {#non-goals}

- App-wide "all sessions" activity overview card — the first Activity card is session-bound ([Q04]).
- Overlaid stacked-band single-SVG rendering — the first expanded card is small-multiples; stacked bands are a follow-on ([P12]).
- Linux per-process disk I/O — macOS-first; Linux disk deferred ([Q03]).
- Persisting activity history across reloads — the meters are live, rolling, and ephemeral (like today's throughput meter).
- Changing the pulse **label** dwell/cross-fade behavior or the `tugpulse` daemon transport.

#### Dependencies / Prerequisites {#dependencies}

- `sysinfo` (already a workspace dependency, already sampling in `process_info.rs`).
- `libc` (already a workspace dependency) for the `proc_pid_rusage` binding.
- The existing `PULSE` feed / `PulseStore` app-scope pattern as the template for an app-scoped store fed by both frames and per-session routers.

#### Constraints {#constraints}

- **WARNINGS ARE ERRORS** — the Rust workspace enforces `-D warnings`; fix all warnings in-step.
- tugdeck laws: one `root.render()` [L01]; external state via `useSyncExternalStore` only [L02]; appearance via CSS/DOM never React state [L06]; motion via WAAPI not rAF/timer frame loops [L13].
- Platform: macOS (`darwin`) is the target for OS-level sampling.
- The high-churn series must not trigger React re-renders (they update at 4 Hz+); only the enabled flag / channel registry may pass through the store snapshot.
- Verify tugdeck changes with `bunx vite build` before declaring done ([verify-with-vite-build]).

#### Assumptions {#assumptions}

- `CodeSessionStore` is one-instance-per-session (confirmed: single `tugSessionId` field, single `throughputMeter`), so it is a valid per-session producer that feeds the app-scoped store with `this.tugSessionId`.
- `streaming_usage.usage.output_tokens` is cumulative within a `msg_id` and resets across message ids (confirmed in `types.ts` doc), so a per-`msg_id` delta yields a token-velocity signal ([Q01] resolved).
- The tugcode process's subtree (claude + Bash tool subprocesses) equals "everything this session did"; neither tugcode nor claude opens a new process group, so attribution must be a PID-parentage subtree walk, not pgid ([P08]).

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

Anchors are explicit and kebab-case; plan-local decisions use `[P01]`; steps cite decisions/specs/anchors, never line numbers.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Token-velocity source field (DECIDED) {#q01-token-source}

**Question:** Which field of `streaming_usage.usage` yields a per-interval token rate?

**Why it matters:** The token channel is the single best "working hard while textless" signal; getting the delta wrong makes it flat or spiky-wrong.

**Resolution:** DECIDED (see [P06]). `usage.output_tokens` is cumulative within a `msg_id` (per `types.ts` `StreamingUsage` doc: "reflects the latest frame and does not accumulate across `msg_id`s"). Track last value keyed by `msg_id`; delta = `max(0, current − last)`; on a new `msg_id`, seed last to the first observed value (no phantom spike). Fall back to a small fixed beat if `output_tokens` is absent.

#### [Q02] Resource-sampler cadence and subtree-walk cost (OPEN) {#q02-sampler-cadence}

**Question:** At what interval do we sample the per-session PID subtree, and is a full `sysinfo` refresh per tick acceptable with several concurrent sessions?

**Why it matters:** Too frequent or too broad a refresh burns CPU measuring CPU.

**Options (if known):**
- 1 Hz, refresh only the session's subtree PIDs (`ProcessesToUpdate::Some`) — default.
- 2 Hz for finer humps at higher cost.

**Plan to resolve:** Spike in Step 6 — measure the sampler's own CPU with 3 concurrent sessions each running a `cargo build`; pick the coarsest cadence that still shows a legible hump.

**Resolution:** OPEN — default 1 Hz; confirm in Step 6 checkpoint.

#### [Q03] Cross-platform disk I/O (DEFERRED) {#q03-disk-crossplat}

**Question:** How is per-process disk I/O read on Linux?

**Why it matters:** `proc_pid_rusage` is macOS-only; `sysinfo`'s per-process disk API is Linux-oriented but coarse.

**Resolution:** DEFERRED — target is `darwin`. The disk channel degrades to absent on non-macOS (the API and card already tolerate absent channels, [P02]). Revisit if/when Tug ships on Linux.

#### [Q04] Activity card scope: session-bound vs app-wide (DEFERRED) {#q04-card-scope}

**Question:** Should the expanded Activity card show one session or all sessions?

**Why it matters:** App-wide needs an all-sessions selector over the store; session-bound reuses the card's existing session binding.

**Resolution:** DEFERRED — the first Activity card ([P12]) is session-bound, reusing the dev card's `tugSessionId`. The app-scoped store already supports an app-wide view later without a redesign.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Subtree-walk sampler burns CPU | med | med | Refresh only subtree PIDs; 1 Hz default ([Q02]) | Sampler >2% CPU with 3 sessions |
| Stale/reused PID after session death | med | low | Drop the PID on session close; treat missing process as zero ([P08]) | Ghost CPU on a closed session |
| Sparkline visual regression | med | low | Step 1 is behavior-neutral; composite defaults to text-only until channels added ([P01]) | Line differs from baseline in Step 1 |
| Dominant-color flicker | low | med | Hysteresis: keep current dominant until a challenger leads by a margin over N samples ([P05]) | Visible color strobing |

**Risk R01: Sampler measures its own overhead** {#r01-sampler-overhead}

- **Risk:** A per-session `sysinfo` refresh each tick could dominate the very CPU number it reports.
- **Mitigation:** Scope `ProcessesToUpdate::Some(&subtree)`; 1 Hz; one shared `System` across sessions; spike in Step 6.
- **Residual risk:** Very large subtrees (a session spawning hundreds of subprocesses) still cost a proportional walk.

**Risk R02: PID reuse** {#r02-pid-reuse}

- **Risk:** The OS reuses a dead session's PID for an unrelated process, misattributing its CPU.
- **Mitigation:** Clear the captured PID on session close ([P08]); the sampler skips sessions with no live PID and reports zero when the root process is gone.
- **Residual risk:** A brief misread in the window between death and cleanup; bounded to one sample.

---

### Design Decisions {#design-decisions}

#### [P01] App-scoped `SessionActivityStore` keyed by session id (DECIDED) {#p01-app-scoped-store}

**Decision:** Introduce a single app-scoped `SessionActivityStore` keyed by `tug_session_id`, mirroring `PulseStore`'s app-scope, rather than hanging meters off each `CodeSessionStore`.

**Rationale:**
- Multiple consumers — the compact strip, the expanded Activity card, and the Dev panel — must read a session's activity **without** holding that session's frame router.
- Both producer kinds converge cleanly: per-session `CodeSessionStore` instances push deck-local channels with `this.tugSessionId`; a single frame subscription pushes OS channels tagged with `tug_session_id`.

**Implications:** A getter `getSessionActivityStore()` (like `getPulseStore()`); `CodeSessionStore` no longer owns `throughputMeter`; consumers depend on the store, not the router.

#### [P02] Multi-channel model: one `ActivityMeter` per channel + descriptor (DECIDED) {#p02-channels}

**Decision:** Model activity as a fixed enum of channels — `text | tokens | tools | subagents | cpu | memory | disk` — each backed by its own `ActivityMeter` (the generalized `ThroughputMeter`: fixed-width rolling bins retaining raw units) plus a static descriptor `{ unit, hue, fullScale, curve }`.

**Rationale:**
- The existing meter already retains raw units per bin; generalizing it costs a rename and a descriptor.
- Channels may be **absent** (OS channels on non-macOS, or before the resource feed connects); consumers iterate live channels rather than assuming all seven.

**Implications:** New `activity-meter.ts` (generalizes `throughput-meter.ts`); `SessionActivityStore` lazily creates channels on first `record`; the descriptor is the single place hue/scale/curve live.

#### [P03] High-churn series stay out of React state (DECIDED) {#p03-out-of-react}

**Decision:** Series data is read imperatively (`store.series(session, channel, nowMs)`) on the consumer's own timer and painted straight to SVG; only the `enabled` flag and the set of live channels pass through `useSyncExternalStore`.

**Rationale:** Follows the current `throughputMeter` design and [L02]/[L06] — 4 Hz+ updates must never drive React re-renders.

**Implications:** The store exposes plain methods for series/raw/dominant/intensity (not snapshot fields) and a small snapshot for enabled/channel-membership only.

#### [P04] Composite for compact, per-channel for expanded (DECIDED) {#p04-composite-vs-channels}

**Decision:** The store exposes both `compositeSeries(session, nowMs)` (a normalized, weighted max/sum across channels, clamped) for the compact one-line view and `series(session, channel, nowMs)` + `raw(session, channel)` for the expanded per-channel view.

**Rationale:** The compact strip needs one always-alive line; the expanded card needs the breakdown. Computing both in the store keeps consumers dumb.

**Implications:** `intensity()` (scalar 0..1 headline) and `dominant()` (argmax channel) are derived in the store, not the view.

#### [P05] Color by dominant channel via CSS data-attribute (DECIDED) {#p05-color-by-dominant}

**Decision:** `TugSparkline` takes an optional `getColorChannel(nowMs)` callback and, during its existing sample loop, stamps a `data-activity-channel` attribute on its root; theme CSS maps that attribute to a hue token. Dominant selection uses hysteresis to avoid flicker.

**Rationale:** Appearance stays in CSS/DOM, not React state ([L06]); the sparkline already runs a timer, so no new loop; theme hues live in the theme-engine token files.

**Implications:** New per-channel hue tokens in `tugdeck/styles/themes/*.css`; `TugSparkline` gains a color hook but stays data-source agnostic.

#### [P06] Token velocity from `output_tokens` delta per `msg_id` (DECIDED) {#p06-token-velocity}

**Decision:** The `tokens` channel records `max(0, output_tokens − last[msg_id])` per `streaming_usage` frame, seeding `last[msg_id]` on first sight of a new message id. See [Q01].

**Rationale:** `output_tokens` is cumulative within a message and authoritative; it fires between tool rounds and during textless thinking — exactly the flatline cases.

**Implications:** `recordThroughput` tracks a small `msg_id → lastOutputTokens` map; replaces the fixed `STREAMING_USAGE_UNITS` pip.

#### [P07] Tool/subagent cadence as burst records that decay in the window (DECIDED) {#p07-cadence}

**Decision:** Each `tool_use` / `tool_result` / `task_progress` records a fixed unit burst into `tools` (foreground) or `subagents` (has `parent_tool_use_id`); the meter's rolling window makes a flurry of calls read as a hump that decays naturally.

**Rationale:** No separate decay logic needed — the fixed-window meter already fades old bins. A burst of rapid skill/subagent calls becomes visible activity.

**Implications:** Replaces the per-event fixed pips currently collapsed into the single throughput meter; weights tuned per channel via the descriptor `fullScale`.

#### [P08] OS attribution roots at the tugcode child PID subtree (DECIDED) {#p08-pid-subtree}

**Decision:** Per-session OS sampling walks the PID subtree rooted at the session's **tugcode** child process (which tugcast spawns), summing over claude and all Bash tool subprocesses.

**Rationale:** The subtree is exactly "what this session did," is session-scoped by process parentage (not cwd — satisfying the hard requirement), and tugcast already spawns that child so it can retain the PID. pgid cannot distinguish sessions (tugcast shares one group). Rooting at tugcode (vs claude) avoids an extra PID lookup; bridge overhead is negligible and can be refined later.

**Implications:** `AgentSupervisor` must retain the spawned child PID per session (currently discarded); the sampler reads the session registry.

#### [P09] New `SESSION_RESOURCE` feed, per-session, tagged by session id (DECIDED) {#p09-resource-feed}

**Decision:** Add `FeedId::SESSION_RESOURCE = 0x81` (tugcast_core + `protocol.ts` mirror) carrying `{ tug_session_id, cpu_pct, rss_bytes, disk_read_bps, disk_write_bps, sampled_at }`; the deck `FeedStore` session filter routes it like `CODE_OUTPUT`/`PULSE`.

**Rationale:** The existing `STATS` framework is process-global (samples tugcast itself); per-session data needs its own feed carrying the session tag. `0x81` sits next to `PULSE` (`0x80`).

**Implications:** New `parseSessionResourceFrame` in `protocol.ts`; the resource sampler broadcasts frames, not a `StatSnapshot` aggregate.

#### [P10] Resource sampler is a dedicated per-session task, not a global `StatCollector` (DECIDED) {#p10-sampler-task}

**Decision:** Implement the sampler as a dedicated task (new `feeds/session_resource.rs`) with a handle to the `AgentSupervisor` session registry, iterating live sessions each tick — not as a `StatCollector` (which is single-process by contract).

**Rationale:** `StatCollector::collect()` has no session context; per-session sampling needs the registry and emits one frame per session.

**Implications:** Wired where `StatsRunner` is spawned; shares one `sysinfo::System`; honors the cancellation token.

#### [P11] Disk I/O via `libc::proc_pid_rusage(RUSAGE_INFO_V2)` (DECIDED) {#p11-disk-rusage}

**Decision:** Read per-PID disk bytes on macOS via a small `libc` binding to `proc_pid_rusage` (`ri_diskio_bytesread` / `ri_diskio_byteswritten`), summed over the subtree and differenced across ticks to a bytes/sec rate.

**Rationale:** `sysinfo`'s per-process disk API is Linux-oriented; `proc_pid_rusage` is the reliable macOS source. `libc` is already a dependency.

**Implications:** A `#[cfg(target_os = "macos")]` binding; disk fields are `Option`/zero on other platforms ([Q03]).

#### [P12] First expanded rep is small-multiples; stacked bands are follow-on (DECIDED) {#p12-activity-card}

**Decision:** The Activity card renders one labeled `TugSparkline` + raw readout (`raw()`) per live channel (small-multiples), reusing the primitive. Overlaid stacked-band single-SVG rendering is a follow-on.

**Rationale:** Small-multiples reuse the existing sparkline and land the "larger representation" quickly; stacked bands are a rendering refinement over the same API.

**Implications:** New `activity-card.tsx`/`.css`; no new data plumbing beyond the store API.

---

### Deep Dives (Optional) {#deep-dives}

#### End-to-end data flow {#data-flow}

```
PRODUCERS                          SessionActivityStore (app-scoped [P01])         CONSUMERS
─────────                          ───────────────────────────────────────        ─────────
CodeSessionStore.recordThroughput  Map<tugSessionId, SessionActivity>              DevPulseStrip (compact):
  (per-session, CODE_OUTPUT tap)     SessionActivity = Map<channel, ActivityMeter>   getSeries → compositeSeries()
  → text  (partial deltas)           + descriptors {unit,hue,fullScale,curve}        getColorChannel → dominant()
  → tokens(output_tokens delta)    ── derived ──────────────────────────────       Activity card (expanded [P12]):
  → tools (event bursts)             series(s,ch,now)   raw(s,ch)                     per-channel series() + raw()
  → subagents(parent bursts)         compositeSeries(s,now)  intensity(s,now)        TugDevPanel telemetry (raw)
                                      dominant(s,now)  channels(s)
conn.onFrame(SESSION_RESOURCE)      ─────────────────────────────────────────
  (app-scoped, [P09])                snapshot (useSyncExternalStore [P03]):
  → cpu / memory / disk              { enabled, sessions→channel-membership }
```

#### Process tree and session attribution {#process-tree}

```
tugexec → tugcast (own pgid; setpgid) → tugcode (one per session; tugcast spawns) → claude → bash tool subprocesses
```

- Root the subtree at the tugcode child PID ([P08]). tugcast currently type-erases and drops that child handle; Step 5 retains `child.id()` in the session registry.
- Reconstruct the subtree via `sysinfo` parent-PID links from the root PID; sum `cpu_usage()`, `memory()`, and `proc_pid_rusage` disk bytes over it.
- Two sessions in one directory are distinct subtrees → clean separation (the whole point).

---

### Specification {#specification}

#### Public API surface — `SessionActivityStore` (deck) {#public-api}

**Spec S01: SessionActivityStore** {#s01-store-api}

```ts
type ActivityChannel =
  | "text" | "tokens" | "tools" | "subagents"   // deck-local producers
  | "cpu"  | "memory" | "disk";                  // SESSION_RESOURCE feed

interface ActivityChannelDescriptor {
  unit: "chars/s" | "tok/s" | "events" | "%cpu" | "bytes" | "bytes/s";
  hue: string;          // theme-token name → CSS maps data-activity-channel
  fullScale: number;    // rate at full height (per rolling window)
  curve: SparklineCurve;
}

class SessionActivityStore {
  record(session: string, channel: ActivityChannel, units: number, atMs: number): void;
  series(session: string, channel: ActivityChannel, nowMs: number): number[]; // oldest→newest
  raw(session: string, channel: ActivityChannel): { value: number; unit: string } | null;
  compositeSeries(session: string, nowMs: number): number[]; // normalized max across channels [P04]
  intensity(session: string, nowMs: number): number;         // scalar 0..1 headline
  dominant(session: string, nowMs: number): ActivityChannel | null; // hysteretic [P05]
  channels(session: string): ActivityChannel[];              // live channels only
  clearSession(session: string): void;                       // on session close [R02]
  subscribe(cb: () => void): () => void;                     // membership/enabled only [P03]
  getSnapshot(): { enabled: boolean; sessions: ReadonlyMap<string, readonly ActivityChannel[]> };
}
```

- `series`/`compositeSeries`/`raw`/`intensity`/`dominant` are **plain methods**, read off React's render path ([P03]).
- Composite = per-sample max of each channel's normalized rate (`curve(sum/fullScale)` clamped), so silence reads flat and any active channel keeps the line up.

#### Output schema — `SESSION_RESOURCE` wire frame {#resource-wire}

**Spec S02: SESSION_RESOURCE payload** {#s02-resource-payload}

```jsonc
{
  "tug_session_id": "c745a4d7…",
  "cpu_pct": 143.2,          // sum over subtree; may exceed 100 (multi-core)
  "rss_bytes": 512000000,    // resident set of the subtree
  "disk_read_bps": 10485760, // bytes/sec since last sample (macOS; 0 elsewhere)
  "disk_write_bps": 2097152,
  "sampled_at": "2026-07-01T19:02:57Z"
}
```

`FeedId::SESSION_RESOURCE = 0x81` (Rust `tugcast_core` + `protocol.ts` mirror). Parsed by `parseSessionResourceFrame`; routed by the existing session filter.

#### Terminology {#terminology}

- **Channel** — one measured dimension of session activity ([P02]).
- **Composite intensity** — normalized cross-channel headline for the compact line ([P04]).
- **Dominant channel** — the channel leading the current window; drives fill color ([P05]).
- **Subtree** — the process tree rooted at the session's tugcode child ([P08]).

#### State Zone Mapping (tugdeck/tugways) {#state-zone-mapping}

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| Per-channel series / composite / intensity | local-data (high-churn) | imperative store methods; read on the consumer's timer, painted to SVG | [L02], [L06], [P03] |
| Dominant-channel fill color | appearance | `data-activity-channel` attr stamped in the sparkline sample loop; theme CSS maps to hue | [L06], [P05] |
| `enabled` flag + live-channel membership | local-data (low-churn) | store snapshot via `useSyncExternalStore` | [L02] |
| Activity card layout / channel rows | structure | React render from `channels()` | [L02] |
| Sparkline scroll | appearance/motion | WAAPI translateX (unchanged) | [L13] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/lib/activity-meter.ts` | Generalized rolling-bin meter (evolves `throughput-meter.ts`) |
| `tugdeck/src/lib/session-activity-store.ts` | App-scoped multi-channel store + descriptors + hooks ([P01], [P02]) |
| `tugdeck/src/components/tugways/cards/activity-card.tsx` (+ `.css`) | Expanded small-multiples consumer ([P12]) |
| `tugrust/crates/tugcast/src/feeds/session_resource.rs` | Per-session PID-subtree resource sampler ([P10]) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `ActivityMeter` | class | `lib/activity-meter.ts` | Generalized `ThroughputMeter`; raw-unit bins + descriptor |
| `SessionActivityStore`, `getSessionActivityStore` | class/fn | `lib/session-activity-store.ts` | Spec S01 |
| `ActivityChannel`, `ActivityChannelDescriptor` | type | `lib/session-activity-store.ts` | [P02] |
| `recordThroughput` | method | `lib/code-session-store.ts` | Route to channels; drop `throughputMeter` field ([P06], [P07]) |
| `DevPulseStrip` | component | `cards/dev-pulse-strip.tsx` | Consume composite + dominant color ([P04], [P05]) |
| `TugSparkline` | component | `tugways/tug-sparkline.tsx` | Add `getColorChannel`; stamp `data-activity-channel` ([P05]) |
| `FeedId::SESSION_RESOURCE` | enum variant | tugcast_core + `tugdeck/src/protocol.ts` | `0x81` ([P09]) |
| `parseSessionResourceFrame` | fn | `tugdeck/src/protocol.ts` | Spec S02 |
| `SessionEntry.child` (PID) | field | tugcast `agent_supervisor.rs` / `agent_bridge.rs` | Populate the currently-dead field ([P08]) |
| `SessionResourceSampler` | struct/task | `feeds/session_resource.rs` | Subtree walk; CPU/mem/disk ([P10], [P11]) |
| `proc_pid_rusage` binding | fn | `feeds/session_resource.rs` (`#[cfg(macos)]`) | Disk bytes ([P11]) |
| activity-channel hue tokens | CSS | `tugdeck/styles/themes/*.css` | Per-channel hues ([P05]) |
| Voice tool cases | fn | `tugcode/src/pulse/voice.ts` | Skills / AskUserQuestion / generic fallback |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When |
|----------|---------|------|
| **Unit** | `ActivityMeter` bin math; `SessionActivityStore` record/series/composite/intensity/dominant; token-delta per `msg_id`; hysteresis | Core logic |
| **Unit (Rust)** | `session_resource` subtree sum; `proc_pid_rusage` binding returns bytes; PID-capture populates registry | Backend logic |
| **Contract** | `SESSION_RESOURCE` frame round-trips through `parseSessionResourceFrame` (Spec S02) | Wire schema |
| **Real-app (verify)** | Skill / AskUserQuestion drive the line; two-session CPU isolation; color shifts | End-to-end |

#### What stays out of tests {#test-non-goals}

- No jsdom render tests of `DevPulseStrip`/`TugSparkline`/`activity-card` — banned pattern; verified in the real app instead ([real-not-fake]).
- No mock-store assertion tests — the store is exercised with real constructed sample sequences, and end-to-end in the app.
- Linux disk I/O — deferred ([Q03]); not tested.

---

### Execution Steps {#execution-steps}

> Commit after all checkpoints pass. Deck changes verify with `bunx vite build`; Rust with `cargo nextest run` (warnings are errors).

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Activity substrate; port throughput to `text` | pending | — |
| #step-2 | Deck-local channels: tokens, tools, subagents | pending | — |
| #step-3 | Compact view: dominant color + composite intensity | pending | — |
| #step-4 | Pulse labels: skills, AskUserQuestion, generic tool | pending | — |
| #step-5 | Retain tugcode child PID per session | pending | — |
| #step-6 | `SESSION_RESOURCE` feed + CPU/memory sampler | pending | — |
| #step-7 | Consume `SESSION_RESOURCE` into cpu/memory channels | pending | — |
| #step-8 | Session disk-I/O via `proc_pid_rusage` | pending | — |
| #step-9 | Expanded Activity card | pending | — |
| #step-10 | Integration checkpoint | pending | — |

#### Step 1: Activity substrate; port throughput to `text` {#step-1}

**Commit:** `tugdeck(data-display): SessionActivityStore substrate; port throughput to text channel`

**References:** [P01] app-scoped store, [P02] channels, [P03] out-of-React, [P04] composite, Spec S01, (#public-api, #data-flow)

**Artifacts:**
- New `lib/activity-meter.ts` (generalize `throughput-meter.ts`), `lib/session-activity-store.ts`.
- `code-session-store.ts`: `recordThroughput` routes the existing text/tool-input signals into `getSessionActivityStore().record(this.tugSessionId, "text", …)`; remove the `throughputMeter` field.
- `dev-pulse-strip.tsx`: `getSeries` reads `store.compositeSeries(session, now)` (composite = text-only for now, so visually identical).

**Tasks:**
- [ ] Create `ActivityMeter` from `ThroughputMeter` (raw-unit bins + per-instance descriptor); keep the bin-width constant (rename `THROUGHPUT_BIN_MS` → `ACTIVITY_BIN_MS`, re-export for the strip).
- [ ] Implement `SessionActivityStore` (Spec S01): lazy per-channel meters, `record`, `series`, `compositeSeries`, `intensity`, `dominant` (stub single-channel), `channels`, `clearSession`, `subscribe`/`getSnapshot`; add `getSessionActivityStore()`.
- [ ] Move all current `throughputMeter.record(...)` calls to `store.record(session, "text", …)` (behavior-neutral: keep the same units for now); wire `clearSession` into session close.
- [ ] Point `DevPulseStrip` at the store; delete the `throughputMeter` field.

**Tests:**
- [ ] Unit: `ActivityMeter` bin advance/zero-fill/series matches the old `ThroughputMeter` tests.
- [ ] Unit: `SessionActivityStore.record`/`series`/`compositeSeries` for a constructed sequence.

**Checkpoint:**
- [ ] `cd tugdeck && bunx vite build` succeeds.
- [ ] `bun test` passes; the sparkline in the real app behaves as before for a Write-heavy turn (visual parity).

---

#### Step 2: Deck-local channels: tokens, tools, subagents {#step-2}

**Depends on:** #step-1

**Commit:** `tugdeck(data-display): token/tool/subagent activity channels`

**References:** [P06] token velocity, [P07] cadence, [Q01] resolved, (#terminology)

**Artifacts:**
- `recordThroughput` records: `tokens` from `streaming_usage.usage.output_tokens` delta per `msg_id`; `tools` from foreground `tool_use`/`tool_result`/`task_progress` bursts; `subagents` from `parent_tool_use_id` bursts. Removes the old fixed `STREAMING_USAGE_UNITS`/`SUBAGENT_ACTIVITY_UNITS` collapse into a single meter.
- Channel descriptors (`fullScale`/hue/curve) for the four deck-local channels.

**Tasks:**
- [ ] Add a `msg_id → lastOutputTokens` map; record `max(0, cur − last)`, seeding on new `msg_id` ([P06]).
- [ ] Record tool/subagent/task bursts into the right channel ([P07]).
- [ ] Tune per-channel `fullScale` so ordinary work uses the mid band (text ≈ current 1200 chars/s; tokens ≈ ~120 tok/s; tools/subagents burst-scaled).

**Tests:**
- [ ] Unit: token-delta resets across `msg_id` and never goes negative.
- [ ] Unit: N tool bursts within the window produce a decaying hump in `series("tools")`.

**Checkpoint:**
- [ ] `bunx vite build` + `bun test` pass.
- [ ] Real app: `/tugplug:vet <file>` and a post-`AskUserQuestion` resume each visibly drive the sparkline off baseline (`verify` skill).

---

#### Step 3: Compact view: dominant color + composite intensity {#step-3}

**Depends on:** #step-2

**Commit:** `tugdeck(data-display): dominant-hued fill + composite intensity in pulse sparkline`

**References:** [P04] composite, [P05] color-by-dominant, State Zone Mapping (#state-zone-mapping)

**Artifacts:**
- `TugSparkline`: optional `getColorChannel(nowMs)`; stamps `data-activity-channel` on its root in the sample loop.
- `dev-pulse-strip.tsx`: passes `getColorChannel = () => store.dominant(session, now)`; plots `compositeSeries`.
- Per-channel hue tokens in `tugdeck/styles/themes/*.css`; sparkline line/area CSS reads them via the data-attribute.

**Tasks:**
- [ ] Add `getColorChannel` to `TugSparkline`; stamp the attribute imperatively ([L06]).
- [ ] Implement `dominant()` hysteresis (keep current unless a challenger leads by a margin for K samples) ([R02]-adjacent flicker guard).
- [ ] Add hue tokens to all six themes; validate with `bun run audit:theme-contrast`.

**Tests:**
- [ ] Unit: `dominant()` hysteresis holds through a single-sample challenger and flips after a sustained lead.

**Checkpoint:**
- [ ] `bunx vite build` + `bun run audit:theme-contrast` pass.
- [ ] Real app: fill color differs between a thinking-heavy stretch and a Write-heavy stretch, with no strobing (`verify`).

---

#### Step 4: Pulse labels: skills, AskUserQuestion, generic tool {#step-4}

**Commit:** `tugcode(data-display): pulse labels for skills, AskUserQuestion, generic tools`

**References:** [P07] (label parity with the new tool channels), (#context)

**Artifacts:**
- `tugcode/src/pulse/voice.ts`: `onFrame`/`narrateTool` cases for `AskUserQuestion` (e.g. "Asking…"/"Question answered"), `tugplug` `<plugin>:<skill>` tool names ("Running <skill>…"), and a generic non-file tool fallback (verb from the tool name) so the strip stops holding a stale line or "None".

**Tasks:**
- [ ] Map skill tool names (`<plugin>:<skill>`) and `AskUserQuestion` to labels; add a generic fallback for otherwise-unhandled tools.
- [ ] Confirm these tool frames are on `PULSE_FORWARD_ALLOWLIST` in `tugcast/src/feeds/pulse.rs`; extend if a needed type is filtered.

**Tests:**
- [ ] Unit (tugcode): `voice.ts` emits a non-empty `PulseLine` for a skill `tool_use`, an `AskUserQuestion`, and an arbitrary tool.

**Checkpoint:**
- [ ] tugcode rebuilt (compiled binary) and `bun test` passes.
- [ ] Real app: invoking `/tugplug:vet` shows a label other than "None".

---

#### Step 5: Retain tugcode child PID per session {#step-5}

**Commit:** `tugcast(data-display): retain tugcode child PID per session`

**References:** [P08] PID subtree, [P10] sampler task, Risk R02, (#process-tree)

**Artifacts:**
- tugcast `agent_bridge.rs`: capture `child.id()` at spawn; thread it into the `AgentSupervisor` `SessionEntry.child`/PID field (currently initialized and never set).
- Clear the PID on session close ([R02]).

**Tasks:**
- [ ] Capture the spawned tugcode child PID and store it keyed by `tug_session_id`.
- [ ] Expose a read accessor for the sampler (Step 6) — `session_id → root PID`.
- [ ] Clear on session teardown.

**Tests:**
- [ ] Unit (Rust): spawning a session records a non-zero PID; closing it clears the entry.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` passes (no warnings).

---

#### Step 6: `SESSION_RESOURCE` feed + CPU/memory sampler {#step-6}

**Depends on:** #step-5

**Commit:** `tugcast(data-display): per-session CPU/memory resource feed (SESSION_RESOURCE)`

**References:** [P08], [P09] resource feed, [P10] sampler task, Spec S02, [Q02] cadence, Risk R01

**Artifacts:**
- `FeedId::SESSION_RESOURCE = 0x81` in tugcast_core; mirror + `parseSessionResourceFrame` in `protocol.ts` (Spec S02).
- New `feeds/session_resource.rs`: a task (not a `StatCollector`) reading the session registry, walking each session's PID subtree via one shared `sysinfo::System`, summing `cpu_usage()` + `memory()`, broadcasting one `SESSION_RESOURCE` frame per session at 1 Hz.

**Tasks:**
- [ ] Add the FeedId (Rust + TS) and the parser.
- [ ] Implement the subtree walk (parent-PID reconstruction from the root PID) and the sampler task; wire it in alongside `StatsRunner` with the cancellation token.
- [ ] Spike [Q02]: measure sampler CPU with 3 concurrent `cargo build` sessions; lock the cadence.

**Tests:**
- [ ] Unit (Rust): subtree sum over a constructed parent/child PID map; a session with a dead root reports zero.
- [ ] Contract (TS): a Spec-S02 payload round-trips through `parseSessionResourceFrame`.

**Checkpoint:**
- [ ] `cargo nextest run` + `bunx vite build` pass.
- [ ] Sampler self-CPU stays within the [Q02] budget in the spike.

---

#### Step 7: Consume `SESSION_RESOURCE` into cpu/memory channels {#step-7}

**Depends on:** #step-1, #step-6

**Commit:** `tugdeck(data-display): consume SESSION_RESOURCE into cpu/memory channels`

**References:** [P01], [P02], [P09], Spec S01, (#data-flow)

**Artifacts:**
- App-scoped subscription (in `SessionActivityStore` init or where feeds are wired): `conn.onFrame(FeedId.SESSION_RESOURCE, …)` → `store.record(tug_session_id, "cpu"|"memory", …)`; store `raw()` values for readouts.
- Descriptors for `cpu`/`memory` (hue, fullScale).

**Tasks:**
- [ ] Subscribe once, app-scoped, and record into the store keyed by the frame's `tug_session_id`.
- [ ] Feed `cpu` into the composite/dominant so a Bash build lights up the compact line and shifts its color.

**Tests:**
- [ ] Unit: recording a `SESSION_RESOURCE`-shaped sample updates `series("cpu")`/`raw("cpu")`.

**Checkpoint:**
- [ ] `bunx vite build` passes.
- [ ] Real app (success criterion): a `cargo build` session shows a CPU hump absent from a second idle session in the same directory (`verify`).

---

#### Step 8: Session disk-I/O via `proc_pid_rusage` {#step-8}

**Depends on:** #step-6

**Commit:** `tugcast(data-display): session disk-I/O sampling via proc_pid_rusage`

**References:** [P11] disk rusage, [Q03] deferred cross-platform, Spec S02

**Artifacts:**
- `#[cfg(target_os = "macos")]` `libc::proc_pid_rusage(RUSAGE_INFO_V2)` binding in `session_resource.rs`; sum `ri_diskio_bytesread`/`byteswritten` over the subtree, difference across ticks → `disk_read_bps`/`disk_write_bps` in the frame; zero on other platforms.
- Deck: record `disk` channel from the now-populated fields (descriptor added).

**Tasks:**
- [ ] Add the macOS binding and subtree disk-byte accumulation with per-tick differencing.
- [ ] Populate the S02 disk fields; deck records the `disk` channel.

**Tests:**
- [ ] Unit (Rust, macos): the binding returns monotonic byte counters for the current process; differencing yields a non-negative rate.

**Checkpoint:**
- [ ] `cargo nextest run` + `bunx vite build` pass.
- [ ] Real app (macOS): a `dd`/large-write Bash step produces a disk-channel hump (`verify`).

---

#### Step 9: Expanded Activity card {#step-9}

**Depends on:** #step-2, #step-7

**Commit:** `tugdeck(data-display): expanded Activity card over the activity API`

**References:** [P12] activity card, [P04] per-channel, Spec S01, State Zone Mapping (#state-zone-mapping)

**Artifacts:**
- New `cards/activity-card.tsx` (+ `.css`): iterates `store.channels(session)`, rendering per channel a labeled `TugSparkline` (`series(session, channel)`) + a raw readout (`raw()`), hued per descriptor.

**Tasks:**
- [ ] Build the small-multiples card bound to the dev card's `tugSessionId` ([Q04]).
- [ ] Register/mount it where cards are registered; reuse existing Tug layout/components (no hand-rolled tabs/rows).
- [ ] `enabled`/channel-membership via `useSyncExternalStore`; series read imperatively ([P03]).

**Tests:**
- [ ] Unit: `channels(session)` reflects exactly the recorded channels (drives the card's row set).

**Checkpoint:**
- [ ] `bunx vite build` passes.
- [ ] Real app: the Activity card shows live per-channel lines during a mixed turn (thinking → writing → build) (`verify`).

---

#### Step 10: Integration checkpoint {#step-10}

**Depends on:** #step-3, #step-4, #step-7, #step-8, #step-9

**Commit:** `N/A (verification only)`

**References:** (#success-criteria, #data-flow)

**Tasks:**
- [ ] Confirm the compact strip (composite + color) and the expanded card read the same store with no divergence.
- [ ] Confirm two sessions in one directory stay isolated across all channels.

**Tests:**
- [ ] Aggregate real-app run exercising skill work, an AskUserQuestion turn, a Bash build, and a Write, watching both the compact strip and the Activity card.

**Checkpoint:**
- [ ] `cd tugrust && cargo nextest run` and `cd tugdeck && bunx vite build && bun test` all pass.
- [ ] All #success-criteria verified in the real app via `just app-test` / `verify`.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A `SessionActivityStore` API driving a lively, color-coded, multi-channel compact pulse sparkline and an expanded per-channel Activity card, with session-scoped CPU/memory/disk sampled from the process subtree.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] Skills, AskUserQuestion resumes, thinking, and subagent work all move the compact sparkline (real app).
- [ ] The compact fill color reflects the dominant activity kind, without strobing.
- [ ] A Bash build shows CPU (and disk on macOS) humps isolated to the originating session.
- [ ] The Activity card renders live per-channel lines + raw readouts over the same API.
- [ ] `cargo nextest run`, `bunx vite build`, `bun test`, and `bun run audit:theme-contrast` all pass.

**Acceptance tests:**
- [ ] Store unit suite (record/series/composite/intensity/dominant/token-delta/hysteresis).
- [ ] Rust unit suite (subtree sum, PID capture, disk binding) + `SESSION_RESOURCE` contract test.
- [ ] Real-app `verify` run covering all #success-criteria.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Overlaid stacked-band single-SVG rendering for the Activity card ([P12]).
- [ ] App-wide "all sessions" activity overview ([Q04]).
- [ ] Linux per-process disk I/O ([Q03]).
- [ ] Root the subtree at the claude PID (excluding bridge overhead) if it proves material ([P08]).

| Checkpoint | Verification |
|------------|--------------|
| Substrate parity | Step 1: sparkline visually unchanged for Write turns |
| Flatlines fixed | Step 2/7: skill + AskUserQuestion + build all move the line |
| Session isolation | Step 7: two same-dir sessions, CPU hump on one only |
| Expanded rep | Step 9: Activity card live per-channel |
