<!-- tugplan-skeleton v2 -->

## Tide Assistant Rendering — Content & Data Type Renderers {#tide-assistant-rendering}

**Purpose:** Build the full content-type rendering layer for Tide's assistant surface — a two-layer system of reusable body kinds + thin per-tool wrappers, plus the dispatcher, stream-event chrome, and parsers/formatters that make Claude Code output materially better than what a TUI can show. Replaces the placeholder rendering currently used by `streamingPaths.assistant`, wires the so-far-unwired `streamingPaths.thinking` and `streamingPaths.tools`, and ships the `--tugx-*` typography/chrome polish that `tugplan-tide-card-polish.md` Steps 12 and 13 are stubs for.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | tugplan-tide-assistant-rendering |
| Last updated | 2026-05-08 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Tide is the unified command surface that hosts Claude Code conversations alongside (eventually) shell commands. Today the Tide card streams assistant text through `TugMarkdownView` with default `--tugx-md-*` tokens, but the surrounding rendering is bare: thinking blocks are unwired, tool calls render as raw JSON-ish text, permission requests have no UI, cost data is dropped on the floor, and there are no content-aware renderers for the structured shapes Claude Code already sends (`tool_use_structured.file`, `.stdout/.stderr`, agent transcripts, etc.).

The assistant-side rendering bar for Tug is *not* "comparable to a terminal." The bar is "comparable to a hand-crafted GUI app" — typography that reads like a publication, dedicated renderers per data shape, progressive disclosure for long content, lazy-loaded stretch content (Mermaid diagrams, KaTeX math), and never-blank fallback for unknown shapes. This phase ships that surface.

