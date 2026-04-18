<!-- tugplan-skeleton v2 -->

## T3.4.c — Tide Card (functional registration) {#tide-card}

**Purpose:** Ship the Tide card — the Unified Command Surface — as a registered, functional card that drives a real `CodeSessionStore` against a live tugcast/Claude session. This is the first phase where opening a card in tugdeck means *talking to Claude in a project of your choice*.

The card body is **not** built from the original [tide.md §T3.4.c](./tide.md#t3-4-c-tide-card) snippet. It is built by **copying `tugdeck/src/components/tugways/cards/gallery-prompt-entry.tsx` verbatim** and swapping the mock seams for real backend services. Everything the gallery card has accumulated in the polish pass — maximize toggle with persistence, editor settings popover (Font / Size / Tracking / Leading), atom font embedding, route gutter with `>`/`❯` alias, content-driven sizing gated on maximize, status row layout with the toggle next to the gear — ships intact.

This plan also rides with [T3.0.W3.b](./tide.md#t3-workspace-registry-w3b): bootstrap workspace removal lands in the same commit because the picker's `spawn_session` path replaces it as the source of workspace frames.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-04-17 |
| Roadmap anchor | [tide.md §T3.4.c](./tide.md#t3-4-c-tide-card) |

---

### Phase Overview {#phase-overview}

#### Context {#context}

The original tide.md §T3.4.c text was written before T3.4.b's polish pass. Since [T3.4.b](./tide.md#t3-4-b-prompt-entry) landed `TugPromptEntry`, two gallery cards (`gallery-prompt-entry`, `gallery-prompt-entry-sandbox`) have served as the working surface for everything that arrived after the original spec was authored:

- **Maximize toggle.** `TugPromptEntry` exposes controlled `maximized` + `onMaximizeChange` props (commits `01308ce2`, `29127a77`). The gallery card pegs the panel to `maxSize` via `TugSplitPanelHandle.setTransientSize`, disables the split-pane drag while maximized, and persists the state across reload via `useTugcardPersistence`.
- **Maximize size-writer gating.** The two other writers to panel size — `useContentDrivenPanelSize` and `handleBeforeSubmit`'s animated restore — both stand down while `maximized === true` (commit `d12429ca`). When `maximized === false`, the pane behaves identically to pre-toggle.
- **Editor settings popover.** Tracking + Leading controls were added (commit `02bf55e4`) alongside Font + Size, all four with `topLabel` captions (commit `02bf55e4`'s `tug-popup-button` extension). Backed by `EditorSettingsStore` with `letterSpacing` and `lineHeight` persisted to tugbank.
- **Per-icon-button glyph sizing.** `tug-button.css` gained per-size SVG rules so the maximize and gear icons actually scale with the button's `size` prop (commit `01308ce2`).
- **Atom rendering.** Atoms now embed `@font-face` fonts via `tug-atom-fonts.ts` (commit `7cefe36f`) so labels render in the editor's actual font instead of falling back to generic Courier. Atom label size is `0.96 × editor size` to compensate for SVG vs HTML rasterization differences (commit `254e53dd`). Atom baseline aligns with the surrounding text baseline (commit `a047adff`). Clipboard paste sanitizes WebKit-injected inline styles (commit `992b58c9`).
- **Route prefix in a gutter.** Route atoms were retired entirely (commit `7cefe36f`'s purge); the route is now rendered as text in a separate gutter element. Both `>` (ASCII) and `❯` (chevron) flip the route to Prompt (commit `57a25e47`).

The result: `gallery-prompt-entry.tsx` is the canonical, polished, accessible-feature-complete shape of "a `TugPromptEntry` in a card body". Re-deriving any of this in a fresh `tide-card.tsx` would silently lose features and waste days re-debugging visual edge cases.

What's missing for production: real `CodeSessionStore` against the wire (not `MockTugConnection`), real `SessionMetadataStore` and `PromptHistoryStore` singletons, a `project_dir` picker at card mount, `spawn_session` / `close_session` lifecycle wiring, card registration, and a `lastError` affordance per [tide.md §T3.4.a `lastError`](./tide.md#code-session-store) line 2513.

This plan also lands [T3.0.W3.b](./tide.md#t3-workspace-registry-w3b) — deletion of the bootstrap workspace and the `--source-tree` CLI flag — in the same commit. The bootstrap exists today purely so the existing git/filetree cards have *something* to subscribe to. Once the Tide card's picker drives `spawn_session` for any chosen project, the bootstrap has no remaining job, and removing it in the same commit keeps the transition atomic (no intermediate commit has both "bootstrap gone" and "no UI picker yet").

#### Strategy {#strategy}

- **Copy gallery-prompt-entry wholesale.** The first commit on this plan is `cp tugdeck/src/components/tugways/cards/gallery-prompt-entry.{tsx,css} tugdeck/src/components/tugways/cards/tide-card.{tsx,css}` followed by a rename of the React component (`GalleryPromptEntry` → `TideCardContent`) and the props interface. Nothing else changes in that commit. It builds, it renders, it just isn't registered yet. Every subsequent step replaces a single mock seam or wires one piece of new behavior, with a green build at every commit.
- **Substitution table is the contract.** The work is not "rewrite around real services"; it is to swap a finite, enumerated list of seams. Anything not on the substitution table carries over verbatim from the gallery copy.
- **Project picker is genuinely new.** No existing tugdeck card has a project-path-picker affordance. The minimum viable picker is a single text input + button ("Open project") that takes a path string, validates it exists locally, and calls `spawn_session(cardId, tugSessionId, projectDir)`. File-picker UX (native dialog or drag-drop) is a polish item for T3.4.d.
- **Spawn lifecycle owns the card mount.** On mount, the card encodes `spawn_session(cardId, tugSessionId, projectDir)`, awaits `spawn_session_ok`, calls `cardSessionBindingStore.setBinding(...)`, then constructs the `CodeSessionStore`. On unmount, it calls `sendCloseSession(...)`. The store does NOT send `close_session` itself per [tide.md line 2391](./tide.md#code-session-store). All of this plumbing — `encodeSpawnSession`, `cardSessionBindingStore`, `sendCloseSession` — already exists from W2 Step 7.
- **Single-session mode pre-P2.** Until [Phase T0.5 P2](./tide.md#t0-5) lands, opening a second Tide card either (a) shares the default session with a visible "single-session mode" indicator, or (b) is blocked outright with a message. (a) is preferred for usability; (b) is acceptable if it's simpler to land. This decision belongs in the picker step (Step 4) — call it explicitly, don't drift.
- **lastError affordance lands here.** Per tide.md line 2513, the `errored` UI affordance was deferred from T3.4.a to T3.4.c. Surface `lastError` in the card body — either as a banner above the entry, an inline message, or a status-row badge. Decide in Step 6.
- **W3.b (bootstrap removal) rides in the same commit.** Per [tide.md §T3.0.W3.b](./tide.md#t3-workspace-registry-w3b), removing `--source-tree`, the `registry.get_or_create(&watch_dir, cancel.clone())` bootstrap call, the `server.rs::source_tree` parameter threading, and the `bootstrap.fs_watch_rx` plumbing happens *with* the card landing, not before or after. Tests that assumed the bootstrap workspace are rewritten to call `spawn_session` explicitly, or deleted if the card-mount tests cover the same surface.
- **Manual A/B smoke from W2 Step 8 becomes the closing acceptance test.** [tide.md execution order line 697](./tide.md#execution-order-w2-to-tide) defers the W2 manual smoke to T3.4.c specifically because the card was the missing UI affordance. Closing the plan means: open a Tide card pointed at project A, open a second pointed at project B (single-session-mode permitting), verify distinct `workspace_key` filters end-to-end.
- **Warnings are errors. Tests stay green at every commit.** `bun run check`, `bun run test`, `cargo nextest`, and `bun run audit:tokens lint` all pass on every commit. No `any`, no `@ts-expect-error`, no descendant-selector reach-ins, no IndexedDB. The `gallery-prompt-entry-sandbox` card stays — it remains useful as a synthetic-frame harness even after the Tide card ships.

#### Success Criteria (Measurable) {#success-criteria}

**Card registration & mount:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` and `.css` exist; export `TideCardContent` + `registerTideCard()`. (verification: `tsc --noEmit` clean)
- `tugdeck/src/main.tsx` calls `registerTideCard()` adjacent to `registerGitCard()`. (verification: `rg 'registerTideCard\(\)' tugdeck/src/main.tsx` returns one match)
- Opening a Tide card in the running tugdeck shows: split pane (markdown view top, prompt entry bottom), project-path picker on first mount, all settings-popover controls (Font / Size / Tracking / Leading), maximize toggle, route gutter, project badge after a path is chosen.

**Feature parity with `gallery-prompt-entry` (the baseline contract):**
- Maximize toggle is present, persisted across reload, and disables drag while active. The content sizer and submit-time restore stand down while maximized. (verification: manual; spot-check against gallery card)
- Editor settings popover renders Font / Size / Tracking / Leading with `topLabel` captions; selecting a value updates the editor live and persists to tugbank. (verification: manual)
- Atom labels render in the editor's font (e.g., Hack), not generic monospace. Pasting an atom doesn't introduce styling artifacts. (verification: manual)
- Route gutter shows `❯` for the Prompt route; typing `>` first eats the char and flips the route. (verification: manual + test)
- Content-driven panel sizing grows the bottom panel as the editor overflows and snaps back on `data-empty=true` (when maximize is off). (verification: manual)
- Per-route drafts persist across route switches and across reload. (verification: manual)

**Backend wiring:**
- On mount: `spawn_session(cardId, tugSessionId, projectDir)` is sent; the card waits for `spawn_session_ok` before constructing the `CodeSessionStore`; `cardSessionBindingStore.setBinding(...)` records the binding. (verification: integration test, asserting frame ordering against a mock connection)
- On unmount: `sendCloseSession(...)` is sent; binding is cleared. (verification: integration test)
- The card subscribes to `[CODE_INPUT, CODE_OUTPUT, SESSION_METADATA, FILETREE]` via the registry's `defaultFeedIds`. (verification: registration assertion)
- Submitting `> hello` round-trips through real Claude: `user_message` on `CODE_INPUT` → `assistant_text` deltas on `CODE_OUTPUT` → `TugMarkdownView` renders streaming text → `turn_complete(success)` returns the entry to idle. (verification: manual smoke against a live `tugcast` + `claude` build)

**lastError affordance:**
- When the store's `lastError` is non-null, the card surfaces it visibly (banner / inline / badge — pick one in Step 6). Successful submit clears it per the existing store semantics. (verification: manual + test)

**W3.b coupling:**
- `--source-tree` flag deleted from `tugcast` CLI. `registry.get_or_create(&watch_dir, cancel.clone())` bootstrap call removed. `server.rs::source_tree` parameter threading dropped. `bootstrap.fs_watch_rx` plumbing unwired. (verification: `rg --source-tree tugrust/` returns zero matches; `cargo nextest` green)
- Pre-existing integration tests that assumed the bootstrap workspace are rewritten to call `spawn_session` explicitly, or deleted. (verification: cargo nextest green)
- Daily dev workflow (running tugdeck without flags) still works: opening a Tide card and choosing a project replaces the bootstrap as the source of workspace frames. (verification: manual smoke)

**Single-session degradation pre-P2:**
- Opening a second Tide card while a first is bound either (a) shares the default session with a visible single-session indicator OR (b) is blocked with a message. Decide and document. (verification: manual + test)

**Manual A/B smoke (closes W2 Step 8):**
- Open a Tide card pointed at project A; open a second card pointed at project B (assuming P2 has shipped or the single-session shim is bypassed for testing). Verify each card's FILETREE / FILESYSTEM / GIT feeds carry only its own workspace's frames. (verification: manual; record a session-trace before commit)

**Repo hygiene:**
- `bun run check` exits 0. `bun run test` exits 0 with all tests passing. `bun run audit:tokens lint` exits 0. `cargo nextest run` exits 0 across the workspace. (verification: each step's exit checkpoint)
- No new IndexedDB references introduced (D-T3-10). (verification: `rg -i 'indexeddb' tugdeck/src/components/tugways/cards/tide-card.*` returns zero matches)
- `gallery-prompt-entry-sandbox` is untouched and still functional. (verification: manual)

#### Scope {#scope}

**In scope:**
- Card body (`tide-card.tsx` / `tide-card.css`), card registration in `main.tsx`.
- `useTideCardServices(cardId)` hook constructing per-card `CodeSessionStore` + `PropertyStore` for streaming, plus shared lazy singletons for `SessionMetadataStore`, `PromptHistoryStore`, `FileTreeStore`.
- Project-path picker — text input + "Open project" button only ([D1](#resolved-decisions)). Picker is the full card body until bound; disappears when bound; no in-card re-bind ([D3](#resolved-decisions), [D4](#resolved-decisions)).
- Recent-projects quick-pick (last ≈5 paths persisted in tugbank, rendered as buttons under the picker input) — soft requirement, ship if time permits ([D2](#resolved-decisions)).
- `spawn_session` / `close_session` lifecycle wiring at card mount/unmount, including `cardSessionBindingStore.setBinding` / `clearBinding`.
- `TugMarkdownView` binding to `services.codeSessionStore.streamingStore` / `streamingPath` for the top pane.
- `lastError` UI affordance.
- Single-session mode shim pre-P2.
- Bootstrap removal (W3.b) — `--source-tree` deletion, registry bootstrap call deletion, server.rs threading deletion, related test cleanup.
- Manual A/B smoke as the closing acceptance test.

**Out of scope (deferred):**
- Native file-picker dialog or "Browse…" affordance for project paths — text input only per [D1](#resolved-decisions); native picker is T3.4.d polish.
- In-card re-bind to a different `project_dir` — opening a new card is the gesture per [D4](#resolved-decisions).
- Multi-session via P2 — single-session shim is sufficient for T3.4.c exit.
- Claude `--resume` (P14) — UX informed by T3.4.c, lands separately.
- stream-json version gate (P15) — gates on T3.4.c reducer hardening, lands separately.
- `BuildStatusCollector` per-workspace ([tide.md line 2102](./tide.md#prefix-router-prompt-input)).
- `control_request_forward` (permission/question) UI — lands in T3.4.d per [tide.md §T3.4.d](./tide.md#t3-4-d-polish-exit).

---

### Steps {#steps}

Each step is its own commit. Tests + checks pass at the end of every step.

#### Step 1 — Copy the gallery card verbatim {#step-1}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (new — `cp` of `gallery-prompt-entry.tsx`).
- `tugdeck/src/components/tugways/cards/tide-card.css` (new — `cp` of `gallery-prompt-entry.css`).

**Work:**
- `cp` both files. Rename the exported component (`GalleryPromptEntry` → `TideCardContent`), the props interface (`GalleryPromptEntryProps` → `TideCardContentProps`), the `data-testid` value (`gallery-prompt-entry` → `tide-card`), and the CSS root class (`gallery-prompt-entry-card` → `tide-card`). Update internal class names that referenced the gallery prefix.
- Leave every mock seam (`mockSessionRef`, `getFixtureSessionMetadataStore`, fixture file completion) in place — they're swapped in later steps.
- The card is not registered yet. It builds; `main.tsx` does not call it; nothing renders.

**Verification:**
- `bun x tsc --noEmit` exits 0.
- `bun test` exits 0 (no new tests; existing suite still green).
- `rg 'TideCardContent' tugdeck/src/` returns at least one match in `tide-card.tsx`.

#### Step 2 — Register the card with mock services {#step-2}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (add `registerTideCard()` export).
- `tugdeck/src/main.tsx` (call `registerTideCard()` after `registerGitCard()`).

**Work:**
- Add `registerTideCard()` per the snippet in [tide.md §T3.4.c](./tide.md#t3-4-c-tide-card): `componentId: "tide"`, default meta, `defaultFeedIds: [CODE_INPUT, CODE_OUTPUT, SESSION_METADATA, FILETREE]`, size policy.
- Wire `contentFactory: (cardId) => <TideCardContent cardId={cardId} />`.
- Opening the card from the card menu mounts the copied body inside tugdeck's normal card chrome (title bar, close button, resize handles). The body itself is unchanged from Step 1 — same split pane, same mock-backed entry, same polish features — only the mount path differs from the gallery grid.

**Verification:**
- `bun run check` clean.
- Manual: open the card from the card menu; the body renders with all polish features (maximize toggle, settings popover, route gutter, content-driven sizing, atom fonts).
- `rg 'registerTideCard\(\)' tugdeck/src/main.tsx` returns one match.

#### Step 3 — Extract `useTideCardServices` skeleton (still mock-backed) {#step-3}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (extract the per-card service construction into a hook).

**Work:**
- Extract the existing per-card setup (`mockSessionRef`, `historyStoreRef`, fixture metadata store, completion providers, editor store binding) into a single hook `useTideCardServices(cardId: string)` returning an object: `{ codeSessionStore, sessionMetadataStore, historyStore, completionProviders, editorStore }`.
- The hook's internals still reference the mock layer; only the *shape* is what Step 4 will swap.
- The card component's body shrinks: it calls `useTideCardServices(cardId)` and passes the returned services into the JSX it already had.

**Verification:**
- Same as Step 2; nothing visibly changes.
- Existing tests still pass.

#### Step 4 — Wire real backend services + project picker {#step-4}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (replace mock seams with real wiring).
- `tugdeck/src/components/tugways/cards/tide-card.css` (picker styles, if any).
- New files for the picker if its UI is non-trivial (probably inline for the MVP).

**Work:**
- Replace `MockTugConnection`-backed `CodeSessionStore` with a real one bound to the live connection (as `gallery-prompt-input` does today via `getConnection()`).
- Replace fixture `SessionMetadataStore` with a shared lazy singleton — module-scoped `_sessionMetadataStore` initialized from the real connection.
- Replace fixture `PromptHistoryStore` similarly.
- Replace fixture file completion provider with a real `FILETREE`-backed provider.
- **Project picker:** when no `project_dir` is bound for this card, the **picker is the entire card body** (no split-pane behind it; no placeholder; the picker stands alone) per [D3](#resolved-decisions). Text input + "Open project" button only — no native dialog, no "Browse…" button per [D1](#resolved-decisions). On submit, send `encodeSpawnSession(cardId, tugSessionId, projectDir)`, await `spawn_session_ok`, call `cardSessionBindingStore.setBinding(cardId, { sessionKey, projectDir })`, then construct/expose the `CodeSessionStore`. Once bound the picker disappears entirely and the split pane (markdown view + entry) takes over. There is no in-card re-bind affordance — re-pointing requires a new card per [D4](#resolved-decisions).
- **Recent projects (soft requirement, [D2](#resolved-decisions)):** persist the last ≈5 chosen project paths in tugbank under a card-type-scoped key (e.g., `tide.recent-projects`). Render them as quick-pick buttons under the text input. Choosing one populates the input *and* submits in one click. If time runs short, ship Step 4 without this and follow up before [Step 8](#step-8); don't gate the rest of the plan on it.
- On unmount, send `sendCloseSession(cardId)`; clear the binding.
- **Single-session shim:** if `cardSessionBindingStore` already holds a binding for a *different* card, the second card either (a) shares the same `sessionKey` with a visible "single-session mode" badge in the status row, or (b) shows a "Single-session mode — close the other Tide card first" message and a disabled picker. Pick one and document in the picker code.

**Verification:**
- `cargo nextest run` clean (no Rust regressions from the binding store usage).
- `bun test` adds at least one integration-style test asserting the spawn → ack → bind → store-construction sequence on mount, and the close → clear-binding sequence on unmount.
- Manual: type a path; the picker disappears; the entry renders; submit `> hi`; observe a real Claude response stream in via `TugMarkdownView`. (This is the live end-to-end smoke.)

#### Step 5 — Wire `TugMarkdownView` to streaming output {#step-5}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx`.

**Work:**
- The gallery card's top split-panel is an empty placeholder rectangle. Replace it with `<TugMarkdownView streamingStore={services.codeSessionStore.streamingStore} streamingPath={services.codeSessionStore.streamingPath} />` per [tide.md line 2406](./tide.md#code-session-store).
- The PropertyStore instance is exposed as `store.streamingDocument`; the snapshot exposes `streamingStore` + `streamingPath` strings. Pass the strings only — no instance coupling.

**Verification:**
- Manual: a streaming `assistant_text` turn renders as live deltas in the top pane; `turn_complete(success)` finalizes the rendered text.
- `bun run audit:tokens lint` clean.

#### Step 6 — `lastError` affordance {#step-6}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx`.
- `tugdeck/src/components/tugways/cards/tide-card.css`.

**Work:**
- Read `snap.lastError` from the `CodeSessionStore` snapshot.
- Surface it visibly. Recommended: a thin banner above the entry (full-width, dismissable), or a status-row badge with the error category. Pick the one that requires the least new component machinery.
- The store already clears `lastError` on the next successful `send()`; the UI follows the snapshot.

**Verification:**
- Force an error (e.g., bad project_dir → `spawn_session_err`); the affordance appears.
- Submit a valid prompt; the affordance clears.
- Test asserts the affordance appears when `lastError !== null` and disappears when it clears.

#### Step 7 — W3.b: delete bootstrap workspace + `--source-tree` {#step-7}

**Files (Rust):**
- `tugrust/crates/tugcast/src/cli.rs` (or wherever the `--source-tree` flag is parsed): delete the flag and any associated arg struct field.
- `tugrust/crates/tugcast/src/server.rs` (and call sites): drop the `source_tree` parameter from function signatures.
- The bootstrap call: delete `registry.get_or_create(&watch_dir, cancel.clone())` and the `bootstrap.fs_watch_rx` plumbing it feeds.
- `tugrust/crates/tugcast/tests/`: rewrite tests that depended on the bootstrap workspace to call `spawn_session` explicitly, or delete them if Step 4's card-mount integration test covers the same surface.

**Files (docs/scripts):**
- README, `tugtool worktree setup` scaffolding, any developer setup notes that mention `--source-tree`. Per [tide.md line 2216](./tide.md#t3-workspace-registry-w3a), full deletion happens here.

**Work:**
- Delete the bootstrap surface in one coherent commit. The Tide card's `spawn_session` flow is now the only way workspace frames get published.
- Daily dev workflow: developers open tugdeck; if no card has bound a session yet, the existing git/filetree cards subscribe to feeds that have no publisher. That's the regression window — closed by also opening a Tide card with a project path. (Pre-P2: the first Tide card opened serves as the de facto bootstrap for any other card subscribing to FILETREE / FILESYSTEM / GIT.)

**Verification:**
- `rg --source-tree tugrust/` returns zero matches.
- `cargo nextest run` exits 0 across the workspace.
- Manual: launch `tugcast` without flags; confirm it starts cleanly with no bootstrap-workspace log noise; confirm a Tide card mount drives the first `spawn_session` end-to-end.

**Coupling note:** Steps 1–6 land independently if T3.4.c needs to ship in a form that *doesn't* also delete the bootstrap. Per the roadmap, they ship together. If the gate slips, this step can split off into an immediate follow-up commit per [tide.md line 2268](./tide.md#t3-workspace-registry-w3b).

#### Step 8 — Manual A/B smoke + closing checkpoints {#step-8}

**Work:**
- This is the deferred Step 8 from W2: open a Tide card pointed at project A, open a second pointed at project B (single-session-mode shim permitting), send a prompt in each, verify each card's FILETREE / FILESYSTEM / GIT feeds carry only that workspace's frames.
- Capture a session trace (`tugcast` log + tugdeck console) showing distinct `workspace_key` filtering.
- Close out [tugplan-workspace-registry-w2.md `#exit-criteria`](./archive/tugplan-workspace-registry-w2.md#exit-criteria) — the "deferred to T3.4.c" criterion is now satisfied.
- Close out the [T3.4.c exit criteria](#success-criteria) above by spot-checking each gallery-card feature in the Tide card.

**Verification:**
- All test suites green.
- A session trace recorded showing two cards, two `workspace_key`s, two distinct frame streams.
- `roadmap/tugplan-workspace-registry-w2.md` updated (move from `roadmap/archive/` if needed and check off the deferred criterion).

---

### Risks {#risks}

**R1 — Hidden coupling in the gallery card.** The gallery card has accumulated subtle wiring (mock connection refs, fixture-data side effects, timing-sensitive useLayoutEffect ordering). The "copy then substitute" approach minimizes this risk because the structural skeleton is unchanged, but a careful diff in Step 1 vs. Step 4 is essential. Keep substitutions small per commit so any regression is bisectable to a single seam swap.

**R2 — Bootstrap removal regression window.** If Step 7 lands but a developer opens tugdeck without ever opening a Tide card, the existing git/filetree cards display empty `Loading...` placeholders. Document this in the README change in Step 7 — "open a Tide card to populate workspace feeds" replaces "tugcast --source-tree=..." in setup docs. Acceptable because Tug.app shipping users always run via the Tide card path; the regression only touches dev tooling.

**R3 — Single-session shim ambiguity.** Pre-P2, the second Tide card has no clean home. (a) "share the default session" is confusing if the user opens the second card hoping for a fresh session. (b) "block the second card" is restrictive but unambiguous. Pick (b) for T3.4.c — the indicator/UX for shared sessions can land with P2 itself, where it's actually meaningful. Re-evaluate after first manual smoke if (b) feels too restrictive.

**R4 — `lastError` affordance design churn.** Banner vs badge vs inline message — easy to bikeshed. Pick the simplest (banner above entry, dismissable) and ship it; revisit in T3.4.d if the choice doesn't survive contact with real Claude error rates.

**R5 — Project picker visual quality.** Text input + button is ugly but functional. Per the [Scope](#scope), file-picker UX is T3.4.d. Don't let polish creep in here — Step 4 ships the minimum, T3.4.d makes it pretty.

**R6 — Atom font embedding fallback uncertainty.** WebKit data-URI SVG `@font-face` loading was implemented but not 100% confirmed working in production. If atoms render in fallback monospace under live conditions, that's a visual polish issue, not a T3.4.c blocker — file it for T3.4.d.

**R7 — `cargo nextest` test rewrites in Step 7.** The bootstrap-related test cleanup may surface test-only assumptions (e.g., a test that assumes `watch_dir` is always set). Budget for an afternoon of test triage; if more than one full day, split Step 7 to its own follow-up commit per the coupling note above.

---

### Resolved Decisions {#resolved-decisions}

These were the open questions surfaced when the plan was drafted. All are now answered. Anything that affects implementation has been propagated into [Strategy](#strategy), [Scope](#scope), or the relevant [Step](#steps).

**D1 — Picker UI shape: text input only.** No native dialog or "Browse…" affordance in T3.4.c. A bridge to the host file picker is T3.4.d polish if it ever happens.

**D2 — Recent-projects list: yes, soft requirement.** Persist the last N (≈5) chosen paths in tugbank and surface them as quick-pick buttons in the picker. Nice to have but not gating — if it slips, ship without it and add in T3.4.d. Moved into [Scope](#scope) as a soft requirement; called out in [Step 4](#step-4).

**D3 — Picker placement: always shown when unbound.** A Tide card without a `project_dir` makes no sense — there is nothing for it to do. The picker is the entire card body until bound; once bound it disappears entirely. No split-pane placeholder underneath, no compact status-row form. Reflected in [Step 4](#step-4).

**D4 — Re-bind affordance: none.** Opening a new card is the gesture for re-pointing at a different project. Closing and reopening is two clicks. Defer the in-card re-bind until users specifically ask.

**D5 — Maximize state across project changes: simplest path wins.** Current implementation (`useTugcardPersistence` round-trip via `onMaximizeChange`) inherits unchanged from the gallery copy. Don't redesign it for the Tide card; verify it round-trips during [Step 8](#step-8) and refine later if the behavior surfaces a real problem.

**D6 — `gallery-prompt-entry` is preserved verbatim.** The gallery card stays exactly as it is now — same file path, same content, same registration, same purpose (theme-audit and visual regression on the bare component-in-card shape with no live dependencies). The Tide card is a *copy*, not a replacement. No edits to `gallery-prompt-entry.tsx` or `gallery-prompt-entry.css` should appear in any commit on this plan.

---

### References {#references}

- Roadmap anchor: [tide.md §T3.4.c](./tide.md#t3-4-c-tide-card)
- Predecessor: [tide.md §T3.4.b](./tide.md#t3-4-b-prompt-entry) (✓ landed)
- Riding alongside: [tide.md §T3.0.W3.b](./tide.md#t3-workspace-registry-w3b)
- Closes deferred criterion in: [archive/tugplan-workspace-registry-w2.md](./archive/tugplan-workspace-registry-w2.md)
- Decision references: D-T3-04 (gallery card override — already moot per T3.4.b plan), D-T3-09 (one CodeSessionStore per card), D-T3-10 (no IndexedDB), D-T3-11 (shared observer rehydration)
- Commits accumulated since T3.4.b landed (the polish baseline that ships in the Tide card):
  - `de99a556` Lock T3.4.c baseline to copy of gallery prompt entry
  - `57a25e47` Accept > as alias for ❯ prompt route prefix
  - `29127a77` Move maximize toggle next to settings gear
  - `d12429ca` Stand down content sizers while maximize is on
  - `01308ce2` Add maximize toggle to prompt entry
  - `02bf55e4` Add Tracking and Leading editor controls
  - `254e53dd` Scale atom label to 0.96x of editor size
  - `7cefe36f` Embed @font-face fonts in atom SVGs and purge route atom code
  - `a047adff` Match atom font size to editor and align baselines
  - `992b58c9` Sanitize clipboard HTML on atom paste
  - `69ad9de8` Render route prefix as text in gutter and choice group
