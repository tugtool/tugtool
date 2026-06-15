<!-- plan authored against devise-skeleton v4 -->

## Fast Refresh Boundary Hygiene — Restore the HMR-never-reloads Invariant {#fast-refresh-hygiene}

**Purpose:** Stop the transcript's import graph from triggering full page reloads under HMR by converting the spine and the frequently-edited child modules into clean, component-only React Fast Refresh boundaries that self-accept.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-06-15 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

`@vitejs/plugin-react` treats a module as a self-accepting Fast Refresh boundary **only when every runtime export is a React component** (types/interfaces are erased and don't count). A module that exports a component *plus* a value (a hook, a constant, a `composeX` helper) — "mixed" — is not a boundary; nor is a pure value/util module. When such a module is edited, the HMR update propagates to its importers, and if it reaches the entry (`main.tsx`) **without crossing a component-only boundary**, Vite performs a full page reload.

A sweep (`tugdeck/scripts/fast-refresh-sweep.ts`) found that the transcript host sits on a **boundary-free spine** — `dev-card-transcript.tsx → dev-card.tsx → main.tsx`, all non-accepting — so editing **any** of ~288 modules in the transcript subtree reaches the entry boundary-free and full-reloads. This violates the project's baked-in invariant that HMR must never reload (it remounts the transcript, a multi-second lock). The prior `dev-restore-sheet` → `dev-restore-sheet-gate.ts` split fixed exactly one file by making it a clean boundary; this plan generalizes that fix to the spine and the hot-path children.

#### Strategy {#strategy}

- **Fix the file itself, not the file above it.** The robust cure for any module is to make *that module* a clean boundary so it self-accepts — then its import paths are irrelevant. A boundary placed *above* a module only downgrades a page reload into a transcript-host remount, and doesn't help when a second importer (e.g. a gallery) reaches root by another path. See [P01].
- **Land the oracle first.** Make the sweep script importable with an assert/exit-code mode and add a pure-logic drift test, so every later step has a falsifiable, regenerable checkpoint and regressions fail CI ([P05]).
- **Tier 1 = the spine (2 files).** Evict value exports from `dev-card.tsx` and `dev-card-transcript.tsx` into transparent sibling modules; both become component-only boundaries. This alone removes the full page reload for the entire subtree.
- **Tier 2 = hot-path children, grouped.** Apply the same eviction to the modules edited most during transcript work — tool-blocks, body-kinds, transcript chrome/cards, and contexts — so each self-accepts locally with no host remount.
- **Each move follows one pattern:** non-component exports go to a transparent `*-helpers.ts` / `*-context.ts` sibling; the `.tsx` keeps only components (and erased types). Mirrors the existing `dev-restore-sheet-gate.ts` precedent.
- **Defer the broad sweep.** Shared tugways primitives (`tug-*`) and lib stores reach root through other graphs and have app-wide consumer fan-out; they are explicit follow-ons, not part of this phase ([P06]).

#### Success Criteria (Measurable) {#success-criteria}

- After Tier 1, `bun run scripts/fast-refresh-sweep.ts` reports **0** escaping (full-reload) entries for `dev-card.tsx` and `dev-card-transcript.tsx`. (sweep output)
- After Tier 1, the transcript-graph full-reload count drops from 288 to the residual set (only modules reachable via a still-boundary-free path), verified by the sweep's printed total. (sweep output)
- After each Tier 2 group step, the sweep reports **0** escaping entries for every file in that group's directory. (sweep `--assert`)
- A `bun test` drift test fails if any frozen-clean file regains a value export (re-introduces mixed exports). (test run)
- `bunx tsc --noEmit` is clean after every step (no dangling imports from the moves). (tsc)

#### Scope {#scope}

1. Refactor `fast-refresh-sweep.ts` into an importable analyzer with a `--assert <files…>` exit-code mode; add a drift test.
2. Tier 1: make `dev-card.tsx` and `dev-card-transcript.tsx` component-only boundaries by extracting their value exports to new transparent sibling modules and updating the (small) set of importers.
3. Tier 2: same treatment for the transcript hot-path groups — tool-blocks, body-kinds, transcript chrome/cards, and contexts.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Splitting shared tugways primitives (`tug-sheet`, `tug-popover`, `tug-alert`, `tug-list-row`, `tug-dialog-button`, `tug-animator`, `theme-provider`, …) — deferred to follow-on ([P06], #roadmap).
- Splitting lib stores / value-only modules (`lib/code-session-store*`, `lib/tug-dev-log-store*`, `protocol.ts`) — these are value-only (no component to split) and go quiet once a boundary sits above them ([P06]).
- Any runtime/visual change. This is a pure module-organization refactor; behavior, DOM, and state zones are unchanged.
- A runtime HMR integration test (fake-DOM is banned; the sweep is the oracle — [P05]).

#### Dependencies / Prerequisites {#dependencies}

- `tugdeck/scripts/fast-refresh-sweep.ts` (already committed) — the analysis oracle this plan extends.
- HMR is always running in dev; no manual builds. Checkpoints use `bunx tsc --noEmit`, `bun test`, and the sweep CLI.

#### Constraints {#constraints}

- **WARNINGS ARE ERRORS** (workspace policy); `bunx tsc --noEmit` must stay clean.
- Use `bun`, never `npm`/`npx`.
- Tuglaws apply (tugdeck work): one `root.render()` [L01]; external state via `useSyncExternalStore` [L02]; registrations via `useLayoutEffect` [L03]; appearance via CSS/DOM [L06]. The context moves must preserve these — the `createContext` value and consumer hook relocate, but their zone/mechanism is unchanged.
- Types/interfaces may remain in a `.tsx` boundary file (erased at runtime — they do not break the boundary).

#### Assumptions {#assumptions}

- The export classifier in the sweep is heuristic but the spine result is confirmed by direct reading; per-step checkpoints catch any misclassification.
- `registerDevCard` only needs `dev-card.tsx`'s exported `DevCardContent` (it JSX-renders it via a factory) plus `registerCard`/`FeedId` — no unexported internals (verified by reading the function; re-confirm in #step-2).
- Moving a hook/value to a sibling module preserves identity for all consumers (same symbol, new path).

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

Anchors are explicit, kebab-case, and stable. Plan-local decisions use `[P01]` (never `[D01]`). Steps cite decisions/specs/anchors, never line numbers.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Do any context consumers import the Provider and the hook/Context from one path? (OPEN) {#q01-context-barrel}

**Question:** When splitting `createContext` value + consumer hook out of a context `.tsx` (Provider stays), do consumers import both the Provider and the hook from the same module specifier, requiring a re-export/barrel to avoid churn?

**Why it matters:** If many consumers import both, a naive split doubles their import lines or forces a barrel that would re-mix the boundary.

**Options (if known):**
- Provider-only stays in `.tsx`; hook + Context move to `*-context.ts`; consumers of the hook update their path (Provider consumers are usually few — mount sites).
- Add a type-only re-export if a consumer needs the `Context` type from the Provider file.

**Plan to resolve:** Per-context `grep` of importers at the start of #step-8; resolve each context individually inside that step.

**Resolution:** OPEN — resolved per-context during #step-8.

#### [Q02] Does `registerDevCard` reference any non-exported `dev-card.tsx` internal? (OPEN) {#q02-register-internals}

**Question:** Can `registerDevCard` move to a sibling `.tsx` shim using only `dev-card.tsx`'s public exports?

**Why it matters:** If it closes over a module-private helper, that helper must also be exported (or moved), enlarging the change.

**Plan to resolve:** Read the full `registerDevCard` body in #step-2 before moving it. Initial read shows it uses only `registerCard`, `<DevCardContent>`, and `FeedId` — all importable.

**Resolution:** OPEN — confirmed in #step-2.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| A "boundary" still has a missed value export | med | med | sweep `--assert` per step proves `escapes=false` | sweep still lists the file |
| Moved hook/value breaks import paths app-wide | med | low | `tsc --noEmit` checkpoint; Tier-1 fan-out verified at 1 site each | tsc errors |
| Tier-1-only leaves host remount on child edits | low | high (until Tier 2) | sequence hot-path groups first; Tier 2 removes it | dev complaints about transcript remount |
| Context split churns many consumers | med | med | [Q01] per-context grep; Provider-only stays, hook/Context move | large diff in #step-8 |

**Risk R01: A boundary that isn't.** {#r01-not-a-boundary}

- **Risk:** A file is declared "clean" but retains a value export (or a PascalCase const the eye reads as a component), so it still escapes.
- **Mitigation:** Every step's checkpoint runs the sweep against the touched files; `escapes=false` is the gate.
- **Residual risk:** The classifier could mis-call a genuine component as a value; the drift test freezes only files proven clean, so a false alarm is visible, not silent.

---

### Design Decisions {#design-decisions}

#### [P01] Make the edited file itself the boundary (DECIDED) {#p01-file-is-boundary}

**Decision:** The fix for each target is to make *that module* component-only so it self-accepts; we do not rely on installing a boundary above it.

**Rationale:**
- A boundary above only converts a page reload into a transcript-host remount (still a multi-second lock).
- `dev-card-transcript.tsx` is imported by both the spine and `gallery-transcript-copy.tsx`; a boundary above on the spine would not stop the gallery path from making it escape. A self-accepting file is immune to import path.

**Implications:** Every target `.tsx` ends the phase exporting only components (+ erased types). All non-component exports relocate.

#### [P02] Evict value exports to transparent sibling modules (DECIDED) {#p02-sibling-eviction}

**Decision:** Non-component exports move to a sibling `*-helpers.ts` / `*-format.ts` / `*-context.ts`, following the existing `dev-restore-sheet.tsx` → `dev-restore-sheet-gate.ts` precedent. Types/interfaces may stay in the `.tsx`.

**Rationale:** Smallest, idiomatic change; the sibling is transparent (gets absorbed by the boundary above) and keeps the `.tsx` clean.

**Implications:** New sibling files per target; importers of the moved symbols update their specifier.

#### [P03] `registerDevCard` moves to a registration shim (DECIDED) {#p03-registration-shim}

**Decision:** `registerDevCard` (the only value export `main.tsx` needs from the spine) moves to a new `dev-card-registration.tsx` that imports `DevCardContent` from `dev-card.tsx`; `main.tsx` imports `registerDevCard` from the shim.

**Rationale:** Keeps `dev-card.tsx` component-only while preserving the registration entry point. The shim is `.tsx` (the factory JSX-renders `<DevCardContent>`) and is transparent (no component export).

**Implications:** One import-line change in `main.tsx`; new file `dev-card-registration.tsx`.

#### [P04] `useDevCardServices` moves to its own hook module (DECIDED) {#p04-use-dev-card-services}

**Decision:** `useDevCardServices` moves to a new `use-dev-card-services.ts`, importing `cardServicesStore` from `lib/card-services-store.ts` and the `DevCardServices` type from `dev-card.tsx` (type import — erased). Its single real consumer (`dev-card-transcript.tsx`) updates its import.

**Rationale:** The hook is a thin `useSyncExternalStore` wrapper over the existing store ([L02]); a dedicated module keeps `dev-card.tsx` clean without entangling the store file's responsibilities.

**Implications:** New file `use-dev-card-services.ts`; one import change in `dev-card-transcript.tsx`. `DevCardServices` interface stays in `dev-card.tsx` (erased; safe).

#### [P05] The sweep is the regression oracle; no fake-DOM HMR test (DECIDED) {#p05-sweep-oracle}

**Decision:** Extend `fast-refresh-sweep.ts` with an importable `analyze()` and a `--assert <files…>` mode (non-zero exit if any named file escapes); add a pure-logic `bun test` drift test over a frozen-clean file set. No runtime/fake-DOM HMR test.

**Rationale:** happy-dom is deleted and fake-DOM render tests are banned; the static reachability analysis is the faithful, fast oracle for "would this edit reload?".

**Implications:** The script gains a small CLI/exported surface; one new test file.

#### [P06] Scope to transcript hot-path; defer shared primitives (DECIDED) {#p06-scope}

**Decision:** This phase covers the spine + tool-blocks + body-kinds + transcript chrome/cards + contexts. Shared `tug-*` primitives, `dev-assistant-renderer-dispatch.ts`, and lib stores are follow-ons.

**Rationale:** The hot-path groups are what developers edit during transcript work; shared primitives have broad consumer fan-out and reach root via other graphs — higher blast radius, lower transcript-edit frequency.

**Implications:** Residual escapers remain after this phase but are not on the transcript edit hot path; tracked in #roadmap.

---

### Specification {#specification}

#### Boundary rule (normative) {#boundary-rule}

- **Boundary (self-accepting):** ≥1 component export, **zero** runtime non-component exports (types/interfaces excluded). Editing it refreshes in place; propagation stops.
- **Mixed:** ≥1 component + ≥1 value export → non-accepting → propagates.
- **Transparent:** zero component exports (value/util/type/css only) → non-accepting → propagates, absorbed by the nearest boundary above.
- **Full page reload** occurs iff an edited module's propagation reaches a no-importer entry along non-accepting modules only.

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

> This phase introduces **no new state**. It relocates existing exports (including `createContext` values and hooks) without changing their zone or mechanism. The table records the touched state-bearing exports and confirms their zone is preserved.

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| `cardServicesStore` services (via `useDevCardServices`) | structure / external-data | module store + `useSyncExternalStore` (unchanged; hook only relocates) | [L02] |
| context values (`ToolBlock*Context`, `Scroller*`, `OuterScrollport`, `CardData`, `ResponderChain`, `TugPane*`) | structure | `createContext` + Provider (Provider stays in `.tsx`; Context+hook move to `*-context.ts`) | [L02], [L03] |
| transcript cell-menu / model-name (`useTranscriptCellMenu`, `useSessionModelName`) | local-data | `useState`/`useRef`/`useMemo` (unchanged; hook only relocates) | [L06] |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Drift Prevention** | Assert frozen-clean files stay boundary-clean (no re-mixed exports) | Every step after Tier 1 |
| **Contract (sweep)** | `--assert` reports `escapes=false` for touched files | Every step checkpoint |
| **Type check** | `tsc --noEmit` clean after each move | Every step |

#### What stays out of tests {#test-non-goals}

- Runtime/visual HMR behavior — covered by the static sweep oracle; fake-DOM tests are banned ([P05]).
- Per-symbol unit tests for moved helpers — pure relocation, no logic change; `tsc` + existing tests cover them.
- Mock-store assertion tests — banned project-wide.

---

### Execution Steps {#execution-steps}

> Commit after all checkpoints pass. References are mandatory; never cite line numbers.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Sweep oracle: importable analyzer + `--assert` + drift test | pending | — |
| #step-2 | Tier 1a: make `dev-card.tsx` a boundary | pending | — |
| #step-3 | Tier 1b: make `dev-card-transcript.tsx` a boundary | pending | — |
| #step-4 | Tier 1 integration checkpoint | pending | — |
| #step-5 | Tier 2: tool-blocks group | pending | — |
| #step-6 | Tier 2: body-kinds group | pending | — |
| #step-7 | Tier 2: transcript chrome/cards group | pending | — |
| #step-8 | Tier 2: contexts group | pending | — |
| #step-9 | Tier 2 integration checkpoint | pending | — |

#### Step 1: Sweep oracle — importable analyzer + `--assert` + drift test {#step-1}

**Commit:** `tugdeck(hmr): make fast-refresh-sweep importable with --assert mode + drift test`

**References:** [P05] (#p05-sweep-oracle, #boundary-rule, #success-criteria)

**Artifacts:**
- `scripts/fast-refresh-sweep.ts` refactored: export `analyze(): { reloaders, census, focusGraph }`; keep the human report under a `main()`; add `--assert <file…>` that exits non-zero if any named file escapes.
- New `src/lib/__tests__/fast-refresh-boundary.test.ts` (pure-logic `bun test`) asserting a frozen set of files report `escapes=false`.

**Tasks:**
- [ ] Extract the graph build + `escapes()` into an exported `analyze()`; preserve current CLI output via `main()`.
- [ ] Add `--assert` mode (accepts file globs/paths; exit 1 + print offenders if any escape).
- [ ] Seed the drift test's frozen list with the files this phase will clean (initially the spine targets; extend per step).

**Tests:**
- [ ] `bun test src/lib/__tests__/fast-refresh-boundary.test.ts` runs and (pre-fix) is allowed to assert only the oracle wiring, not yet the spine.

**Checkpoint:**
- [ ] `bun run scripts/fast-refresh-sweep.ts --assert src/main.tsx` exits non-zero (main is the entry — proves assert mode detects an escaper).
- [ ] `bunx tsc --noEmit` clean.

---

#### Step 2: Tier 1a — make `dev-card.tsx` a boundary {#step-2}

**Depends on:** #step-1

**Commit:** `tugdeck(hmr): split registerDevCard + useDevCardServices out of dev-card to make it a refresh boundary`

**References:** [P01] (#p01-file-is-boundary), [P03] (#p03-registration-shim), [P04] (#p04-use-dev-card-services), [Q02] (#q02-register-internals)

**Artifacts:**
- New `src/components/tugways/cards/dev-card-registration.tsx` exporting `registerDevCard`.
- New `src/components/tugways/cards/use-dev-card-services.ts` exporting `useDevCardServices`.
- `dev-card.tsx` left exporting only `DevCardContent`, `DevCardBody` (+ erased types `DevCardContentProps`, `DevCardServices`, `DevTurnTrailingRenderer`, `DevTurnTrailingContext`).
- Updated importers: `main.tsx` (registerDevCard from shim), `dev-card-transcript.tsx` (useDevCardServices from new hook module).

**Tasks:**
- [ ] Confirm [Q02]: read `registerDevCard`; verify it needs only public exports.
- [ ] Move `registerDevCard` → `dev-card-registration.tsx`; import `DevCardContent` + `registerCard` + `FeedId`.
- [ ] Move `useDevCardServices` → `use-dev-card-services.ts`; import `cardServicesStore` and `type DevCardServices`.
- [ ] Update `main.tsx` and `dev-card-transcript.tsx` import specifiers.

**Tests:**
- [ ] Extend the drift test's frozen list with `dev-card.tsx`.

**Checkpoint:**
- [ ] `bun run scripts/fast-refresh-sweep.ts --assert src/components/tugways/cards/dev-card.tsx` exits 0 (no longer escapes).
- [ ] `bunx tsc --noEmit` clean.

---

#### Step 3: Tier 1b — make `dev-card-transcript.tsx` a boundary {#step-3}

**Depends on:** #step-2

**Commit:** `tugdeck(hmr): split transcript helpers out of dev-card-transcript to make it a refresh boundary`

**References:** [P01] (#p01-file-is-boundary), [P02] (#p02-sibling-eviction), (#state-zone-mapping)

**Artifacts:**
- New sibling(s) under `cards/` (e.g. `transcript-host-helpers.ts`) exporting `useSessionModelName`, `formatTranscriptTimestamp`, `useTranscriptCellMenu`.
- `dev-card-transcript.tsx` left exporting only `DevTranscriptHost` (+ erased types).
- Updated importer: `gallery-transcript-copy.tsx` (useTranscriptCellMenu from the new sibling).

**Tasks:**
- [ ] Move the three hooks/fns to the sibling; keep `CopyMarkdownResolver`/`TurnTrailing*`/`DevTranscriptHandle` types in place (erased).
- [ ] Update `gallery-transcript-copy.tsx` import (the only external consumer of `useTranscriptCellMenu`).
- [ ] Verify no remaining value export on `dev-card-transcript.tsx`.

**Tests:**
- [ ] Add `dev-card-transcript.tsx` to the drift test frozen list.

**Checkpoint:**
- [ ] `bun run scripts/fast-refresh-sweep.ts --assert src/components/tugways/cards/dev-card-transcript.tsx` exits 0.
- [ ] `bunx tsc --noEmit` clean.

---

#### Step 4: Tier 1 integration checkpoint {#step-4}

**Depends on:** #step-2, #step-3

**Commit:** `N/A (verification only)`

**References:** [P01] (#p01-file-is-boundary), (#success-criteria)

**Tasks:**
- [ ] Re-run the full sweep; confirm both spine files cleared and record the new transcript-graph full-reload total (expected: a sharp drop from 288 to the residual reachable-by-other-path set).

**Tests:**
- [ ] `bun test src/lib/__tests__/fast-refresh-boundary.test.ts` green with both spine files frozen.

**Checkpoint:**
- [ ] `bun run scripts/fast-refresh-sweep.ts` total reloaders < 288 and neither spine file appears.
- [ ] Manual smoke (optional): edit `dev-card-transcript.tsx` in dev → HMR refreshes without a page reload.

---

#### Step 5: Tier 2 — tool-blocks group {#step-5}

**Depends on:** #step-4

**Commit:** `tugdeck(hmr): make tool-block components clean refresh boundaries`

**References:** [P01] (#p01-file-is-boundary), [P02] (#p02-sibling-eviction), [P06] (#p06-scope)

**Artifacts:**
- For each `src/components/tugways/cards/tool-blocks/*-tool-block.tsx` (ask-user-question, bash, cron, default, edit, glob, grep, monitor, notebook-edit, read, remote-trigger, share-onboarding-guide, skill, task-inline, task-mgmt, task, web-fetch, web-search, worktree, write) plus `middle-ellipsis-path.tsx` and `tool-block-chrome.tsx`: evict `narrowX`/`composeX`/`deriveX`/constant exports to a `*-helpers.ts` sibling; leave the `.tsx` component-only. (`collapse-context.tsx` is handled in #step-8.)

**Tasks:**
- [ ] Run the sweep to get the authoritative current list of escaping `tool-blocks/*` files.
- [ ] For each, move non-component exports to a sibling; update intra-group import sites.

**Tests:**
- [ ] Extend the drift frozen list with the cleaned tool-block files.

**Checkpoint:**
- [ ] `bun run scripts/fast-refresh-sweep.ts --assert 'src/components/tugways/cards/tool-blocks/*-tool-block.tsx'` exits 0.
- [ ] `bunx tsc --noEmit` clean.

---

#### Step 6: Tier 2 — body-kinds group {#step-6}

**Depends on:** #step-4

**Commit:** `tugdeck(hmr): make body-kind blocks clean refresh boundaries`

**References:** [P01] (#p01-file-is-boundary), [P02] (#p02-sibling-eviction)

**Artifacts:**
- For `src/components/tugways/body-kinds/{agent-transcript,diff,file,json-tree,path-list,search-result,terminal,todo-list}-block.tsx` and `body-kinds/affordances/{block-copy-button.tsx,index.ts}`: evict formatters/parsers/constants to siblings; `.tsx` component-only. For the `affordances/index.ts` barrel, ensure it re-exports only components or is split so it isn't a mixed boundary.

**Tasks:**
- [ ] Sweep for the current body-kinds escaper list; move helpers per file.
- [ ] Resolve the `affordances/index.ts` barrel (components-only re-export, or move `useBlockFoldState`/constants out).

**Tests:**
- [ ] Extend the drift frozen list with the cleaned body-kinds files.

**Checkpoint:**
- [ ] `bun run scripts/fast-refresh-sweep.ts --assert 'src/components/tugways/body-kinds/**'` exits 0.
- [ ] `bunx tsc --noEmit` clean.

---

#### Step 7: Tier 2 — transcript chrome/cards group {#step-7}

**Depends on:** #step-4

**Commit:** `tugdeck(hmr): make transcript chrome/cards clean refresh boundaries`

**References:** [P01] (#p01-file-is-boundary), [P02] (#p02-sibling-eviction)

**Artifacts:**
- For `chrome/{dev-error-block,dev-permission-dialog,dev-question-dialog,dev-session-init-banner,dev-thinking-block}.tsx` and `cards/{dev-card-telemetry-renderers,dev-card-z1c,tug-atom-text-body,tug-attachment-strip}.tsx`: evict constants/parsers/format helpers to siblings; `.tsx` component-only. (Dialogs carry preservation-key constants and `parseX`/`composeX` helpers — move those out.)

**Tasks:**
- [ ] Sweep for the current escaper list in this group; move helpers per file; update import sites.

**Tests:**
- [ ] Extend the drift frozen list with the cleaned chrome/cards files.

**Checkpoint:**
- [ ] `bun run scripts/fast-refresh-sweep.ts --assert` over the listed files exits 0.
- [ ] `bunx tsc --noEmit` clean.

---

#### Step 8: Tier 2 — contexts group {#step-8}

**Depends on:** #step-4

**Commit:** `tugdeck(hmr): split context values from providers to make context modules clean boundaries`

**References:** [P01] (#p01-file-is-boundary), [P02] (#p02-sibling-eviction), [Q01] (#q01-context-barrel), (#state-zone-mapping)

**Artifacts:**
- For `cards/tool-blocks/collapse-context.tsx`, `internal/scroller-context.tsx`, `internal/outer-scrollport-context.tsx`, `hooks/use-card-data.ts`, `responder-chain-provider.tsx`, `chrome/tug-pane.tsx`: move the `createContext` value + consumer hook to a `*-context.ts` (transparent); keep the Provider component in the `.tsx` (boundary). Preserve [L02]/[L03] zones.

**Tasks:**
- [ ] Resolve [Q01] per context: grep importers, confirm Provider-only stays in `.tsx`.
- [ ] Move Context + hook to `*-context.ts`; update consumer import paths.
- [ ] For `tug-pane.tsx` (multiple contexts + `CARD_TITLE_BAR_HEIGHT` + `useCardDirty`): move all value exports out, keep `CardTitleBar`/`TugPane` components.

**Tests:**
- [ ] Extend the drift frozen list with the cleaned context Provider files.

**Checkpoint:**
- [ ] `bun run scripts/fast-refresh-sweep.ts --assert` over the listed Provider `.tsx` files exits 0.
- [ ] `bunx tsc --noEmit` clean.

---

#### Step 9: Tier 2 integration checkpoint {#step-9}

**Depends on:** #step-5, #step-6, #step-7, #step-8

**Commit:** `N/A (verification only)`

**References:** [P06] (#p06-scope), (#success-criteria, #roadmap)

**Tasks:**
- [ ] Re-run the full sweep; confirm every hot-path group reports 0 escapers; record residual escapers (expected: only the deferred shared primitives / lib stores per [P06]).

**Tests:**
- [ ] `bun test src/lib/__tests__/fast-refresh-boundary.test.ts` green with the full cleaned set frozen.

**Checkpoint:**
- [ ] Sweep shows 0 escapers in `tool-blocks/`, `body-kinds/`, the listed chrome/cards files, and the context Providers.
- [ ] `bunx tsc --noEmit` clean.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The transcript spine and its hot-path child modules are clean, self-accepting Fast Refresh boundaries; editing any of them refreshes in place under HMR with no full page reload, enforced by a regenerable sweep oracle and a drift test.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] `dev-card.tsx` and `dev-card-transcript.tsx` report `escapes=false` (sweep).
- [ ] All Tier 2 group files report `escapes=false` (sweep `--assert`).
- [ ] `bun test` drift test passes with the full cleaned set frozen.
- [ ] `bunx tsc --noEmit` clean on the final tree.
- [ ] Residual escapers are only the explicitly deferred shared primitives / lib stores.

**Acceptance tests:**
- [ ] `bun run scripts/fast-refresh-sweep.ts` — transcript-graph reload total reduced to the deferred residual only.
- [ ] `bun test src/lib/__tests__/fast-refresh-boundary.test.ts`.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Shared tugways primitives: `tug-sheet`, `tug-popover`, `tug-alert`, `tug-bulletin`, `tug-list-row`, `tug-dialog-button`, `tug-inline-dialog`, `tug-link`, `tug-arc-gauge`, `tug-progress-indicator`, `tug-progress-wave`, `tug-animator`, `tug-transcript-entry`, `use-component-state-preservation`, `use-responder`, `theme-provider`.
- [ ] `dev-assistant-renderer-dispatch.ts` (registry: move `NullToolBlock` out to fully flatten it to transparent).
- [ ] Confirm value-only lib modules (`lib/code-session-store*`, `lib/tug-dev-log-store*`, `lib/tug-dev-panel-store*`, `protocol.ts`) need no change once boundaries sit above them.

| Checkpoint | Verification |
|------------|--------------|
| Spine cleaned | `fast-refresh-sweep.ts --assert` on both spine files exits 0 |
| Tier 2 groups cleaned | `fast-refresh-sweep.ts --assert` per group exits 0 |
| No regressions | `bun test` drift test green; `tsc --noEmit` clean |