**Stream-json events we render** (one renderer per row; full machine-readable shape at [Spec S07](#s07-event-inventory)):

| Event | Use |
|-------|-----|
| `protocol_ack`, `session_init` | Session lifecycle chrome |
| `system_metadata` | Per-turn metadata: model, tools, plugins, agents, mcp_servers, version, permissionMode |
| `thinking_text` | Pre-response reasoning. Delta-streamed. |
| `assistant_text` | Response body. Delta-streamed; `complete` event has full text. |
| `tool_use` | Tool invocation. Input streams empty → full. |
| `tool_result` | Tool output as text + `is_error` flag. |
| `tool_use_structured` | Tool output as typed structured data (file viewer, bash stdout/stderr, agent transcript, etc.). |
| `control_request_forward` | Permission (`is_question: false`) or AskUserQuestion (`is_question: true`). |
| `cost_update` | Per-turn token + USD breakdown. |
| `turn_complete` | End-of-turn signal. |
| `error` | Error with `recoverable` flag. |

#### Strategy {#strategy}

- **Two-layer hybrid architecture.** ~14 reusable Layer-1 body kinds (FileBlock, DiffBlock, TerminalBlock, etc.) carry the heavy rendering work; ~14 thin Layer-2 per-tool wrappers compose them with tool-specific chrome and interactions. See [D05].
- **Renderer dispatch lives outside the store.** A separate `assistant-renderer-dispatch.ts` module maps `TurnEntry` records to renderer kinds; `CodeSessionStore` stays state-only. See [D01].
- **WASM only where it earns its keep.** New `tugdiff-wasm` crate (`imara-diff` bindings) for diff parsing; ANSI, JSON-tree, and inline math stay in JS. See [D06].
- **Day-one coverage via `DefaultToolWrapper`.** Any tool we haven't built a bespoke wrapper for renders cleanly through a generic JsonTree-based wrapper, and a caution badge surfaces drift. See [D11], [D04].
- **Lazy-load stretch content.** KaTeX (~350 KB), Mermaid (~1 MB), Shiki language packs, and the diff WASM module load on first encounter, not at boot. See [D10].
- **Stream-aware per body kind.** Markdown, terminal, agent-transcript stream incrementally; diff, file, JSON-tree, math, mermaid wait for `complete`. Wrappers show a "streaming…" placeholder during the gap. See [D12].
- **Theme-token sovereignty per L20.** Every component owns its slot under the seven-slot naming convention; consumers tune via wrapping selectors, not by reaching into primitives.
- **Empirical calibration.** A pre-implementation session audit (Step 0) mines the local Claude Code session corpus to ground threshold choices (collapse points, virtualization caps, lazy-load justification) in real data, not intuition.
- **Gallery showcases.** Each renderer ships with a gallery card (Steps 14.5 and 29.5) that stacks variants with mock content, so design review can happen before live wiring.

#### Success Criteria (Measurable) {#success-criteria}

> Each criterion is verifiable by replaying a stream-json catalog fixture, by automated tests, or by manual inspection in a Tide card against `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.105/`.

- Replaying every fixture in `v2.1.105/` produces a fully rendered Tide transcript with no `[object Object]`, no raw JSON in tool bodies, and no blank components. (Replay test: see [Spec S06](#s06-fixture-replay).)
- Every Claude tool currently emitted by the catalog (`Read`, `Bash`, `Edit`, `Glob`, `Grep`, `Task`/`Agent`, `WebFetch`, `WebSearch`, `TodoWrite`, `NotebookEdit`, `Write`) renders through its bespoke Layer-2 wrapper, not `DefaultToolWrapper`. Verify by enumerating dispatch-registry entries.
- A tool name absent from the registry (verify by injecting a synthetic `tool_use` with `tool_name: "ZzzUnknownToolZzz"`) renders through `DefaultToolWrapper` with a caution badge ([D04]) and never throws.
- `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint` all green.
- Both `brio` and `harmony` themes render every component without missing tokens, verified by visual snapshot tests.
- Long-content collapse: a fixture-injected 500-line Bash output, 200-line Read result, and 40-hunk Edit diff all default to collapsed with single-line summary headers and an expand affordance. Verify by automated DOM assertion + manual smoke.
- KaTeX `$E=mc^2$` and `$$\\int_0^1 x^2 dx$$` typeset correctly in assistant prose. Mermaid ` ```mermaid\\nflowchart…\\n``` ` renders as a diagram once the fenced block reaches `complete`. Both lazy-loaded — initial Tide card mount has no KaTeX or Mermaid bytes downloaded.
- A version-mismatch fixture (`system_metadata.version` ≠ pinned catalog) surfaces a caution badge in the card chrome per [D04].
- All work in this phase respects [L01] (one root.render), [L02] (external state via useSyncExternalStore), [L03] (useLayoutEffect for registrations), [L06] (appearance via DOM/CSS), [L19] (component-authoring guide), [L20] (token sovereignty), [L22] (streaming binding).

#### Scope {#scope}

1. Layer-1 body kinds: MarkdownBlock extensions, TerminalBlock, DiffBlock, FileBlock, PathListBlock, SearchResultBlock, JsonTreeBlock, TodoListBlock, AgentTranscriptBlock, ImageBlock, MermaidBlock, KaTeXBlock, TableBlock (rich), PlainTextBlock.
2. Layer-2 tool wrappers: ReadToolBlock, WriteToolBlock, EditToolBlock, BashToolBlock, GlobToolBlock, GrepToolBlock, TaskToolBlock, WebFetchToolBlock, WebSearchToolBlock, TodoWriteToolBlock, NotebookEditToolBlock, DefaultToolWrapper.
3. Stream-event chrome: ThinkingBlock, PermissionDialog (`is_question:false`), QuestionDialog (`is_question:true`), CostChrome (per-turn footer + expanded breakdown + card-level cumulative), SessionInitBanner, ErrorBlock.
4. Renderer dispatch infrastructure (`assistant-renderer-dispatch.ts`) and the block-transformer pass over markdown blocks.
5. New `tugdeck/crates/tugdiff-wasm/` Rust crate with `imara-diff` bindings.
6. Library integrations: `ansi_up`, KaTeX (lazy), Mermaid (lazy), `diff-match-patch` (word-level intra-line diff inside DiffBlock).
7. `--tugx-md-*` typography pass (subsumes `tugplan-tide-card-polish.md` §Step 12).
8. Drift detection + caution-badge surface (per [D04]).
9. Tests: unit, integration via fixture replay, theme-snapshot, audit:tokens lint clean.
10. Both `brio` and `harmony` theme verification for every component.

#### Non-goals (Explicitly out of scope) {#non-goals}

- **MCP tool support.** Adoption has slowed and the long-term viability is uncertain. Unknown MCP tools fall back through `DefaultToolWrapper`; bespoke MCP-server wrappers are not in this phase. Revisit if/when MCP becomes load-bearing for our users.
- **Re-run buttons on `BashToolBlock` (and similar).** Security-policy-laden; the permission-mode story for re-run isn't settled. Defer to a follow-on phase. (Listed in [Roadmap](#roadmap).)
- **"Allow with edits" on `PermissionDialog`.** Requires a structured editor over `tool_use.input` (a command-line editor for Bash, an editable diff for Edit). Defer to a follow-on phase.
- **`AgentTranscriptBlock` as a Slack-like participant variant.** Initial implementation is an inline collapsible block within the parent `code` row; the participant-variant A/B is deferred until the inline form has shipped.
- **Tree-sitter syntax highlighting.** Shiki stays in place. Reevaluate only if a measurable Shiki bottleneck shows up in profiling. (Open question [Q02].)
- **NotebookCellBlock specialization.** `NotebookEditToolBlock` v1 uses generic `DiffBlock`. Cell-aware specialization deferred. (Open question [Q01].)
- **Phase T2 shell-command adapter blocks** (`GitStatusBlock`, `BuildOutputBlock`, etc.). Those land in `tide.md` Phase T2/T6; this phase only ships the Layer-1 primitives those adapters will reuse.
- **Editing the `marked`-based legacy markdown path** (`tugdeck/src/lib/markdown.ts`). Slated for removal in its own dedicated cleanup; not touched here unless the pipeline surface forces it.
- **Persisting renderer-level UI state** (e.g., per-block expand/collapse remembered across reload). Optional polish, deferred.
- **Re-rendering of historical `system_metadata` events** for cosmetic reasons. Per [D03], we render only on change.

#### Dependencies / Prerequisites {#dependencies}

- `tugmark-wasm` (pulldown-cmark + WASM block lex/parse) — exists at `tugdeck/crates/tugmark-wasm/`.
- `TugMarkdownView` and `TugMarkdownBlock` — exist at `tugdeck/src/components/tugways/`.
- `parseMarkdownToSanitizedBlocks` and `dompurify-instance` — exist at `tugdeck/src/lib/markdown/`.
- `CodeSessionStore` and its `streamingPaths.{assistant,thinking,tools}` — exist; produce `TurnEntry` records this phase consumes.
- `TugListView` + `TideTranscriptDataSource` — landed via `tugplan-tug-list-view.md`. The transcript surface this phase renders into.
- `TugTranscriptEntry` row primitive — landed via `tugplan-tide-card-polish.md` Step 9.
- `tugplan-tide-session-ledger.md` — Step 10 of card-polish — for session lifecycle that drives `SessionInitBanner`.
- `BlockHeightIndex` / `RenderedBlockWindow` — exist; reused by `TerminalBlock` self-virtualization per [D02].
- `PropertyStore` + `observe` — exists; the streaming-binding contract per Spec S05.
- Stream-json catalog at `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.105/` (and `v2.1.112/`) — ground truth for fixture replay tests.
- Both theme files: `tugdeck/styles/themes/brio.css` and `harmony.css` — extended with per-component slots.
- The seven-slot token convention from `tuglaws/token-naming.md`.
- The component-authoring guide from `tuglaws/component-authoring.md`.

#### Constraints {#constraints}

- All new components must pass the L19 component-authoring checklist (file pair `.tsx` + `.css`, module docstring, exported props interface, `data-slot` attribute).
- All new tokens must conform to the seven-slot naming per L19/L20: `--tugx-<kind>-<plane>-control-<constituent>-<emphasis>-<role>-<state>`. `bun run audit:tokens lint` exits 0.
- No `box-shadow` elevation, no `translateY` press-down, no gradients. Color transitions only ([D85, D70, D82]).
- No `localStorage` / `sessionStorage` / IndexedDB. Persistent UI state — none in this phase, but if any is added it goes through tugbank's `/api/defaults/<domain>/<key>` model.
- HMR is always running; no manual builds for tugdeck.
- `bun`, never `npm` / `npx`.
- WASM modules must initialize before any code that uses them runs; main.tsx pattern is the existing template.
- Lazy-loaded stretch content (KaTeX, Mermaid, tugdiff-wasm) must not appear in the main bundle.
- No new IndexedDB dependencies (D-T3-10).
- Vitest test names must encode the spec they cover. Rust nextest tests with `-D warnings`.
- `happy-dom` is forbidden for tests that exercise focus, selection, or event ordering across React renders (per `feedback_no_happy_dom_tests`). Use the `app-test` harness for those.
- All work is on the `tugplan-tide-assistant-rendering` branch; no commits to `main` directly.
- Both `brio` and `harmony` themes verified for every component.

#### Assumptions {#assumptions}

- `pulldown-cmark` block output remains stable across patch versions. Drift caught by the markdown unit tests.
- The stream-json catalog at `v2.1.105` is representative; new event shapes that arrive in `v2.1.112+` are caught by the drift detection in [D04].
- Anthropic continues to delta-stream `assistant_text` and `thinking_text` (full-text only on `complete`).
- `Shiki` performance is acceptable for syntax highlighting — confirmed by qualitative use; revisit if profiling shows otherwise (per [Q02]).
- The `imara-diff` Rust crate compiles to WASM cleanly — to be verified in [#step-9](#step-9).
- KaTeX bundle size is ~350 KB and loads synchronously after import; Mermaid is ~1 MB with lazy diagram-type loading.
- Users do not need bidirectional/RTL math layout in v1 (KaTeX supports it but we don't surface controls).
- Image attachments arrive only on inbound user messages, not in assistant output. Markdown `![alt](url)` references in assistant prose go through the `MarkdownBlock` → `ImageBlock` delegation.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] When do we ship `NotebookCellBlock`? (OPEN) {#q01-notebook-cell-block}

**Question:** `NotebookEditToolBlock` v1 uses generic `DiffBlock`. When do we promote to a cell-aware `NotebookCellBlock` body kind that knows about cell types (markdown vs. code) and their intra-cell semantics?

**Why it matters:** Premature specialization burns design time on a low-frequency tool. Late specialization leaves notebook-edit ergonomics subpar for users who do live in notebooks.

**Options:**
- Ship after the first Tide user complains in qualitative feedback.
- Schedule for the first quarter after this phase closes if no user surfaces it.
- Defer indefinitely; revisit only if NotebookEdit traffic crosses a measured threshold.

**Plan to resolve:** Track `NotebookEdit` tool-use frequency in dogfooding for ~4 weeks after this phase ships. Decide based on observed traffic and user feedback.

**Resolution:** OPEN.

#### [Q02] When do we evaluate Tree-sitter migration vs. Shiki? (OPEN) {#q02-tree-sitter-evaluation}

**Question:** Shiki is fast enough today but doesn't do incremental highlighting. When (if ever) do we migrate to `web-tree-sitter`?

**Why it matters:** Tree-sitter would handle streaming/incremental code-block highlighting better, but the per-language WASM blob + async init complexity is substantial.

**Options:**
- After this phase, profile a Tide session with heavy code-block traffic; migrate only if a measurable bottleneck appears.
- Stay on Shiki indefinitely; revisit only if a user complaint forces it.

**Plan to resolve:** Add a one-shot benchmark in [#step-30](#step-30) that paste-loads 10k lines of code into a Tide card and measures highlight latency on Shiki. If > 5s on the reference machine, file a follow-up plan.

**Resolution:** OPEN — benchmark is an artifact of this phase but the migration decision is deferred.

#### [Q03] How does the drift "caution" badge surface? (OPEN) {#q03-caution-badge-surface}

**Question:** When [D04]'s drift detection fires, does the caution badge appear (a) in the card chrome row alongside the cumulative cost chrome, (b) inline at the offending event, or (c) both?

**Why it matters:** Chrome-only is discoverable but doesn't anchor the user to the offending event. Inline is anchored but invisible if the user scrolled past. Both is loud but possibly correct.

**Options:**
- (a) Chrome only — quiet; loses provenance.
- (b) Inline only — loud at the site; misses overall awareness.
- (c) Chrome (subtle, "drift detected: 3 events") + inline (subtle, on the offending event) — discoverable from either direction.

**Plan to resolve:** Implement option (c) in [#step-21](#step-21) and adjust based on dogfooding feel.

**Resolution:** OPEN — initial implementation is (c).

#### [Q04] What's the cap on retained lines for very large Bash output? (OPEN) {#q04-terminal-line-cap}

**Question:** [D02] virtualizes long output via `BlockHeightIndex`, but virtualization manages *visible* lines, not retained-in-memory lines. What's the cap on how many lines we hold for a single `BashToolBlock`?

**Why it matters:** A `Bash` tool that streams 50 MB of output will OOM the tab if we retain everything. But aggressive truncation loses information the user might want to scroll back to.

**Options:**
- 10k lines retained, drop earliest with "… 12,345 earlier lines truncated" indicator.
- 100k lines retained — generous; might still hit memory under pathological inputs.
- Configurable via tugbank `/api/defaults/tide/terminal-line-cap`, default 10k.

**Plan to resolve:** Default 10k retained with truncation indicator; expose via tugbank if a user surfaces a need.

**Resolution:** RESOLVED. [Audit §5.2](./tide-assistant-rendering-session-audit.md) confirms real-corpus Bash stdout: P50=6, P95=40, P99=100, max=706 lines. Default **10k retained** is two orders of magnitude above the observed maximum across 25,542 Bash invocations — safe without a configurable knob. The tugbank knob is **not shipped in v1**; revisit only if a user reports a long-running streaming Bash output (`watch`, log tail) that hits the cap.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Bundle bloat from eager-loading stretch libs | high | low | Lazy-load KaTeX, Mermaid, tugdiff-wasm; per Tables [T04](#t04-library-picks) and [T06](#t06-bundle-budget) | Initial-bundle measurement crosses configured budget |
| Drift breaks renderers when Anthropic ships new shapes | medium | medium | DefaultToolWrapper covers unknown tools; JsonTree fallback for unknown structured shapes; caution badge surfaces drift; align with `tide.md#p15-stream-json-version-gate` | Capture-test catalog drift > N events |
| Mid-stream rerender churn | medium | medium | Per [D12] only streaming bodies subscribe; non-streaming bodies render once on completion | Profile shows > 5% time in render commits during heavy streams |
| Mermaid / KaTeX runtime errors crash a row | medium | low | Error boundary per instance; fall back to CodeBlock with toast | First runtime crash in dogfooding |
| Component sprawl + token sprawl | medium | medium | Strict L19/L20 compliance; cross-component snapshot tests against both themes | audit:tokens lint failure or theme-mismatch report |
| Streaming + virtualization perf under high-frequency updates | medium | low | rAF coalescing in TugMarkdownView (already in place); profile and adjust | Pathological prompts > 50 deltas/sec land jank in scroll |

**Risk R01: Bundle bloat from eager-loading stretch libs** {#r01-bundle-bloat}

- **Risk:** KaTeX (~350 KB), Mermaid (~1 MB), `tugdiff-wasm` (~hundreds of KB), and Shiki language packs together blow past a Tide card's first-paint budget if loaded eagerly.
- **Mitigation:** All four are lazy — KaTeX on first `$...$` or `$$...$$` encounter; Mermaid on first ` ```mermaid `; tugdiff-wasm on first `DiffBlock` mount; Shiki language packs already lazy. The first encounter pays a one-time load; subsequent uses hit the cache.
- **Residual risk:** First encounter with each lazy module has a load delay (typically < 500ms on warm cache). Acceptable; we surface a placeholder spinner.

**Risk R02: Drift breaks renderers when Anthropic ships new event shapes** {#r02-drift-breaks-renderers}

- **Risk:** A future Claude Code release adds a new `tool_name`, a new `structured_result` shape, or a new top-level event type. Our renderers crash or render blank.
- **Mitigation:** `DefaultToolWrapper` ([D11]) handles unknown `tool_name`s. `JsonTreeBlock` fallback ([D04]) handles unknown structured shapes. The drift detector ([D04]) compares incoming `system_metadata.version` to the pinned golden catalog and surfaces a caution badge when shapes diverge ([Q03]).
- **Residual risk:** Caution badge requires user acknowledgement; drift is silently rendered through the generic fallback until a user reports.

**Risk R03: Mid-stream rerender churn** {#r03-rerender-churn}

- **Risk:** rAF coalescing helps, but a `code` row that contains both a streaming `MarkdownBlock` and a non-streaming `FileBlock` may have React render churn from upstream prop changes.
- **Mitigation:** Per [D12] / Spec S05, only streaming bodies subscribe to `PropertyStore`; non-streaming bodies render once on `tool_use_structured` completion and use `React.memo` to skip prop-equal rerenders.
- **Residual risk:** Mixed streaming/non-streaming compositions need profiling; high-frequency `assistant_text` deltas can still land work in the React commit phase.

**Risk R04: Mermaid / KaTeX runtime errors crash a row** {#r04-stretch-runtime-errors}

- **Risk:** Malformed diagram or math syntax causes the third-party renderer to throw. Without isolation, it tears down the parent transcript row.
- **Mitigation:** Each `MermaidBlock` and `KaTeXBlock` instance wraps in an error boundary; on throw, fall back to plain `CodeBlock` rendering with a small "Diagram failed to render" or "Math failed to render" toast.
- **Residual risk:** First user encounter with broken diagram is jarring even with fallback.

**Risk R05: Component sprawl + token sprawl** {#r05-component-sprawl}

- **Risk:** ~14 body kinds + ~14 wrappers + chrome = 30+ new components, each with their own token slot. Theming consistency suffers.
- **Mitigation:** Strict L19/L20 compliance enforced by `bun run audit:tokens lint`; cross-component snapshot tests against both themes in `__tests__/`.
- **Residual risk:** Each new component is one more touchpoint when a theme axis changes — but this is the cost of the rendering bar.

**Risk R06: Streaming + virtualization perf under high-frequency updates** {#r06-streaming-perf}

- **Risk:** When `assistant_text` fires 30+ deltas/sec interleaved with tool events, `BlockHeightIndex` recomputes thrash and scroll fidelity drops.
- **Mitigation:** rAF coalescing in `TugMarkdownView` already in place; profile and tune if needed.
- **Residual risk:** Pathological prompts (~100 deltas/sec) might still degrade. Mitigation: deferred adaptive coalescing window if observed.

---

### Design Decisions {#design-decisions}

#### [D01] Renderer dispatch lives in `assistant-renderer-dispatch.ts`, not in `CodeSessionStore` (DECIDED) {#d01-dispatch-separate}

**Decision:** A new module `tugdeck/src/components/tugways/cards/tide-assistant-renderer-dispatch.ts` owns the `TurnEntry` → renderer mapping. `CodeSessionStore` stays state-only and is unchanged by this phase.

**Rationale:**
- Keeps the store concerned with state, the dispatch concerned with presentation.
- Lets the registry evolve (new tools, new event types) without touching the store reducer.
- Easier to unit-test the dispatch table in isolation.

**Implications:**
- `TurnEntry` records do *not* carry a `rendererKind` tag; the dispatch derives it from `entry.kind` + `entry.toolName` + structured shape.
- The dispatch module exports a `dispatch(entry: TurnEntry): { Component, props }` shape that the transcript view consumes.
- The dispatch module owns the `toolWrapperRegistry` keyed on `tool_name` (case-insensitive, with `MultiEdit` aliasing to `Edit`).

#### [D02] `TerminalBlock` self-virtualizes long output via `BlockHeightIndex` (DECIDED) {#d02-terminal-virtualizes}

**Decision:** When a `TerminalBlock` exceeds N visible lines (default 40), it self-virtualizes using the same `BlockHeightIndex` + `RenderedBlockWindow` machinery `TugMarkdownView` uses. Up to a retained-line cap ([Q04], default 10k); beyond that, drop the earliest with a "… N earlier lines truncated" indicator.

**Rationale:**
- Reuses existing virtualization infrastructure rather than building a parallel path.
- 10k retained is enough for typical `cargo build`, `npm test`, multi-MB log dumps; pathological streams degrade gracefully rather than OOM.
- Truncation indicator preserves user awareness of dropped content.

**Implications:**
- `TerminalBlock` accepts the same `BlockHeightIndex` host plumbing as `TugMarkdownView`.
- Retained-line cap is configurable via tugbank `/api/defaults/tide/terminal-line-cap` (deferred unless surfaced).
- Stream parsing (ANSI → spans) runs incrementally as deltas arrive.

#### [D03] `system_metadata` renders per-turn only when something changed (DECIDED) {#d03-system-metadata-on-change}

**Decision:** `SessionInitBanner` and `CostChrome` both read `system_metadata`; either re-renders only when one of `model`, `permissionMode`, `version`, or the tool/skill enumeration differs from the previous `system_metadata` event in this session. Identical-shape `system_metadata` events are dropped without re-rendering.

**Rationale:**
- Per-turn render is noisy; session-init-only loses mid-session model and permission-mode changes.
- Diff-based render keeps the user informed only when state actually changes.

**Implications:**
- Dispatch module owns a per-session "previous system_metadata" reference for shallow comparison.
- Comparison is shallow on the fields named above; deep compare on tools/skills/agents arrays.
- A test fixture replay where every event includes `system_metadata` should produce exactly one banner render plus one re-render at any change.

#### [D04] Drift fallback is `JsonTreeBlock` + caution badge (DECIDED) {#d04-drift-fallback-caution-badge}

**Decision:** When the dispatch encounters an unknown tool_name (registry miss) or a `structured_result` shape that doesn't match its expected schema, render via `JsonTreeBlock` and surface a caution badge per [Q03]. The caution badge is also surfaced when `system_metadata.version` doesn't match the pinned golden catalog (per `tide.md#p15-stream-json-version-gate`).

**Rationale:**
- Never render blank or crash on drift.
- Caution badge gives the user provenance to report drift to us.
- Aligns with the `tide.md#p15-stream-json-version-gate` story.

**Implications:**
- `JsonTreeBlock` is a permanent body kind, not just a fallback — it's also the default body for unknown tool inputs in `DefaultToolWrapper`.
- Caution badge is surfaced both in the card chrome (subtle aggregate) and inline at the offending event (subtle marker), per [Q03] option (c).
- Drift events are logged to the console (and, longer-term, to the supervisor telemetry feed if/when that ships).
- Schema-mismatch detection is shallow: we check field presence and types at top level, not deep validation.

#### [D05] Two-layer hybrid architecture: body kinds + thin per-tool wrappers (DECIDED) {#d05-two-layer-hybrid}

**Decision:** Layer 1 is ~14 reusable body kinds that own all the heavy rendering. Layer 2 is one wrapper per Claude tool, each wrapper is thin (~50-100 lines) and composes Layer 1.

**Why this isn't overkill.** "One component per tool" sounds like a lot, but the per-tool layer is *decoration over composition* — chrome (header, footer, badges) plus a body that's a Layer-1 component. The rendering polish accumulates in body kinds, where it gets reused by every tool that needs that shape. So when a designer touches diff styling, they touch *one* file and every tool that shows a diff inherits the change. Per-tool is the right granularity for "great rendering"; sharing the body kinds is the right factoring for staying maintainable.

**Three upgrade levers, with worked examples:**

1. **Tune the wrapper.** `BashToolBlock` later wants a re-run button → add it to the wrapper. `ReadToolBlock` later wants a "view in editor" link → add it to the wrapper. No body-kind or sibling-tool changes.
2. **Swap the body.** `BashToolBlock` initially uses `<TerminalBlock>`. We later detect `git status --porcelain=v2` output → swap to `<GitStatusBlock>` (Phase T2 in `tide.md` already plans for this body kind on the shell-adapter side; *the same body serves both halves*). One-line change in the wrapper.
3. **Specialize a body kind.** `EditToolBlock` initially uses generic `<DiffBlock>`. Notebook edits need cell-aware diffing → ship `<NotebookDiffBlock>` as a sibling primitive. `EditToolBlock` switches based on file extension; the generic `<DiffBlock>` is untouched. Specialization is invasive but localized.

A `toolRendererRegistry` keyed on `tool_name` makes lever 1 trivial; lever 2 is internal to the wrapper; lever 3 is the most invasive but bounded.

**Rationale:**
- Per-tool components for "great rendering," but the bulk of code is shared so the per-tool layer is cheap.
- Three localized upgrade levers above let any tool reach an arbitrarily-bespoke ceiling without disturbing siblings.
- Same body kinds reused in `tide.md` Phase T2 for shell adapters.

**Implications:**
- See Tables [T01](#t01-body-kinds) and [T02](#t02-tool-wrappers).
- All wrappers conform to the [Spec S03](#s03-tool-wrapper-contract) shape.
- Adding a new tool = new wrapper file + registry entry; never touches body kinds.

#### [D06] WASM only where it earns its keep (DECIDED) {#d06-wasm-where-earns}

**Decision:** New WASM crates only for parsers where the speed/correctness win is clear: `tugdiff-wasm` (imara-diff) for diff parsing. Stay JS for ANSI parsing (`ansi_up`), JSON-tree, KaTeX (already JS), Mermaid (already JS), word-level intra-line diff (`diff-match-patch`).

**Rationale:**
- WASM has real costs: build complexity, async init, an extra crate to maintain.
- `imara-diff` is 10-30× faster than JS alternatives on large diffs and pathological-input safe — wins justify the cost.
- ANSI / JSON / inline math don't have the input scale to need WASM.

**Implications:**
- One new crate this phase: `tugdeck/crates/tugdiff-wasm/`.
- Vite config extended for the new WASM module.
- Possible future migration: `vtparse` (Rust) for ANSI if we hit pathological terminal sequences.

#### [D07] Block-transformer pass over markdown blocks (DECIDED) {#d07-block-transformer-pass}

**Decision:** `parseMarkdownToSanitizedBlocks` adds a transformer hook that runs after sanitize. Transformers can replace a block's `html`, change its `type`, or insert sibling blocks. Initial transformers: mermaid (lang === "mermaid"), latex/math (lang === "math" or "latex"), diff (lang === "diff"), large-json (lang === "json", > N tokens).

**Rationale:**
- The fenced-code-block lang hint is a natural promotion point.
- Pure function over the block list — no side effects, easy to test.
- Streaming-friendly: transformers run on each parse pass.

**Implications:**
- `parseMarkdownToSanitizedBlocks` signature gains an optional `transformers: BlockTransformer[]` parameter.
- Each transformer is a small, testable unit with the [Spec S04](#s04-block-transformer-pass) shape.
- Inline math (`$...$`, `$$...$$`) is handled via a separate post-DOMPurify text-node walk inside `MarkdownBlock` rendering, not the block-transformer pass.

#### [D08] KaTeX (not MathJax) for math typesetting (DECIDED) {#d08-katex-over-mathjax}

**Decision:** Use KaTeX for inline (`$...$`) and display (`$$...$$`) math. Lazy-loaded, ~350 KB total, synchronous render. Local font bundling, no CDN.

**Rationale:**
- Smaller bundle than MathJax (350 KB vs. 1+ MB).
- Synchronous render — no reflow churn during streaming.
- Faster than MathJax v3 in our latency profile.
- Sufficient LaTeX coverage for the math the assistant typically emits.

**Implications:**
- KaTeX bundle loads on first `$...$` or `$$...$$` encounter.
- WOFF2 fonts bundled, not pulled from CDN.
- Error boundary per instance per [R04].

#### [D09] `imara-diff` for `DiffBlock` backbone (DECIDED) {#d09-imara-diff-backbone}

**Decision:** Compile `imara-diff` (Rust) to WASM via a new `tugdeck/crates/tugdiff-wasm/` crate. Use it to compute unified diffs and parse upstream unified-diff strings. Fall back to JS `jsdiff` for first-paint before the WASM module loads.

**Rationale:**
- 10-30× faster than `similar` on large inputs.
- Histogram + Myers algorithms; pathological-input safe.
- WASM is the right home — diff is exactly the kind of work where WASM shines.

**Implications:**
- New crate at `tugdeck/crates/tugdiff-wasm/`.
- Vite config + WASM init pattern matching `tugmark-wasm`.
- `DiffBlock` mounts in JS-fallback mode if the WASM module isn't ready, swaps once it loads.

#### [D10] Lazy-load all stretch content modules (DECIDED) {#d10-lazy-load-stretch}

**Decision:** KaTeX, Mermaid, `tugdiff-wasm`, and Shiki language packs all load on first encounter. The Tide card boot bundle excludes them.

**Rationale:**
- Initial bundle stays bounded — Tide card mount is fast.
- A session that never sees a diagram pays no Mermaid cost.
- First encounter has a one-time load (cached for session); subsequent uses are instant.

**Implications:**
- Each lazy module has a placeholder shown during fetch (small spinner, not jarring).
- Bundle-size budget enforced via [T06](#t06-bundle-budget).
- Once loaded for a session, modules persist in the JS heap; no GC trickery.

#### [D11] `DefaultToolWrapper` covers unknown tools day-one (DECIDED) {#d11-default-tool-wrapper}

**Decision:** Any `tool_use` with a `tool_name` not in the registry renders through `DefaultToolWrapper` — `JsonTreeBlock` over input + smart-pick body for output (text → MarkdownBlock; object → JsonTreeBlock) — with a caution badge per [D04].

**Rationale:**
- Day-one guarantee: we never render blank or ugly when a new tool ships.
- Upgrade path is "promote from default to bespoke" by adding a wrapper.
- Drift surfaces visibly to the user.

**Implications:**
- Always-shipped fallback; cannot be conditionally absent.
- Caution badge required for unknown-tool dispatches.
- The dispatch logs the unknown tool name for telemetry.

#### [D12] Streaming-aware behavior per body kind (DECIDED) {#d12-streaming-per-body}

**Decision:** Streaming behavior is a per-body-kind property documented in Table [T05](#t05-streaming-matrix). Streaming bodies subscribe to `PropertyStore`; non-streaming bodies render once on completion. Wrappers handle the "tool input is streaming, body isn't ready yet" gap with a placeholder.

**Rationale:**
- Not all data shapes benefit from streaming. A diff isn't a diff until both sides exist.
- Subscribing every body to `PropertyStore` would multiply rerender work for no visible gain.
- Wrappers handle the gap state once, consistently.

**Implications:**
- See Table [T05](#t05-streaming-matrix).
- All body-kind components use `React.memo` and equality-by-data-version on props.
- Wrappers expose a `WrapperState = "streaming" | "ready" | "error"` that drives chrome.

#### [D13] Inline (not modal) Permission and Question dialogs (DECIDED) {#d13-inline-dialogs}

**Decision:** Both `PermissionDialog` (`control_request_forward` with `is_question:false`) and `QuestionDialog` (`is_question:true`) render as inline blocks within the transcript flow, not as modal overlays.

**Rationale:**
- Modals break the top-to-bottom transcript reading model.
- Inline blocks preserve the conversation's spatial logic (the request appeared at a point in time).
- After resolution, the inline block becomes a static record showing what was asked and how it was answered — a permanent transcript artifact.

**Implications:**
- Both dialogs participate in the transcript scroll and selection model.
- After response, the block collapses to a one-line summary with an expand affordance.
- Focus management on dialog mount: focus the primary action button via `useLayoutEffect`.

#### [D14] Thinking blocks always collapsed by default after `turn_complete` (DECIDED) {#d14-thinking-collapse-default}

**Decision:** `ThinkingBlock` shows a streaming preview during partials but, once `turn_complete` fires, snaps to a collapsed state showing only "Thinking…" + a one-line preview. User opts in to expand.

**Rationale:**
- Thinking is supplementary; the user wants the response, not the reasoning trail by default.
- Collapsing during streaming would be jittery; collapsing on completion is stable.
- Aligns with `tugplan-tide-card-polish.md` §Step 13's default recommendation.

**Implications:**
- `ThinkingBlock` watches the parent turn's status and self-collapses on transition to `complete`.
- User-expanded state persists for the lifetime of the row (not across reload).
- Collapse animation respects reduced-motion preference.

#### [D15] Token compliance via seven-slot convention per L19/L20 (RESTATED) {#d15-token-compliance}

**Decision:** Every body kind and every wrapper introduces tokens under `--tugx-<kind>-<plane>-control-<constituent>-<emphasis>-<role>-<state>`. Wrappers do not reach into body-kind CSS. `bun run audit:tokens lint` exits 0.

**Rationale:**
- Tuglaw L19/L20 compliance is non-negotiable for component authoring.
- Theme switching (`brio` ↔ `harmony`) must work uniformly for every component.

**Implications:**
- Each new component pairs `.tsx` + `.css` files.
- `data-slot="..."` attribute on each component root.
- Token slot names enumerated in [Table T07](#t07-token-slots).

#### [D16] `assistant-renderer-dispatch` registry is keyed on `tool_name` (case-insensitive) with explicit aliases (DECIDED) {#d16-registry-key}

**Decision:** The tool-wrapper registry is a `Map<string, ToolWrapperFactory>` keyed on the lowercased `tool_name`. Aliases are declared explicitly:

| Canonical | Aliases |
|-----------|---------|
| `edit` | `multiedit` |
| `agent` | `task` (historical name; renamed by Claude Code; **per [audit §4.3](./tide-assistant-rendering-session-audit.md), real sessions emit `Agent`**) |

(MCP tools are explicitly a non-goal in v1; alias entries reserved for future MCP-server-aware wrappers.)

**Rationale:**
- Case sensitivity has been observed to vary by event; lowercase normalizes.
- Explicit aliases avoid surprise dispatch and absorb tool renames cleanly.
- Easy to test: `dispatch.match("Read") === ReadToolBlock`.

**Implications:**
- Registry construction is centralized in `assistant-renderer-dispatch.ts`.
- Aliases declared as a sibling object next to the registry.
- Unknown lookups return `DefaultToolWrapper` per [D11]; *known* tools routed through Default (per [Table T02](#t02-tool-wrappers) audit-confirmed list) get registry entries that suppress the unknown-tool caution flag.

#### [D17] `AgentTranscriptBlock` recurses through the same dispatch (DECIDED) {#d17-agent-transcript-recurses}

**Decision:** When `tool_use_structured` for `Task`/`Agent` arrives with nested `content[].tool_use` entries, those nested tool calls render through the same dispatch pipeline — including their own per-tool wrappers and bodies. Recursion is bounded by a max depth (default 3); deeper levels collapse with a "+N nested calls" affordance.

*Audit footnote ([§5.1](./tide-assistant-rendering-session-audit.md)):* No real-session subagent depth > 1 observed in the 1,031-session corpus. Default cap of 3 is generous; 2 would be safe. Keep cap at 3 for paranoia headroom.

**Rationale:**
- The same rendering quality across recursion depth.
- Unbounded recursion would melt the layout for pathological inputs.
- Same dispatch keeps consistency.

**Implications:**
- Dispatch is recursive in shape but iterative in implementation.
- Depth tracked as a prop on each render.
- Tests cover at least depth 2 explicitly (sub-subagent).

**Design note — subagents as participants.** Subagent runs naturally read like their own *speaker* in the transcript (an `Explore` agent submitted a query and produced an answer; that's a participant turn, not just a tool call). The v1 implementation here is an inline collapsible block within the parent `code` row. A future option — A/B'd against the inline form — is to promote `AgentTranscriptBlock` to its own participant variant on `TugTranscriptEntry`, alongside `user`/`code`/`shell`/`command`. This same observation applies to a future `Bash`-as-participant treatment if shell-adapter UX work surfaces it. Both deferred to [Roadmap](#roadmap).

---

### Deep Dives {#deep-dives}

#### Architecture mental model {#architecture-mental-model}

```
┌─────────────────────────── stream-json events ───────────────────────────┐
│                                                                          │
│  thinking_text   assistant_text   tool_use   tool_result                 │
│  tool_use_structured   control_request_forward   cost_update             │
│  system_metadata   session_init   error                                  │
│                                                                          │
└────────┬─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────── CodeSessionStore reducer ─────────────────────────┐
│ Accumulates deltas; produces TurnEntry records:                          │
│   { kind, msg_id, seq, body | toolEvents, status, ... }                  │
│ (Unchanged by this phase. State-only.) [D01]                             │
└────────┬─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──── tide-assistant-renderer-dispatch.ts (this phase) [D01] [D16] ────────┐
│  user_text          → UserTurnRenderer (existing)                        │
│  assistant_text     → AssistantTurnRenderer (markdown + transformers)    │
│  thinking           → ThinkingBlock                                      │
│  tool_use[name]     → toolWrapperRegistry[name] | DefaultToolWrapper     │
│  control_request    → PermissionDialog | QuestionDialog                  │
│  cost_update        → CostBadge / CostChrome                             │
│  system_metadata    → SessionInitBanner (on change) [D03]                │
│  error              → ErrorBlock                                         │
└────────┬─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────── Layer 2 — Tool wrappers ──────────────────────┐
│  ReadToolBlock, WriteToolBlock, EditToolBlock, BashToolBlock,            │
│  GlobToolBlock, GrepToolBlock, TaskToolBlock, WebFetchToolBlock,         │
│  WebSearchToolBlock, TodoWriteToolBlock, NotebookEditToolBlock,          │
│  DefaultToolWrapper                                                      │
│                                                                          │
│  Each wrapper: chrome (header/footer/badges) + body ← Layer 1            │
└────────┬─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────── Layer 1 — Body kinds ─────────────────────────┐
│  MarkdownBlock     TerminalBlock      DiffBlock       FileBlock          │
│  PathListBlock     SearchResultBlock  JsonTreeBlock   TodoListBlock      │
│  AgentTranscriptBlock  ImageBlock     MermaidBlock    KaTeXBlock         │
│  TableBlock (rich)  PlainTextBlock                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Block-transformer pass {#block-transformer-pass}

Transformers run after `parseMarkdownToSanitizedBlocks` and before render. Each transformer takes the block list and returns a (possibly modified) list. Initial transformers in this phase:

- **`mermaidTransformer`** — replaces `{ type: "code", lang: "mermaid", text }` with `{ type: "tug-mermaid", text }`. The renderer treats `tug-*` types as opaque and delegates to the matching component. Streaming-aware: stays as a plain code block while the parent block's status is `partial`; promotes to mermaid only on `complete`.
- **`mathTransformer`** — replaces `{ type: "code", lang: "math" | "latex" | "tex", text }` with `{ type: "tug-math-display", text }`. Always display mode for fenced blocks.
- **`diffTransformer`** — replaces `{ type: "code", lang: "diff", text }` with `{ type: "tug-diff", text }` (read-only mode of `DiffBlock`).
- **`largeJsonTransformer`** — for `{ type: "code", lang: "json", text }` where `text.length > 2048`, replaces with `{ type: "tug-json-tree", text }` — a deeper interactive view than syntax-highlighted JSON.

Inline math is handled separately, after sanitize, by a text-node walk inside `MarkdownBlock` rendering. Pattern: `$<latex>$` (inline) and `$$<latex>$$` (display). Escaped `\\$` is preserved.

#### Streaming behavior matrix {#streaming-matrix}

See [Table T05](#t05-streaming-matrix).

#### Library landscape (May 2026) {#library-landscape}

Web research conducted for this phase (cited in §[Library citations](#library-citations)) confirms:

- **`imara-diff`**: 10-30× faster than `similar` on linux-kernel-scale diffs; histogram + Myers; pathological-input safe. WASM compilation is supported; build pattern matches `tugmark-wasm`.
- **Shiki**: VS Code-grade highlighting via TextMate grammars and themes. Modern versions run in browser. Lazy language loading. ~3.5s for 10k lines in browser tests — adequate for our virtualized rendering.
- **Tree-sitter** via `web-tree-sitter`: better incremental highlighting under streaming, but per-language WASM blob + async init complexity. Reserved for future evaluation per [Q02].
- **Mermaid**: lazy-loading API since v9.2; ~1 MB main bundle, smaller "Tiny" variant available. Diagram-specific code loads on first use. Late-binding pattern per [Rick Strahl 2025](#library-citations).
- **`ansi_up`**: zero-deps, ~6 KB, sufficient linear ANSI parser for our scale.
- **KaTeX vs MathJax (Nov 2025 comparison)**: KaTeX wins on bundle (~350 KB vs. 1+ MB), synchronous render, faster on most inputs. MathJax v3 has better LaTeX coverage; KaTeX coverage is sufficient for our use case.

---

### Specification {#specification}

#### Spec S01: `AssistantRendererDispatch` interface {#s01-dispatch-interface}

The dispatch is stateless logic over a discriminated-union input. The real `TurnEntry` (`tugdeck/src/lib/code-session-store/types.ts`) is a *full-turn* record without a `kind` discriminator — it carries `userMessage`, `thinking`, `assistant`, `toolCalls`, etc. The transcript view turns each `TurnEntry` (and any in-flight content) into a series of `RenderInput` values, each of which the dispatch routes to a renderer.

```typescript
// tugdeck/src/components/tugways/cards/tide-assistant-renderer-dispatch.ts

/**
 * Discriminated input for the dispatch. Each kind routes to a specific
 * renderer per the architecture mental model. Sources include TurnEntry
 * fields (assistant / thinking / toolCalls / userMessage), in-flight
 * streaming content (streamingPaths.*), and chrome-shaped events
 * (control_request_forward, cost_update, system_metadata, error).
 */
export type RenderInput =
  | { kind: "assistant_text"; text: string; status: "streaming" | "complete"; msgId: string }
  | { kind: "thinking"; text: string; status: "streaming" | "complete"; msgId: string }
  | { kind: "tool_call"; toolCall: ToolCallState; msgId: string }
  | { kind: "user_text"; text: string; submitAt: number }
  | { kind: "permission"; request: ControlRequestForward }
  | { kind: "question"; request: ControlRequestForward }
  | { kind: "cost"; cost: CostSnapshot; cumulative?: CostSnapshot }
  | { kind: "system_metadata"; metadata: unknown; previousMetadata?: unknown }
  | { kind: "error"; message: string; recoverable: boolean };

export interface DispatchResult {
  Component: React.ComponentType<unknown>;
  props: Record<string, unknown>;
  /** Caution flag; surfaces caution badge per [D04]. */
  caution?: { reason: "unknown_tool" | "unknown_shape" | "version_drift"; detail?: string };
}

export interface AssistantRendererDispatch {
  /** Route a RenderInput to a renderer + props. Always returns; never throws. */
  dispatch(input: RenderInput, context: DispatchContext): DispatchResult;

  /** Look up a tool wrapper by name (case-insensitive). Returns DefaultToolWrapper for misses. */
  resolveToolWrapper(toolName: string): ToolWrapperFactory;

  /** Test-only: enumerate all registered tool wrappers. */
  registeredTools(): ReadonlyArray<string>;
}

export interface DispatchContext {
  /** PropertyStore for streaming-binding access. */
  store: PropertyStore;
  /** The session's CodeSessionStore handle (read-only access). */
  session: CodeSessionStore;
  /** Recursion depth for AgentTranscriptBlock; default 0. */
  depth?: number;
}
```

`previousMetadata` for [D03]'s on-change comparison rides on the `system_metadata` `RenderInput` itself rather than `DispatchContext`, so the dispatch is fully stateless over the registry: callers stay responsible for tracking their per-session previous-snapshot reference.

#### Spec S02: Body-kind contract {#s02-body-kind-contract}

Every Layer-1 body kind exports:

```typescript
export interface BodyKindProps<TData = unknown> {
  data: TData;
  /** When true, the body subscribes to the streaming store. [D12] */
  streamingStore?: PropertyStore;
  /** PropertyStore path key; default "text". */
  streamingPath?: string;
  /** Initial collapse state; respects each body's defaultCollapsedThreshold. */
  collapsed?: boolean;
  onToggleCollapsed?: (next: boolean) => void;
  className?: string;
}
```

Each component:
- Pairs a `.tsx` + `.css` file (L19).
- Sets `data-slot="<kind>-body"` on the root.
- Owns its `--tugx-<kind>-*` token slot (L20).
- Renders nothing if `data` is null/undefined; renders fallback `PlainTextBlock` on parse error.

#### Spec S03: Tool-wrapper contract {#s03-tool-wrapper-contract}

Every Layer-2 wrapper exports:

```typescript
export interface ToolWrapperProps<TInput = unknown, TStructured = unknown> {
  toolUseId: string;
  toolName: string;
  msgId: string;
  seq: number;
  input?: TInput;            // streamed empty → full
  textOutput?: string;       // tool_result.output
  structuredResult?: TStructured; // tool_use_structured.structured_result
  isError?: boolean;
  durationMs?: number;
  status: "streaming" | "ready" | "error";
  caution?: DispatchResult["caution"];
}

export type ToolWrapperFactory = (props: ToolWrapperProps) => React.ReactElement;
```

Each wrapper:
- Pairs `.tsx` + `.css`, `data-slot="<tool>-tool-block"` root.
- Renders chrome (header + footer) + composed body kind.
- Handles `status === "streaming"` with a placeholder body.
- Handles `status === "error"` with `isError` styling + the structured error message.
- Surfaces `caution` as an inline badge per [Q03]/[D04].

#### Spec S04: Block-transformer pass {#s04-block-transformer-pass}

```typescript
export interface BlockTransformer {
  /** Stable name for diagnostics. */
  name: string;
  /** Transform a single block, returning the new block list. Pure. */
  transform(block: SanitizedMarkdownBlock, context: BlockTransformContext): SanitizedMarkdownBlock[];
}

export interface BlockTransformContext {
  /** Whether the source text has reached `complete` status. */
  isComplete: boolean;
  /** Block index in the parent block list. */
  index: number;
}
```

Composition: `parseMarkdownToSanitizedBlocks(text, { transformers })` flat-maps each block through every registered transformer in order. A transformer may return `[block]` (no change), `[]` (drop), `[modified]` (replace), or `[a, b, c]` (split).

#### Spec S05: Streaming binding {#s05-streaming-binding}

Every body kind that participates in streaming:
- Accepts `streamingStore: PropertyStore` + `streamingPath: string`.
- On mount in a `useLayoutEffect`, reads `store.get(path)` synchronously and renders that initial value (G1 contract — `observe` does NOT fire on subscribe).
- Subscribes via `store.observe(path, listener)`, coalescing rapid updates with `requestAnimationFrame`.
- Writes DOM imperatively per L06; React state holds only the container ref.
- Cleans up by calling unsubscribe in the effect's cleanup.

Reference implementation: `TugMarkdownBlock` already follows this contract.

#### Spec S07: Stream-json event inventory {#s07-event-inventory}

The full set of stream-json event types this phase renders. Authoritative shape is in the fixture catalog at [`tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.105/`](../tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.105/) and `v2.1.112/`. Field-level shape derived from `transport-exploration.md`.

| Event | Direction | Routes to | Reducer behavior |
|-------|-----------|-----------|------------------|
| `protocol_ack` | server → client | `SessionInitBanner` (silent) | first-frame handshake |
| `session_init` | server → client | `SessionInitBanner` (top of card) | sets `session_id` (may be `"pending"`) |
| `system_metadata` | server → client | `SessionInitBanner` (re-render only on change per [D03]) | per-turn metadata: `model`, `permissionMode`, `version`, `tools`, `skills`, `agents`, `mcp_servers`, `plugins` |
| `thinking_text` | server → client | `ThinkingBlock` | delta-streamed; full text on `is_partial:false`/`status:complete` |
| `assistant_text` | server → client | `MarkdownBlock` (in `code` row body) | delta-streamed; final `complete` event has full accumulated text |
| `tool_use` | server → client | tool-wrapper-by-name (Layer 2) | `input` streams empty → full |
| `tool_result` | server → client | tool wrapper's body | `output` text + `is_error` |
| `tool_use_structured` | server → client | tool wrapper's body | typed structured shape per tool |
| `control_request_forward` (`is_question:false`) | server → client | `PermissionDialog` | answer with `tool_approval` |
| `control_request_forward` (`is_question:true`) | server → client | `QuestionDialog` | answer with `question_answer` |
| `cost_update` | server → client | `CostBadge` (per-turn) + `CostChrome` (cumulative) | per-model token + USD breakdown |
| `turn_complete` | server → client | finalize current turn | `result: "success" \| "error"` |
| `error` | server → client | `ErrorBlock` | `recoverable` flag drives variant |

Inbound (UI → Claude Code) — not rendered, but produced by the dialogs above:

| Type | Produced by | Fields |
|------|-------------|--------|
| `tool_approval` | PermissionDialog Allow/Deny | `request_id`, `decision`, `updatedInput?`, `message?` |
| `question_answer` | QuestionDialog Submit | `request_id`, `answers` |
| `interrupt` | Stop button (existing) | (empty) |

#### Spec S06: Fixture-replay test contract {#s06-fixture-replay}

A single integration test file (`tugdeck/src/__tests__/assistant-rendering-fixture-replay.test.tsx`) walks every `*.jsonl` file under `tugrust/crates/tugcast/tests/fixtures/stream-json-catalog/v2.1.105/` and `v2.1.112/`, replays each event sequence into a `CodeSessionStore`, mounts a Tide card, and asserts:

1. No render throws.
2. No `[object Object]` string literal appears in the rendered DOM.
3. No raw JSON-line text bleeds through outside `JsonTreeBlock` or `CodeBlock`.
4. Every `tool_use` event in the fixture produces exactly one `[data-slot$="-tool-block"]` element in the DOM.
5. For tool names enumerated in [Table T02](#t02-tool-wrappers), the dispatched component is bespoke (not `DefaultToolWrapper`).
6. Caution badge appears exactly when expected (synthetic-drift fixtures).

Fixture replay is the load-bearing test for the success criteria.

#### Internal Architecture {#internal-architecture}

**File layout (proposed):**

```
tugdeck/
  src/
    components/
      tugways/
        cards/
          tide-assistant-renderer-dispatch.ts          [D01]
          tide-assistant-renderer-dispatch.test.ts
          tool-wrappers/
            read-tool-block.tsx + .css
            write-tool-block.tsx + .css
            edit-tool-block.tsx + .css
            bash-tool-block.tsx + .css
            glob-tool-block.tsx + .css
            grep-tool-block.tsx + .css
            task-tool-block.tsx + .css
            web-fetch-tool-block.tsx + .css
            web-search-tool-block.tsx + .css
            todo-write-tool-block.tsx + .css
            notebook-edit-tool-block.tsx + .css
            default-tool-wrapper.tsx + .css
            tool-wrapper-chrome.tsx + .css   ← shared header/footer
        body-kinds/
          terminal-block.tsx + .css
          diff-block.tsx + .css
          file-block.tsx + .css
          path-list-block.tsx + .css
          search-result-block.tsx + .css
          json-tree-block.tsx + .css
          todo-list-block.tsx + .css
          agent-transcript-block.tsx + .css
          image-block.tsx + .css
          mermaid-block.tsx + .css
          katex-block.tsx + .css
          table-block.tsx + .css
          plain-text-block.tsx + .css
        chrome/
          tide-thinking-block.tsx + .css
          tide-permission-dialog.tsx + .css
          tide-question-dialog.tsx + .css
          tide-cost-chrome.tsx + .css
          tide-session-init-banner.tsx + .css
          tide-error-block.tsx + .css
          tide-caution-badge.tsx + .css     [D04]
    lib/
      markdown/
        block-transformers/
          mermaid-transformer.ts            [D07]
          math-transformer.ts
          diff-transformer.ts
          large-json-transformer.ts
          inline-math-walker.ts
          parse-markdown-to-sanitized-blocks.ts  ← extended
      ansi/
        ansi-to-html.ts                      ← uses ansi_up
      lazy/
        load-katex.ts                        [D10]
        load-mermaid.ts
        load-tugdiff-wasm.ts
  crates/
    tugdiff-wasm/                            [D09]
      Cargo.toml
      src/lib.rs
      pkg/                                   ← built artifact
  styles/
    themes/
      brio.css                               ← extended
      harmony.css                            ← extended
```

Each new file follows L19 (component-authoring) and L20 (token sovereignty).

#### Modes / Policies {#modes}

- **Collapse-by-default thresholds** per body kind, see [Table T01](#t01-body-kinds).
- **Streaming behavior** per body kind, see [Table T05](#t05-streaming-matrix).
- **Lazy loading** per [D10] for KaTeX, Mermaid, tugdiff-wasm.
- **Error fallback**: every primitive falls back to `PlainTextBlock` (text content) or `JsonTreeBlock` (structured) on internal error; never blank, never throws.
- **Theme switching** is uniform: `data-theme="brio"` ↔ `data-theme="harmony"` swaps token values; no component-level branching on theme name.

#### Tables {#tables}

**Table T01: Layer-1 body-kind catalog** {#t01-body-kinds}

| Body kind | Source data | Streams? | Default collapse threshold | Lazy module |
|-----------|-------------|----------|----------------------------|-------------|
| MarkdownBlock (existing) | text | yes | per-block height | none |
| TerminalBlock | stdout/stderr + ANSI | yes (stream) | 40 lines | none (ansi_up shipped) |
| DiffBlock | (old, new) or unified | no | 40 hunks | tugdiff-wasm |
| FileBlock | { content, filePath, ... } | no | 50 lines | none |
| PathListBlock | string[] | no | 100 paths | none |
| SearchResultBlock | { groups } | no | 50 results | none |
| JsonTreeBlock | unknown | no | depth 3 | none |
| TodoListBlock | { todos } | tool input | none | none |
| AgentTranscriptBlock | { content[] } | yes recursively | depth 2 | none |
| ImageBlock | { url, alt } | no | none | none |
| MermaidBlock | text | no (wait for complete) | none | mermaid |
| KaTeXBlock | text | no | none | katex |
| TableBlock (rich) | rows | no | 20 rows | none |
| PlainTextBlock | string | yes | 100 lines | none |

**Table T02: Layer-2 tool-wrapper catalog** {#t02-tool-wrappers}

| Wrapper | Tool name(s) | Body kind composed | Chrome |
|---------|--------------|---------------------|--------|
| ReadToolBlock | Read | FileBlock | filePath + line range |
| WriteToolBlock | Write | FileBlock | filePath + size, new vs overwrite |
| EditToolBlock | Edit, MultiEdit | DiffBlock | filePath + change counts |
| BashToolBlock | Bash | TerminalBlock | command + duration + exit code |
| GlobToolBlock | Glob | PathListBlock | pattern + count + truncated |
| GrepToolBlock | Grep | SearchResultBlock or PathListBlock | pattern + counts |
| TaskToolBlock | Task | AgentTranscriptBlock | agentType + status + tokens |
| WebFetchToolBlock | WebFetch | MarkdownBlock or FileBlock | url + favicon |
| WebSearchToolBlock | WebSearch | SearchResultBlock | query + count |
| TodoWriteToolBlock | TodoWrite | TodoListBlock | counts + progress |
| NotebookEditToolBlock | NotebookEdit | DiffBlock | notebook + cell |
| DefaultToolWrapper | * (registry miss) | JsonTreeBlock + dynamic body | tool_name + summary + caution badge |

**Audit-confirmed routes through `DefaultToolWrapper`** (per [session audit §4.2](./tide-assistant-rendering-session-audit.md)) — the dispatch registry includes explicit entries for these so they're documented coverage rather than silent unknowns. They're all low-volume harness/management tools whose JsonTree-based default rendering is sufficient, but the registry entry suppresses the `caution: { reason: "unknown_tool" }` flag (these are *known* tools, just generically rendered). Promote any of them to a bespoke wrapper later if dogfooding warrants:

| Tool name | Audit volume | Notes |
|-----------|-------------:|-------|
| TaskCreate | 1,789 (2.78%) | Background-task creation; short structured input |
| TaskUpdate | 3,426 (5.33%) | Background-task status update; ~1-line responses |
| TaskList | 34 (0.05%) | List background tasks |
| TaskOutput | 37 (0.06%) | Read background-task output |
| TaskStop | 7 (0.01%) | Stop a background task |
| Monitor | 38 (0.06%) | Process/log monitoring |
| Skill | 10 (0.02%) | Skill invocation |
| ScheduleWakeup | 17 (0.03%) | Self-pacing wakeup |
| ToolSearch | 145 (0.23%) | Tool schema lookup |
| EnterWorktree | 1 (0.00%) | Worktree management |
| ExitWorktree | 1 (0.00%) | Worktree management |

**Table T03: Stream-event chrome catalog** {#t03-chrome}

| Renderer | Source event | Placement |
|----------|--------------|-----------|
| ThinkingBlock | thinking_text | inline at top of code row |
| AssistantBody (existing MarkdownBlock) | assistant_text | code row body |
| Tool wrapper (per Table T02) | tool_use family | code row body, in turn order |
| PermissionDialog | control_request_forward (is_question:false) | inline, transcript flow |
| QuestionDialog | control_request_forward (is_question:true) | inline, transcript flow |
| CostBadge | cost_update (per turn) | code row footer |
| CostChrome (cumulative) | aggregate cost_update | card status row |
| SessionInitBanner | session_init / system_metadata change [D03] | top of card |
| ErrorBlock | error | inline, transcript flow |
| CautionBadge | drift detection [D04] | both card chrome + inline at offending event |

**Table T04: Library picks** {#t04-library-picks}

| Need | Pick | WASM? | Lazy? | Rationale |
|------|------|-------|-------|-----------|
| Markdown lex/parse | pulldown-cmark via tugmark-wasm | yes | no | already shipped |
| HTML sanitize | DOMPurify | no | no | already shipped |
| Code highlighting | Shiki | no | per-language | shipped; revisit per [Q02] |
| Diff backbone | imara-diff via tugdiff-wasm | yes | yes | 10-30× faster than alternatives [D09] |
| Word-level diff | diff-match-patch | no | with DiffBlock | small JS, sufficient for line pairs |
| ANSI parsing | ansi_up | no | no | small, sufficient |
| Math typesetting | KaTeX | no | yes | smaller + faster than MathJax [D08] |
| Diagrams | mermaid | no | yes | bundle large; lazy [D10] |
| JSON tree | custom JS component | no | no | small, full control over UX |

**Table T05: Streaming behavior matrix** {#t05-streaming-matrix}

| Body kind | Streams? | Approach during stream | On `complete` |
|-----------|----------|------------------------|---------------|
| MarkdownBlock | yes — assistant_text deltas | Existing pipeline | finalize via full text |
| TerminalBlock | yes — Bash output streams | Re-parse on each delta; ANSI parser is linear | unchanged |
| DiffBlock | no | Wrapper shows placeholder | Render once on tool_use_structured |
| FileBlock | no | Wrapper shows placeholder | Render once |
| PathListBlock | no | Wrapper shows placeholder | Render once |
| SearchResultBlock | no | Wrapper shows placeholder | Render once |
| JsonTreeBlock | no | Wrapper shows placeholder | Render once |
| AgentTranscriptBlock | yes recursively | Same pipeline as outer transcript | finalize on agent status:"completed" |
| MermaidBlock | no | Show raw code as CodeBlock | Swap to mermaid render |
| KaTeXBlock | no | Show raw `$...$` text | Render once |
| TodoListBlock | tool input streams | Wrapper shows placeholder | Render once |
| ImageBlock | no | n/a | Render once |
| TableBlock | no | n/a | Render once |
| PlainTextBlock | yes | Update on each delta | finalize |

**Table T06: Bundle-size budget** {#t06-bundle-budget}

| Module | Approx size | Loaded when |
|--------|-------------|-------------|
| tugmark-wasm (existing) | ~200 KB | Tide card boot |
| Shiki core | ~80 KB | first code block |
| Shiki language pack (per language) | 5-30 KB | first encounter of that language |
| ansi_up | 6 KB | shipped in main |
| diff-match-patch | ~50 KB | with DiffBlock |
| tugdiff-wasm | ~150-300 KB | first DiffBlock |
| KaTeX core + fonts | ~350 KB | first `$...$` or fenced math |
| Mermaid core | ~600 KB | first ` ```mermaid ` |
| Mermaid diagram packs (per type) | 100-200 KB | first encounter of that diagram type |

A Tide card with no diagrams, no math, no diffs, no code blocks pays only the tugmark-wasm + ansi_up cost on boot.

**Table T07: Token-slot enumeration** {#t07-token-slots}

Per L19/L20, every component owns a slot. Slot prefix → component:

| Slot prefix | Component(s) |
|-------------|--------------|
| `--tugx-md-*` | MarkdownBlock (existing — extended) |
| `--tugx-term-*` | TerminalBlock |
| `--tugx-diff-*` | DiffBlock |
| `--tugx-file-*` | FileBlock |
| `--tugx-paths-*` | PathListBlock |
| `--tugx-search-*` | SearchResultBlock |
| `--tugx-json-*` | JsonTreeBlock |
| `--tugx-todo-*` | TodoListBlock |
| `--tugx-agent-*` | AgentTranscriptBlock |
| `--tugx-image-*` | ImageBlock |
| `--tugx-mermaid-*` | MermaidBlock |
| `--tugx-katex-*` | KaTeXBlock |
| `--tugx-tabrich-*` | TableBlock (rich) |
| `--tugx-toolblock-*` | shared tool-wrapper chrome |
| `--tugx-thinking-*` | ThinkingBlock |
| `--tugx-perm-*` | PermissionDialog |
| `--tugx-quest-*` | QuestionDialog |
| `--tugx-cost-*` | CostChrome |
| `--tugx-banner-*` | SessionInitBanner |
| `--tugx-err-*` | ErrorBlock |
| `--tugx-caut-*` | CautionBadge |

**List L01: Pulldown-cmark options enabled (existing + new)** {#l01-cmark-options}

- ENABLE_TABLES (existing)
- ENABLE_STRIKETHROUGH (existing)
- ENABLE_TASKLISTS (existing)
- ENABLE_FOOTNOTES (new — typography upgrade)
- ENABLE_SMART_PUNCTUATION (new — typography upgrade)

**List L02: Block transformers shipped this phase** {#l02-block-transformers}

- mermaidTransformer
- mathTransformer (display)
- diffTransformer
- largeJsonTransformer

**List L03: Layer-1 body kinds (one-line names)** {#l03-body-kinds}

MarkdownBlock, TerminalBlock, DiffBlock, FileBlock, PathListBlock, SearchResultBlock, JsonTreeBlock, TodoListBlock, AgentTranscriptBlock, ImageBlock, MermaidBlock, KaTeXBlock, TableBlock, PlainTextBlock.

**List L04: Layer-2 tool wrappers (one-line names)** {#l04-tool-wrappers}

ReadToolBlock, WriteToolBlock, EditToolBlock, BashToolBlock, GlobToolBlock, GrepToolBlock, TaskToolBlock, WebFetchToolBlock, WebSearchToolBlock, TodoWriteToolBlock, NotebookEditToolBlock, DefaultToolWrapper.

**List L05: Stream-event chrome renderers (one-line names)** {#l05-chrome}

ThinkingBlock, PermissionDialog, QuestionDialog, CostChrome (with CostBadge sub-component), SessionInitBanner, ErrorBlock, CautionBadge.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New crates {#new-crates}

| Crate | Purpose |
|-------|---------|
| `tugdiff-wasm` | Rust crate at `tugdeck/crates/tugdiff-wasm/`; exposes `imara-diff` to JS as `parse_unified_diff(text: &str) -> Vec<DiffHunk>` and `two_text_diff(before: &str, after: &str) -> Vec<DiffHunk>` |

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/cards/tide-assistant-renderer-dispatch.ts` | [D01] dispatch module |
| `tugdeck/src/components/tugways/cards/tide-assistant-renderer-dispatch.test.ts` | dispatch unit tests |
| `tugdeck/src/components/tugways/cards/tool-wrappers/{read,write,edit,bash,glob,grep,task,web-fetch,web-search,todo-write,notebook-edit,default}-tool-block.{tsx,css}` | tool wrappers (12 × 2 = 24 files) |
| `tugdeck/src/components/tugways/cards/tool-wrappers/tool-wrapper-chrome.{tsx,css}` | shared chrome |
| `tugdeck/src/components/tugways/body-kinds/{terminal,diff,file,path-list,search-result,json-tree,todo-list,agent-transcript,image,mermaid,katex,table,plain-text}-block.{tsx,css}` | body kinds (13 × 2 = 26 files) |
| `tugdeck/src/components/tugways/chrome/tide-thinking-block.{tsx,css}` | [D14] |
| `tugdeck/src/components/tugways/chrome/tide-permission-dialog.{tsx,css}` | [D13] |
| `tugdeck/src/components/tugways/chrome/tide-question-dialog.{tsx,css}` | [D13] |
| `tugdeck/src/components/tugways/chrome/tide-cost-chrome.{tsx,css}` | per-turn + cumulative |
| `tugdeck/src/components/tugways/chrome/tide-session-init-banner.{tsx,css}` | [D03] |
| `tugdeck/src/components/tugways/chrome/tide-error-block.{tsx,css}` | error rendering |
| `tugdeck/src/components/tugways/chrome/tide-caution-badge.{tsx,css}` | [D04] |
| `tugdeck/src/lib/markdown/block-transformers/{mermaid,math,diff,large-json}-transformer.ts` | [D07] |
| `tugdeck/src/lib/markdown/block-transformers/inline-math-walker.ts` | inline `$...$` detection |
| `tugdeck/src/lib/ansi/ansi-to-html.ts` | ansi_up wrapper |
| `tugdeck/src/lib/lazy/{load-katex,load-mermaid,load-tugdiff-wasm}.ts` | [D10] lazy loaders |
| `tugdeck/src/__tests__/assistant-rendering-fixture-replay.test.tsx` | Spec S06 |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `AssistantRendererDispatch` | interface | dispatch.ts | Spec S01 |
| `DispatchResult` | interface | dispatch.ts | Spec S01 |
| `DispatchContext` | interface | dispatch.ts | Spec S01 |
| `BodyKindProps<T>` | interface | shared types | Spec S02 |
| `ToolWrapperProps<I,O>` | interface | shared types | Spec S03 |
| `ToolWrapperFactory` | type | shared types | Spec S03 |
| `BlockTransformer` | interface | block-transformers/index.ts | Spec S04 |
| `BlockTransformContext` | interface | block-transformers/index.ts | Spec S04 |
| `parseMarkdownToSanitizedBlocks` | fn (modify) | parse-markdown-to-sanitized-blocks.ts | gain optional `transformers` param [D07] |
| `parser_options` | fn (modify) | tugmark-wasm/src/lib.rs | enable FOOTNOTES + SMART_PUNCTUATION [L01] |
| `toolWrapperRegistry` | const Map | dispatch.ts | [D16] |
| `parse_unified_diff` | wasm fn | tugdiff-wasm/src/lib.rs | [D09] |
| `two_text_diff` | wasm fn | tugdiff-wasm/src/lib.rs | [D09] |

---

### Documentation Plan {#documentation-plan}

- [ ] Update `tide.md` §Phase T1 — Content Block Types: replace the stub bullet list with a back-link to this plan and a one-paragraph summary.
- [ ] Update `tugplan-tide-card-polish.md` §Step 12 and §Step 13: mark as absorbed by this plan and link forward.
- [ ] Add a section to `tugdeck/README.md` describing the body-kind / tool-wrapper architecture and the dispatch module's public API.
- [ ] Add a developer guide at `tugdeck/src/components/tugways/body-kinds/README.md` explaining how to add a new body kind (file-pair convention, token slot, streaming contract).
- [ ] Add a developer guide at `tugdeck/src/components/tugways/cards/tool-wrappers/README.md` for adding a new tool wrapper (registry entry, alias declaration, body composition).
- [ ] Add a guide at `tugdeck/crates/tugdiff-wasm/README.md` matching the `tugmark-wasm` pattern (Cargo.toml conventions, build commands, exported API).
- [ ] Update `tuglaws/INDEX.md` if any new tuglaws are introduced (none anticipated; this plan is implementation, not law).

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Unit** | Test individual body kinds, wrappers, transformers, dispatch functions in isolation | Per-component happy paths and edge cases |
| **Integration (fixture replay)** | Replay every stream-json fixture into a Tide card and verify rendering | Per Spec S06; the load-bearing success-criteria test |
| **Snapshot (theme)** | Visual snapshot of every component in both `brio` and `harmony` | Theme drift detection |
| **Gallery rendering** | Each gallery card mounts and renders all its mock variants under both themes | [#step-14-5](#step-14-5) and [#step-29-5](#step-29-5) verification |
| **app-test** | Full-app harness for focus / selection / event-ordering scenarios | Permission/Question dialog focus management; expand/collapse interactions |
| **Drift Prevention** | Synthetic-drift fixtures that introduce unknown tools, unknown shapes, version mismatches | Verify [D04] caution badge and `DefaultToolWrapper` fallback |
| **Performance** | Microbenchmarks for diff parse, ANSI parse, and high-frequency streaming | Verify [R03], [R06], inform [Q02] |

---

### Execution Steps {#execution-steps}

> **Commit after all checkpoints pass.** Each step is one commit. Integration checkpoint steps use `Commit: N/A (verification only)`.

#### Step 0: Empirical session audit {#step-0}

<!-- Step 0 has no dependencies. Runs concurrently with Step 1+; later steps reference its output to calibrate thresholds. -->

**Commit:** `docs(tide-rendering): empirical session audit — frequency tables and threshold calibration`

**References:** [Q04] (terminal-cap calibration), [D02] (virtualization threshold), [Table T01](#t01-body-kinds) (collapse thresholds), [D10] (lazy-load justification), (#success-criteria)

**Artifacts:**
- New `roadmap/tide-assistant-rendering-session-audit.md` capturing the audit results
- Optional helper script `tugdeck/scripts/audit-claude-sessions.ts` (or a Bash + jq pipeline; deletable after the audit)
- The audit document is the load-bearing artifact; it informs but does not gate later steps

**Tasks:**
- [x] Walk every `*.jsonl` file under `~/.claude/projects/-Users-kocienda-Mounts-u-src-tugtool/` (1,031 files, 232,031 JSONL lines, 0 parse errors as of 2026-05-08)
- [x] Compute frequency distribution of `tool_use` events by `tool_name` — produces a percentage table that calibrates which wrappers ship bespoke vs. through `DefaultToolWrapper`
- [x] Compute size distributions (P50/P95/P99) for: Read line count, Bash `stdout` line count, Edit `(old_string, new_string)` line counts, Glob result count, agent transcript depth — calibrates collapse thresholds in [Table T01](#t01-body-kinds) and [Q04]
- [x] Enumerate any tools in real sessions that aren't in [Table T02](#t02-tool-wrappers) — 11 new tool names found; dispositions captured in audit §4.2
- [x] Count occurrences of fenced-code-block languages in `assistant_text` — Mermaid 0%, math 1.4%, validates [D10] lazy-load decisively
- [ ] ~~Count `control_request_forward` events~~ — *Not measurable from session-log format; requires wire-level capture; documented as limitation in audit §6*
- [x] Count `is_error: true` ratios per tool — informs error-state design in every wrapper
- [x] Subagent depth in real sessions — max observed = 1; [D17] depth cap of 3 is generous; default could drop to 2 safely
- [x] Write up findings as a frequency-table appendix in the new audit doc; cross-reference each subsequent step's calibration-relevant tasks

**Tests:**
- [x] N/A — research artifact, not code

**Checkpoint:**
- [x] Audit doc reviewed; threshold-calibration table captured at [§5.1 of audit](./tide-assistant-rendering-session-audit.md)
- [x] All 11 tools surfaced by audit but missing from [Table T02](#t02-tool-wrappers) added below as audit-confirmed `DefaultToolWrapper` routes; [D16] alias map updated; [#step-7](#step-7) collapse threshold updated; [Q04] resolved

---

#### Step 1: Renderer dispatch infrastructure {#step-1}

**Commit:** `feat(tide-rendering): add assistant-renderer-dispatch module and registry scaffolding`

**References:** [D01], [D11], [D16], Spec S01, (#architecture-mental-model)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/tide-assistant-renderer-dispatch.ts`
- `tugdeck/src/components/tugways/cards/tide-assistant-renderer-dispatch.test.ts`
- Shared `BodyKindProps` / `ToolWrapperProps` / `ToolWrapperFactory` types in `tugdeck/src/components/tugways/cards/tool-wrappers/types.ts`
- A no-op `DefaultToolWrapper` (just enough to pass the dispatch test; full body lands in [#step-13](#step-13))

**Tasks:**
- [x] Define `AssistantRendererDispatch`, `DispatchResult`, `DispatchContext` per Spec S01 (Spec S01 reconciled with real `TurnEntry` shape — input is `RenderInput` discriminated union, not raw `TurnEntry`)
- [x] Build `toolWrapperRegistry: Map<string, ToolWrapperFactory>` keyed lowercase per [D16]
- [x] Build alias map per [D16] — `multiedit → edit` and `task → agent` (historical rename per audit §4.3)
- [x] Implement `dispatch(input, context)`: routes by `input.kind`; for `tool_call`, looks up by lowercased `toolCall.toolName`; falls back to `DefaultToolWrapper` per [D11] with `caution: { reason: "unknown_tool" }`; suppresses caution for the audit-confirmed default-routed tools
- [x] Implement `resolveToolWrapper(name)` and `registeredTools()`
- [x] Implement scaffold-only `DefaultToolWrapper` rendering tool_name + "(default)" marker; full body lands at [#step-13](#step-13)

**Tests:**
- [x] `dispatch.test`: dispatch an `assistant_text` input → `KIND_RENDERERS.assistant_text` (the per-kind scaffold; replaced wholesale by the real renderer at [#step-3](#step-3))
- [x] `dispatch.test`: dispatch a `tool_call` with unknown name → `DefaultToolWrapper` + caution `{ reason: "unknown_tool" }`
- [x] `dispatch.test`: alias resolution — `MultiEdit` / `multiedit` / `MULTIEDIT` all resolve to the registered `edit` wrapper; `Task` / `task` resolve to the registered `agent` wrapper
- [x] `dispatch.test`: case-insensitive lookup — `Read` / `READ` / `reAd` all resolve identically
- [x] `dispatch.test`: audit-confirmed default-routed tools (e.g., `TaskUpdate`) → `DefaultToolWrapper` *without* caution (suppressed by design)
- [x] `dispatch.test`: store status `pending`/`error` map to wrapper status `streaming`/`error` and `isError` flag; canonical wrapper props (`toolUseId`, `toolName`, `msgId`, `input`, `structuredResult`) are threaded onto the prop bag
- [x] 19 tests, 38 assertions — all pass

**Checkpoint:**
- [x] `bun x tsc --noEmit` — clean
- [x] `bun test src/components/tugways/cards/tide-assistant-renderer-dispatch.test.ts` — 19 pass / 0 fail
- [x] `bun run audit:tokens lint` — zero violations
- [x] Full test suite still green (3,169 pass, 0 fail across 188 files)

---

#### Step 2: Markdown typography pass (subsumes card-polish §Step 12) {#step-2}

**Depends on:** #step-1

**Commit:** `style(tide-rendering): tune --tugx-md-* tokens for both brio and harmony themes`

**References:** [D15], [Table T07](#t07-token-slots), [tugplan-tide-card-polish.md §Step 12](./tugplan-tide-card-polish.md#step-12), (#success-criteria)

**Artifacts:**
- `tugdeck/styles/themes/brio.css` (extended `--tugx-md-*` slots)
- `tugdeck/styles/themes/harmony.css` (extended `--tugx-md-*` slots)
- `tugdeck/src/components/tugways/tug-markdown-view.css` and `tug-markdown-block.css` adjustments if needed for new slots

**Tasks:**
- [x] Define and tune token values for: paragraph, headings (h1-h6 with descending weight scale + muted h6), inline code, fenced code chrome, bold/italic, strikethrough, blockquote, hr, ul/ol (incl. task-list checkboxes), table (with header bg + alternate-row stripe), link (rest + hover), footnote, image
- [x] Vertical rhythm: paragraph margins (0.6em), heading margins (1.4em top, 0.4em bottom, first-child reset to 0), list indent (1.75em), code-block padding (md-lg from spacing scale)
- [x] Both themes: brio (dark) and harmony (light) declare the same `--tugx-md-*` token vocabulary; theme-as-sole-source — no fallback literals in the markdown CSS (the lone exception being `--tugx-md-block-padding-x` per its module docstring); rgba directions flipped per-theme for backgrounds/dividers
- [x] Mark `tugplan-tide-card-polish.md §Step 12` as absorbed (link back to this plan)

**Tests:**
- [x] `tug-markdown-typography.test.ts` — parser-output coverage for a representative markdown document (headings h1-h6, paragraphs, strong/em/del, links, fenced code with language class, blockquote with nested emphasis, hr, nested bullet list, ordered list, task lists, table with thead+tbody, image with alt+src) plus block-decomposition assertions (each heading is its own block; tables/lists carry rowCount/itemCount metadata)
- [x] `tide-md-token-coverage.test.ts` — guards the contract that brio.css and harmony.css declare the same set of `--tugx-md-*` tokens; every token referenced by the markdown CSS is declared in both themes; spot-check covers every typography axis; theme is the sole source (no fallback literals except the documented `--tugx-md-block-padding-x` exception)
- [x] `bun run audit:tokens lint` exits 0

**Checkpoint:**
- [x] `bun x tsc --noEmit` — clean
- [x] `bun test` — full suite 3,188 pass / 0 fail across 190 files (19 new typography assertions added)
- [x] `bun run audit:tokens lint` — zero violations
- [x] Both `brio` and `harmony` themes verified by `tide-md-token-coverage.test.ts` covering token equality + reference completeness

---

#### Step 3: MarkdownBlock extensions — block-transformer pass + footnotes + smart-punct {#step-3}

**Depends on:** #step-2

**Commit:** `feat(tide-rendering): block-transformer pass + pulldown-cmark footnotes + smart-punctuation`

**References:** [D07], Spec S04, List L01, List L02, (#block-transformer-pass)

**Scope note (deferred):** The "collapse-tall-block" affordance originally bundled in this step is deferred pending UX direction — controls at the top vs. bottom of long sections both have ergonomic issues that need a deliberate design pass. Nothing downstream depends on the collapse work (#step-12 / #step-13 / #step-15 only consume the block-transformer pass), so the deferral is structural-cost-zero. When picked back up, it gets its own step with `--tugx-md-collapse-*` tokens declared in both themes and its own gallery card.

**Artifacts:**
- `tugdeck/crates/tugmark-wasm/src/lib.rs` (extended `parser_options`)
- `tugdeck/src/lib/markdown/block-transformers/index.ts`
- `tugdeck/src/lib/markdown/block-transformers/{mermaid,math,diff,large-json}.ts` (no-op stubs; populated in later steps when consumed)
- `tugdeck/src/lib/markdown/parse-markdown-to-sanitized-blocks.ts` (gains `transformers` param)
- `tugdeck/src/lib/markdown/dompurify-instance.ts` (allow `div` for `footnote-definition`)

**Tasks:**
- [x] Enable `Options::ENABLE_FOOTNOTES` and `Options::ENABLE_SMART_PUNCTUATION` in `tugmark-wasm`
- [x] Define `BlockTransformer` and `BlockTransformContext` interfaces per Spec S04
- [x] Add optional `transformers: BlockTransformer[]` parameter to `parseMarkdownToSanitizedBlocks`; flat-map each block through every transformer in order, with `BlockTransformContext.isComplete` for streaming-aware deferral per [D07]
- [x] Create no-op stub transformer files for mermaid / math / diff / large-json so the dispatch contract compiles; consuming steps populate the bodies
- [x] Allow `div` in DOMPurify so pulldown-cmark's `<div class="footnote-definition" id="N">` keeps its `id` for fragment back-references

**Tests:**
- [x] Footnote markdown round-trips through pulldown-cmark and produces the expected `<sup class="footnote-reference">` + `<div class="footnote-definition" id="…">` chrome (`cmark-extensions.test.ts`)
- [x] Smart-punctuation: `--` / `---` produce en/em-dashes, straight quotes become curly quotes, `...` becomes `…` (`cmark-extensions.test.ts`)
- [x] Block transformer pass: a no-op transformer leaves blocks identical; a swap-type transformer changes a block's `type`; a split transformer produces multiple blocks; an empty-result transformer drops a block; transformer order is preserved when chained (`block-transformers.test.ts`)
- [x] `BlockTransformContext.isComplete` propagates from `parseMarkdownToSanitizedBlocks(text, { isComplete: false })` into each transformer invocation (`block-transformers.test.ts`)

**Implementation note:** Footnote ref ↔ definition linking only works when pulldown-cmark sees the whole document at parse time. The original pipeline parsed each block independently (sliced byte-range → `parse_to_html`), which left `[^name]` references rendering as plaintext. To fix this, a new `parse_blocks_to_html(text)` was added to `tugmark-wasm` — it walks the document in a single parser pass, buckets events into top-level blocks, and emits per-block HTML. `parseMarkdownToSanitizedBlocks` now zips `lex_blocks`'s metadata with `parse_blocks_to_html`'s HTML; the per-block `parse_to_html` is preserved for the incremental update path in `TugMarkdownView`.

**Checkpoint:**
- [x] `cd tugdeck/crates/tugmark-wasm && cargo build --target wasm32-unknown-unknown --release` — clean
- [x] `cd tugdeck && bun x tsc --noEmit` — clean
- [x] `cd tugdeck && bun test src/lib/markdown` — 45 pass / 0 fail (4 files)
- [x] Full suite: `cd tugdeck && bun test` — 3227 pass / 0 fail (194 files); `bun run audit:tokens lint` — zero violations

---

#### Step 4: ThinkingBlock + wire `streamingPaths.thinking` {#step-4}

**Depends on:** #step-1, #step-2

**Commit:** `feat(tide-rendering): ThinkingBlock — inline collapsible thinking with default-collapse-on-complete`

**References:** [D14], Spec S05, [tugplan-tide-card-polish.md §Step 13](./tugplan-tide-card-polish.md#step-13), (#chrome)

**Artifacts:**
- `tugdeck/src/components/tugways/chrome/tide-thinking-block.tsx` + `.css`
- Wire-up in `tide-card.tsx` to consume `streamingPaths.thinking`

**Tasks:**
- [x] New token slot `--tugx-thinking-*` per [Table T07](#t07-token-slots), tuned for both themes (brio + harmony) — bg / border / radius / margin / header padding+gap+hover / label color+size+weight / chevron color / preview color+size+weight / content padding+color+size+style / collapse duration+easing / focus ring
- [x] Streaming binding to `streamingPaths.thinking` per Spec S05 — chrome subscribes for preview text + visibility, body composes `TugMarkdownBlock` which subscribes for prose, both rAF-coalesced and unsubscribe on unmount
- [x] Collapse animation via `grid-template-rows: 0fr ↔ 1fr` (no max-height cap), `prefers-reduced-motion: reduce` disables transition
- [x] Snap-to-collapsed on parent turn `complete` per [D14] — implemented by the row swap: streaming cell unmounts, committed cell mounts a fresh `TideThinkingBlock` with the static-mode default-collapsed
- [x] User-expanded state persists for the cell's lifetime via React state; remount restores the mode default

**Tests:**
- [x] Renders streaming thinking text incrementally — `tide-thinking-block.test.tsx` `becomes visible after the first non-empty store emission`, `preview text updates on subsequent emissions`
- [x] On `turn_complete`, the new cell's static-mode block mounts default-collapsed with first-line preview — `non-empty initialText → strip is visible and default-collapsed [D14]`, `preview is the computed first-line summary`
- [x] User expand persists across stream deltas — `user can collapse a streaming block; toggle persists for the cell's lifetime`
- [x] Unmount unsubscribes — `unmount unsubscribes — subsequent store writes do not throw or schedule rAF`
- [x] `computePreview` unit pass: empty / leading-blank / whitespace-only / interior-collapse / truncation
- [x] Both themes declare the full `--tugx-thinking-*` token set (enforced via existing `audit:tokens lint`)

**Checkpoint:**
- [x] `cd tugdeck && bun x tsc --noEmit` — clean
- [x] `cd tugdeck && bun test` — 3247 pass / 0 fail (195 files); 20 new tests
- [x] `cd tugdeck && bun run audit:tokens lint` — zero violations
- [ ] Manual: replay `test-22-subagent-spawn.jsonl` in a Tide card; verify thinking renders, then collapses (deferred to user — HMR is always running)

---

#### Step 5: TerminalBlock body kind {#step-5}

**Depends on:** #step-1

**Commit:** `feat(tide-rendering): TerminalBlock — ANSI-aware streaming terminal renderer with virtualization`

**References:** [D02], [D06], [Q04], Spec S02, Spec S05, (#streaming-matrix)

**Artifacts:**
- `tugdeck/src/components/tugways/body-kinds/terminal-block.tsx` + `.css`
- `tugdeck/src/lib/ansi/ansi-to-html.ts` (ansi_up wrapper)
- Token slot `--tugx-term-*` for both themes
- `bun add ansi_up` to package.json

**Tasks:**
- [x] Implement ANSI parsing via `ansi_up` (v6.0.6, MIT); expose `ansiToHtml(text: string): string` in `lib/ansi/ansi-to-html.ts` — fresh `AnsiUp` instance per call (no cross-call SGR state), `use_classes = true` so 16-color SGR codes emit `class="ansi-{color}-fg|bg"` markup that the `--tugx-term-ansi-*` token slots paint
- [x] TerminalBlock with stdout/stderr split; per-line `<div class="tugx-term-line tugx-term-line--{stdout|stderr}">`, ANSI SGR parsed into theme-mapped spans
- [x] Streaming binding per Spec S05 — `useLayoutEffect` G1 sync read on mount, `observe()` for updates, `requestAnimationFrame`-coalesced re-parse on each delta, unsubscribe + cancel pending rAF on unmount
- [x] Self-virtualization at `VISIBLE_THRESHOLD = 40` lines using `BlockHeightIndex` + `RenderedBlockWindow` — explicit-height scroll container, top + bottom spacers reflect prefix-sum heights, scroll listener diffs windowed range and applies enter/exit ranges to the DOM imperatively
- [x] Truncation indicator at top — `"… N earlier lines truncated"` banner when total parsed lines exceed `RETAINED_LINE_CAP = 10_000` ([Q04])
- [x] Copy-to-clipboard button overlaid on the body, fades in on hover, writes composed `stdout + "\n" + stderr` text, toggles `is-copied` for ~1.2s
- [x] Footer: `exit ${code}` badge (zero subtle, non-zero strong via separate token slots), `interrupted` indicator, `formatDuration(ms)` mm:ss / N s / N ms

**Tests:**
- [x] ANSI: `\x1b[31mred\x1b[0m` produces `<span class="ansi-red-fg">red</span>` (`ansi-to-html.test.ts`)
- [x] Stream: deltas accumulate without flicker — rAF coalesces a 3-emission burst into one render, final value reflects cumulative content (`terminal-block.test.tsx`)
- [x] Virtualization: 200-line input switches to scroller with spacers; rendered DOM lines < total (`terminal-block.test.tsx`)
- [x] Truncation: `RETAINED_LINE_CAP + 5` lines produces the indicator with the exact dropped count (`terminal-block.test.tsx`)
- [x] Footer variants: exit-zero subtle, exit-nonzero strong, interrupted badge, duration formatted, footer-only data (no body) still renders the post-mortem badges (`terminal-block.test.tsx`)
- [x] Copy interaction: writes composed text, toggles `is-copied`, no-throw when `navigator.clipboard` is missing (`terminal-block.test.tsx`)
- [x] Both themes declare the full `--tugx-term-*` token set including the 16 ANSI palette slots — enforced via `audit:tokens lint`; ANSI palette uses `--tug-color()` recipes so the postcss plugin expands them at build time and the "zero standalone hex" gate (`step8-roundtrip-integration.test.ts`) stays green

**Checkpoint:**
- [x] `cd tugdeck && bun x tsc --noEmit` — clean
- [x] `cd tugdeck && bun test src/lib/ansi src/components/tugways/body-kinds` — 39 pass / 0 fail (14 + 25)
- [x] `cd tugdeck && bun test` — 3286 pass / 0 fail (197 files)
- [x] `cd tugdeck && bun run audit:tokens lint` — zero violations

---

#### Step 6: BashToolBlock wrapper {#step-6}

**Depends on:** #step-1, #step-5

**Commit:** `feat(tide-rendering): BashToolBlock — composes TerminalBlock with command/duration/exit chrome`

**References:** [D05], Spec S03, (#t02-tool-wrappers)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/tool-wrappers/bash-tool-block.tsx` + `.css`
- `tugdeck/src/components/tugways/cards/tool-wrappers/tool-wrapper-chrome.tsx` + `.css` (shared header/footer)
- Token slot `--tugx-toolblock-*` (shared) and the wrapper composes existing `--tugx-term-*`
- Registry entry in dispatch.ts

**Tasks:**
- [x] Shared `ToolWrapperChrome` component (`tool-wrapper-chrome.{tsx,css}`) — header (icon slot + tool name + args summary + inline caution badge) + body slot + optional inline error message + footer slot for badges; `data-status` attribute on the root drives streaming / ready / error stripe coloring; exports a `<StreamingPlaceholder />` companion for wrappers that paint a placeholder body while input streams in
- [x] `BashToolBlock` (`bash-tool-block.{tsx,css}`) — header shows the command from `input.command` as a `<code>` args summary (CSS truncate-with-hover-expand; full Shiki shell-syntax highlight is a follow-up polish since pulling in shell highlighting for one inline phrase is heavy compared to the truncate-and-expand affordance); footer renders synthesized exit badge + interrupted badge + duration
- [x] Body: `TerminalBlock` fed from `tool_use_structured.{stdout,stderr}` with `tool_result.output` as the `stdout` fallback when `tool_use_structured` is absent (older catalog versions / drift)
- [x] Status placeholder during stream — `status === "streaming"` swaps the body for `<StreamingPlaceholder />`; the chrome's left-edge stripe paints the streaming color so the row reads as in-flight at a glance
- [x] Token slot `--tugx-toolblock-*` declared in both themes (bg / border / radius / margin / status stripes / header / icon / name / args / caution / error band / footer / streaming placeholder); the wrapper composes the existing `--tugx-term-*` tokens for body chrome
- [x] Registry entry — `registerToolWrapper("bash", BashToolBlock)` runs at the bottom of `tide-assistant-renderer-dispatch.ts` (after `registerToolWrapper` is defined) so the import graph stays one-directional (dispatch → wrapper → chrome → types). Dispatch also gained an `extractTextOutput` helper that reads `tool_result.output` into `ToolWrapperProps.textOutput` as the structured-result fallback

**Tests:**
- [x] Bash fixture shape — props matching `test-09-bash-auto-approved.jsonl`'s `{ input: { command }, structured_result: { stdout, stderr, interrupted: false } }` render BashToolBlock with the command in the header, stdout in the body, exit 0 (zero subtle) in the footer (`bash-tool-block.test.tsx`)
- [x] Synthetic non-zero exit — `isError: true` with empty stderr renders the exit-1 (nonzero strong) badge with `data-exit="nonzero"` (`bash-tool-block.test.tsx`)
- [x] Interrupted: `structured_result.interrupted === true` replaces the exit badge with the interrupted indicator (`bash-tool-block.test.tsx`)
- [x] (no output) hint: success path with empty stdout/stderr surfaces a "(no output)" footer hint so the row doesn't read as missing data (`bash-tool-block.test.tsx`)
- [x] Streaming: `status === "streaming"` renders `<StreamingPlaceholder />`, NOT `<TerminalBlock />` (`bash-tool-block.test.tsx`)
- [x] Error band: `status === "error"` with a plain-text `tool_result.output` paints the chrome error stripe and surfaces the message inline (`bash-tool-block.test.tsx`)
- [x] Caution: `caution: { reason, detail }` paints the inline caution badge in the header and stamps `data-caution` on the root (`bash-tool-block.test.tsx`)
- [x] Helpers: `composeTerminalData` derives the `TerminalData` payload (structured / fallback / synthetic exit / interrupt suppression of exit); `formatBashDuration` covers ms / s / m formatting (`bash-tool-block.test.tsx`)
- [x] Dispatch resolution: `resolveToolWrapper("Bash" | "bash" | "BASH")` returns `BashToolBlock` (`bash-tool-block.test.tsx`)

**Checkpoint:**
- [x] `cd tugdeck && bun x tsc --noEmit` — clean
- [x] `cd tugdeck && bun test src/components/tugways/cards/tool-wrappers` — 20 pass / 0 fail
- [x] `cd tugdeck && bun test` — 3306 pass / 0 fail (198 files)
- [x] `cd tugdeck && bun run audit:tokens lint` — zero violations
- [ ] Manual: invoke `> use bash to echo hello` against live tugcode; verify rendering (deferred to user — HMR is always running) — *blocked at Step 6 because the transcript view never rendered `turn.toolCalls`; resolved by [#step-6-5](#step-6-5)*

---

#### Step 6.5: Transcript wire-through for tool calls (committed + streaming) {#step-6-5}

**Depends on:** #step-1, #step-6

**Commit:** `feat(tide-rendering): render turn.toolCalls + inflight.tools in the transcript`

**References:** [D01], [D05], [D11], [D12], [L02], Spec S01, Spec S03, (#architecture-mental-model)

**Why this step exists.** Steps 1-6 built the dispatch + the BashToolBlock wrapper, but `tide-card-transcript.tsx` never iterates `turn.toolCalls` — the row body only renders thinking, assistant text, and the Interrupted badge. As a result, even though `registerToolWrapper("bash", BashToolBlock)` runs at the bottom of `tide-assistant-renderer-dispatch.ts`, the wrapper never mounts in the live UI: the import graph from the transcript view never reaches the dispatch module, and even if it did, no caller ever maps `turn.toolCalls` to rendered components. Manual smoke testing of [#step-6](#step-6) ("use bash to echo hello") confirmed the gap — the CLI shows `Bash(echo hello) / └─ hello`, but Tide shows only the assistant's "hello" summary. This sub-step closes that gap once for every wrapper that ships in this phase, so [#step-7](#step-7) (FileBlock), [#step-8](#step-8) (ReadToolBlock), [#step-11](#step-11) (EditToolBlock), and the rest become live-visible the moment they register, with no further plumbing.

**Decision: render-order in the row body.** Within a single `code` row the natural reading order is `thinking → tool calls → assistant`. The CLI mirrors this: `Bash(echo hello) / └─ hello` (the tool call) then `hello` (the assistant's summary). Real conversations interleave assistant_text spans with tool_use events at finer granularity, but interleaving requires a fundamentally different data shape than `TurnEntry` exposes today (it flattens `assistant` to a single string). v1 renders all tool calls between thinking and assistant. Future work — interleaving — is a separate concern that lands when the store learns to retain assistant_text spans alongside tool calls, and is explicitly out of scope here.

**Decision: streaming surface.** The reducer already serializes the in-flight `toolCallMap` to the streaming `PropertyStore` at path `inflight.tools` on every tool-call event (per `reducer.ts:serializeToolCalls`). The streaming row uses `useSyncExternalStore` (per [L02]) to subscribe to that path; on each emission the JSON string is parsed back into a `ToolCallState[]`, and each entry is routed through dispatch. React keys by `toolUseId` so a tool whose status transitions `pending → done` reconciles in place rather than remounting. Per-wrapper streaming (e.g., a tool that wants to paint its own incremental output) is NOT in scope here — the wrapper props (`input`, `structuredResult`, `status`) are computed from the snapshot and re-flow on every emission; that is sufficient for every wrapper this phase ships.

**Decision: streaming-to-committed handoff.** When `turn_complete` fires, the streaming row unmounts and the committed row mounts in its place. The streaming `<TranscriptToolCalls />` unmounts; the committed one mounts with `turn.toolCalls`. For BashToolBlock specifically: while `status === "streaming"` the wrapper paints `<StreamingPlaceholder />`; on the committed re-mount, `status === "ready"` so the wrapper paints `<TerminalBlock data={...} />`. Different React subtrees on each side of the transition → `TerminalBlock`'s mount-once contract is honored (it sees its `data` prop exactly once, at fresh mount). No special handling is required.

**Decision: import-graph fix as part of the wire-through.** Today the dispatch module is only reachable from test files and the wrapper itself, so the bottom-of-file `registerToolWrapper("bash", BashToolBlock)` never executes in production. Importing the dispatch from the new `<TranscriptToolCalls />` component is what causes those registrations to evaluate at module-load time in the live bundle. This is the simplest fix; no separate "registry bootstrap" module is introduced.

**Artifacts:**
- `tugdeck/src/components/tugways/cards/tide-card-transcript-tool-calls.tsx` + `.css` — new component with two modes (static `toolCalls` array, streaming `PropertyStore` + path)
- Edits to `tugdeck/src/components/tugways/cards/tide-card-transcript.tsx`:
  - `CodeCommittedRowCell` body inserts `<TranscriptToolCalls toolCalls={turn.toolCalls} msgId={turn.msgId} />` between thinking and assistant
  - `CodeStreamingRowCell` body inserts `<TranscriptToolCalls streamingStore={...} streamingPath={toolsStreamingPath} msgId={inflightMsgId} />` between thinking and assistant; gains `toolsStreamingPath` + `inflightMsgId` props
  - `TideTranscriptHost` plumbs `toolsStreamingPath` (from `snapshot.streamingPaths.tools`, memoized like its peers) and `inflightMsgId` (read from `snapshot.activeMsgId` via `useSyncExternalStore`)
- Optional minimal export from `tide-assistant-renderer-dispatch.ts`: a small helper that maps a `ToolCallState` + `msgId` to the `(Component, props)` pair. Today's `dispatch()` requires a `DispatchContext` ({store, session}) that the tool-call branch ignores; the helper avoids constructing a fake context at the call site. Name TBD during implementation (`composeToolCallRender`, `dispatchToolCallState`, etc.) — the choice is purely an internal API ergonomic.

**Tasks:**
- [x] Build `<TranscriptToolCalls />` with two mutually exclusive modes:
  - Static: `toolCalls: ReadonlyArray<ToolCallState>; msgId: string`
  - Streaming: `streamingStore: PropertyStore; streamingPath: string; msgId: string`
  - Streaming subscribes via `useSyncExternalStore`; the snapshot getter returns the parsed `ToolCallState[]` (with a stable empty-array sentinel when the path is empty / `"[]"` to keep `Object.is` stable across no-op emissions)
- [x] Map each `ToolCallState` through dispatch (or the new helper); render `<Component {...props} />` keyed by `toolUseId`
- [x] Container element `<div data-slot="tide-transcript-tool-calls">` for selectors; no own visible chrome — flex column. (No new `--tugx-*` token slot was needed: per-call vertical rhythm is owned by each wrapper's `--tugx-toolblock-margin`; the container is purely structural, so introducing a token slot would have been ceremony with no theme-tunable behavior to expose.)
- [x] CodeCommittedRowCell: insert the static-mode `<TranscriptToolCalls />` between `<TideThinkingBlock>` and `<TugMarkdownBlock>`. Render only when `turn?.toolCalls` is non-empty (avoid an empty container in the DOM for tool-free turns)
- [x] CodeStreamingRowCell: insert the streaming-mode `<TranscriptToolCalls />` between `<TideThinkingBlock>` and the streaming `<TugMarkdownBlock>`. The component itself self-hides when the parsed list is empty
- [x] Plumb `toolsStreamingPath` from `TideTranscriptHost` to `CodeStreamingRowCell` (mirrors `thinkingStreamingPath`)
- [x] Plumb `inflightMsgId` from `TideTranscriptHost` (read `snapshot.activeMsgId` via `useSyncExternalStore`) so streaming-row wrapper props have a stable `msgId`. Until `activeMsgId` is set the in-flight `msgId` is `""` — the wrapper consumers don't depend on identity for their visual output, so this is acceptable
- [x] Import the dispatch module from `<TranscriptToolCalls />` so module-load-time `registerToolWrapper(...)` calls execute in production (today only test imports trigger them)
- [x] Refactor: hoist the tool-call branch out of `dispatch()` and export it as `dispatchToolCallState(toolCall, msgId)`. The old internal `dispatchToolCall(input, _context)` ignored its context anyway; the public helper avoids fabricating a fake `DispatchContext` at call sites that only have a `ToolCallState` in hand. `dispatch()` now delegates to the helper for the `tool_call` branch.

**Tests:**
- [x] Pure-helper test: mapping `ToolCallState` of every `status` (`pending`, `done`, `error`) yields the expected wrapper status (`streaming`, `ready`, `error`) and `isError` flag; threading of `msgId` / `toolUseId` / `toolName` / `input` / `structuredResult`; `Bash → BashToolBlock` no caution; unknown tool name → `DefaultToolWrapper` + `caution { reason: "unknown_tool" }`
- [x] `TranscriptToolCalls` static mode — single Bash tool call: BashToolBlock mounts; container has the right `data-slot`; the rendered command appears in the wrapper header
- [x] `TranscriptToolCalls` static mode — unknown-tool entry: DefaultToolWrapper mounts and stamps `data-caution="unknown_tool"` on its root. (Full caution-badge chrome on `DefaultToolWrapper` lands at [#step-13](#step-13); the scaffold today only stamps the attribute, so this test pins the threading without anticipating that step's UI.)
- [x] `TranscriptToolCalls` static mode — multiple tool calls render in insertion order (`toolUseId` keys preserved)
- [x] `TranscriptToolCalls` static mode — empty `toolCalls`: renders nothing at all (no container in the DOM)
- [x] `TranscriptToolCalls` streaming mode — initial subscribe path: the snapshot is read synchronously on mount (G1 contract); the wrapper for the seed `inflight.tools` value paints before the first observer emission
- [x] `TranscriptToolCalls` streaming mode — emission path: emit a new `inflight.tools` value where the same `toolUseId` transitions `pending → done` with a `structuredResult`; assert the wrapper instance's container `data-slot` keeps the same DOM node (in-place reconciliation, not remount). Verified additionally that the BashToolBlock body flips from `<StreamingPlaceholder>` to `<TerminalBlock>` with the structured stdout rendered, and that adding a *new* tool call to the list keeps the existing wrapper's DOM node identical while appending the new one. This is happy-dom-safe because we're observing post-render DOM identity, not focus / event ordering.
- [x] Streaming mode — empty seed (`"[]"`): no DOM container.
- [x] Streaming mode — unsubscribe on unmount: setting a new value after unmount does not throw (no leaked listener).

**Manual:**
- [ ] Re-run the [#step-6](#step-6) deferred manual: in the live tugcode session, prompt `use bash to echo hello`. Expected: while the command runs, the streaming row paints a `<TranscriptToolCalls>` containing a Bash wrapper with the streaming-stripe and the placeholder body. After `turn_complete`, the committed row mounts the same wrapper with the structured `stdout: "hello"` rendered through `<TerminalBlock>`, and the assistant's summary follows below.
- [ ] On confirmation, check the [#step-6](#step-6) "Manual: invoke `> use bash to echo hello`…" checkbox.

**Checkpoint:**
- [x] `cd tugdeck && bun x tsc --noEmit && bun test` — typecheck clean; full suite **3359 pass / 0 fail across 200 files**
- [x] `cd tugdeck && bun run audit:tokens lint` — zero violations

---

#### Step 7: FileBlock body kind {#step-7}

**Depends on:** #step-1

**Commit:** `feat(tide-rendering): FileBlock — read-only file viewer with line numbers and language highlight`

**References:** [D05], Spec S02, (#t01-body-kinds)

**Artifacts:**
- `tugdeck/src/components/tugways/body-kinds/file-block.tsx` + `.css`
- Token slot `--tugx-file-*`

**Tasks:**
- [x] Line-numbered gutter; honor `startLine` offset
- [x] Language inferred from `filePath` extension; highlight via existing Shiki integration
- [x] Long-content collapse (**default folded if > 80 lines** per [audit §5.1](./tide-assistant-rendering-session-audit.md); audit shows Read P50 = 50 lines, so 50 was too aggressive — would fold half of all reads. 80 lines catches ~upper-40% which is the natural "long enough to scan-or-skip" bar.)
- [x] "Showing N of M lines" header
- [x] Click-line-to-copy
- [x] Search-within-file (Cmd+F) when expanded — scoped to the FileBlock instance, not the whole transcript

**Tests:**
- [x] Renders content with line numbers starting at `startLine`
- [x] Long file collapses
- [x] Language detection produces correct highlight class
- [x] Cmd+F inside an expanded FileBlock highlights matches and supports next/previous navigation — search markup verified in unit tests; full interactive flow (Cmd+F focus, typing, next/prev, Escape) belongs in a real-browser surface per the project's happy-dom test scoping rule, deferred to gallery/e2e

**Checkpoint:**
- [x] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 8: ReadToolBlock wrapper {#step-8}

**Depends on:** #step-1, #step-7

**Commit:** `feat(tide-rendering): ReadToolBlock — composes FileBlock with filePath and line-range chrome`

**References:** [D05], Spec S03

**Artifacts:**
- `tugdeck/src/components/tugways/cards/tool-wrappers/read-tool-block.tsx` + `.css`
- Registry entry

**Tasks:**
- [x] Header: `Read · {filePath}` (full path; chrome's args slot truncates with hover-expand) + line-range badge when `input.offset` / `input.limit` set (`lines N–M`, `from line N`, or `first N lines`)
- [x] Body: FileBlock (in `embedded` mode) from `tool_use_structured.file`; falls back to a synthesized `FileData` from `input.file_path` + `tool_result.output` when only the older catalog event lands
- [x] Footer: "Showing N of M lines" when `numLines < totalLines`; suppressed for full-file reads (no empty footer bar)
- [x] Streaming → `<StreamingPlaceholder />`; error → chrome's error band only (body suppressed so the failure message doesn't double-render with the FileBlock fallback)
- [x] FileBlock gained an `embedded` mode mirroring `TerminalBlock`: drops bg/border/radius/margin and hides its own header — the wrapper owns the file's identity in its own header. Reset values, no new tokens introduced. Search / collapse affordances are deferred to the wrapper UX (out of scope for v1).
- [x] Registry entry — `registerToolWrapper("read", ReadToolBlock)` added at the bottom of `tide-assistant-renderer-dispatch.ts` (one-directional import graph).
- [x] Drive-by fix on `BashToolBlock`: errored Bash no longer double-renders the failure message — the chrome's error band already shows it; the body is suppressed unless `structured.{stdout,stderr}` carries genuinely-distinct content.

**Tests:**
- [x] Pure helpers — `composeFileData` (structured, fallback, missing filePath, nothing renderable); `composeLineRangeBadge` (offset+limit, offset-only, limit-only, neither); `composeReadFooterHint` (subset, full read, unknown total)
- [x] Header — tool name + file path stamp; line-range badge appears with offset+limit; missing `file_path` suppresses args
- [x] Body — structured `file` shape lands on the embedded FileBlock with correct gutter / startLine / content; textOutput fallback drives the body when structured is absent; nothing-renderable drops the body
- [x] Footer — "Showing N of M lines" appears for windowed reads, suppressed for full reads
- [x] Streaming placeholder substitution; error suppresses body in favor of chrome error band
- [x] Caution badge surfaces from dispatch
- [x] Dispatch resolution: `resolveToolWrapper("Read" | "read" | "READ")` returns `ReadToolBlock`
- [x] Replay `test-05-tool-use-read.jsonl` (`v2.1.112`) end-to-end through `CodeSessionStore` → committed `TurnEntry.toolCalls[0]` routes through `dispatchToolCallState` → `<ReadToolBlock {...props} />` renders with the fixture's `file_path`, three-line embedded FileBlock, gutter starting at 1, "Showing 3 of 55 lines" footer

**Checkpoint:**
- [x] `cd tugdeck && bun x tsc --noEmit && bun test` — typecheck clean; full suite **3384 pass / 0 fail across 202 files**
- [x] `cd tugdeck && bun run audit:tokens lint` — zero violations

---

#### Step 9: tugdiff-wasm crate {#step-9}

**Depends on:** #step-1

**Commit:** `feat(tugdiff-wasm): new crate exposing imara-diff to JS via wasm-bindgen`

**References:** [D06], [D09], (#new-crates)

**Artifacts:**
- `tugdeck/crates/tugdiff-wasm/Cargo.toml`
- `tugdeck/crates/tugdiff-wasm/src/lib.rs`
- `tugdeck/crates/tugdiff-wasm/README.md`
- `tugdeck/crates/tugdiff-wasm/pkg/` (built artifact, .gitignored if convention follows tugmark-wasm)
- Vite config extension if needed

**Tasks:**
- [x] Cargo manifest mirroring `tugmark-wasm`'s pattern; add `imara-diff = "..."` and `wasm-bindgen`
- [x] Export `parse_unified_diff(text: &str) -> JsValue` (JSON-serialized hunks)
- [x] Export `two_text_diff(before: &str, after: &str) -> JsValue` (JSON-serialized hunks)
- [x] Build script + bun command analogous to tugmark-wasm
- [x] README describing the API

**Tests:**
- [x] Rust-side: `parse_unified_diff` round-trips a known fixture
- [x] Rust-side: `two_text_diff` produces correct hunks for a known input pair
- [x] -D warnings clean

**Checkpoint:**
- [x] `cd tugrust && cargo build -p tugdiff-wasm` (if path-included) — or invoke the crate's bun-driven build (n/a from workspace; built via `just wasm` / `wasm-pack build --target web --release tugdeck/crates/tugdiff-wasm` — produces `pkg/` with 70 KB `.wasm`)
- [x] `cd tugrust && cargo nextest run -p tugdiff-wasm` (if tests added) — N/A from workspace; 15 unit tests pass via `cd tugdeck/crates/tugdiff-wasm && cargo test`

---

#### Step 10: DiffBlock body kind {#step-10}

**Depends on:** #step-1, #step-9

**Commit:** `feat(tide-rendering): DiffBlock — inline unified-diff renderer with hunk collapse and word-level intra-line diff`

**References:** [D05], [D09], Spec S02

**Artifacts:**
- `tugdeck/src/components/tugways/body-kinds/diff-block.tsx` + `.css`
- `tugdeck/src/lib/lazy/load-tugdiff-wasm.ts`
- Token slot `--tugx-diff-*`
- `bun add diff-match-patch` for word-level intra-line

**Tasks:**
- [ ] Lazy-load `tugdiff-wasm` per [D10]; JS fallback (jsdiff) for first-paint
- [ ] Inline view by default; side-by-side toggle stub in chrome (full toggle implementation deferred to [Roadmap](#roadmap))
- [ ] When the side-by-side toggle ships, the inline-vs-side-by-side preference persists per-card via tugbank (`/api/defaults/tide/diff-view`); reload restores the user's choice
- [ ] Hunk-by-hunk collapse
- [ ] Word-level highlighting via `diff-match-patch`
- [ ] Filename + change-counts header (e.g., `tide-card.tsx · +12 −3`)
- [ ] Syntax highlight inside hunks per file extension (Shiki)

**Tests:**
- [ ] Two-text input produces correct hunks
- [ ] Unified-diff input parses correctly
- [ ] Hunk collapse works
- [ ] Word-level highlight on a single-line change
- [ ] Both themes verify

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 11: EditToolBlock wrapper {#step-11}

**Depends on:** #step-1, #step-10

**Commit:** `feat(tide-rendering): EditToolBlock — composes DiffBlock with filePath and change-count chrome`

**References:** [D05], Spec S03

**Artifacts:**
- `tugdeck/src/components/tugways/cards/tool-wrappers/edit-tool-block.tsx` + `.css`
- Registry entry; alias `MultiEdit → Edit` per [D16]

**Tasks:**
- [ ] Header: `Edit · {filePath}` + change counts (computed from diff)
- [ ] Body: DiffBlock fed from `(old_string, new_string)` or full-file diff if `replace_all`
- [ ] Footer: link-to-file in tugdeck filetree (deferred to follow-on if filetree integration isn't ready)
- [ ] Hover-line annotation: hovering a diff line surfaces a small status pill ("added" / "removed" / "unchanged") for accessibility and at-a-glance scanning; respects `prefers-reduced-motion`

**Tests:**
- [ ] Synthetic Edit fixture → DiffBlock with correct hunks
- [ ] MultiEdit alias dispatches correctly
- [ ] `replace_all` produces full-file diff
- [ ] Hover annotation appears on `mouseenter` and clears on `mouseleave`

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 12: JsonTreeBlock body kind {#step-12}

**Depends on:** #step-1

**Commit:** `feat(tide-rendering): JsonTreeBlock — collapsible JSON tree viewer with copy-as-path`

**References:** [D04], [D05], [D11], Spec S02

**Artifacts:**
- `tugdeck/src/components/tugways/body-kinds/json-tree-block.tsx` + `.css`
- Token slot `--tugx-json-*`

**Tasks:**
- [ ] Collapsible tree, default depth 3
- [ ] Type-aware coloring (string, number, bool, null, array, object)
- [ ] Search-within-tree (basic; full search deferred to polish)
- [ ] Copy-as-path (`response.data[0].id`) and copy-subtree
- [ ] Both themes verify

**Tests:**
- [ ] Renders nested object correctly
- [ ] Collapse beyond default depth shows expand affordance
- [ ] Copy-as-path produces correct path string

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 13: DefaultToolWrapper {#step-13}

**Depends on:** #step-1, #step-12

**Commit:** `feat(tide-rendering): DefaultToolWrapper — JsonTree-based fallback with caution badge`

**References:** [D04], [D11], Spec S03, (#chrome)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/tool-wrappers/default-tool-wrapper.tsx` + `.css`
- `tugdeck/src/components/tugways/chrome/tide-caution-badge.tsx` + `.css`
- Token slots `--tugx-caut-*` and `--tugx-toolblock-*` (extension)

**Tasks:**
- [ ] DefaultToolWrapper: JsonTree over `tool_use.input` (collapsed by default), separator, then body picked from `tool_result.output`/`tool_use_structured.structured_result`: text → MarkdownBlock; object → JsonTreeBlock
- [ ] CautionBadge: small inline chip with hover tooltip showing reason
- [ ] Update [#step-1](#step-1) scaffold's no-op DefaultToolWrapper to this real implementation

**Tests:**
- [ ] Inject synthetic `tool_use { tool_name: "ZzzUnknown" }` → DefaultToolWrapper + caution badge
- [ ] Object output renders via JsonTreeBlock
- [ ] Text output renders via MarkdownBlock

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 14: Integration checkpoint — day-1 coverage {#step-14}

**Depends on:** #step-6, #step-8, #step-11, #step-13

**Commit:** `N/A (verification only)`

**References:** [D04], [D05], [D11], Spec S06, (#success-criteria)

**Tasks:**
- [ ] Verify Bash, Read, Edit wrappers + DefaultToolWrapper all dispatch correctly across the v2.1.105 fixture catalog
- [ ] Verify caution badge appears for synthetic unknown-tool fixture
- [ ] Run the `assistant-rendering-fixture-replay.test.tsx` against the four shipped wrappers (other tools still go through DefaultToolWrapper at this point — that's fine, the test asserts what's known to be wired)

**Tests:**
- [ ] All v2.1.105 fixtures replay without throw or `[object Object]` content
- [ ] Read/Bash/Edit fixtures produce bespoke wrappers; other tools use DefaultToolWrapper

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test src/__tests__/assistant-rendering-fixture-replay.test.tsx`
- [ ] `cd tugdeck && bun run audit:tokens lint`

---

#### Step 14.5: Gallery cards for shipped renderers (batch 1) {#step-14-5}

**Depends on:** #step-3, #step-4, #step-6, #step-8, #step-11, #step-13

**Commit:** `feat(gallery): cards for ThinkingBlock, TerminalBlock+Bash, FileBlock+Read, DiffBlock+Edit, JsonTree, DefaultToolWrapper`

**References:** [D05], [D11], [D14], (#t01-body-kinds), (#t02-tool-wrappers), (#t03-chrome). Pattern: `tugdeck/src/components/tugways/cards/gallery-transcript-entry.tsx` (stacked variants with mock content).

**Artifacts:**
- `tugdeck/src/components/tugways/cards/gallery-md-content-blocks.tsx` + `.css` — MarkdownBlock extensions (footnotes, smart-punct, tables, task lists, collapse-tall)
- `tugdeck/src/components/tugways/cards/gallery-tide-thinking.tsx` + `.css` — ThinkingBlock variants (streaming, completed-collapsed, completed-expanded)
- `tugdeck/src/components/tugways/cards/gallery-terminal-block.tsx` + `.css` — TerminalBlock (clean stdout, ANSI-rich, stdout/stderr split, virtualized 5k-line, interrupted)
- `tugdeck/src/components/tugways/cards/gallery-file-block.tsx` + `.css` — FileBlock (three languages, with/without line offset, long-file collapsed)
- `tugdeck/src/components/tugways/cards/gallery-diff-block.tsx` + `.css` — DiffBlock (small inline, large multi-hunk, single-line word-level)
- `tugdeck/src/components/tugways/cards/gallery-json-tree-block.tsx` + `.css` — JsonTreeBlock standalone (will be promoted to gallery-structured-blocks in [#step-29-5](#step-29-5))
- `tugdeck/src/components/tugways/cards/gallery-tool-block-shell.tsx` + `.css` — BashToolBlock (success, non-zero exit, interrupted, big-output, ANSI-rich)
- `tugdeck/src/components/tugways/cards/gallery-tool-block-file-shipped.tsx` + `.css` — Read + Edit wrappers side by side (Write + NotebookEdit added in [#step-29-5](#step-29-5))
- `tugdeck/src/components/tugways/cards/gallery-tool-block-default.tsx` + `.css` — DefaultToolWrapper with synthetic unknown tool + caution badge variants
- Registrations added to `gallery-registrations.tsx`

**Tasks:**
- [ ] Each card stacks 3-5 mock variants showing the component's full design surface
- [ ] All mock data is module-scope, no live wiring
- [ ] Each card's root has `data-testid="gallery-<kind>"` for the snapshot tests
- [ ] Both themes verified (gallery host already supports theme switching)
- [ ] No new tokens introduced — gallery cards only consume existing component slots

**Tests:**
- [ ] Each gallery card renders without throw under both themes (snapshot test)
- [ ] `bun run audit:tokens lint` exits 0

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test src/components/tugways/cards/__tests__/gallery-rendering.test.tsx`
- [ ] Manual: open each new gallery card; visually verify variants render correctly in both themes

---

#### Step 15: PathListBlock + GlobToolBlock {#step-15}

**Depends on:** #step-1

**Commit:** `feat(tide-rendering): PathListBlock + GlobToolBlock`

**References:** [D05], Spec S02, Spec S03

**Artifacts:**
- `tugdeck/src/components/tugways/body-kinds/path-list-block.tsx` + `.css`
- `tugdeck/src/components/tugways/cards/tool-wrappers/glob-tool-block.tsx` + `.css`
- Token slot `--tugx-paths-*`
- Registry entry

**Tasks:**
- [ ] PathListBlock: icons by file type, path-shortening (`…/`), sortable when count > 20, "Truncated at N" indicator
- [ ] GlobToolBlock: header `Glob · {pattern}` + count + truncated indicator; body PathListBlock

**Tests:**
- [ ] Replay `test-21-glob-tool.jsonl` → GlobToolBlock with PathListBlock, correct count
- [ ] Truncation indicator appears when `truncated: true`

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 16: SearchResultBlock + GrepToolBlock {#step-16}

**Depends on:** #step-1, #step-15

**Commit:** `feat(tide-rendering): SearchResultBlock + GrepToolBlock with content-mode and files-only-mode`

**References:** [D05], Spec S02, Spec S03

**Artifacts:**
- `tugdeck/src/components/tugways/body-kinds/search-result-block.tsx` + `.css`
- `tugdeck/src/components/tugways/cards/tool-wrappers/grep-tool-block.tsx` + `.css`
- Token slot `--tugx-search-*`
- Registry entry

**Tasks:**
- [ ] SearchResultBlock: grouped by file with collapsible headers; highlighted match span; surrounding context lines
- [ ] GrepToolBlock: header `Grep · {pattern}` + match count + file count; body SearchResultBlock (content mode) or PathListBlock (files-only mode)

**Tests:**
- [ ] Synthetic Grep fixture (content mode) → SearchResultBlock with grouped matches
- [ ] Synthetic Grep fixture (files-only mode) → PathListBlock

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 17: AgentTranscriptBlock + TaskToolBlock (recursive) {#step-17}

**Depends on:** #step-1, #step-13

**Commit:** `feat(tide-rendering): AgentTranscriptBlock + TaskToolBlock — recursive nested tool rendering`

**References:** [D05], [D17], Spec S02, Spec S03

**Artifacts:**
- `tugdeck/src/components/tugways/body-kinds/agent-transcript-block.tsx` + `.css`
- `tugdeck/src/components/tugways/cards/tool-wrappers/task-tool-block.tsx` + `.css`
- Token slot `--tugx-agent-*`
- Registry entry; alias `Agent → Task` per [D16] if needed

**Tasks:**
- [ ] AgentTranscriptBlock: header (agent type + status + duration + tool-call count); body iterates `content[]` rendering each entry through the same dispatch (`depth + 1`); footer (cost summary)
- [ ] Recursion bounded by max depth (default 3); deeper levels collapse with "+N nested calls"
- [ ] TaskToolBlock: composes AgentTranscriptBlock; header shows agent type + status

**Tests:**
- [ ] Replay `test-22-subagent-spawn.jsonl` → TaskToolBlock with AgentTranscriptBlock; nested Grep call renders via GrepToolBlock
- [ ] Synthetic depth-3 fixture → depth-3 renders; depth-4 shows collapse

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 18: PermissionDialog (`control_request_forward`, `is_question:false`) {#step-18}

**Depends on:** #step-1, #step-12

**Commit:** `feat(tide-rendering): PermissionDialog — inline allow/deny dialog with permission_suggestions`

**References:** [D13], Spec S03 (chrome variant), (#chrome)

**Artifacts:**
- `tugdeck/src/components/tugways/chrome/tide-permission-dialog.tsx` + `.css`
- Token slot `--tugx-perm-*`
- Wire-up: dispatch routes `control_request_forward` (is_question:false) here

**Tasks:**
- [ ] Header: "Permission requested" + tool icon + tool name
- [ ] Body picker — render the `tool_use.input` through the *most-fitting* body kind, not just JsonTree:
  - `Bash` → render `input.command` via inline `CodeBlock` (shell-syntax-highlighted)
  - `Edit` → render `(input.old_string, input.new_string)` via `DiffBlock` (read-only)
  - `Read`/`Write` → show `input.file_path` as a styled path with line-range badge if applicable
  - any other tool → fall back to `JsonTreeBlock` over `tool_use.input`
- [ ] Reason line from `decision_reason`
- [ ] Suggestions from `permission_suggestions` rendered as buttons
- [ ] Allow / Deny buttons; disable while pending
- [ ] After response: collapse to one-line static record showing decision

**Tests:**
- [ ] Replay `test-11-permission-deny-roundtrip.jsonl` → PermissionDialog renders, deny click sends `tool_approval { decision: "deny" }`
- [ ] Allow click sends `tool_approval { decision: "allow" }`
- [ ] Focus management: primary button focused on mount

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`
- [ ] Manual smoke against live tugcode

---

#### Step 19: QuestionDialog (`control_request_forward`, `is_question:true`) {#step-19}

**Depends on:** #step-1, #step-18

**Commit:** `feat(tide-rendering): QuestionDialog — inline single/multi-select with Other input`

**References:** [D13], Spec S03 (chrome variant)

**Artifacts:**
- `tugdeck/src/components/tugways/chrome/tide-question-dialog.tsx` + `.css`
- Token slot `--tugx-quest-*`
- Wire-up: dispatch routes `control_request_forward` (is_question:true) here

**Tasks:**
- [ ] Question text rendered via MarkdownBlock
- [ ] Options as choice cards; single-select default; `multiSelect:true` flips to checkboxes
- [ ] "Other" free-text input
- [ ] Submit button sends `question_answer { request_id, answers }`
- [ ] After response: collapse to one-line summary

**Tests:**
- [ ] Synthetic AskUserQuestion fixture → QuestionDialog with options
- [ ] Submitting selection produces correct `question_answer` payload
- [ ] Multi-select mode toggles checkboxes

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 20: CostChrome — per-turn footer + expanded breakdown + cumulative {#step-20}

**Depends on:** #step-1

**Commit:** `feat(tide-rendering): CostChrome — per-turn cost badge, expanded modelUsage breakdown, card-level cumulative`

**References:** [D03], (#chrome), (#t03-chrome)

**Artifacts:**
- `tugdeck/src/components/tugways/chrome/tide-cost-chrome.tsx` + `.css`
- Token slot `--tugx-cost-*`
- Replace placeholder `"Project path /gallery/demo"` in `tide-card.tsx` status row

**Tasks:**
- [ ] CostBadge sub-component: `$0.04 · 1.2k tok · 3.4s` per `code` row footer
- [ ] Click expands to per-model breakdown (input/output/cache tokens stacked bar; cost contribution per model)
- [ ] CostChrome cumulative: card-level status row showing session total (turn count + tokens + USD)
- [ ] Hook: card binding's `projectDir` (or shortened form) replaces gallery placeholder

**Tests:**
- [ ] Replay any fixture → CostBadge shows correct values
- [ ] Multi-turn fixture → cumulative chrome aggregates correctly
- [ ] Both themes verify

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 21: Drift detection + caution badge surfacing {#step-21}

**Depends on:** #step-13, #step-20

**Commit:** `feat(tide-rendering): drift detection — caution badge in card chrome and inline at offending events`

**References:** [D04], [Q03], `tide.md#p15-stream-json-version-gate`, (#chrome)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/tide-assistant-renderer-dispatch.ts` (drift detector logic)
- Extension to `tide-cost-chrome.tsx` for aggregate caution chip in card chrome
- Inline caution at the offending event already lands via the [#step-13](#step-13) DefaultToolWrapper integration
- Pinned-catalog version constant alongside the dispatch (read from a build-time constant)

**Tasks:**
- [ ] Detect three drift signals: (1) unknown tool name (already wired in step 1), (2) unknown structured_result shape (shallow schema check), (3) `system_metadata.version` ≠ pinned catalog
- [ ] Aggregate caution counter on card chrome: "drift detected: 3 events" with click-expand listing the offending events
- [ ] Inline caution chip on each offending event (DefaultToolWrapper already; extend to bespoke wrappers when their structured_result fails the schema check)
- [ ] Console-log every drift event for triage; include event type, tool_name, version, summary

**Tests:**
- [ ] Synthetic version-mismatch fixture → both card-chrome chip and inline-event marker
- [ ] Synthetic unknown-tool fixture → caution chip present
- [ ] Synthetic shape-mismatch fixture (e.g., `tool_use_structured.file` missing `content`) → caution + JsonTree fallback

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 22: KaTeXBlock (lazy-loaded) {#step-22}

**Depends on:** #step-3

**Commit:** `feat(tide-rendering): KaTeXBlock — lazy-loaded math typesetting for inline and display modes`

**References:** [D08], [D10], List L02, (#block-transformer-pass)

**Artifacts:**
- `tugdeck/src/components/tugways/body-kinds/katex-block.tsx` + `.css`
- `tugdeck/src/lib/lazy/load-katex.ts`
- `tugdeck/src/lib/markdown/block-transformers/math-transformer.ts` (populated)
- `tugdeck/src/lib/markdown/block-transformers/inline-math-walker.ts` (populated)
- Token slot `--tugx-katex-*`
- KaTeX font WOFF2 bundled locally

**Tasks:**
- [ ] Lazy-load KaTeX on first encounter
- [ ] Display mode: replace fenced ` ```math ` / ` ```latex ` blocks via mathTransformer
- [ ] Inline mode: text-node walk inside MarkdownBlock for `$...$` and `$$...$$` (post-DOMPurify, pre-render)
- [ ] Error boundary per instance (R04); fallback to `CodeBlock` with toast
- [ ] Bundle KaTeX fonts locally; no CDN

**Tests:**
- [ ] Inline `$E=mc^2$` typesets
- [ ] Display `$$\\int_0^1 x^2\\,dx$$` typesets
- [ ] Malformed math falls back without crashing parent
- [ ] Boot bundle excludes KaTeX (verify via build artifact inspection)

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`
- [ ] Manual: prompt `> render the quadratic formula` → expect typeset output

---

#### Step 23: MermaidBlock (lazy-loaded) {#step-23}

**Depends on:** #step-3

**Commit:** `feat(tide-rendering): MermaidBlock — lazy-loaded diagram rendering with theme-aware config`

**References:** [D10], List L02, (#block-transformer-pass), R04

**Artifacts:**
- `tugdeck/src/components/tugways/body-kinds/mermaid-block.tsx` + `.css`
- `tugdeck/src/lib/lazy/load-mermaid.ts`
- `tugdeck/src/lib/markdown/block-transformers/mermaid-transformer.ts` (populated)
- Token slot `--tugx-mermaid-*`

**Tasks:**
- [ ] Lazy-load mermaid on first encounter
- [ ] Streaming-safe: stay as plain `CodeBlock` until parent block reaches `complete`; promote then
- [ ] Theme-aware config: pass current theme tokens into mermaid's config object
- [ ] Pan/zoom on click for large diagrams
- [ ] Error boundary; fallback to plain code with toast on parse error

**Tests:**
- [ ] ` ```mermaid\\nflowchart LR\\n  a-->b\\n``` ` renders as diagram on `complete`
- [ ] During streaming (parent block partial), shows raw code
- [ ] Malformed diagram falls back without crashing parent
- [ ] Boot bundle excludes Mermaid (verify via build artifact inspection)

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 24: TodoListBlock + TodoWriteToolBlock {#step-24}

**Depends on:** #step-1

**Commit:** `feat(tide-rendering): TodoListBlock + TodoWriteToolBlock — task checklist with status indicators`

**References:** [D05], Spec S02, Spec S03

**Artifacts:**
- `tugdeck/src/components/tugways/body-kinds/todo-list-block.tsx` + `.css`
- `tugdeck/src/components/tugways/cards/tool-wrappers/todo-write-tool-block.tsx` + `.css`
- Token slot `--tugx-todo-*`
- Registry entry

**Tasks:**
- [ ] TodoListBlock: checklist with status indicators (pending/in_progress/completed); in_progress highlighted
- [ ] TodoWriteToolBlock: header with counts + progress bar; body TodoListBlock

**Tests:**
- [ ] Synthetic TodoWrite fixture → renders checklist correctly
- [ ] In-progress item visually distinct

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 25: WebFetchToolBlock + WebSearchToolBlock {#step-25}

**Depends on:** #step-1, #step-7, #step-16

**Commit:** `feat(tide-rendering): WebFetchToolBlock + WebSearchToolBlock`

**References:** [D05], Spec S03

**Artifacts:**
- `tugdeck/src/components/tugways/cards/tool-wrappers/web-fetch-tool-block.tsx` + `.css`
- `tugdeck/src/components/tugways/cards/tool-wrappers/web-search-tool-block.tsx` + `.css`
- Registry entries

**Tasks:**
- [ ] WebFetchToolBlock: header `WebFetch · {url}` + favicon + cache-hit indicator; body MarkdownBlock (default) or FileBlock (raw text)
- [ ] WebSearchToolBlock: header `WebSearch · {query}` + result count; body SearchResultBlock adapted for web results (title + URL + snippet)

**Tests:**
- [ ] Synthetic WebFetch/WebSearch fixtures render correctly

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 26: WriteToolBlock + NotebookEditToolBlock {#step-26}

**Depends on:** #step-1, #step-7, #step-10

**Commit:** `feat(tide-rendering): WriteToolBlock + NotebookEditToolBlock (notebook uses generic DiffBlock for v1)`

**References:** [D05], [Q01], Spec S03

**Artifacts:**
- `tugdeck/src/components/tugways/cards/tool-wrappers/write-tool-block.tsx` + `.css`
- `tugdeck/src/components/tugways/cards/tool-wrappers/notebook-edit-tool-block.tsx` + `.css`
- Registry entries

**Tasks:**
- [ ] WriteToolBlock: header `Write · {filePath}` + size; body FileBlock; new-vs-overwrite indicator
- [ ] NotebookEditToolBlock: header `NotebookEdit · {notebookPath} · cell {cellId}` + edit-mode badge; body DiffBlock (generic v1 per [Q01])

**Tests:**
- [ ] Synthetic Write fixture renders FileBlock
- [ ] Synthetic NotebookEdit replace renders DiffBlock

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 27: ImageBlock {#step-27}

**Depends on:** #step-1

**Commit:** `feat(tide-rendering): ImageBlock — inline image with lazy load and click-to-zoom`

**References:** [D05], Spec S02, [atoms-attachments.md](./atoms-attachments.md)

**Artifacts:**
- `tugdeck/src/components/tugways/body-kinds/image-block.tsx` + `.css`
- Token slot `--tugx-image-*`
- Markdown-block delegation: when `MarkdownBlock` encounters an `<img>` element after parse, it can render through ImageBlock

**Tasks:**
- [ ] Lazy-load with low-res placeholder
- [ ] EXIF orientation honored
- [ ] Click-to-fullscreen modal
- [ ] Cooperate with atoms-attachments user-side rendering

**Tests:**
- [ ] Renders an image URL with placeholder until load
- [ ] Click → fullscreen modal

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 28: TableBlock (rich) {#step-28}

**Depends on:** #step-3

**Commit:** `feat(tide-rendering): TableBlock — rich table with sorting and sticky header for large tables`

**References:** [D05], [D07], Spec S02

**Artifacts:**
- `tugdeck/src/components/tugways/body-kinds/table-block.tsx` + `.css`
- Token slot `--tugx-tabrich-*`
- A new transformer `largeTableTransformer` in block-transformers (promotes to TableBlock when rows > 10 or columns > 5)

**Tasks:**
- [ ] Sortable columns
- [ ] Sticky header on scroll
- [ ] Cell overflow handling (truncate + tooltip)
- [ ] Optional row striping
- [ ] Block transformer promotes large GFM tables

**Tests:**
- [ ] Small table stays as plain GFM table
- [ ] Table with > 10 rows promotes to TableBlock; sort/sticky-header work

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 29: SessionInitBanner + ErrorBlock {#step-29}

**Depends on:** #step-1, #step-21

**Commit:** `feat(tide-rendering): SessionInitBanner (on system_metadata change) + ErrorBlock`

**References:** [D03], (#chrome), (#t03-chrome)

**Artifacts:**
- `tugdeck/src/components/tugways/chrome/tide-session-init-banner.tsx` + `.css`
- `tugdeck/src/components/tugways/chrome/tide-error-block.tsx` + `.css`
- Token slots `--tugx-banner-*` and `--tugx-err-*`
- Wire dispatch to compare `system_metadata` against previous and emit banner only on change

**Tasks:**
- [ ] SessionInitBanner: project path, model, permissionMode; integrates with drift caution chip from [#step-21](#step-21) when version mismatches
- [ ] Diff logic per [D03]: shallow on (model, permissionMode, version) + deep on tools/skills/agents
- [ ] ErrorBlock: amber for `recoverable: true` (with retry); red for `recoverable: false` (with copy-error button)

**Tests:**
- [ ] First system_metadata renders banner
- [ ] Identical-shape system_metadata does NOT re-render
- [ ] Changed model produces banner re-render
- [ ] Recoverable error shows retry; non-recoverable shows copy

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test`

---

#### Step 29.5: Gallery cards for remaining renderers (batch 2) {#step-29-5}

**Depends on:** #step-14-5, #step-15, #step-16, #step-17, #step-18, #step-19, #step-20, #step-21, #step-22, #step-23, #step-24, #step-25, #step-26, #step-27, #step-28, #step-29

**Commit:** `feat(gallery): cards for stretch content, structured blocks, dialogs, agent transcript, cost chrome, tool wrappers (rest)`

**References:** [D05], [D08], [D10], [D13], [D17], (#t01-body-kinds), (#t02-tool-wrappers), (#t03-chrome)

**Artifacts:**
- `tugdeck/src/components/tugways/cards/gallery-stretch-content.tsx` + `.css` — KaTeXBlock (inline + display), MermaidBlock (flowchart + sequence + class diagram), TableBlock-rich (sortable 50-row)
- `tugdeck/src/components/tugways/cards/gallery-structured-blocks.tsx` + `.css` — promotes from `gallery-json-tree-block` to a unified showcase: JsonTree + PathList + SearchResult + TodoList side by side
- `tugdeck/src/components/tugways/cards/gallery-agent-transcript-block.tsx` + `.css` — three nesting depths, mixed nested-tool variety, complete + streaming sub-transcripts
- `tugdeck/src/components/tugways/cards/gallery-image-block.tsx` + `.css` — lazy-load placeholder, EXIF-orientation samples, click-to-zoom
- `tugdeck/src/components/tugways/cards/gallery-tool-block-search.tsx` + `.css` — Glob + Grep + WebSearch wrappers
- `tugdeck/src/components/tugways/cards/gallery-tool-block-network.tsx` + `.css` — WebFetch (cache hit, cache miss, fetch error)
- `tugdeck/src/components/tugways/cards/gallery-tool-block-agent.tsx` + `.css` — Task wrapper with depth 1, 2, 3
- `tugdeck/src/components/tugways/cards/gallery-tool-block-meta.tsx` + `.css` — TodoWrite + finalized DefaultToolWrapper drift variants
- `tugdeck/src/components/tugways/cards/gallery-tool-block-file.tsx` + `.css` — promotes from `gallery-tool-block-file-shipped` to full set: Read + Write + Edit + NotebookEdit
- `tugdeck/src/components/tugways/cards/gallery-tide-dialogs.tsx` + `.css` — PermissionDialog + QuestionDialog (pending, approved, denied; single + multi-select with "Other")
- `tugdeck/src/components/tugways/cards/gallery-tide-chrome.tsx` + `.css` — CostChrome (badge + expanded + cumulative), SessionInitBanner, ErrorBlock, CautionBadge
- Promotions update `gallery-json-tree-block.tsx` → re-export path (or removal) and `gallery-tool-block-file-shipped.tsx` → `gallery-tool-block-file.tsx`
- Registrations updated in `gallery-registrations.tsx`

**Tasks:**
- [ ] Each card stacks 3-5 mock variants per its primary component(s)
- [ ] Stretch-content card MUST exercise the lazy-load path — first render of each component triggers fetch; verify the placeholder shows
- [ ] Agent-transcript card exercises [D17] depth cap — render at depth 4 to verify the "+N nested calls" affordance
- [ ] Dialogs card includes the post-response collapsed state per [D13]
- [ ] Both themes verified
- [ ] Promote `gallery-json-tree-block` and `gallery-tool-block-file-shipped` cleanly — old gallery entries are removed (not duplicated)

**Tests:**
- [ ] Snapshot tests per card under both themes
- [ ] Lazy-load test: gallery-stretch-content's first render fetches KaTeX/Mermaid bundles (verified via mock fetch instrumentation)
- [ ] `bun run audit:tokens lint` exits 0

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test src/components/tugways/cards/__tests__/gallery-rendering.test.tsx`
- [ ] Manual: open each new gallery card; visually verify variants in both themes
- [ ] Manual: verify boot bundle still excludes KaTeX, Mermaid, tugdiff-wasm even after gallery cards added (gallery cards lazy-load on mount, not at boot)

---

#### Step 30: Phase exit integration checkpoint {#step-30}

**Depends on:** #step-2, #step-3, #step-4, #step-14, #step-14-5, #step-15, #step-16, #step-17, #step-18, #step-19, #step-20, #step-21, #step-22, #step-23, #step-24, #step-25, #step-26, #step-27, #step-28, #step-29, #step-29-5

**Commit:** `N/A (verification only)`

**References:** All decisions, Spec S06, (#success-criteria), (#exit-criteria)

**Tasks:**
- [ ] Run the full assistant-rendering-fixture-replay test against both `v2.1.105/` and `v2.1.112/` catalogs
- [ ] Verify dispatch.registeredTools() enumerates exactly the wrappers from [Table T02](#t02-tool-wrappers) (minus DefaultToolWrapper)
- [ ] Verify caution-badge appears on synthetic-drift fixtures
- [ ] Visual snapshot pass: every component in both `brio` and `harmony`
- [ ] Bundle audit: confirm KaTeX, Mermaid, tugdiff-wasm absent from boot bundle (verify via build-artifact inspection)
- [ ] Shiki paste-load benchmark: 10k lines highlight latency on reference machine; record for [Q02]
- [ ] Gallery audit: every component listed in [Tables T01-T03](#t01-body-kinds) is reachable from a registered gallery card (per [#step-14-5](#step-14-5) and [#step-29-5](#step-29-5))
- [ ] Cross-reference Step 0 audit findings — confirm threshold calibrations (FileBlock fold, TerminalBlock virtualization, AgentTranscript depth cap, DiffBlock hunk threshold) match what real-session data suggests, or note any open follow-up
- [ ] `bun run audit:tokens lint` exits 0
- [ ] `bun x tsc --noEmit` exits 0
- [ ] `bun test` all green
- [ ] `cd tugrust && cargo nextest run` all green
- [ ] Manual smoke: replay multi-turn live session, verify thinking + tool wrappers + cost chrome + permission dialog round-trip

**Tests:**
- [ ] Full fixture-replay test exits 0
- [ ] Bundle-audit script reports excluded modules
- [ ] Theme-snapshot test exits 0

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit && bun test && bun run audit:tokens lint`
- [ ] `cd tugrust && cargo nextest run`
- [ ] Manual smoke against live tugcode covers: streaming response, tool use (Read/Bash/Edit at minimum), thinking, permission flow, cost chrome, drift caution (synthetic), both themes

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A complete content-and-data-type rendering layer for Tide's assistant surface — body kinds + tool wrappers + dispatch + chrome — that ships every renderer enumerated in [Tables T01-T03](#t01-body-kinds), passes the full fixture-replay test against both `v2.1.105/` and `v2.1.112/` catalogs, and visually verifies on both `brio` and `harmony` themes.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] All 32 execution steps committed with green checkpoints (Step 0 + Steps 1-30 + Steps 14.5 and 29.5).
- [ ] `roadmap/tide-assistant-rendering-session-audit.md` produced and reviewed; threshold calibrations cross-referenced into the relevant later steps.
- [ ] Every component in [Tables T01-T03](#t01-body-kinds) is reachable from a registered gallery card (`gallery-md-content-blocks`, `gallery-stretch-content`, `gallery-diff-block`, `gallery-file-block`, `gallery-terminal-block`, `gallery-structured-blocks`, `gallery-agent-transcript-block`, `gallery-image-block`, `gallery-tool-block-{file,shell,search,network,agent,meta,default}`, `gallery-tide-{thinking,dialogs,chrome}`).
- [ ] `bun x tsc --noEmit`, `bun test`, `bun run audit:tokens lint`, `cd tugrust && cargo nextest run` all green.
- [ ] Replaying the full v2.1.105 + v2.1.112 fixture catalogs produces no render errors, no `[object Object]` text, no raw JSON bleed, and every fixture's `tool_use` events route to the bespoke wrapper enumerated in [Table T02](#t02-tool-wrappers).
- [ ] Synthetic-drift fixtures produce caution badges in both card chrome and inline at the offending event.
- [ ] Bundle audit confirms KaTeX, Mermaid, and tugdiff-wasm are excluded from the boot bundle.
- [ ] Both `brio` and `harmony` themes verified for every component.
- [ ] `tide.md` §Phase T1 updated with a back-link to this plan.
- [ ] `tugplan-tide-card-polish.md` §Step 12 and §Step 13 marked as absorbed.

**Acceptance tests:**
- [ ] `tugdeck/src/__tests__/assistant-rendering-fixture-replay.test.tsx` — full catalog replay.
- [ ] `tugdeck/src/components/tugways/cards/tide-assistant-renderer-dispatch.test.ts` — registry coverage.
- [ ] Theme-snapshot test across all body kinds, wrappers, and chrome.
- [ ] Drift-caution synthetic-fixture test.
- [ ] Bundle-audit script run.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Re-run buttons on `BashToolBlock` (and shell-adapter wrappers when Phase T2 lands). Pending permission-mode story for re-run.
- [ ] "Allow with edits" structured editor on `PermissionDialog` (command-line editor for Bash, editable diff for Edit).
- [ ] `AgentTranscriptBlock` as a Slack-like participant variant on `TugTranscriptEntry` (A/B against the inline form). See [D17] design note.
- [ ] `BashToolBlock` as a participant variant on `TugTranscriptEntry` (the same idea applied to shell commands). Companion to the AgentTranscript participant exploration above.
- [ ] `NotebookCellBlock` cell-aware specialization, gated on observed NotebookEdit traffic per [Q01].
- [ ] Tree-sitter migration evaluation per [Q02], gated on Shiki bottleneck observation.
- [ ] Caution-badge surface refinement per [Q03] feedback.
- [ ] Configurable retained-line cap on `TerminalBlock` via tugbank, if [Q04] surfaces a need.
- [ ] MCP-server-aware wrappers (Gmail, Calendar, Drive) — currently a non-goal; revisit if MCP becomes load-bearing.
- [ ] Persisting per-block expand/collapse state across reload via tugbank.
- [ ] Side-by-side diff view toggle on `DiffBlock` (inline only in v1).
- [ ] In-file search (Cmd+F) inside expanded `FileBlock`.
- [ ] Adaptive coalescing window for streaming under > 50 deltas/sec, if [R06] residual surfaces.

| Checkpoint | Verification |
|------------|--------------|
| Empirical session audit (Step 0) | `roadmap/tide-assistant-rendering-session-audit.md` produced; frequency tables and threshold calibrations captured |
| Dispatch infrastructure | `bun test src/components/tugways/cards/tide-assistant-renderer-dispatch.test.ts` |
| Markdown typography | Visual snapshot, both themes; `bun run audit:tokens lint` |
| ThinkingBlock | Replay `test-22-subagent-spawn.jsonl`; verify thinking renders + collapses on complete |
| TerminalBlock + BashToolBlock | Replay `test-09-bash-auto-approved.jsonl`; verify command, stdout, exit |
| FileBlock + ReadToolBlock | Replay `test-05-tool-use-read.jsonl`; verify file viewer with line numbers |
| DiffBlock + EditToolBlock | Synthetic Edit fixture; verify hunks; word-level highlight |
| JsonTreeBlock + DefaultToolWrapper | Synthetic unknown-tool fixture; verify caution badge |
| Day-1 coverage integration | Step 14 fixture-replay run |
| Gallery batch 1 (Step 14.5) | Each shipped renderer reachable from a registered gallery card; both themes verified |
| PathListBlock + GlobToolBlock | Replay `test-21-glob-tool.jsonl` |
| SearchResultBlock + GrepToolBlock | Synthetic Grep fixture |
| AgentTranscriptBlock + TaskToolBlock | Replay `test-22-subagent-spawn.jsonl`; nested call renders correctly |
| PermissionDialog | Replay `test-11-permission-deny-roundtrip.jsonl` |
| QuestionDialog | Synthetic AskUserQuestion fixture |
| CostChrome | Replay any fixture; verify badge + breakdown + cumulative |
| Drift detection | Synthetic version-mismatch + unknown-shape fixtures |
| KaTeXBlock | Inline + display math fixtures; lazy-load verified |
| MermaidBlock | Diagram fixture; lazy-load verified |
| TodoListBlock + TodoWriteToolBlock | Synthetic TodoWrite fixture |
| WebFetch + WebSearch | Synthetic web fixtures |
| WriteToolBlock + NotebookEditToolBlock | Synthetic Write + NotebookEdit fixtures |
| ImageBlock | Markdown image reference fixture |
| TableBlock (rich) | Large-table fixture |
| SessionInitBanner + ErrorBlock | system_metadata change fixture; error fixture |
| Gallery batch 2 (Step 29.5) | Every remaining component reachable from a registered gallery card; lazy-load fetch verified |
| Phase exit | Step 30 full integration |

---

### Library citations {#library-citations}

Web research for this phase, May 2026:

- [imara-diff (GitHub)](https://github.com/pascalkuthe/imara-diff) — performance-stable Rust diff library; histogram + Myers; 10×–30× faster than `similar` on large inputs. Justifies [D09].
- [imara-diff announcement](https://users.rust-lang.org/t/announcing-imara-diff-a-reliably-performant-diffing-library-for-rust/83276)
- [similar (Rust)](https://docs.rs/similar) — comparison baseline.
- [Shiki](https://shiki.style/guide/) — current syntax highlighter; modern versions run in browser.
- [Tree-sitter syntax highlighting](https://tree-sitter.github.io/tree-sitter/3-syntax-highlighting.html) — alternative; deferred per [Q02].
- [Mermaid lazy loading (Rick Strahl, 2025)](https://weblog.west-wind.com/posts/2025/May/10/Lazy-Loading-the-Mermaid-Diagram-Library) — late-binding pattern referenced by [D10].
- [Mermaid bundle size (Sidharth Vinod)](https://www.sidharth.dev/posts/shrinking-mermaid/) — "Tiny" variant trade-offs.
- [ansi_up (GitHub)](https://github.com/drudru/ansi_up) — zero-dep JS ANSI → HTML.
- [vtparse (Rust)](https://docs.rs/vtparse/) — heavier full VT escape parser; reserved for pathological inputs.
- [KaTeX](https://katex.org/) — fast synchronous math typesetting; ~350 KB total. Justifies [D08].
- [KaTeX vs MathJax (BigGo, Nov 2025)](https://biggo.com/news/202511040733_KaTeX_MathJax_Web_Rendering_Comparison) — bundle and speed analysis.
