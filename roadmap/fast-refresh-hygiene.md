<!-- plan authored against devise-skeleton v4 -->

## Fast Refresh Boundary Hygiene — Restore the HMR-never-reloads Invariant (Tier 1) {#fast-refresh-hygiene}

**Purpose:** Stop transcript edits from triggering full page reloads under HMR by (a) making the two transcript spine files clean React Fast Refresh boundaries and (b) sealing the remaining gallery cluster-exits (primarily by deferring the dev-only gallery registration behind a dynamic import, with a clean-the-mixed-files fallback) — and lock in the invariant that any reload that *does* still happen restores the deck faithfully (cards survive, no orphan sessions).

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

`@vitejs/plugin-react` treats a module as a self-accepting Fast Refresh boundary **only when every runtime export is a React component** (types/interfaces are erased and don't count). A "mixed" module (component + a hook/const/helper) or a pure value/util module is non-accepting: when edited, the HMR update propagates to its importers, and if it reaches the entry (`main.tsx`) **without crossing a component-only boundary**, Vite does a full page reload. A full reload re-resumes the transcript from JSONL — a multi-second lock — and violates the project's baked-in invariant that HMR must never reload data/transcript.

A sweep (`tugdeck/scripts/fast-refresh-sweep.ts`) found the transcript host sits on a **boundary-free spine** — `dev-card-transcript.tsx → dev-card.tsx → main.tsx`, all non-accepting — so editing anything in the transcript subtree reaches the entry boundary-free and full-reloads. Direct reading of the import graph shows the leaf modules (tool-blocks, body-kinds) do not sit on a couple of clean paths but in a **dense, cyclic cluster** (the dispatch registry, chrome dialogs, and the leaves import one another) whose escapes to the entry are a small set of exit nodes — the spine, `model-chip`, `dev-route-indicator-badge`, and the dev-only gallery files (see #leaf-cluster). This phase is deliberately **scoped to maximum bang-for-buck with minimum churn**: make the two spine files boundaries, then seal the remaining gallery exits — rather than rewriting dozens of leaves. A separate concern surfaced during investigation — a recent boot regression rebuilt the deck from an empty tugbank cache on reload, blowing away cards and stranding "live in another card" sessions — so this phase also locks in the faithful-restore invariant so that any reload that still occurs is non-destructive.

#### Strategy {#strategy}

- **Frequency and severity are two different problems.** Boundary hygiene reduces *how often* HMR reloads ([P01], [P06]); the faithful-restore guard ensures that any reload that still happens is *non-destructive* ([P07]). This phase does both, but they are independent — the guard is the safety net, the boundaries are the convenience.
- **Land the oracle first.** Make the sweep importable with an assert/exit-code mode, teach it to model dynamic `import()` as a graph cut, and add a pure-logic drift test — so every later step has a falsifiable, regenerable checkpoint ([P05]).
- **Fix the spine itself, not the file above it.** The robust cure for the spine is to make `dev-card.tsx` and `dev-card-transcript.tsx` component-only so they self-accept ([P01], [P02]). This stops the full reload for the whole transcript subtree reachable through the spine.
- **Seal the gallery cluster-exits instead of rewriting every leaf.** The leaves live in a cyclic cluster whose escapes to the entry are a small set of exit nodes (#leaf-cluster); after Tier 1 the gallery files are the remaining boundary-free ones. Sealing them — primarily by making `registerGalleryCards()` a dynamic `import()` ([P06]) — is far less churn than evicting value exports from ~40 leaf modules, which is explicitly **out of scope** ([#non-goals]). The gallery cut's runtime efficacy is unproven by inspection, so [P06] is run as a measured experiment (#step-4a, #step-6) with a concrete fallback, not an assumed win.
- **Accept a transcript-host remount on leaf edits.** With the boundary on the spine (not on each leaf), editing a tool-block refreshes at the `dev-card-transcript.tsx` boundary — a transcript-host remount, not a full page reload. No re-resume from JSONL. This is the deliberate bang-for-buck tradeoff; true per-leaf in-place refresh is a deferred follow-on ([#roadmap]).
- **No codebase reorganization.** Every move is the existing `dev-restore-sheet.tsx → dev-restore-sheet-gate.ts` pattern: non-component exports go to a transparent sibling; the `.tsx` keeps only components. No new abstractions, no runtime/visual change.

#### Success Criteria (Measurable) {#success-criteria}

- `bun run scripts/fast-refresh-sweep.ts --assert src/components/tugways/cards/dev-card.tsx src/components/tugways/cards/dev-card-transcript.tsx` exits 0 (neither spine file escapes). (sweep `--assert`)
- Per-target, not gross total: after Tier 1 (+ the gallery decision in #step-5), the sweep reports **0 escapers** under `components/tugways/cards/tool-blocks/` and `components/tugways/body-kinds/` (the transcript-component leaves). (sweep output — actual numbers measured, not predicted)
- The gross transcript-graph reload total is recorded **informationally only**, not as a gate: it stays dominated by the explicitly-deferred `lib/` (~63), `tugways/` (~38), `lib/code-session-store/` (~11), and `lib/markdown/` (~12) modules ([#non-goals]), so it will remain high even when the leaves clear. (sweep output)
- Dev smoke: editing `dev-card-transcript.tsx` refreshes in place; editing one transcript tool-block refreshes **without a full page reload** (a transcript-host remount on the leaf edit is acceptable). The leaf result is the empirical proof of the #step-5 decision, not an assumed outcome. (manual dev observation)
- A `bun test` drift test fails if `dev-card.tsx` or `dev-card-transcript.tsx` regains a value export. (test run)
- A `bun test` guard fails if `main.tsx` constructs the `DeckManager` without first awaiting `tugbankClient.ready()` (faithful-restore invariant). (test run)
- `bunx tsc --noEmit` is clean after every step. (tsc)

#### Scope {#scope}

1. Refactor `fast-refresh-sweep.ts` into an importable analyzer with a `--assert <files…>` exit-code mode, model dynamic `import()` as a graph cut, and add a drift test.
2. Lock in the faithful-restore invariant: a pure-logic guard test that `main.tsx` awaits `tugbankClient.ready()` before `new DeckManager`, plus a documented decision ([P07]).
3. Tier 1: make `dev-card.tsx` and `dev-card-transcript.tsx` component-only boundaries by evicting their value exports to transparent sibling modules.
4. Detach the gallery graph from the entry by converting `registerGalleryCards()` to a dynamic `import()`.

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Tier 2 and beyond — dropped from scope.** Per-leaf eviction of value exports from tool-blocks, body-kinds, transcript chrome/cards, and contexts is **not** done in this phase. Once the gallery exits are sealed (#step-5), a leaf edit refreshes at a cluster boundary (host remount) rather than full-reloading; making each leaf its own boundary (true in-place refresh, no host remount) is a deferred follow-on ([#roadmap]). It is polish, not a requirement.
- Splitting shared tugways primitives (`tug-sheet`, `tug-popover`, `tug-list-row`, `theme-provider`, …) — deferred ([#roadmap]).
- Splitting lib stores / value-only modules (`lib/code-session-store*`, `protocol.ts`, …) — deferred ([#roadmap]).
- Any runtime/visual/state-zone change. This is pure module organization plus a boot-ordering guard; behavior, DOM, and state are unchanged.
- A runtime/fake-DOM HMR integration test — banned; the sweep is the oracle ([P05]).
- Re-fixing the `tugbankClient.ready()` boot race — the await is **already restored** in `main.tsx`. This phase only adds the regression guard, it does not re-author the fix.

#### Dependencies / Prerequisites {#dependencies}

- `tugdeck/scripts/fast-refresh-sweep.ts` (already committed) — the analysis oracle this plan extends.
- `tugbankClient.ready()` await already restored in `main.tsx` boot (committed) — [P07] only guards against its regression.
- HMR is always running in dev; no manual builds. Checkpoints use `bunx tsc --noEmit`, `bun test`, and the sweep CLI.

#### Constraints {#constraints}

- **WARNINGS ARE ERRORS** (workspace policy); `bunx tsc --noEmit` must stay clean.
- Use `bun`, never `npm`/`npx`.
- Tuglaws apply (tugdeck work): one `root.render()` [L01]; external state via `useSyncExternalStore` [L02]; registrations via `useLayoutEffect` [L03]; appearance via CSS/DOM [L06]. The hook relocation in Tier 1a preserves its zone/mechanism unchanged.
- Types/interfaces may remain in a `.tsx` boundary file (erased at runtime — they do not break the boundary).
- No fake-DOM tests (happy-dom is deleted); the faithful-restore guard and the boundary drift test are both **pure-logic** `bun test`.

#### Assumptions {#assumptions}

- The sweep's export classifier is heuristic but the spine result is confirmed by direct reading; per-step checkpoints catch any misclassification.
- `registerDevCard` only needs `dev-card.tsx`'s exported `DevCardContent` (it JSX-renders it via a factory) plus `registerCard`/`FeedId` — no unexported internals (re-confirmed in #step-3, [Q02]).
- Galleries are dev demo surfaces; deferring their registration behind an awaited dynamic `import()` during boot preserves registration-before-construction ordering, so a persisted gallery card still rehydrates ([Q01]).
- Vite treats a dynamic `import()` as a code-split point, so editing a module reachable from the entry *only* through that dynamic edge does not full-reload the main app chunk — confirmed by the dev smoke in #step-6 ([Q01]).

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

Anchors are explicit, kebab-case, and stable. Plan-local decisions use `[P01]` (never `[D01]`). Steps cite decisions/specs/anchors, never line numbers.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Does detaching the galleries via dynamic `import()` actually stop the full reload for transcript leaves? (OPEN) {#q01-gallery-dynamic-cut}

**Question:** When `registerGalleryCards()` becomes a dynamic `import()`, do the gallery-imported leaf modules (tool-blocks, body-kinds) stop reaching the entry along a static non-accepting path — in both the sweep's model **and** Vite's actual full-reload decision?

**Why it matters:** This is the single biggest risk in the phase. The leaf benefit of [P06] rests on the dynamic-import edge actually being a propagation cut at runtime. If Vite still walks the dynamic-import edge up to the entry on a leaf edit, the cut does nothing and leaves keep full-reloading. The dev smoke is the **only** proof; it gates whether [P06]'s primary mechanism stays or reverts to its fallback.

**Options (if known):**
- **Primary:** await the dynamic `import()` inside the boot IIFE before `new DeckManager` so registration timing is unchanged; the `import()` is a separate chunk regardless of `await`.
- **Fallback (if the smoke still reloads):** revert the dynamic import and instead clean the `[mixed]` gallery files that are the real boundary-free exits — `gallery-tool-block-file.tsx` (`greet`/`DEFAULT_GREETING`/`farewell` — leftover scaffolding) and `gallery-bash-tool-block.tsx` (`GalleryBashMountInSavedState`), plus any other the sweep flags. This does not depend on Vite's dynamic-import behavior.
- Rejected: lazy-on-open registration (a persisted gallery card would fail to rehydrate at boot).

**Plan to resolve:** In #step-1 teach the sweep to treat dynamic `import()` as a graph cut (the regex already ignores it — make it explicit and tested). In #step-4a, measure post-Tier-1 which leaves still escape and via which exit. In #step-5, apply [P06] and in #step-6 run the dev smoke: edit a tool-block, confirm the page does not reload — **decision gate**: keep the dynamic import if it holds, switch to the fallback if it doesn't.

**Resolution:** OPEN — gated by the #step-6 dev smoke; primary-or-fallback chosen there.

#### [Q02] Does `registerDevCard` reference any non-exported `dev-card.tsx` internal? (OPEN) {#q02-register-internals}

**Question:** Can `registerDevCard` move to a sibling `.tsx` shim using only `dev-card.tsx`'s public exports?

**Why it matters:** If it closes over a module-private helper, that helper must also be exported (or moved), enlarging the change.

**Plan to resolve:** Read the full `registerDevCard` body in #step-3 before moving it. Initial read shows it uses only `registerCard`, `<DevCardContent>`, and `FeedId` — all importable.

**Resolution:** OPEN — confirmed in #step-3.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Dynamic-import gallery cut doesn't stop Vite full reload (Risk R03) | high | med | [Q01]: gated by the #step-6 dev smoke; concrete fallback (clean ~2 mixed gallery files) if it fails | dev smoke still reloads on leaf edit |
| Leaves escape via a cluster exit Tier 1 + [P06] doesn't seal | med | med | #step-4a measures post-Tier-1 escapers and their exits before [P06]; #step-4 confirms `dev-route-indicator-badge` is a boundary | sweep shows leaf escaping via a non-{spine,gallery} exit |
| Async gallery import fails and strands boot (Risk R03) | med | low | the awaited `import()` has a `.catch` that logs and still constructs the deck | boot hangs / throws before `new DeckManager` |
| A "boundary" still has a missed value export | med | med | sweep `--assert` per step proves `escapes=false` | sweep still lists the file |
| Deferring gallery registration breaks a persisted gallery card | med | low | await the dynamic import before `new DeckManager` ([Q01]) | gallery card fails to rehydrate at boot |
| Moved hook/value breaks import paths | med | low | `tsc --noEmit` checkpoint; Tier-1 fan-out is 1 site each | tsc errors |
| Faithful-restore guard is brittle (source-text match) | low | med | match a stable token (`tugbankClient.ready()` awaited before `new DeckManager`), not whitespace | guard fails on an innocuous edit |

**Risk R01: A boundary that isn't.** {#r01-not-a-boundary}

- **Risk:** A spine file is declared "clean" but retains a value export (or a PascalCase const the eye reads as a component), so it still escapes.
- **Mitigation:** Every step's checkpoint runs the sweep against the touched files; `escapes=false` is the gate; the drift test freezes the cleaned files.
- **Residual risk:** The classifier could mis-call a genuine component as a value; the drift test freezes only files proven clean, so a false alarm is visible, not silent.

**Risk R02: A reload slips through and is destructive.** {#r02-destructive-reload}

- **Risk:** Boundary hygiene cannot remove *every* reload trigger (editing `main.tsx`, `hmr-bridge.ts` self-invalidating, vite config, the deferred galleries/primitives). If such a reload rebuilds the deck from a pre-DEFAULTS cache, cards vanish and sessions strand — the exact regression that motivated this plan.
- **Mitigation:** [P07] documents the invariant; #step-2 adds a guard test that `main.tsx` awaits `tugbankClient.ready()` before `new DeckManager`.
- **Residual risk:** The guard is a source-text assertion, not a live boot test; a real reload app-test is a deferred follow-on ([#roadmap]).

**Risk R03: The gallery cut is unproven at runtime, and its async form can strand boot.** {#r03-gallery-cut-runtime}

- **Risk:** [P06]'s primary mechanism (dynamic `import()`) is proven a cut only in the sweep's *model*; Vite's runtime full-reload decision may still walk the dynamic edge, so a leaf edit could still full-reload. Separately, an awaited dynamic import that rejects (chunk-load error) would throw in the boot IIFE before `new DeckManager`, stranding boot — the same failure class as the `ready()` regression that motivated [P07].
- **Mitigation:** [P06] is sequenced *after* a measurement step (#step-4a) and gated by the #step-6 dev smoke, with a concrete lower-risk fallback (clean the ~2 `[mixed]` gallery files) that does not depend on Vite's dynamic-import behavior. The awaited `import()` carries a `.catch` that logs and still constructs the deck.
- **Residual risk:** If both the dynamic cut and the fallback under-deliver (a leaf escapes via an exit neither seals), the leaf benefit is deferred to per-leaf cleanup ([#roadmap]); the spine + faithful-restore wins still stand independently.

---

### Design Decisions {#design-decisions}

#### [P01] Make the spine file itself the boundary (DECIDED) {#p01-file-is-boundary}

**Decision:** The fix for each spine target is to make *that module* component-only so it self-accepts; we do not install a boundary above it.

**Rationale:**
- A boundary above only converts a page reload into a remount of whatever the boundary wraps.
- `dev-card-transcript.tsx` is imported by both the spine and the gallery graph; making the file itself a boundary is immune to import path (it self-accepts regardless of which graph reaches it).

**Implications:** `dev-card.tsx` and `dev-card-transcript.tsx` end the phase exporting only components (+ erased types). Their non-component exports relocate.

#### [P02] Evict value exports to transparent sibling modules (DECIDED) {#p02-sibling-eviction}

**Decision:** Non-component exports move to a sibling `*-helpers.ts` / `*-context.ts`, following the existing `dev-restore-sheet.tsx → dev-restore-sheet-gate.ts` precedent. Types/interfaces may stay in the `.tsx`.

**Rationale:** Smallest, idiomatic change; the sibling is transparent (absorbed by the boundary above) and keeps the `.tsx` clean. No new abstractions.

**Implications:** New sibling files per spine target; importers of the moved symbols update their specifier.

#### [P03] `registerDevCard` moves to a registration shim (DECIDED) {#p03-registration-shim}

**Decision:** `registerDevCard` (the only value export `main.tsx` needs from the spine) moves to a new `dev-card-registration.tsx` that imports `DevCardContent` from `dev-card.tsx`; `main.tsx` imports `registerDevCard` from the shim.

**Rationale:** Keeps `dev-card.tsx` component-only while preserving the registration entry point. The shim is `.tsx` (the factory JSX-renders `<DevCardContent>`) and is transparent (no component export).

**Implications:** One import-line change in `main.tsx`; new file `dev-card-registration.tsx`.

#### [P04] `useDevCardServices` moves to its own hook module (DECIDED) {#p04-use-dev-card-services}

**Decision:** `useDevCardServices` moves to a new `use-dev-card-services.ts`, importing `cardServicesStore` from `lib/card-services-store.ts` and the `DevCardServices` type from `dev-card.tsx` (type import — erased). Its consumer (`dev-card-transcript.tsx`) updates its import.

**Rationale:** The hook is a thin `useSyncExternalStore` wrapper over the existing store ([L02]); a dedicated module keeps `dev-card.tsx` clean without entangling the store file.

**Implications:** New file `use-dev-card-services.ts`; one import change in `dev-card-transcript.tsx`. `DevCardServices` interface stays in `dev-card.tsx` (erased; safe).

#### [P05] The sweep is the regression oracle; no fake-DOM HMR test (DECIDED) {#p05-sweep-oracle}

**Decision:** Extend `fast-refresh-sweep.ts` with an importable `analyze()`, a `--assert <files…>` mode (non-zero exit if any named file escapes), and explicit dynamic-`import()`-as-cut modeling; add a pure-logic `bun test` drift test over a frozen-clean file set. No runtime/fake-DOM HMR test.

**Rationale:** happy-dom is deleted and fake-DOM render tests are banned; the static reachability analysis is the faithful, fast oracle for "would this edit reload?". Modeling dynamic imports as cuts is required to make the gallery-detach lever measurable ([P06], [Q01]).

**Implications:** The script gains a small CLI/exported surface; one new test file.

#### [P06] Seal the gallery cluster-exits — a measured, reversible experiment (DECIDED) {#p06-gallery-detach}

**Decision:** *After* Tier 1 lands and the post-Tier-1 sweep (#step-4a) shows which leaves still escape and via which exit, seal the remaining gallery exits. The **primary** mechanism is to convert `registerGalleryCards()` in `main.tsx` from a static import + sync call to an awaited dynamic `import()` inside the boot IIFE, before `new DeckManager` — removing the entire gallery subtree from the entry's static graph. This is run as a **measured, reversible experiment**, not an assumed win: if the dev smoke (#step-6) shows a leaf edit still full-reloads (e.g. Vite walks the dynamic-import edge), revert it and apply the **fallback** instead — clean the two `[mixed]` gallery files that are the actual boundary-free exits (`gallery-tool-block-file.tsx`: `greet`/`DEFAULT_GREETING`/`farewell`; `gallery-bash-tool-block.tsx`: `GalleryBashMountInSavedState`), plus any other mixed gallery file the sweep flags. We do **not** evict value exports from the transcript leaves themselves (the dropped Tier 2).

**Rationale:**
- The leaves do not live on two clean paths; they live in a cyclic cluster whose only escapes to the entry are a small set of exit nodes (#leaf-cluster). Tier 1 + `model-chip` already seal most of them; the gallery exits are what remain, and only a couple of `[mixed]` gallery files are actually boundary-free today.
- The dynamic-import cut seals all gallery exits in one edit and is reasonable on its own merits (galleries are dev-only demo surfaces, rarely edited during transcript work). But it depends on Vite's runtime dynamic-import propagation behavior ([Q01]) — unproven by inspection — so it carries a concrete, lower-risk fallback (clean ~2 mixed files) that does not.
- The sweep's import scan ignores dynamic `import()` (it matches only `… from '…'`), so the *model* treats the cut as removing the gallery subtree; the dev smoke (#step-6) is what proves the *runtime* matches the model.

**Implications:** Sequenced after a measurement step (#step-4a), not before. Primary path makes registration async; awaited before `new DeckManager` with a `.catch` that still constructs the deck on chunk-load failure (Risk R03, [L01]). One import/call-site change in `main.tsx`. Leaves still refresh at a cluster boundary (host remount), not in place — accepted ([#strategy]).

#### [P07] Reloads stay possible and must be non-destructive — faithful restore (DECIDED) {#p07-faithful-restore}

**Decision:** Boundary hygiene reduces reload *frequency* but cannot eliminate it; the invariant is that any reload that still occurs must restore the deck faithfully. Concretely: `main.tsx` must **never construct or persist the deck from a tugbank cache that has not received its first DEFAULTS frame** — i.e. it must `await tugbankClient.ready()` before `new DeckManager`. The await is already restored in code; this phase guards it against regression.

**Rationale:**
- A recent boot change commented out `tugbankClient.ready()`, so a reload raced the DEFAULTS frame; on a cold cache `readLayout` returned null → `buildDefaultLayout()` (empty deck) → the card was blown away, and the still-live server session showed as an orphan "Live in another card" row in the picker.
- The sweep oracle proves "did we avoid a reload"; nothing proves "a reload that slips through is non-destructive." This decision closes that gap.

**Implications:** A pure-logic guard test asserts the await precedes `new DeckManager` in `main.tsx`. A live reload app-test is a deferred follow-on ([#roadmap]).

---

### Deep Dives (Optional) {#deep-dives}

#### The leaf cluster and why sealing every exit is what matters {#leaf-cluster}

The boundary rule (below) makes a full reload happen iff an edited module's HMR propagation reaches the entry along non-accepting modules only. A transcript leaf (a `*-tool-block.tsx` or a `body-kinds/*-block.tsx`) is **not** on two clean paths to the entry. Direct reading of the import graph shows the leaves sit in a **dense, cyclic cluster**:

- `dev-assistant-renderer-dispatch.ts` is `[mixed]` and is imported by the spine **and** by `dev-tool-visibility-policy.ts`, `dev-permission-dialog.tsx`, `dev-route-indicator-badge.tsx`, and the tool-blocks themselves.
- The tool-blocks import `dispatch` back (`read-tool-block ↔ dispatch`); `dispatch ↔ dev-permission-dialog`; `dispatch → dev-tool-visibility-policy → dispatch`. Cycles throughout (the sweep's `escapes()` guards them with a `stack` set).

So a leaf edit does not "propagate up the spine." It full-reloads iff the **cluster has any boundary-free exit to the entry.** The exits, by reading, are:

| Cluster exit | Boundary today? | After this phase |
|---|---|---|
| `dev-card-transcript.tsx` | no (`[mixed]`) | **boundary** (Tier 1b, #step-4) |
| `dev-card.tsx` | no (`[mixed]`) | **boundary** (Tier 1a, #step-3) |
| `model-chip.tsx` | yes (component-only; only importer is `dev-card`) | unchanged |
| `dev-route-indicator-badge.tsx` | **to confirm** in #step-4a | unchanged / must already be a boundary |
| `gallery-*.tsx` (the ~20 that import leaves) | **mostly** yes, but `gallery-tool-block-file.tsx` (`greet`/`DEFAULT_GREETING`/`farewell`) and `gallery-bash-tool-block.tsx` (`GalleryBashMountInSavedState`) are `[mixed]` — live boundary-free exits | removed from the static graph (#step-5, [P06]) **or** the two mixed files cleaned (the [P06] fallback) |

The leaves stop full-reloading **only when every row above is a boundary or removed.** Tier 1 converts the two spine exits; `model-chip` is already a boundary; `dev-route-indicator-badge` must be verified (#step-4a); the gallery exits are sealed by [P06] (or its fallback). This is an **empirical claim about the whole exit set**, not a tidy "two graphs, detach one" story — it is verified by the post-Tier-1 sweep (#step-4a) and the dev smoke (#step-6), not by inspection. This is precisely the hazard [P01] names: a boundary above a module only helps modules reachable *only* through it, and the leaves have many importers.

The residual cost — a transcript-host remount when a leaf is edited (the leaves are themselves `[mixed]`, e.g. `read-tool-block` exports `composeFileData` + `ReadToolBlock`, so they never self-accept until cleaned) — is the price of *not* making each leaf its own boundary. Eliminating that remount (true per-leaf in-place refresh) is the deferred follow-on, and is polish, not a requirement.

---

### Specification {#specification}

#### Boundary rule (normative) {#boundary-rule}

- **Boundary (self-accepting):** ≥1 component export, **zero** runtime non-component exports (types/interfaces excluded), or a manual `import.meta.hot.accept()`. Editing it refreshes in place; propagation stops.
- **Mixed:** ≥1 component + ≥1 value export → non-accepting → propagates.
- **Transparent:** zero component exports (value/util/type/css only) → non-accepting → propagates, absorbed by the nearest boundary above.
- **Dynamic-import edge:** a module reached from the entry *only* via a dynamic `import()` is not on the static propagation path to the entry; Vite code-splits it.
- **Full page reload** occurs iff an edited module's propagation reaches a no-importer entry along static, non-accepting modules only.

#### State Zone Mapping (tugdeck/tugways plans) {#state-zone-mapping}

> This phase introduces **no new state**. It relocates one existing hook and the gallery registration call without changing zone or mechanism.

| State | Zone | Mechanism | Law |
|-------|------|-----------|-----|
| `cardServicesStore` services (via `useDevCardServices`) | structure / external-data | module store + `useSyncExternalStore` (unchanged; hook only relocates) | [L02] |
| gallery card-type registry (via `registerGalleryCards`) | structure | `registerCard` call (unchanged; only deferred behind an awaited dynamic `import()`) | [L02] |
| boot deck construction order | structure | `await tugbankClient.ready()` before `new DeckManager` (unchanged; guarded) | [L02] |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `src/lib/__tests__/fast-refresh-boundary.test.ts` | Pure-logic drift test: frozen-clean files report `escapes=false`. |
| `src/__tests__/boot-faithful-restore.test.ts` | Pure-logic guard: `main.tsx` awaits `tugbankClient.ready()` before `new DeckManager` ([P07]). |
| `src/components/tugways/cards/dev-card-registration.tsx` | Transparent shim exporting `registerDevCard` ([P03]). |
| `src/components/tugways/cards/use-dev-card-services.ts` | Hook module for `useDevCardServices` ([P04]). |
| `src/components/tugways/cards/transcript-host-helpers.ts` | Sibling for `dev-card-transcript.tsx`'s evicted value exports ([P02]). Exact symbol set confirmed by the sweep in #step-4. |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `analyze()` | fn (new export) | `scripts/fast-refresh-sweep.ts` | Exposes graph build + `escapes()` for the drift test/CLI. |
| `--assert` mode | CLI flag | `scripts/fast-refresh-sweep.ts` | Non-zero exit if any named file escapes. |
| `registerDevCard` | fn (relocate) | → `dev-card-registration.tsx` | [P03]; `main.tsx` import updates. |
| `useDevCardServices` | hook (relocate) | → `use-dev-card-services.ts` | [P04]; `dev-card-transcript.tsx` import updates. |
| `registerGalleryCards` | call (defer) | `main.tsx` | [P06]; static import → awaited dynamic `import()`. |

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Contract (sweep)** | `--assert` reports `escapes=false` for touched files | Every Tier 1 / gallery step checkpoint |
| **Drift Prevention** | Frozen-clean spine files stay boundary-clean; `main.tsx` keeps the `ready()` await before deck construction | #step-1, #step-2, and after each Tier 1 step |
| **Type check** | `tsc --noEmit` clean after each move | Every step |

#### What stays out of tests {#test-non-goals}

- Runtime/visual HMR behavior — covered by the static sweep oracle + a manual dev smoke; fake-DOM tests are banned ([P05]).
- A live reload app-test for faithful restore — deferred follow-on ([#roadmap]); this phase uses the pure-logic source guard.
- Per-symbol unit tests for relocated hooks/helpers — pure relocation, no logic change; `tsc` + existing tests cover them.
- Mock-store assertion tests — banned project-wide.

---

### Execution Steps {#execution-steps}

> Commit after all checkpoints pass. References are mandatory; never cite line numbers.

#### Step Status Ledger {#step-status-ledger}

| Step | Title | Status | Commit |
|---|---|---|---|
| #step-1 | Sweep oracle: importable analyzer + `--assert` + dynamic-import modeling + drift test | pending | — |
| #step-2 | Faithful-restore guard: assert `ready()` awaited before deck construction | pending | — |
| #step-3 | Tier 1a: make `dev-card.tsx` a boundary | pending | — |
| #step-4 | Tier 1b: make `dev-card-transcript.tsx` a boundary (+ confirm `dev-route-indicator-badge`) | pending | — |
| #step-4a | Measure post-Tier-1 leaf escapers and their exits (decides #step-5) | pending | — |
| #step-5 | Seal gallery exits: dynamic import (primary) or clean mixed gallery files (fallback) | pending | — |
| #step-6 | Integration checkpoint: per-target sweep + dev smoke gate | pending | — |

#### Step 1: Sweep oracle — importable analyzer + `--assert` + dynamic-import modeling + drift test {#step-1}

**Commit:** `tugdeck(hmr): make fast-refresh-sweep importable with --assert + dynamic-import cuts + drift test`

**References:** [P05] (#p05-sweep-oracle), [Q01] (#q01-gallery-dynamic-cut), (#boundary-rule, #success-criteria)

**Artifacts:**
- `scripts/fast-refresh-sweep.ts` refactored: export `analyze(): { reloaders, census, focusGraph }`; keep the human report under a `main()`; add `--assert <file…>` that exits non-zero if any named file escapes; make the dynamic-`import()`-as-cut behavior explicit and covered (today the import scan silently ignores `import()` — assert that a dynamically-imported-only module is treated as off the static path).
- New `src/lib/__tests__/fast-refresh-boundary.test.ts` (pure-logic `bun test`) asserting a frozen set of files report `escapes=false`.

**Tasks:**
- [ ] Extract the graph build + `escapes()` into an exported `analyze()`; preserve current CLI output via `main()`.
- [ ] Add `--assert` mode (accepts file paths; exit 1 + print offenders if any escape).
- [ ] Add a focused assertion/test that a module reached from the entry only via a dynamic `import()` is not flagged as escaping (grounds [Q01]).
- [ ] Seed the drift test's frozen list empty (extended per later step); assert the oracle wiring itself.

**Tests:**
- [ ] `bun test src/lib/__tests__/fast-refresh-boundary.test.ts` runs (pre-fix: asserts only oracle wiring + the dynamic-import-cut behavior, not yet the spine).

**Checkpoint:**
- [ ] `bun run scripts/fast-refresh-sweep.ts --assert src/main.tsx` exits non-zero (entry is an escaper — proves `--assert` detects one).
- [ ] `bunx tsc --noEmit` clean.

---

#### Step 2: Faithful-restore guard — assert `ready()` awaited before deck construction {#step-2}

**Commit:** `tugdeck(hmr): guard that boot awaits tugbankClient.ready() before constructing the deck`

**References:** [P07] (#p07-faithful-restore), Risk R02 (#r02-destructive-reload), (#context)

**Artifacts:**
- New `src/__tests__/boot-faithful-restore.test.ts` (pure-logic `bun test`): reads `src/main.tsx` source and asserts `await tugbankClient.ready()` appears and is **not** commented out, and that it precedes `new DeckManager(`. Match a stable token, tolerant of whitespace/formatting.

**Tasks:**
- [ ] Confirm `main.tsx` currently awaits `tugbankClient.ready()` before `new DeckManager` (already restored — verify).
- [ ] Write the guard test against the source text; fail clearly if the await is removed, commented, or reordered after construction.

**Tests:**
- [ ] `bun test src/__tests__/boot-faithful-restore.test.ts` green on the current (restored) boot.

**Checkpoint:**
- [ ] `bun test src/__tests__/boot-faithful-restore.test.ts` passes; temporarily commenting the await locally makes it fail (sanity-check the guard, then revert).
- [ ] `bunx tsc --noEmit` clean.

---

#### Step 3: Tier 1a — make `dev-card.tsx` a boundary {#step-3}

**Depends on:** #step-1

**Commit:** `tugdeck(hmr): split registerDevCard + useDevCardServices out of dev-card to make it a refresh boundary`

**References:** [P01] (#p01-file-is-boundary), [P03] (#p03-registration-shim), [P04] (#p04-use-dev-card-services), [Q02] (#q02-register-internals)

**Artifacts:**
- New `src/components/tugways/cards/dev-card-registration.tsx` exporting `registerDevCard`.
- New `src/components/tugways/cards/use-dev-card-services.ts` exporting `useDevCardServices`.
- `dev-card.tsx` left exporting only `DevCardContent`, `DevCardBody` (+ erased types).
- Updated importers: `main.tsx` (registerDevCard from shim), `dev-card-transcript.tsx` (useDevCardServices from new hook module).

**Tasks:**
- [ ] Confirm [Q02]: read `registerDevCard`; verify it needs only public exports.
- [ ] Move `registerDevCard` → `dev-card-registration.tsx`; import `DevCardContent` + `registerCard` + `FeedId`.
- [ ] Move `useDevCardServices` → `use-dev-card-services.ts`; import `cardServicesStore` and `type DevCardServices`.
- [ ] Update `main.tsx` and `dev-card-transcript.tsx` import specifiers.

**Tests:**
- [ ] Extend the drift frozen list with `dev-card.tsx`.

**Checkpoint:**
- [ ] `bun run scripts/fast-refresh-sweep.ts --assert src/components/tugways/cards/dev-card.tsx` exits 0.
- [ ] `bunx tsc --noEmit` clean.

---

#### Step 4: Tier 1b — make `dev-card-transcript.tsx` a boundary {#step-4}

**Depends on:** #step-3

**Commit:** `tugdeck(hmr): split transcript helpers out of dev-card-transcript to make it a refresh boundary`

**References:** [P01] (#p01-file-is-boundary), [P02] (#p02-sibling-eviction), (#leaf-cluster, #state-zone-mapping)

**Artifacts:**
- New sibling `src/components/tugways/cards/transcript-host-helpers.ts` exporting the value exports the sweep flags on `dev-card-transcript.tsx` (e.g. `useSessionModelName`, `formatTranscriptTimestamp`, `useTranscriptCellMenu` — confirm the exact set at step time).
- `dev-card-transcript.tsx` left exporting only `DevTranscriptHost` (+ erased types).
- Updated importer(s): any external consumer (e.g. `gallery-transcript-copy.tsx` consuming `useTranscriptCellMenu`) updates its import.

**Tasks:**
- [ ] Run the sweep to get the authoritative value-export list on `dev-card-transcript.tsx`.
- [ ] Move those hooks/fns to the sibling; keep erased types in place.
- [ ] Update each external consumer's import specifier.
- [ ] Verify no remaining value export on `dev-card-transcript.tsx`.
- [ ] Confirm the non-spine cluster exit `dev-route-indicator-badge.tsx` is already a component-only boundary (#leaf-cluster); if it is `[mixed]`, note it as a leaf-blocking exit for #step-4a (it is small and would be a cheap clean, but is out of the declared scope — record, don't silently absorb).

**Tests:**
- [ ] Add `dev-card-transcript.tsx` to the drift frozen list.

**Checkpoint:**
- [ ] `bun run scripts/fast-refresh-sweep.ts --assert src/components/tugways/cards/dev-card-transcript.tsx` exits 0.
- [ ] `bunx tsc --noEmit` clean.

---

#### Step 4a: Measure post-Tier-1 leaf escapers and their exits {#step-4a}

**Depends on:** #step-4

**Commit:** `N/A (measurement only)`

**References:** [P06] (#p06-gallery-detach), [Q01] (#q01-gallery-dynamic-cut), Risk R03 (#r03-gallery-cut-runtime), (#leaf-cluster, #success-criteria)

> This is the data-driven gate for #step-5. With Tier 1 landed, the two spine cluster-exits are now boundaries. Before touching the galleries, measure what still escapes and *why* — so #step-5 seals the right exits and isn't an assumed win.

**Tasks:**
- [ ] Re-run the full sweep. Record the per-directory escaper counts for `components/tugways/cards/tool-blocks/` and `components/tugways/body-kinds/` (the transcript-component leaves).
- [ ] For a representative still-escaping leaf, trace which cluster exit carries the escape (gallery path vs. a non-{spine,gallery} exit such as `dev-route-indicator-badge` if it is `[mixed]`). The sweep's reachability output + importer reading is the tool.
- [ ] Decide #step-5's mechanism from the data:
  - If the only remaining boundary-free exits are gallery files → proceed with [P06] primary (dynamic import) or fallback (clean the flagged `[mixed]` gallery files).
  - If a non-gallery exit also leaks → record it; [P06] alone will not clear those leaves, and the leaf success criterion is scoped to what the sealed exits cover (the rest is deferred, [#roadmap]). Do **not** silently expand scope to chase it.

**Tests:**
- [ ] None (measurement). The recorded numbers seed #step-6's per-target gate.

**Checkpoint:**
- [ ] Per-directory escaper counts for `tool-blocks/` and `body-kinds/` recorded, with the carrying exit identified for at least one leaf.

---

#### Step 5: Seal gallery exits — dynamic import (primary) or clean mixed gallery files (fallback) {#step-5}

**Depends on:** #step-4a

**Commit:** `tugdeck(hmr): seal gallery cluster-exits (dynamic-import registration | clean mixed gallery files)`

**References:** [P06] (#p06-gallery-detach), [Q01] (#q01-gallery-dynamic-cut), Risk R03 (#r03-gallery-cut-runtime), (#leaf-cluster)

**Artifacts (primary — chosen unless #step-4a/#step-6 say otherwise):**
- `main.tsx`: replace the static `import { registerGalleryCards } from ".../gallery-registrations"` + sync call with an awaited dynamic `import(".../gallery-registrations").then((m) => m.registerGalleryCards()).catch((err) => { /* log via tugDevLog; still construct the deck */ })` placed in the boot IIFE before `new DeckManager`.

**Artifacts (fallback — if the #step-6 smoke shows a leaf still full-reloads):**
- Revert the `main.tsx` change; instead make the `[mixed]` gallery files component-only: `gallery-tool-block-file.tsx` (drop/relocate `greet`, `DEFAULT_GREETING`, `farewell` — leftover scaffolding), `gallery-bash-tool-block.tsx` (relocate `GalleryBashMountInSavedState` to a sibling), plus any other gallery file #step-4a flagged.

**Tasks:**
- [ ] Confirm `registerGalleryCards` is the only static import pulling `gallery-registrations` (and the gallery subtree) into the entry chunk.
- [ ] Apply the primary mechanism: convert to the awaited dynamic import before deck construction, with a `.catch` that logs and proceeds to construct the deck (Risk R03, [L01]); verify a persisted gallery card still rehydrates ([Q01]).
- [ ] Re-run the sweep; confirm the gallery subtree no longer connects leaves to the entry.

**Tests:**
- [ ] No new test file; covered by the sweep delta and the dev smoke in #step-6.

**Checkpoint:**
- [ ] `bun run scripts/fast-refresh-sweep.ts` — gallery files drop out of the entry-reachable escaper set (primary) or the flagged gallery files report `escapes=false` (fallback).
- [ ] `bunx tsc --noEmit` clean.

---

#### Step 6: Integration checkpoint — per-target sweep + dev smoke gate {#step-6}

**Depends on:** #step-2, #step-3, #step-4, #step-4a, #step-5

**Commit:** `N/A (verification only)`

**References:** [P01] (#p01-file-is-boundary), [P06] (#p06-gallery-detach), [P07] (#p07-faithful-restore), [Q01] (#q01-gallery-dynamic-cut), Risk R03 (#r03-gallery-cut-runtime), (#success-criteria)

**Tasks:**
- [ ] Re-run the full sweep. Confirm both spine files report `escapes=false`. Record the per-directory escaper counts for `tool-blocks/` and `body-kinds/` (target: 0); record the gross transcript-graph total as informational only (expected to stay high — the deferred `lib/`/`markdown/`/`code-session-store/` residual).
- [ ] **Dev smoke (the [Q01]/Risk R03 gate):** edit `dev-card-transcript.tsx` → must refresh in place, no page reload. Edit one transcript tool-block → must not full-reload (a transcript-host remount is acceptable). If the tool-block edit still full-reloads, the dynamic-import cut did not hold at runtime → switch #step-5 to its fallback and re-run this gate.

**Tests:**
- [ ] `bun test src/lib/__tests__/fast-refresh-boundary.test.ts` green with both spine files frozen.
- [ ] `bun test src/__tests__/boot-faithful-restore.test.ts` green.

**Checkpoint:**
- [ ] Spine files refresh in place; a tool-block edit does not full-reload (primary or fallback, whichever passed the gate); [Q01] resolved with the chosen mechanism recorded.
- [ ] `bunx tsc --noEmit` clean.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** The two transcript spine files are clean, self-accepting Fast Refresh boundaries and the gallery cluster-exits are sealed, so editing the spine refreshes in place and editing a transcript leaf no longer triggers a full page reload (a leaf edit costs at most a host remount); any reload that still occurs restores the deck faithfully, enforced by a guard test, a sweep oracle, and a drift test.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] `dev-card.tsx` and `dev-card-transcript.tsx` report `escapes=false` (sweep `--assert`).
- [ ] Per-target: `tool-blocks/` and `body-kinds/` report 0 escapers in the sweep (the gross transcript-graph total is recorded informationally only and is expected to stay high — the deferred `lib/`/`markdown/`/`code-session-store/` residual).
- [ ] Dev smoke (the gate): editing the spine refreshes in place, and editing a transcript tool-block does not full-reload — via whichever #step-5 mechanism (dynamic-import primary or mixed-file fallback) passed.
- [ ] `bun test` drift test passes with both spine files frozen.
- [ ] `bun test` faithful-restore guard passes (boot awaits `ready()` before deck construction).
- [ ] `bunx tsc --noEmit` clean on the final tree.

**Acceptance tests:**
- [ ] `bun run scripts/fast-refresh-sweep.ts --assert src/components/tugways/cards/dev-card.tsx src/components/tugways/cards/dev-card-transcript.tsx`.
- [ ] `bun test src/lib/__tests__/fast-refresh-boundary.test.ts`.
- [ ] `bun test src/__tests__/boot-faithful-restore.test.ts`.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] **Per-leaf in-place refresh (the dropped Tier 2).** Evict value exports from tool-blocks, body-kinds, transcript chrome/cards, and contexts so each becomes its own boundary — eliminates the transcript-host remount on a leaf edit. Polish; do a group only if its host-remount-on-edit becomes a real annoyance.
- [ ] **Live reload app-test for faithful restore.** A `just app-test` that reloads with a card open and asserts the card survives and no orphan "live" session appears — the runtime counterpart to the [P07] source guard.
- [ ] **Gallery editing ergonomics.** If editing `gallery-*.tsx` during gallery work full-reloads (now that they are a dynamic chunk, an edit refreshes the gallery chunk, not the app), revisit only if it becomes painful.
- [ ] **Shared tugways primitives** (`tug-sheet`, `tug-popover`, `tug-list-row`, `theme-provider`, …) and **value-only lib modules** (`lib/code-session-store*`, `protocol.ts`, …) — deferred; broad consumer fan-out, low transcript-edit frequency.

| Checkpoint | Verification |
|------------|--------------|
| Spine cleaned | `fast-refresh-sweep.ts --assert` on both spine files exits 0 |
| Leaf exits measured | #step-4a records `tool-blocks/` + `body-kinds/` escaper counts and the carrying exit |
| Gallery exits sealed | sweep: gallery subtree no longer entry-reachable (primary) or flagged mixed files `escapes=false` (fallback); dev smoke: leaf edit does not full-reload |
| Faithful restore guarded | `bun test` boot guard green |
| No regressions | `bun test` drift test green; `tsc --noEmit` clean |
