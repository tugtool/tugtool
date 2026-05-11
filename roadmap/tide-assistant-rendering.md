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
- [x] Lazy-load `tugdiff-wasm` per [D10]; JS fallback (jsdiff) for first-paint (the JS-side `parseUnifiedDiffText` mirrors the Rust parser one-to-one and is the synchronous first-paint path for `unified` input — the rare `two-text` input shows a "Computing diff…" placeholder until the WASM engine resolves; jsdiff was not added as it would duplicate work the WASM crate already does)
- [x] Inline view by default; side-by-side toggle stub in chrome (full toggle implementation deferred to [Roadmap](#roadmap))
- [ ] When the side-by-side toggle ships, the inline-vs-side-by-side preference persists per-card via tugbank (`/api/defaults/tide/diff-view`); reload restores the user's choice — *closed by [#step-10-5](#step-10-5) Thread B*
- [x] Hunk-by-hunk collapse
- [x] Word-level highlighting via `diff-match-patch`
- [x] Filename + change-counts header (e.g., `tide-card.tsx · +12 −3`)
- [ ] Syntax highlight inside hunks per file extension (Shiki) — *closed by [#step-10-5](#step-10-5) Thread C, which composes Shiki with the word-level overlay via `render-line.ts`*

**Tests:**
- [x] Two-text input produces correct hunks (covered by stub-engine path and the Rust-side `two_text_diff_produces_correct_hunks_for_known_pair` in #step-9)
- [x] Unified-diff input parses correctly
- [x] Hunk collapse works
- [x] Word-level highlight on a single-line change
- [ ] Both themes verify (manual / browser-eyes verification — both `--tugx-diff-*` slots ship in `harmony.css` and `brio.css`)

**Checkpoint:**
- [x] `cd tugdeck && bun x tsc --noEmit && bun test` (3423 tests pass; tsc clean)

---

#### Step 10.5: WASM packaging convention + DiffBlock follow-throughs {#step-10-5}

**Depends on:** #step-9, #step-10

**Commits (one per thread):**
- Thread A: `chore(tugdeck/crates): collapse WASM crates into a sub-workspace + driver script`
- Thread B: `feat(tide-rendering): DiffBlock side-by-side view + tugbank-persisted preference`
- Thread C: `feat(tide-rendering): DiffBlock — Shiki syntax highlight composed with word-level overlay`

**References:** [D05], [D06], [D09], [D10], (#new-crates), [`tuglaws/wasm-crates.md`](../tuglaws/wasm-crates.md)

**Why this step exists.** Steps 9–10 shipped two WASM crates and a body kind, but three threads accumulated that need to close before #step-11 (EditToolBlock) lands on top of the current shape:

1. **Build/packaging is ad-hoc.** The `Justfile` `wasm` recipe enumerates crates by name; the Vite watcher exclusion enumerates each `pkg/`; `pkg/.gitignore` is `**` (wasm-pack default), so every commit needs `git add -f`; per-crate `Cargo.lock` files live outside any workspace, so `cargo test -p <name>` from `tugrust/` fails. Each new WASM crate is five edits in five files. The pattern is "copy tugmark-wasm and pray" — that's not a convention.
2. **The side-by-side toggle is a UI lie.** [#step-10](#step-10) shipped a disabled `<button>` with `title="coming soon"`. Tugbank persistence (`/api/defaults/tide/diff-view/<cardId>`) was deferred "with the toggle itself" — circular. This step ships both.
3. **Shiki on diff hunks was deferred without a design.** The naive path (replace line `innerHTML` with Shiki HTML) wipes the word-level overlay. The right answer is to define a token stream and merge upstream of render — not to defer.

**Decision: sub-workspace at `tugdeck/crates/Cargo.toml`.** Both WASM crates become members of a virtual workspace. One `Cargo.lock` at `tugdeck/crates/Cargo.lock`; per-crate locks deleted. `cargo test --workspace` and `cargo clippy --workspace -- -D warnings` from `tugdeck/crates/` cover everything. Per-crate `Cargo.toml`'s `[package]` sections stay; only the workspace declaration is centralized. This is the standard Rust pattern; the standalone-crate shape we shipped in Step 9 was the cargo-cult.

**Decision: side-by-side view as a `viewMode` branch in `diff-block.tsx`.** One file, two layouts. The hunk model, word overlay, header chrome, and collapse state are shared; only the per-line layout differs (3-column inline vs. 2-column with paired before/after cells). Adds ~100 lines to the body kind; avoids duplicating the surrounding plumbing. Per-card persistence keys on `tide/diff-view/<cardId>` to match the convention used by other per-card prefs in the codebase.

**Decision: Shiki + word-level merge emits double-classed spans.** `renderLine(text, syntaxTokens, wordSegments)` walks the line once, tracking the current syntax class and current word-level tag. It emits a new `<span>` whenever either changes. Spans that fall inside both a syntax run and a word-level segment carry both class names (`shiki-token-foo` AND `tugx-diff-word-add`); CSS specificity decides the visible color, but the DOM is honest about the nesting. Token count is bounded by `O(syntax-tokens + word-segments)` per line — no quadratic blowup.

**Artifacts:**

*Thread A — packaging:*
- New: `tugdeck/crates/Cargo.toml` — virtual workspace; `members = ["tugmark-wasm", "tugdiff-wasm"]`.
- New: `tugdeck/crates/Cargo.lock` — workspace lock (replaces per-crate locks).
- New: `scripts/build-wasm.sh` — globs `tugdeck/crates/*/Cargo.toml`, runs `wasm-pack build --target web --release` on each, then writes `pkg/.gitignore` empty.
- New: `tugdeck/src/lib/lazy/wasm-init.ts` — generic singleton-promise + reset-on-rejection helper.
- Edits: `Justfile` `wasm` recipe shells to `scripts/build-wasm.sh` (drops per-crate enumeration).
- Edits: `tugdeck/vite.config.ts` watcher exclusion → `**/tugdeck/crates/*/pkg/**`.
- Edits: `tugdeck/src/lib/lazy/load-tugdiff-wasm.ts` shrinks to ~25 lines via `wasm-init.ts`.
- Edits: `tuglaws/wasm-crates.md` — replace the per-crate checklist with the new sub-workspace shape.
- Deletions: `tugdeck/crates/tugmark-wasm/Cargo.lock`, `tugdeck/crates/tugdiff-wasm/Cargo.lock`.

*Thread B — side-by-side:*
- Edits: `tugdeck/src/components/tugways/body-kinds/diff-block.tsx` — `viewMode` prop; side-by-side branch; toggle button no longer disabled.
- Edits: `tugdeck/src/components/tugways/body-kinds/diff-block.css` — `[data-view-mode="side-by-side"]` selectors and the 2-column grid layout.
- Edits: `tugdeck/styles/themes/harmony.css` and `brio.css` — add `--tugx-diff-sbs-*` tokens (column gap, paired-row backgrounds, blank-cell tint).
- Edits: `tugdeck/src/components/tugways/body-kinds/__tests__/diff-block.test.tsx` — coverage for the new mode + persistence.
- New (or edits to existing): `tugdeck/src/lib/diff/diff-view-pref.ts` — read/write helpers around `tugbank-client` for `tide/diff-view/<cardId>`.

*Thread C — Shiki + word-level merge:*
- New: `tugdeck/src/lib/diff/render-line.ts` — pure `renderLine(text, syntaxTokens, wordSegments) → ReactNode[]`.
- New: `tugdeck/src/lib/diff/__tests__/render-line.test.ts` — golden fixtures.
- New: `tugdeck/src/lib/diff/syntax-tokens-from-shiki.ts` — parses Shiki per-line HTML into `{start, end, className}[]`.
- Edits: `tugdeck/src/components/tugways/body-kinds/diff-block.tsx` — wires `renderLine` into the line-render path; lazy-loads Shiki when `data.filePath` has a known extension.
- Edits: `tugdeck/src/lib/diff/parse-unified-diff.ts` — enrich `WordDiffSegment` with `[start, end]` ranges (additive, non-breaking).

**Tasks:**

*Thread A — packaging:*
- [x] Author `tugdeck/crates/Cargo.toml` virtual workspace; verify `cd tugdeck/crates && cargo build` builds both crates and produces a single `Cargo.lock`.
- [x] Delete the per-crate `Cargo.lock` files; commit the workspace lock.
- [x] Write `scripts/build-wasm.sh` (Bash, `set -euo pipefail`); test it idempotently against both crates and observe `pkg/` contents.
- [x] Update `Justfile` `wasm` recipe to call the script; verify `just wasm` still builds both crates.
- [x] Update `tugdeck/vite.config.ts` watcher exclusion glob (smoke-test deferred — HMR runs continuously).
- [x] Build `tugdeck/src/lib/lazy/wasm-init.ts` (the helper); refactor `load-tugdiff-wasm.ts` to use it.
- [x] Rewrite `tuglaws/wasm-crates.md` to describe the sub-workspace, the build script, and the loader convention. Remove the "checklist for adding a new crate" 10-step list; replace with the 3-step new shape.

*Thread B — side-by-side + persistence:*
- [x] Add `viewMode: "inline" | "side-by-side"` prop to `DiffBlock`; default order is tugbank-saved value > prop > `"inline"`. New `cardId` prop scopes the persistence key.
- [x] Implement the side-by-side render branch in `diff-block.tsx` via the new `groupSideBySideRows` helper. Layout: `data-view-mode="side-by-side"` switches the hunk-rows container to a 2-column grid; sbs rows use `display: contents` so each `cell` is a direct grid child. Word-level overlay applies inside both cells of paired rows.
- [x] Re-enable the toggle button; bind to local `viewMode` state; flip label/aria-pressed based on current mode.
- [x] Wire `dev.tugtool.tide.diff-view/<cardId>` reads/writes through `tugbank-client` via the new `lib/diff/diff-view-pref.ts` module. Read on first render via `useState` initializer (synchronous from the populated cache, no flash); write on toggle.
- [x] Add `--tugx-diff-sbs-*` tokens (column-gap, blank-cell tint) to harmony and brio.

*Thread C — Shiki merge:*
- [x] Enrich `WordDiffSegment` to carry per-side `[start, end)` ranges via a discriminated union (`equal | delete | insert` each carry only the ranges that apply). `wordLevelDiffSync` walks once, accumulating `beforePos` / `afterPos`.
- [x] Implement `syntax-tokens-from-shiki.ts`: parses Shiki's per-line HTML into `{start, end, style}[]`. Decodes the standard HTML-entity quintet so offsets index into the *decoded* line text.
- [x] Implement `render-line.ts`: pure `renderLineSegments(text, syntaxTokens, wordRanges) → RenderedSegment[]`. Single boundary-set walk; emits a segment per (syntax-style, word-class) change. Plus `wordRangesForSide` helper to project a `WordDiffSegment[]` into `WordRange[]` per side.
- [x] Wire it into `DiffBlock`. Shiki lazy-loads when `data.filePath` resolves through `detectLanguage` (FileBlock's `EXT_TO_LANG`); per-line tokens cached by line text in a Map. Both inline and side-by-side render paths consume the merge via `renderLineContent`.
- [x] Verified: both view modes render Shiki-styled context lines and double-attributed (style + class) spans on paired remove/add lines. Graceful degradation: when Shiki rejects, lines fall back to plain text + word overlay (no exception, no missing content); unknown extensions never attempt the load.

**Tests:**

*Thread A:*
- [x] `cd tugdeck/crates && cargo test --workspace` passes (15 tests in tugdiff-wasm; tugmark-wasm has no tests; both build and link cleanly).
- [x] `cd tugdeck/crates && cargo clippy --workspace --all-targets -- -D warnings` clean.
- [x] `just wasm` produces fresh `pkg/` for both crates via `scripts/build-wasm.sh`; `pkg/.gitignore` is empty so commits don't need `-f`.
- [x] `bun test` continues to pass (3423/3423) after the loader refactor.

*Thread B:*
- [x] `viewMode` prop respected on initial render (`data-view-mode` attribute, sbs row markup vs. inline row markup).
- [x] Toggle button click flips `viewMode`; `aria-pressed` and label update.
- [x] Tugbank read on mount: a seeded fakeTugbank returning `"side-by-side"` causes first render to be side-by-side (no flash).
- [x] Tugbank write on toggle: a mocked `fetch` confirms a single PUT to `/api/defaults/dev.tugtool.tide.diff-view/<cardId>` with `{ kind: "string", value: "side-by-side" }`.
- [x] Side-by-side row grouping covers context, paired remove+add, lone remove, lone add, and runs of N removes + M adds (zip semantics).

*Thread C:*
- [x] `render-line.ts` golden fixtures: TS identifier change (`let` → `var`), bash multi-token change (`echo $foo` ↔ `printf $bar`), word range fully inside a single token, range crossing token boundaries. Each verifies double-decorated segments at overlaps and the invariant that segment text concatenation reconstructs the input.
- [x] `syntax-tokens-from-shiki.ts` round-trip: Shiki-styled HTML → `SyntaxToken[]` → reconstructed offsets; HTML-entity decoding (`&lt;` etc.) keeps offsets aligned with the decoded source line.
- [x] Component integration: mounting DiffBlock with `data.filePath = "foo.ts"` and a stub Shiki produces a remove-side `<span class="tugx-diff-word-remove">` carrying both the class AND a Shiki `style="color:..."` attribute. Mirror coverage for the add side. Context lines get Shiki styling but no word-level class.
- [x] Graceful degradation: when the stub Shiki import rejects, paired remove/add lines still render `tugx-diff-word-*` spans (no `style` attribute) and the line text remains visible. Unknown extensions short-circuit the loader entirely.

**Checkpoint:**
- [x] `cd tugdeck/crates && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings` clean (15 tests in tugdiff-wasm pass; clippy quiet).
- [x] `just wasm` runs via `scripts/build-wasm.sh`; both `pkg/.gitignore` files end up empty so commits don't need `-f`.
- [x] `cd tugdeck && bunx tsc --noEmit && bun test` clean (3468 tests pass; tsc clean).
- [ ] Manual: open a Tide card with a diff in both inline and side-by-side modes; toggle persists across reload (deferred to user — HMR is always running).

---

#### Step 10.6: `TugCue` — banner-shaped click target for body-kinds {#step-10-6}

**Depends on:** none (foundation for #step-10-8)

**Commit (after design gate):** `feat(tugways): add TugCue — banner-shaped inline click target`

**References:** [L11], [L15], [L19], [L20], `tuglaws/component-authoring.md`, `tuglaws/responder-chain.md`, `roadmap/component-library-roadmap.md`

**Why this step exists.** The body-kind layer (FileBlock, DiffBlock, and future siblings) repeatedly needs a "soft inline banner that is also a click target" — most visibly the `tugx-file-collapsed-hint` and `tugx-diff-collapsed-hint` panels that say things like *"1,230 lines folded — click to expand."* Today these are bare HTML `<button>` elements styled with `--tugx-<kind>-*` tokens; the same pattern recurs at `tugx-file-toggle`, `tugx-file-icon-btn`, `tugx-file-search-*`, `tugx-diff-toggle`, `tugx-diff-view-toggle`, `tugx-diff-hunk-toggle`. None of the existing public Tug components fit:

- `TugPushButton` adds `text-transform: uppercase; letter-spacing: 0.06em` (a CTA look). Wrong tone for a soft hint, wrong shape for a full-width banner.
- `TugIconButton` is icon-only and focus-refusing — wrong shape, wrong focus discipline.
- `TugBanner` is an app-modal status/error strip with a scrim and `inert` blocker. Wrong layer.
- `TugBulletin` is toast notifications via Sonner. Wrong layer.

So we have a real hole. Step 10.8 ("click Expand to view does nothing") sits on top of this hole. Rather than paper over it with another bare `<button>`, this step introduces the missing primitive.

**Decision: design-first, then implement.** Step 10.6 lands in two parts:

  1. **Gallery card with design variants.** A new `tugdeck/src/components/tugways/cards/gallery-tug-cue.tsx` ships 4–6 visual variants of the component — variations across `tone` (default | accent | danger), `density` (compact | comfortable), border treatment (none | hairline), text style (italic | roman), and an optional leading icon. The card mounts in the gallery deck for visual inspection. **No production wiring** at this phase — pure design exploration.

  2. **Production component.** Once you've picked the variant(s), the public component lands at `tugdeck/src/components/tugways/tug-cue.tsx` + `.css` with its token slot family and full a11y. The chosen variant becomes the default; non-chosen variants either become explicit `role` / `density` props or get dropped. Note: per `tuglaws/token-naming.md` the canonical slot-5 term is `role` (not `tone`); the prop name follows.

The split is deliberate: I don't ship the component until you've vetted the design.

**Decision: chain-action + onClick, matching `TugButton`'s API.** Per [L11] every actionable control should be able to dispatch through the responder chain. The public API surface mirrors `TugButton`'s mutually-exclusive `onClick` / `action` props, plus the targeted-dispatch `target` prop, plus the standard `disabled` / `aria-*` passthrough. Future call sites that want chain-action (e.g. a TideThinkingBlock cue dispatching `revealThinking` to the card responder) get it for free.

**Decision: own token slot is `--tugx-cue-*`.** Per `tuglaws/token-naming.md`, the `--tugx-*` prefix is the canonical namespace for component aliases — TugAlert, TugBanner, TugPopover, TugBadge all use `--tugx-<name>-*`. Reserved `--tug-*` is for global scale/dimension primitives (`--tug-space-*`, `--tug-radius-*`). TugCue follows the same convention: `--tugx-cue-*` resolves to base-tier `--tug7-*` tokens per [L17]. Body-kinds that compose TugCue may pass `className` to scope-style at the host's surface.

**Artifacts:**

*Phase 1 — Design gallery:*
- New: `tugdeck/src/components/tugways/cards/gallery-tug-cue.tsx` — a card that mounts 4–6 candidate variants of the component, each with its own click handler logging to a debug strip. Driven by ad-hoc prototype JSX rather than a finished component import so design iteration is fast.
- Optionally: a small `.css` sidecar for the gallery card if the prototypes need ad-hoc layout.
- Gallery registration in `tugdeck/src/components/tugways/cards/gallery-registrations.tsx`.

*Phase 2 — Production component (after design gate):*
- New: `tugdeck/src/components/tugways/tug-cue.tsx` + `.css`. Per [L19]: module docstring, exported props interface, `data-slot="tug-cue"`, `@tug-pairings` table in the CSS file.
- Token slot family `--tugx-cue-*` declared in the component's own `tug-cue.css` `body {}` block (matching the TugBanner / TugAlert / TugPopover convention); per-theme tuning flows through the `--tug7-*` base tokens those aliases resolve to.
- Updated `tugdeck/src/components/tugways/cards/gallery-tug-cue.tsx` to import the finished component (not the prototype JSX) and exercise every prop / state combination.
- New: `tugdeck/src/components/tugways/__tests__/tug-cue.test.tsx`.
- Updated: `roadmap/component-library-roadmap.md` "New Component Ideas" — add TugCue entry, mark as implemented in the appropriate group.

**Tasks:**

*Phase 1 — Design gallery:*
- [x] Sketch 4–6 visual variants. Candidate axes: tone (default / accent / danger), density (compact / comfortable), border (none / hairline), text style (italic / roman), with/without leading icon (a `Hint` chevron or similar lucide glyph).
- [x] Build `gallery-tug-cue.tsx` with each variant labeled, mounted in a stack, click logging.
- [x] Register the gallery card and verify it shows up in the gallery deck.
- [ ] **Design gate: user vets variants and picks the default + which props/values to expose.**

*Phase 2 — Production component (post-gate):*
- [x] Author `tug-cue.tsx` per [L19]. Props interface includes: `children`, `onClick` xor `action`, `target` (when `action`), `icon?`, `role?` (one of `active` | `accent` | `agent` | `caution` | `danger` | `data` | `success` — the seven `--tug7-surface-tone-primary-normal-{role}-rest` values from `tuglaws/token-naming.md`), `density?`, `disabled?`, `aria-expanded?`, `className?`.
- [x] Author `tug-cue.css` with `@tug-pairings` table, `@tug-renders-on` annotations where needed, `--tugx-cue-*` slot family used for every visible declaration. Hover, focus-visible, active, disabled per [L15].
- [x] Declare `--tugx-cue-*` token slots in `tug-cue.css` `body {}` block (per-theme variance via `--tug7-*` base tokens).
- [x] Update the gallery card to import the finished component; remove prototype JSX.
- [x] Tests: render markup, click → onClick, click → chain dispatch (when `action` set), keyboard activation (Enter / Space), focus-visible styling sanity check, `aria-expanded` passthrough.

**Tests:**

- [x] `bun test src/components/tugways/__tests__/tug-cue.test.tsx` passes the full prop / state matrix.
- [x] `bunx tsc --noEmit` clean.
- [x] `bun run audit:tokens lint` clean (token-naming and pairings declared correctly).
- [x] Gallery card renders all variants without console warnings (HMR check).

**Checkpoint:**

- [x] User signs off on Phase 1 design gallery before any Phase 2 work starts.
- [x] `cd tugdeck && bunx tsc --noEmit && bun test && bun run audit:tokens lint` all clean.
- [x] Gallery card visible in the gallery deck and exercises every prop.
- [x] Component-library-roadmap entry added.

---

#### Step 10.7: `BashToolBlock` detects unified-diff output and routes through `DiffBlock` {#step-10-7}

**Depends on:** none (uses #step-6 BashToolBlock + #step-10 DiffBlock, both shipped)

**Commit:** `feat(tide-rendering): BashToolBlock — render unified-diff output via DiffBlock`

**References:** [D05], [D09], Spec S02, Spec S03

**Why this step exists.** When bash runs `git show`, `git diff`, `git log -p`, or any pipeline that produces a unified diff, the output IS a diff — but it currently renders as plain terminal text because `BashToolBlock` unconditionally composes `TerminalBlock`. We have `DiffBlock` for exactly this content shape; the missing piece is the routing decision. Real user feedback from the live Tide session prompted this step: opening `git show <sha>` rendered as monospaced bash text, not as the rich diff view we just built.

**Decision: heuristic-gate before parse.** Detection runs as a fast string scan on `textOutput` before any parsing. The gate matches when *any* of these markers appear at a reasonable position:

  - `\ndiff --git ` — strongest signal; only `git diff` and friends emit this exact prefix.
  - `\n@@ -<n>[,<n>] +<n>[,<n>] @@` — hunk-header marker; the JS parser already recognizes it.
  - `^commit [0-9a-f]{7,40}\n` — `git show` and `git log -p` open with this; combined with `diff --git` below it, an excellent signal.

When the gate matches, `BashToolBlock` parses the output via `parseUnifiedDiffText` (already shipped, JS-only, no WASM dependency) and feeds the resulting hunks into `DiffBlock` as `source: "hunks"`. When the parser returns zero hunks (rare, only if the markers were false positives), the wrapper falls back to `TerminalBlock` so nothing renders blank.

Falling back to `TerminalBlock` on no-match is what makes this safe to enable by default: the worst case for benign bash output is "still renders as terminal" (no regression).

**Decision: detection lives in `BashToolBlock`, not a shared helper.** Other tool wrappers may eventually want similar smart-pick routing, but generalizing it now would be premature. The function is small, well-tested, and self-contained — promote it to a shared helper when a second consumer needs it.

**Artifacts:**

- Updated: `tugdeck/src/components/tugways/cards/tool-wrappers/bash-tool-block.tsx` — adds `isUnifiedDiffOutput(text)` helper, conditional body-kind selection.
- Updated: `tugdeck/src/components/tugways/cards/tool-wrappers/__tests__/bash-tool-block.test.tsx` — fixture coverage for `git show`, `git diff`, `git log -p`, plus benign bash output that contains a `@@` line in passing (must not mis-route).
- Updated: `tugdeck/src/components/tugways/cards/gallery-registrations.tsx` (or the bash gallery card) — add a fixture demonstrating bash + diff routing.

**Tasks:**

- [x] Implement `isUnifiedDiffOutput(text: string | undefined): boolean` in `bash-tool-block.tsx` (or a sibling util file). Heuristic scans only the first ~2 KB of output to keep the check O(1) for large outputs.
- [x] In the body-composition branch (where `BashToolBlock` currently always returns `<TerminalBlock>`), gate on `isUnifiedDiffOutput(textOutput) && parsed.length > 0`. Pass `<DiffBlock data={{ source: "hunks", hunks: parsed }}>` when both conditions hold. *(Implemented via the `tryParseBashDiff` helper which composes the heuristic + parse and returns `null` on either miss.)*
- [ ] When `cardId` is available to the bash wrapper, thread it through to `DiffBlock` for persistence. *(Deferred: `cardId` is not yet on `ToolWrapperProps`. Threading it requires a broader plumbing change through `dispatchToolCallState`, `TranscriptToolCalls`, and every wrapper — orthogonal to the diff-routing shipped here. DiffBlock falls back to local view-mode state per Step 10.5 when no `cardId` is provided, so the visual behavior is identical; only cross-mount persistence is missing. Track in a follow-up that touches all wrappers at once.)*
- [ ] When the bash output's first line is `commit <sha>`, use that as `data.filePath = null` (no path) and the commit-sha gets surfaced via the chrome header. *(Deferred: `parseUnifiedDiffText` returns hunks only — file paths from `diff --git a/foo b/foo` lines are not extracted. For v1 the file-name column in DiffBlock's header is intentionally blank; the chrome header already shows the full `git show <sha>` command so the commit context is visible. A follow-up can extend the parser to surface both filePath and commit sha when a real consumer needs them.)*
- [x] Gallery fixture: a bash card with stub output showing `git show <sha>` text routing through DiffBlock. *(See `gallery-bash-tool-block.tsx` — four canonical states: echo, git show, git diff, git status.)*

**Tests:**

- [x] `isUnifiedDiffOutput` returns true for `git show`, `git diff`, `git log -p` fixture strings.
- [x] `isUnifiedDiffOutput` returns false for `git status`, `ls -la`, and bash output that happens to include `@@` as a literal character in some unrelated context (must not false-positive).
- [x] BashToolBlock with diff-shaped output renders `<DiffBlock>`, not `<TerminalBlock>`.
- [x] BashToolBlock with non-diff output continues to render `<TerminalBlock>`.
- [x] BashToolBlock with diff-shaped output but zero parsed hunks falls back to `<TerminalBlock>` (safety check).
- [x] BashToolBlock with `status === "streaming"` does NOT detect / route — streaming output is incomplete; defer to ready.

**Checkpoint:**

- [x] `cd tugdeck && bunx tsc --noEmit && bun test` clean.
- [ ] Manual: run `bash git show HEAD` against live tugcode and verify DiffBlock renders.

---

#### Step 10.8: Regularize collapse / expand affordances for FileBlock + DiffBlock {#step-10-8}

**Depends on:** #step-10-6 (TugCue), #step-10-7 (per-hunk TugCue refactor — sets the precedent)

**Commit:** `feat(tide-rendering): regularize collapse/expand affordances in FileBlock + DiffBlock`

**References:** [L06], [L11], [L15], [L19], [L20]

**Why this step exists.** Across `FileBlock` and `DiffBlock`, four distinct affordance shapes had accumulated: bespoke tiny chevron buttons in the header (`.tugx-file-toggle`, `.tugx-diff-toggle`), bare non-interactive collapsed-hint banners (`.tugx-file-collapsed-hint`, `.tugx-diff-collapsed-hint`), the `Copy` and other in-header icon buttons (already `TugIconButton`-style), and the per-hunk diff header (now `TugCue` after #step-10-7). The bare banners are a real bug — `ReadToolBlock` (and any wrapper suppressing its own body's chrome) composes `FileBlock` in `embedded` mode, hiding the header — including the Expand toggle. The collapsed-hint banner says *"1,234 lines folded — click Expand to view,"* but the Expand button is hidden and the banner is a non-interactive `<div>`. The text is a lie; nothing happens when you click. `DiffBlock` ships the parallel dead-end.

#step-10-7 already proved out the right shape for one of these — the diff per-hunk header — by replacing a bespoke `<div role="button">` + tiny inner chevron with `<TugCue role="muted" align="start" mono icon={ChevronDown|Right}>`. This step generalizes that pattern across the rest of the FileBlock + DiffBlock surface.

**Decision: three affordance shapes, one component each, mapped to use cases.** No more bespoke micro-buttons in body-kinds.

| Shape | Use case | Component | Token family |
|---|---|---|---|
| **A — Reveal cue** | The whole content is folded; the cue IS the only thing visible besides the header. Click to expand. | `<TugCue role="active" icon={<ChevronsDown />} onClick={…}>` | `--tugx-cue-*` |
| **B — Structural divider cue** | Inside expanded content, a banner separator that toggles a sub-section. (Per-hunk diff header; future siblings.) | `<TugCue role="muted" align="start" mono icon={<ChevronDown|ChevronRight />}>` | `--tugx-cue-*` |
| **C — Header collapse toggle** | Re-collapse expanded content from the header bar. Peer to the `Copy` icon button. | `<TugIconButton tone="default" icon={<ChevronsUp />} aria-label="Collapse" />` | reuses `--tug-button-*` (no body-kind tokens) |

Shape B already shipped in #step-10-7. Shapes A and C are the new work.

**Decision: `role="active"` for the reveal cue.** Shape A is the cue user sees *instead of* content — it has to feel inviting, not subdued. The blue `active` tint (variant G's default) reads as "this is *the* affordance to reveal content." Shape B's `muted` is right for structural dividers between visible content, but wrong here.

**Decision: paired ChevronsDown / ChevronsUp icons.** The double-chevron glyph differentiates whole-content reveal from section disclosure. Single-chevron `ChevronDown` / `ChevronRight` stay for shape B (per-hunk and future structural cues). The reveal cue uses `ChevronsDown` ("unfold downward, more below"); its symmetric counterpart in the header uses `ChevronsUp` ("fold back upward"). The pair reads as one round-trip.

**Decision: header collapse toggle = `TugIconButton`, not a bespoke chevron.** The existing `.tugx-file-toggle` and `.tugx-diff-toggle` are bespoke micro-buttons with their own `--tugx-{file,diff}-toggle-*` token families. They sit next to the existing `.tugx-file-icon-btn` / `.tugx-diff-icon-btn` `Copy` controls — which themselves are bespoke. The right answer is to make all of these `TugIconButton`s: standardizes the header right-edge vocabulary, retires four token slot families, and gives focus / hover / active states the same treatment everywhere. (The view-mode toggle `inline / side-by-side` in DiffBlock is a separate concern — it's a *picker*, not a single-action button; out of scope here.)

**Token surface that retires after this step:**

- `--tugx-file-collapsed-*` (4 tokens) — replaced by `--tugx-cue-*`
- `--tugx-diff-collapsed-*` (4 tokens) — replaced by `--tugx-cue-*`
- `--tugx-file-toggle-*` (~5 tokens) — replaced by `TugIconButton`'s tokens
- `--tugx-diff-toggle-*` (~5 tokens) — same
- `--tugx-file-icon-btn-*` (if present) and `--tugx-diff-icon-btn-*` (Copy/etc.) — converted to `TugIconButton` (defer if any Copy button is touched by #step-10-9; otherwise convert here)

Per-hunk tokens (`--tugx-diff-hunk-header-*`, `--tugx-diff-hunk-toggle-*`) were retired in #step-10-7.

**Visual continuity guarantee.** The reveal cue's `active` blue tint is the same one already shipped in `TugCue` and verified in `gallery-tug-cue`. The header `TugIconButton`s reuse the same ghost-action styling as the existing `Copy` button (which is already on `TugIconButton` shape per #step-7), so the header bar reads as a row of peer icon buttons after this step — no visual surprise.

**Artifacts:**

*Reveal cues (Shape A):*
- Updated: `tugdeck/src/components/tugways/body-kinds/file-block.tsx` — `.tugx-file-collapsed-hint` `<div>` becomes `<TugCue role="active" icon={<ChevronsDown />}>`. Hint text updated to *"X lines folded — click to expand"*. `onClick` calls the existing collapsed-toggle path.
- Updated: `tugdeck/src/components/tugways/body-kinds/file-block.css` — drop `.tugx-file-collapsed-hint` style block; retire `--tugx-file-collapsed-*` slots in `harmony.css` / `brio.css` / `tug-active-theme.css`.
- Updated: `tugdeck/src/components/tugways/body-kinds/diff-block.tsx` — same treatment for `.tugx-diff-collapsed-hint`.
- Updated: `tugdeck/src/components/tugways/body-kinds/diff-block.css` — same.
- Updated: theme files retire `--tugx-diff-collapsed-*` slots.

*Header collapse toggles (Shape C):*
- Updated: `tugdeck/src/components/tugways/body-kinds/file-block.tsx` — bespoke `<button className="tugx-file-toggle">` becomes `<TugIconButton icon={isCollapsed ? <ChevronsDown /> : <ChevronsUp />} aria-label={…} onClick={toggleCollapsed} />`.
- Updated: `tugdeck/src/components/tugways/body-kinds/diff-block.tsx` — same for `.tugx-diff-toggle`.
- Updated: `file-block.css` / `diff-block.css` — drop the `.tugx-file-toggle` / `.tugx-diff-toggle` rule blocks.
- Updated: theme files retire `--tugx-file-toggle-*` and `--tugx-diff-toggle-*` slots.

*Gallery + tests:*
- Updated: `tugdeck/src/components/tugways/cards/gallery-tug-cue.tsx` — add a new **"Affordance use-cases"** section that shows the three regularized shapes side-by-side inside fake-host frames so the design vocabulary can be vetted in one place:
    1. **Shape A — Reveal cue (collapsed FileBlock).** Fake FileBlock-like frame with only its header visible and a `<TugCue role="active" icon={<ChevronsDown />}>X lines folded — click to expand</TugCue>` at the bottom. Click toggles a local expanded state so the cue can be exercised live.
    2. **Shape B — Structural divider (diff hunk header).** Keep the existing "code-context cue" section; rename its title to match the shape vocabulary so the gallery reads as a coherent set.
    3. **Shape C — Header collapse toggle.** Fake FileBlock-like frame in *expanded* state with a `<TugIconButton icon={<ChevronsUp />} aria-label="Collapse" />` in the header row, peer to a `Copy` `TugIconButton`. Demonstrates the paired-icon vocabulary across the header and the body.
  Each fake-host frame uses the existing `cg-tug-cue-host*` helpers so the gallery card stays visually consistent.
- Updated: `tugdeck/src/components/tugways/body-kinds/__tests__/file-block.test.tsx` — banner is interactive; header toggle is a `TugIconButton`.
- Updated: `tugdeck/src/components/tugways/body-kinds/__tests__/diff-block.test.tsx` — same.

**Tasks:**

*Reveal cue (Shape A):*
- [x] In `file-block.tsx`: replace the `.tugx-file-collapsed-hint` `<div>` with `<TugCue role="active" icon={<ChevronsDown />} aria-expanded={false} onClick={…}>{N} lines folded — click to expand</TugCue>`. The cue replaces the entire `<div>` — no extra wrapper.
- [x] Drop `.tugx-file-collapsed-hint` rule block from `file-block.css`. Retire `--tugx-file-collapsed-padding`, `-bg`, `-color`, `-size` from `harmony.css` / `brio.css` / `tug-active-theme.css`.
- [x] Repeat in `diff-block.tsx` / `diff-block.css` / theme files for the diff sibling.
- [x] Confirm the cue's `aria-expanded={false}` carries through (TugCue already passes it through verbatim — test pins this).

*Header collapse toggle (Shape C):*
- [x] In `file-block.tsx`: replace the bespoke `<button className="tugx-file-toggle">` with `<TugIconButton icon={isCollapsed ? <ChevronsDown /> : <ChevronsUp />} aria-label={isCollapsed ? "Expand file" : "Collapse file"} onClick={toggleCollapsed} />`.
- [x] Drop the `.tugx-file-toggle` rule block from `file-block.css`. Retire `--tugx-file-toggle-*` slots from the theme files.
- [x] Repeat in `diff-block.tsx` / `diff-block.css` / theme files for the diff sibling.

*Theme-file `--tugx-*` cleanup (in-scope expansion):*
- [x] **Bulk migration.** Discovered during 10.8 work that the entire body-kind / chrome surface had been violating `tuglaws/token-naming.md` ("`--tugx-*` is component-local; theme files own only `--tug7-*`, `--tug-*`, `--tugc-*`"). Migrated *every* in-scope `--tugx-*` slot family out of `harmony.css` / `brio.css` / `tug-active-theme.css` into the owning component's CSS `body {}` block. Families moved: `--tugx-file-*`, `--tugx-diff-*`, `--tugx-term-*` (non-ANSI), `--tugx-toolblock-*`, `--tugx-thinking-*`, `--tugx-transcript-*`, `--tugx-md-*`, `--tugx-list-view-*`, `--tugx-text-editor-*`. Raw rgba values converted to `--tug7-*` analogs where one existed; theme variance flows through the base layer.
- [x] **Surviving in theme files** (justified): `--tugx-control-disabled-opacity` (shared utility, per the law's own example); `--tugx-host-canvas-color` (host-level theme primitive); `--tugx-term-ansi-*` (ANSI palette — each theme picks its own ANSI hues; no canonical `--tug7-*` home for a 16-color palette).
- [x] `tide-md-token-coverage.test.ts` rewritten to verify the new contract: theme files declare zero `--tugx-md-*` slots; `tug-markdown-view.css` declares them all.

*Gallery:*
- [x] Add an **"Affordance use-cases"** section to `gallery-tug-cue.tsx` showing the three regularized shapes inside fake-host frames (Shape A collapsed FileBlock, Shape B diff hunk header, Shape C expanded FileBlock header). Each fake host wires a local `useState` so the cue / toggle is exercisable live.
- [x] Add a small intro paragraph at the top of the section that names the three shapes and their tokenized role so the gallery doubles as documentation for callers picking between them.

*Tests:*
- [x] FileBlock: with `collapsed={true}`, clicking the cue fires `onToggleCollapsed(false)`. The cue has `aria-expanded="false"`.
- [x] FileBlock: header collapse `TugIconButton` exists, has appropriate `aria-label`, and clicking it fires `onToggleCollapsed(...)`.
- [x] DiffBlock: parallel coverage for both cue and header toggle.
- [x] Token audit (`bun run audit:tokens lint`) stays clean after the retired slots are deleted.

**Tests (commands):**

- [x] `bun test src/components/tugways/body-kinds/__tests__/file-block.test.tsx`
- [x] `bun test src/components/tugways/body-kinds/__tests__/diff-block.test.tsx`
- [x] `bunx tsc --noEmit`
- [x] `bun run audit:tokens lint`
- [x] `bun test` (full suite — no regressions)

**Checkpoint:**

- [x] All four commands above clean.
- [x] Theme files no longer declare the four retired slot families (plus the much-larger bulk migration above).
- [x] Gallery card renders the "Affordance use-cases" section showing all three shapes; each is exercisable (clicking toggles the local state).
- [ ] Manual: in the live Tide session, open a Read tool result for a long file (`>80` lines) and confirm clicking the cue expands it; confirm the header `ChevronsUp` collapses it back. Repeat for `bash git show HEAD` against a multi-hunk commit (DiffBlock path).

---

#### Step 10.8.5: `--tugx-block-*` shared-utility token family {#step-10-8-5}

**Depends on:** #step-10-8 (the bulk `--tugx-*` migration is in place; this step de-duplicates what landed there)

**Commit:** `refactor(tugways): consolidate body-kind block tokens into --tugx-block-* shared utility`

**References:** [L17], [L19], [L20], `tuglaws/token-naming.md`, `tuglaws/color-palette.md`

**Why this step exists.** Step 10.8 relocated ~290 `--tugx-{file,diff,term,toolblock,thinking,transcript,md,list-view,text-editor}-*` slots out of theme files and into each component's CSS `body {}` block. That fixed the law violation (theme files no longer declare `--tugx-*`) but exposed a separate problem: substantial *duplication* across the now-component-local declarations. An audit of the migrated files counted ~329 slot declarations across 9 component CSS files, with the same `--tug7-*` references reused 5–12 times each:

| `--tug7-*` reference | Times reused as `--tugx-{name}-*` slot value |
|---|--:|
| `--tug7-element-global-text-normal-muted-rest` | 12+ |
| `--tug-font-size-2xs` | 8 |
| `--tug7-element-global-text-normal-default-rest` | 7 |
| `--tug7-surface-global-primary-normal-raised-rest` | 6 |
| `--tug7-element-global-divider-normal-muted-rest` | 6 |
| `--tug-space-xs var(--tug-space-md)` (header pad pattern) | 6 |
| `--tug-font-family-mono`, `--tug-font-size-sm`, `--tug-font-family-base` | 5 each |

That isn't coincidence; it's a coherent shared design pattern — *"code-display block-shaped surface with a chrome strip on top, optional matching strip on the bottom, and tone-tinted feedback bands inside"* — currently expressed as N parallel slot families. FileBlock, DiffBlock, TerminalBlock, ToolWrapperChrome, TideThinkingBlock, and TugMarkdownView all paint that same surface; each declared its own near-identical slot family even though every member resolves to the same `--tug7-*` token.

The law allows this case explicitly. From `tuglaws/token-naming.md`: **"`--tugx-` ... Component aliases, *shared utilities*. Locally defined."** The shared-utility lane is the right home for the block pattern.

**Decision: name the shared family `--tugx-block-*`.** `card` is already taken by TugPane and means a different visual element. `surface` is already a slot *dimension* at the `--tug7-*` level and would create cross-tier name collision. `block` is the natural English word for these structures and matches the internal "body-kind / block kind" convention.

**Decision: shared utility CSS lives at `tugdeck/styles/tugx-block.css`.** Alongside `tug-palette.css` and `tug.css`. Imported once at app root so it loads before any component CSS and the slots are available to every component rule.

**Decision: no new `--tug7-*` introductions.** The current seven-slot vocabulary is adequate. The duplication is at the alias layer, not the base layer. (Exception: the ANSI palette carve-out remains a known issue and is *not* addressed by this step.)

**Decision: per-instance customization preserved.** Components keep their own `--tugx-{component}-*` slots for the parts that ARE component-specific (e.g. `--tugx-diff-line-add-bg`, `--tugx-file-gutter-width`, `--tugx-term-ansi-*`). Consumers can still scope-override per-card via `.tide-card-transcript .tug-list-view { --tugx-list-view-row-gap: ... }`. The shared `--tugx-block-*` family is the *default* for the block-surface pattern, not a ceiling.

**Decision: tone tints are part of the shared family.** TerminalBlock exit badges (success / danger / caution), DiffBlock line bgs (success / danger), ToolWrapperChrome caution chip + error band (caution / danger), and TugCue role surfaces all consume the same `--tug7-surface-tone-primary-normal-{role}-rest` family. Folding these into `--tugx-block-tone-{add,remove,caution,active}-{bg,color}` saves ~12 further declarations and gives the codebase one canonical home for "tone-tinted feedback band" values.

**The shared family (≈22 slots):**

```css
/* tugdeck/styles/tugx-block.css */
body {
  /* Frame — body-kind variant (sits below chrome) */
  --tugx-block-bg:          var(--tug7-surface-global-primary-normal-inset-rest);
  --tugx-block-border:      var(--tug7-element-global-border-normal-muted-rest);
  --tugx-block-radius:      var(--tug-radius-md);
  --tugx-block-margin:      var(--tug-space-md) 0;

  /* Frame — chrome variant (sits above body — used by ToolWrapperChrome) */
  --tugx-block-chrome-bg:   var(--tug7-surface-global-primary-normal-raised-rest);

  /* Code-typography defaults */
  --tugx-block-code-font:        var(--tug-font-family-mono);
  --tugx-block-code-font-size:   var(--tug-font-size-sm);
  --tugx-block-code-line-height: 1.55;

  /* Body text colors */
  --tugx-block-text-color:       var(--tug7-element-global-text-normal-default-rest);
  --tugx-block-text-color-muted: var(--tug7-element-global-text-normal-muted-rest);

  /* Header / footer strip (same shape for both) */
  --tugx-block-strip-padding: var(--tug-space-xs) var(--tug-space-md);
  --tugx-block-strip-gap:     var(--tug-space-sm);
  --tugx-block-strip-bg:      var(--tug7-surface-global-primary-normal-raised-rest);
  --tugx-block-strip-border:  var(--tug7-element-global-divider-normal-muted-rest);
  --tugx-block-strip-color:   var(--tug7-element-global-text-normal-muted-rest);
  --tugx-block-strip-size:    var(--tug-font-size-2xs);
  --tugx-block-strip-font:    var(--tug-font-family-base);

  /* Body row interaction */
  --tugx-block-row-hover-bg: var(--tug7-surface-highlight-primary-normal-hover-rest);

  /* Tone-tinted feedback bands */
  --tugx-block-tone-add-bg:        var(--tug7-surface-tone-primary-normal-success-rest);
  --tugx-block-tone-add-color:     var(--tug7-element-global-text-normal-success-rest);
  --tugx-block-tone-remove-bg:     var(--tug7-surface-tone-primary-normal-danger-rest);
  --tugx-block-tone-remove-color:  var(--tug7-element-global-text-normal-danger-rest);
  --tugx-block-tone-caution-bg:    var(--tug7-surface-tone-primary-normal-caution-rest);
  --tugx-block-tone-caution-color: var(--tug7-element-global-text-normal-caution-rest);
  --tugx-block-tone-active-bg:     var(--tug7-surface-tone-primary-normal-active-rest);
}
```

**Consumption pattern.** Component CSS rules consume `--tugx-block-*` *directly* (one-hop to `--tug7-*` per [L17]) for the parts that are shared. Component-specific overrides remain in the component's `body {}` block under `--tugx-{component}-*`. Example:

```css
/* file-block.css — after Step 10.8.5 */
body {
  /* Component-specific slots only. The block-surface scaffold is consumed
   * directly from `--tugx-block-*` in the rules below. */
  --tugx-file-gutter-width:        3.5em;
  --tugx-file-mark-bg:             var(--tug7-surface-card-primary-normal-findmatch-rest);
  --tugx-file-mark-active-bg:      var(--tug7-surface-card-primary-normal-findmatch-active);
  --tugx-file-mark-active-outline: var(--tug7-element-global-border-normal-accent-rest);
  /* ...other file-specific slots... */
}

.tugx-file {
  background:    var(--tugx-block-bg);
  border:        1px solid var(--tugx-block-border);
  border-radius: var(--tugx-block-radius);
  margin:        var(--tugx-block-margin);
  color:         var(--tugx-block-text-color);
  font-family:   var(--tugx-block-code-font);
  font-size:     var(--tugx-block-code-font-size);
  line-height:   var(--tugx-block-code-line-height);
}

.tugx-file-header {
  padding:    var(--tugx-block-strip-padding);
  gap:        var(--tugx-block-strip-gap);
  background: var(--tugx-block-strip-bg);
  border:     1px solid var(--tugx-block-strip-border);
  color:      var(--tugx-block-strip-color);
  font-size:  var(--tugx-block-strip-size);
  font-family: var(--tugx-block-strip-font);
}
```

**Expected reduction.** Per-component slot counts mapped to either shared (drop) or component-specific (keep):

| Component | Before | After | Drops |
|---|--:|--:|--:|
| FileBlock | 57 | ~25 | 32 (frame, code typography, header, hover) |
| DiffBlock | 55 | ~25 | 30 (frame, header, stats, line-add/remove bgs+markers, hunk divider) |
| TerminalBlock (non-ANSI) | 47 | ~12 | 35 (frame, code typography, footer, exit-zero/exit-nonzero/interrupted badges) |
| ToolWrapperChrome | 41 | ~12 | 29 (frame-chrome, header, footer, caution chip, error band) |
| TideThinkingBlock | 22 | ~10 | 12 (frame, header padding/bg/border) |
| TugMarkdownView | 76 | ~58 | 18 (inline-code, fenced-code bgs, hr, table borders/header-bg/row-alt) |
| Transcript / list-view / text-editor | 31 | 31 | 0 |
| **Total** | **329** | **~173** | **~156 (≈47%)** |

Roughly half the slot declarations collapse — and every drop replaces a unique alias name with a shared one, which makes "all body-kinds use the same header strip color" a *fact* rather than an *aspiration* maintained by ~6 parallel slot definitions kept in sync by convention.

**Artifacts:**

- New: `tugdeck/styles/tugx-block.css` — the shared utility family above. Module docstring documenting the role of this file in the three-tier architecture (per `tuglaws/color-palette.md`: palette → base → component).
- Updated: `tugdeck/styles/tug.css` (or app-root entry) — import the new file. Load order: after palette, before component CSS.
- Updated: `tugdeck/src/components/tugways/body-kinds/file-block.css` — drop frame/typography/header/hover slots from body{}; rewrite rules to consume `--tugx-block-*`.
- Updated: `tugdeck/src/components/tugways/body-kinds/diff-block.css` — same pattern; keep diff-specific slots (line bgs, word bgs, hunk divider, sbs blanks, stats, view-toggle).
- Updated: `tugdeck/src/components/tugways/body-kinds/terminal-block.css` — same pattern; keep ANSI palette and the bg/border/footer-specific copy button slots.
- Updated: `tugdeck/src/components/tugways/cards/tool-wrappers/tool-wrapper-chrome.css` — use `--tugx-block-chrome-bg` for the chrome variant frame; consume strip + tone tints.
- Updated: `tugdeck/src/components/tugways/chrome/tide-thinking-block.css` — same pattern.
- Updated: `tugdeck/src/components/tugways/tug-markdown-view.css` — fold inline-code bg, fenced-code bg, hr color, table border/header-bg/row-alt, footnote border into `--tugx-block-*`. Markdown-specific typography (heading scale, blockquote, link decoration, list indents) stays.
- Updated: `tugdeck/src/components/tugways/__tests__/tide-md-token-coverage.test.ts` — refresh the required-slot list since md-specific slots now exclude what folded into `--tugx-block-*`.
- Updated: `tuglaws/component-authoring.md` — document the `--tugx-block-*` family as the canonical home for the block-surface pattern; the next body-kind author consumes it rather than rolling new parallel slots.

**Tasks:**

- [x] Author `tugdeck/styles/tugx-block.css` with the body{} block above.
- [x] Wire the import at the app-root CSS entry (after palette + base, before component CSS) via `src/globals.css`.
- [x] Per component (file-block, diff-block, terminal-block, tool-wrapper-chrome, tide-thinking-block, tug-markdown-view): identify each slot whose value is identical to its `--tugx-block-*` counterpart. Delete those declarations from the component's body{}; replace `var(--tugx-{component}-X)` with `var(--tugx-block-X)` in the component's CSS rules.
- [x] For each component, keep the `body {}` block intact (still the file-pair anchor per [L19]); it now only declares the *component-specific* slots.
- [x] Run `bun run audit:tokens lint` after each component to catch any straggler that broke its pairings.
- [x] Update `tide-md-token-coverage.test.ts` to reflect the reduced md-specific slot list (the spot-check required-list).
- [x] Add a doc paragraph to `tuglaws/component-authoring.md` (under the existing token-naming section): *"For body-kinds and chrome wrappers, consume `--tugx-block-*` directly for the shared block-surface pattern (frame, code typography, header/footer strip, hover, tone tints). Component-specific slots are reserved for parts that differ."*

**Tests:**

- [x] `bun test src/components/tugways/body-kinds/__tests__/file-block.test.tsx`
- [x] `bun test src/components/tugways/body-kinds/__tests__/diff-block.test.tsx`
- [x] `bun test src/components/tugways/__tests__/tide-md-token-coverage.test.ts`
- [x] `bunx tsc --noEmit`
- [x] `bun run audit:tokens lint` — zero violations.
- [x] `bun test` (full suite — no regressions). 3533/3533 pass.

**Checkpoint:**

- [x] All commands above clean.
- [x] `tugx-block.css` exists, imported once at the app root.
- [x] Slot count net delta: **−158** declarations across the six affected component CSS files (298 → 140); plus 25 new slots in the shared utility. Plan predicted ~−156 / 22; actual very close.
- [ ] Manual: open the Tide gallery's `gallery-tug-cue` (Affordance use-cases section), `gallery-bash-tool-block`, and a few Tide session cards (a long Read result + a `git show` diff). Confirm both brio and harmony render identically to before the consolidation.
- [x] `tuglaws/component-authoring.md` documents the `--tugx-block-*` family.

---

#### Step 10.9: Pinned headers + CM6 file viewer {#step-10-9}

**Depends on:** none (foundation for future entry-level controls + the second public consumer of the CM6 substrate already in `tug-text-editor`).

**Commit:** `feat(tide-rendering): pin transcript entry + content block headers; FileBlock on CM6 (TugCodeView)`

**References:** [L02], [L03], [L06], [L19], [L20]

**Why this step exists.** Three problems share one structural cause, plus a fourth caused by parallel implementations of the same feature:

1. **Per-line horizontal scrollbars in `FileBlock`.** Each `.tugx-file-content` cell is its own `overflow-x: auto` scroll container, so wide lines render N stacked per-row scrollbars. Real user-reported visual bug from the live Tide session — see screenshot in the task that motivated this recast.
2. **Copy button overlapping the scrollbar in `TerminalBlock`.** Copy is an `position: absolute` overlay inside the body scroller. It sits on top of the vertical scrollbar gutter — and worse, on the corner where both scrollbars meet — for any output tall enough to trigger scrolling.
3. **Block affordances scroll away with the body.** When you scroll a long FileBlock / DiffBlock body, the Copy / Search / Collapse / view-mode controls all live in the header strip that scrolls off the top of the viewport. Users have to scroll back up to reach them.
4. **`FileBlock` reimplements a text engine we already own.** The bespoke `.tugx-file-rows` DOM tree, per-row scroller, per-line click gesture, Shiki-overlay swap, and Cmd-F overlay are all features that `@codemirror/view` provides natively — and that `tug-text-editor` already exposes for the editing side. Maintaining two parallel text-display systems means *every* fix has to ship in two places and inevitably drift; the per-line scrollbar bug is a direct symptom of the maintenance gap.

Problems 1–3 collapse into "affordances live at a stable visible location, never on top of a scrollbar, never scrolled away." The structural fix is **pinned headers** at two nesting levels: the `TugTranscriptEntry` header (identifier + timestamp + future entry-level controls) and each content block's own header (FileBlock path/lang/buttons; DiffBlock path/stats/buttons; new TerminalBlock header with command summary + Copy). Problem 4 collapses into "use CM6 for any file-based text content" — which dissolves the per-line scrollbar by construction (CM6's `EditorView.lineWrapping` is a single extension), brings find/search/selection/large-file virtualization for free, and aligns the read surface with the edit surface so users see one scroll behavior, one find UI, one selection model, one set of keyboard shortcuts.

**Decision: CM6 is the canonical text engine for file-based content. No exceptions.** `tug-text-editor` already mounts `EditorView` from `@codemirror/state` / `@codemirror/view` / `@codemirror/commands` with the full `Compartment`-based reconfiguration plumbing (soft-wrap, line numbers, read-only, theme, active-line gutter, placeholder — all in place at `tug-text-editor.tsx:83-330`). The packages are already in `tugdeck/package.json`; the bundle cost is paid. FileBlock's bespoke renderer is retired and replaced by a thin read-only CM6-backed primitive that shares its extension stack with the editor. The "one engine, no bespoke scroll bugs ever again, consistent UX across read and edit" outcome is the whole point.

**Decision: extract `TugCodeView`, a read-only sibling to `tug-text-editor`.** Not a flag on `tug-text-editor` — a peer primitive. The editor's responder/selection/focus story is sized for typing; a viewer's responder story is *selection-only* (no cursor, no IME, no edit keymaps). Both share:

- The same extension set: `EditorView.lineWrapping`, `lineNumbers()`, the existing CM6 theme, the Shiki-via-`@codemirror/language` bridge (or a `tugmark` highlight bridge if we wire one).
- The same `Compartment` reconfiguration pattern, so `wrap` / `lineNumbers` / `language` can be toggled at runtime without rebuilding the view.
- The same focus-acceptance / responder-chain integration as the editor.

`TugCodeView` deliberately differs in three ways:

- `EditorState.readOnly.of(true)` permanently in its config (no editable mode).
- No edit keymap; viewer adds `@codemirror/search` for Cmd-F find UI, optionally `@codemirror/commands` for `selectAll` / `copy` shortcuts.
- React shell is simpler: no `onChange` callback, no value mutation, no `state-preservation` payload — the rendered text is the entire input.

`FileBlock` becomes a thin chrome around a `TugCodeView`: header strip (path + lang badge + counts + Copy + Search + Collapse) above a CM6 viewport. The match-highlight overlay, the per-row scroller, the imperative `buildSearchIcon()`, the Shiki content-swap — all retired. Line numbers come from CM6's `lineNumbers()` gutter; soft-wrap from `EditorView.lineWrapping`; search from `@codemirror/search` mounted with our `TugIconButton`-driven trigger.

**Decision: telescoping sticky stack, two levels.** Outer = `TugTranscriptEntry` `__header`. Inner = block header inside the entry body. Outer pins at `top: 0`; inner pins at `top: var(--tugx-pin-stack-top, 0)`. The entry root writes its measured header height to that variable via `ResizeObserver` in `useLayoutEffect` ([L03] before paint; [L06] DOM write, not React state). When both pin simultaneously, the entry header sits at the top of the viewport and the block header sits directly under it — the GitHub PR pattern, the VS Code Sticky Scroll pattern, the iOS UITableView section-header pattern.

Sticky context analysis confirms the layout is safe: `TugListView` uses natural document flow (`tug-list-view.css:84-96` — `display: flex; flex-direction: column; row-gap`, with top/bottom spacers, no transforms, no `position: absolute` on cells). Sticky elements inside cells stick to the list-view's scroll container as expected. `.tugx-file { overflow: hidden }` etc. clip at the file's box, which is the *correct* behavior — the file's pinned header naturally disappears when the entire file scrolls past.

**Decision: Copy moves into block headers; no overlay layer.** The original Step 10.9 added a non-scrolling overlay div for Copy and `scrollbar-gutter: stable` to reserve the gutter — a workaround for the symptom. With pinned headers, Copy lives in the header strip alongside the existing controls; it is *never* overlaid on the body, so the scrollbar conflict cannot exist. `TerminalBlock` currently has no header — this step adds one (mirroring the FileBlock strip shape) and retires the body-overlay Copy and the `--tugx-term-copy-*` slot family.

**Decision: reserve the scrollbar gutter on body scrollers.** `scrollbar-gutter: stable` on `.tugx-term`'s body scroller (and on `TugCodeView`'s inner viewport, if CM6's default isn't already stable). The gutter is always present in layout even when no scrollbar is visible; no jitter when content grows past the viewport. Cheap, principled, eliminates a class of layout-shift bugs.

**Decision: `[data-stuck="true"]` via IntersectionObserver for the stuck-state shadow.** Tugdeck targets WebKit (the Swift host's `WKWebView`); experimental Blink-only proposals like `:stuck` are irrelevant. The pinned-header drop-shadow (a 1px hairline under the header to visually separate it from the scrolled-under body) is driven by an `IntersectionObserver` watching a sentinel element above the header. When the sentinel scrolls out, the observer flips `data-stuck="true"` on the header and CSS paints the hairline. Standard WebKit-safe technique. (Defer to a follow-on polish if v1 ships without it; the pin works without the shadow.)

**Decision: `TugListEntry` becomes the named primitive.** The pinning behavior is documented on `TugTranscriptEntry` as the canonical "named row with sticky header + scrolling body + optional controls under body" pattern. Future surfaces (history panel, audit log, permission log, session inspector) consume the same shape. Establishes the seat for future entry-level affordances (mute thread, mark unread, share entry, jump-to-related, etc.) without re-inventing.

**Three phases:**

##### Phase A — `TugCodeView` + `FileBlock` engine swap

- New: `tugdeck/src/components/tugways/tug-code-view.tsx` + `.css`. Read-only CM6 viewer. Same extension lineage as `tug-text-editor` but shorter: `EditorView.lineWrapping`, `lineNumbers()`, `@codemirror/search`, the shared theme, language extensions, and a thin selection-only responder.
- New: `tugdeck/src/components/tugways/__tests__/tug-code-view.test.tsx`. Mount, value, wrap toggle, line-numbers toggle, language toggle, find UI reveal, selection round-trip.
- Updated: `tugdeck/src/components/tugways/body-kinds/file-block.tsx` — body becomes `<TugCodeView value={content} language={language} wrap lineNumbers />`; the bespoke `.tugx-file-rows` / `.tugx-file-row` / `.tugx-file-content` / `.tugx-file-overlay` DOM tree and the `buildSearchIcon` SVG builder are deleted. Header keeps its current shape (path + lang + counts + `TugIconButton`s). The Cmd-F affordance now triggers CM6's `openSearchPanel` instead of toggling the bespoke search bar — the `--tugx-file-search-*` slot family retires.
- Updated: `tugdeck/src/components/tugways/body-kinds/file-block.css` — drop the retired row/content/overlay/search-bar rule blocks and slot families. Only the frame chrome and header-specific slots remain (path color/weight, lang pill, counts).
- Updated: `tugdeck/src/components/tugways/body-kinds/__tests__/file-block.test.tsx` — rewrite to test the new composition (TugCodeView mount + header). Defer line-level interactive behavior to `tug-code-view.test.tsx`.
- Per-line scrollbar bug **dissolves by construction**: CM6 with `lineWrapping` produces no per-line scrollers; the body has one horizontal-overflow-clipped viewport that vertically scrolls with `pre-wrap`-style break-spaces.

##### Phase B — Block-header pin + `TerminalBlock` header + Copy relocation

- Add `position: sticky; top: var(--tugx-pin-stack-top, 0); z-index: 1` to `.tugx-file-header`, `.tugx-diff-header`, and (new) `.tugx-term-header`. Background already opaque via `--tugx-block-strip-bg`; no bleed-through.
- New `.tugx-term-header` markup in `terminal-block.tsx` — command summary at left (lifted from `ToolWrapperChrome`'s args display when embedded; for standalone use it's a thin path-or-label slot), `TugIconButton` Copy at right. Retire `.tugx-term-copy` overlay DOM and the `--tugx-term-copy-*` slot family. Existing footer (exit / duration / interrupted) stays at the bottom.
- Add `scrollbar-gutter: stable` to `.tugx-term`'s body scroller so the gutter is reserved regardless of content height.
- Optional polish (defer if v1 needs to ship): add `--tugx-block-strip-shadow-stuck` slot to `tugx-block.css`; wire an IntersectionObserver-driven `data-stuck` attribute on each block header.
- Tests: TerminalBlock — header `<TugIconButton>` Copy exists; no `.tugx-term-copy` overlay DOM; `scrollbar-gutter` declared on the scroller.

##### Phase C — Entry-header pin + telescoping variable

- `.tug-transcript-entry__header { position: sticky; top: 0; z-index: 2 }` (higher than block headers so the entry header always wins during transient transitions when both might compete).
- `tug-transcript-entry.tsx` adds a `useLayoutEffect` that creates a `ResizeObserver` on the `__header` element and writes `--tugx-pin-stack-top: ${height}px` onto the entry root. `[L03]` (observer registered before paint) and `[L06]` (DOM write, not React state) both satisfied. Observer disconnect in the effect's cleanup.
- `tug-transcript-entry.tsx` module docstring documents the contract: "child block headers may consume `--tugx-pin-stack-top` to telescope under the entry header when both pin simultaneously. The variable always reflects the live measured height of `__header`."
- Tests: entry mounts; `--tugx-pin-stack-top` is set on the root after layout; updates when `__header` content changes height (simulated via prop change).
- Real-browser sticky behavior is not asserted in happy-dom — defer to the gallery card + manual visual check, per the happy-dom scoping rule.

**Artifacts:**

- New: `tugdeck/src/components/tugways/tug-code-view.tsx` + `.css`.
- New: `tugdeck/src/components/tugways/__tests__/tug-code-view.test.tsx`.
- New: `tugdeck/src/components/tugways/cards/gallery-pinned-headers.tsx` — a tall-content card demonstrating both levels pinning, with a "scroll me" affordance and a synthesized long file + tall terminal + multi-hunk diff so the telescoping is exercisable in the gallery.
- Updated: `tugdeck/src/components/tugways/body-kinds/file-block.tsx` + `.css` + tests — engine swap to `TugCodeView`; retire `.tugx-file-rows` / `-row` / `-content` / `-overlay` / `-search-*` and their slot families.
- Updated: `tugdeck/src/components/tugways/body-kinds/terminal-block.tsx` + `.css` + tests — new header, Copy relocated, `scrollbar-gutter: stable`, overlay DOM retired.
- Updated: `tugdeck/src/components/tugways/body-kinds/diff-block.css` — header pin only (no JSX change).
- Updated: `tugdeck/src/components/tugways/tug-transcript-entry.tsx` + `.css` + tests — sticky outer header + ResizeObserver-driven `--tugx-pin-stack-top`.
- Updated: `tugdeck/src/components/tugways/tug-markdown-view.css` — fenced-code header pin (same `var(--tugx-pin-stack-top)` consumer).
- Updated: `tuglaws/component-authoring.md` — document the pin-telescoping contract and the `TugCodeView` / file-content rule ("CM6 is the canonical text engine for file-based content").

**Tasks (Phase A — CM6 + FileBlock swap):**

- [ ] Author `tug-code-view.tsx` with the read-only CM6 mount, lineWrapping + lineNumbers + search compartments, and a small selection-only responder.
- [ ] Author `tug-code-view.css` with `--tugx-codeview-*` slots that consume `--tugx-block-*` (frame, code typography, strip chrome) directly; component-specific slots only for the gutter color/width and the selection highlight tones.
- [ ] Author `tug-code-view.test.tsx` covering mount, value, wrap toggle, line-numbers toggle, language toggle, find UI reveal, selection round-trip.
- [ ] Swap `file-block.tsx`'s body to `<TugCodeView ...>`; delete the bespoke renderer, the match overlay, the imperative search icon, and the `--tugx-file-rows/-row/-content/-overlay/-search-*` slot families.
- [ ] Rewrite `file-block.test.tsx` against the new composition; defer line-level CM6 behavior to `tug-code-view.test.tsx`.

**Tasks (Phase B — block-header pin + TerminalBlock header):**

- [ ] Add sticky declarations to `.tugx-file-header`, `.tugx-diff-header`, `.tugx-md-fence-header`.
- [ ] Add `.tugx-term-header` markup to `terminal-block.tsx` (command summary + Copy `TugIconButton`); add CSS rule consuming `--tugx-block-strip-*`.
- [ ] Add sticky declaration to `.tugx-term-header`.
- [ ] Add `scrollbar-gutter: stable` to `.tugx-term-scroller` (the body viewport).
- [ ] Retire `.tugx-term-copy` overlay DOM in `terminal-block.tsx`; drop the `--tugx-term-copy-*` slot family from `terminal-block.css`.
- [ ] Update `terminal-block.test.tsx`: header Copy `TugIconButton` exists; no `.tugx-term-copy` overlay; `scrollbar-gutter` declared on the scroller.

**Tasks (Phase C — entry-header pin):**

- [ ] Add `position: sticky; top: 0; z-index: 2` to `.tug-transcript-entry__header`.
- [ ] Add `useLayoutEffect` + `ResizeObserver` to `tug-transcript-entry.tsx`; write `--tugx-pin-stack-top` onto the entry root.
- [ ] Update `tug-transcript-entry.test.tsx`: variable is set after mount; updates on header-content prop change.
- [ ] Update the module docstring with the pin-telescoping contract.

**Tasks (gallery + docs):**

- [ ] Author `gallery-pinned-headers.tsx` showing both levels pinning across a synthesized long file + multi-hunk diff + tall terminal in one transcript turn.
- [ ] Update `tuglaws/component-authoring.md`: add a "Text content" section that names CM6 (via `TugCodeView` or `tug-text-editor`) as the canonical engine for any file-based text surface, and document the `--tugx-pin-stack-top` variable as a shared contract.

**Tests (commands):**

- [ ] `bun test src/components/tugways/__tests__/tug-code-view.test.tsx`
- [ ] `bun test src/components/tugways/body-kinds/__tests__/file-block.test.tsx`
- [ ] `bun test src/components/tugways/body-kinds/__tests__/diff-block.test.tsx`
- [ ] `bun test src/components/tugways/body-kinds/__tests__/terminal-block.test.tsx`
- [ ] `bun test src/components/tugways/__tests__/tug-transcript-entry.test.tsx`
- [ ] `bunx tsc --noEmit`
- [ ] `bun run audit:tokens lint`
- [ ] `bun test` (full suite — no regressions)

**Checkpoint:**

- [ ] All commands above clean.
- [ ] Manual: open Read tool on a 500-line file in both brio and harmony. Confirm: no per-line scrollbars; lines wrap; file header stays visible while scrolling deep into the body; entry header (Claude / `HH:MM AM`) stays at the top of the viewport above the file header.
- [ ] Manual: run a `bash` command with long stdout. Confirm: Copy button sits in the pinned header, never on top of any scrollbar; scrollbar gutter reserved (no horizontal layout shift when output grows past the viewport).
- [ ] Manual: long DiffBlock + tall TerminalBlock in one transcript turn. Confirm telescoping: entry header at top, then block header under it; scrolling between the two blocks transitions cleanly.

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
