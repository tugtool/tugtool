<!-- tugplan-skeleton v2 -->

## Tuglaws Tidy-Up — Consolidation, New Coverage, and Cross-Reference Repair {#tuglaws-tidyup}

**Purpose:** Bring the `tuglaws/` documentation set up to date with the
last two weeks of architectural change (app-test harness, code-signing
pipeline, lifecycle-delegate refinements, portal refactoring,
component state preservation system). Add three new docs for
under-documented areas, absorb selection content into a renamed
`card-state-model.md`, strip duplicated law text from
`framework-architecture.md`, and add an index so a reader can navigate
the set without having to read every file. Mostly prose; code changes
are mechanical (path/anchor updates only — no behavior changes).

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | complete (2026-04-27) |
| Target branch | main |
| Last updated | 2026-04-27 (Step 8 audit close-out) |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Over the past two weeks, several substantial systems have landed in
the codebase: the `app-test` harness (trusted-event integration tests
driving `Tug.app`), the macOS code-signing pipeline (`Tug Dev`
identity, AX-stable signatures, fingerprint sentinel), app/pane/card
design refinements (portal refactoring of `CardHost`, lifecycle
methods with delegate callouts), and the recently-renamed component
state preservation system (`useComponentStatePreservation`,
`useCardStatePreservation`, `data-tug-state-key`, `FocusSnapshot`,
`bag.{components,formControls,focus,regionScroll}`).

The `tuglaws/` documentation set has not kept up. The
state-preservation system is described nowhere as a single coherent
narrative — its identifiers and mechanisms appear scattered across
`selection-model.md`, `pane-model.md`, `app-test-inventory.md`, and
`design-decisions.md`, requiring four documents to reconstruct
end-to-end behavior. The lifecycle-delegate model (`onCardActivated`,
`cardWillBeginDestruction`, `CardPersistenceCallbacks` and successors)
is referenced obliquely in AT-tag entries but has no architectural
home. Portal refactoring of `CardHost` is mentioned in
`pane-model.md` ("portals into the host Pane's DOM; it is never
remounted") without any explanation of *why* (cross-Pane move
preservation per L23). The app-test harness and signing pipeline have
isolated docs that don't tie back to `tuglaws.md`/`design-decisions.md`.

The framework-architecture narrative duplicates law text in a 70-line
appendix (drift risk), `selection-model.md`'s "ResponderChainProvider
Document-Level Infrastructure" section duplicates content from
`responder-chain.md`, and there is no top-level reading guide telling
new contributors which doc to start with for which question.

#### Strategy {#strategy}

- **Additive over consolidating.** Three of the four docs we lack
  (state-preservation, lifecycle-delegates, app-test-harness)
  describe systems that don't fit cleanly into existing files. Add
  new docs rather than swelling existing ones.
- **One absorption.** `selection-model.md` is genuinely the right
  home for the state-preservation narrative — selection is one axis
  of preserved state, alongside scroll, focus, and form-control
  values. Promote it to `card-state-model.md` and absorb the
  state-preservation content. This avoids creating two adjacent docs
  that have to cross-reference each other for every concept.
- **Strip cross-doc duplication.** `framework-architecture.md`'s
  appendix re-prints law text → replace with anchored cross-refs
  to `tuglaws.md`. `card-state-model.md`'s ResponderChainProvider
  section → cross-ref to `responder-chain.md`.
- **One INDEX.md, kept short.** A reading guide; not a re-stating
  of every doc's contents. ≤ 150 lines.
- **Tie new docs into the L## / D## convention.** Every new doc
  opens with the same cross-reference banner (`[D##]` →
  design-decisions; `[L##]` → tuglaws). Where new architectural
  invariants emerge that are worth treating as laws, add new entries
  to `tuglaws.md` / `design-decisions.md` rather than burying them in
  the deep dive.
- **No behavior changes.** Code changes are limited to: (a) updating
  identifier-table cells in `pane-model.md` and Files tables across
  docs to point at `card-state-model.md` instead of
  `selection-model.md`; (b) updating any `selection-model.md` link in
  source comments / test files. No runtime, test, or build behavior
  changes.
- **Mechanical, grep-gated commits.** Each step has a grep-based
  acceptance criterion before commit. Mirrors the `tugplan-state-
  preservation-rename.md` pattern that just shipped.

#### Success Criteria (Measurable) {#success-criteria}

> Every criterion is a grep, exit-code, or "file exists" check.

- **SC01.** `tuglaws/INDEX.md` exists, ≤ 150 lines, lists every other
  doc in `tuglaws/` exactly once, with a one-line description per doc.
  Verify: `wc -l tuglaws/INDEX.md` ≤ 150 AND
  `ls tuglaws/*.md | grep -v INDEX.md | wc -l` matches the bullet
  count in INDEX.md (manual visual check).
- **SC02.** `tuglaws/card-state-model.md` exists and
  `tuglaws/selection-model.md` does not. Verify:
  `test -f tuglaws/card-state-model.md && ! test -f tuglaws/selection-model.md`.
- **SC03.** `tuglaws/state-preservation.md` exists and contains a
  section listing the core public identifiers of the preservation
  system, including the `CardStatePreservationCallbacks` callback
  bag and its `onCardActivated` / `onSave` / `onRestore` members
  (per OQ1 resolution: these belong with the preservation protocol,
  not the deck-level lifecycle pipe). "Core" means the identifiers
  enumerated in the loop below; secondary types referenced from
  callback signatures (`CardRestoreOptions`, `ComponentStateDescriptor`)
  may appear inline but are not gated. Verify: per-identifier
  presence loop emits no MISSING line:
  ```sh
  for id in useComponentStatePreservation useCardStatePreservation \
            ComponentStatePreservationRegistry \
            CardStatePreservationContext \
            CardStatePreservationContextValue \
            CardStatePreservationCallbacks \
            FocusSnapshot CardStateBag \
            data-tug-state-key data-tug-focus-key \
            data-tug-scroll-key data-tug-prompt-input-root \
            onCardActivated onSave onRestore; do
    grep -Fc "$id" tuglaws/state-preservation.md > /dev/null \
      || echo "MISSING: $id"
  done
  ```
  No `MISSING:` output means every identifier is present at least
  once. (A line-counting `grep -F | wc -l` is unreliable here
  because two identifiers on one line collapse into a single line
  count.)
- **SC04.** `tuglaws/lifecycle-delegates.md` exists and documents
  the deck-level `TugCardDelegate` event pipe — all eleven optional
  methods on the interface (`cardDidFinishConstruction`,
  `cardWillActivate`, `cardDidActivate`, `cardWillDeactivate`,
  `cardDidDeactivate`, `cardWillMove`, `cardDidMove`,
  `cardWillResize`, `cardDidResize`, `cardWillBeginDestruction`),
  the `TugCardDelegate` interface itself, the `MessageChannel`-backed
  drain queue mechanism, and the `CardHost` portal lifecycle. Per
  OQ1 resolution, this doc is strictly about the deck-level event
  pipe; preservation callbacks (`onCardActivated`, `onSave`,
  `onRestore`) live in `state-preservation.md` instead. Verify:
  per-identifier presence loop emits no MISSING line:
  ```sh
  for id in cardDidFinishConstruction \
            cardWillActivate cardDidActivate \
            cardWillDeactivate cardDidDeactivate \
            cardWillMove cardDidMove \
            cardWillResize cardDidResize \
            cardWillBeginDestruction \
            TugCardDelegate CardHost; do
    grep -Fc "$id" tuglaws/lifecycle-delegates.md > /dev/null \
      || echo "MISSING: $id"
  done
  ```
- **SC05.** `tuglaws/app-test-harness.md` exists and absorbs the
  overview-level content from `tests/app-test/README.md`
  (running, env vars, lifecycle model, fidelity envelope, smoke vs.
  scenario classification). The `tests/app-test/README.md` continues
  to exist but its narrative content is reduced to a one-paragraph
  pointer at `tuglaws/app-test-harness.md` followed by the
  test-author-specific procedural sections (Running, Adding a new
  test, Lint, Directory layout).
- **SC06.** `tuglaws/framework-architecture.md` no longer contains a
  duplicated "Appendix: Laws referenced" section. The block is
  replaced with a cross-reference list pointing to
  `tuglaws.md#l02`, `tuglaws.md#l03`, etc. Verify:
  `grep -c '^### L0' tuglaws/framework-architecture.md` returns `0`
  (the appendix's "### L02. ..." headings are gone).
- **SC07.** Every new doc and the renamed `card-state-model.md`
  opens with the canonical `[D##] / [L##]` cross-reference banner
  (matching the existing pattern in `responder-chain.md`,
  `action-naming.md`, `component-authoring.md`). Per OF3, the
  renamed file is treated as new for banner purposes — Step 2
  inserts the banner explicitly. Verify:
  `grep -l '^\*Cross-references:' tuglaws/*.md` includes every new
  file AND `card-state-model.md`. The grep is anchored to
  start-of-line and includes the canonical italic-asterisk format
  used in the existing docs.
- **SC08.** `tuglaws.md` cross-references at least one of the new
  docs from at least one law (e.g., L23 should cross-reference
  `state-preservation.md`; the existing list of cross-refs at L09
  should mention `lifecycle-delegates.md`). Verify by reading the
  cited law lines.
- **SC09.** `pane-model.md`'s "Files" table cell currently pointing at
  `tugdeck/src/components/tugways/use-card-state-preservation.tsx`
  remains correct, AND its "Cross-Links" section adds entries for
  `state-preservation.md` and `lifecycle-delegates.md`. Verify: a
  grep for both new doc names finds them in the Cross-Links block.
- **SC10.** `app-test-inventory.md` cross-references
  `state-preservation.md` for every [A9] protocol mention. The
  string "[A9]" appears in 7 distinct paragraphs in the current
  inventory; each must be accompanied by a `state-preservation.md`
  link in the same paragraph. Verify with a paragraph-level awk
  check that emits a `MISSING:` line for any [A9]-bearing paragraph
  that lacks a `state-preservation.md` link in the same paragraph
  block (paragraphs are RS=""):
  ```sh
  awk 'BEGIN{RS=""} /\[A9\]/ && !/state-preservation\.md/ \
      {print "MISSING: paragraph at record " NR " contains [A9] but no state-preservation.md link"}' \
      tuglaws/app-test-inventory.md
  ```
  Empty output means every [A9] paragraph has its own link. The
  count-based gate (`grep -c 'state-preservation.md'
  tuglaws/app-test-inventory.md` ≥ 7) is retained as a fast sanity
  check, but the awk script is the actual SC10 gate.
- **SC11.** No grep hit for the now-absorbed content path:
  `grep -r 'tuglaws/selection-model' tuglaws/ tugdeck/src/ tests/` returns 0 lines.
  (Source-code mentions of the old filename in comments are caught
  here. The `tests/` root sufficiently covers `tests/app-test/`; no
  separate path is needed per Assumption A04.)
- **SC12.** `bun x tsc --noEmit` exits 0 in `tugdeck/`. (Sanity:
  this plan does not change TypeScript behavior, but the path-comment
  edits in source files should not break the build. Run before commit
  on every step that touches `.tsx` / `.ts`.)
- **SC13.** `bun test` passes in `tugdeck/` (full suite). (Same sanity
  rationale.)

#### Scope {#scope}

1. Add `tuglaws/INDEX.md` — one-page reading guide. (Step 1)
2. Promote `selection-model.md` → `card-state-model.md`; absorb
   the state-preservation narrative. Update internal cross-refs and
   any source-code comments referencing the old path. (Step 2)
3. Add `tuglaws/state-preservation.md` — the full [A9] protocol
   end-to-end. (Step 3)
4. Add `tuglaws/lifecycle-delegates.md` — `CardLifecycle`
   callbacks, `onCardActivated`, `cardWillBeginDestruction`,
   `CardHost` portal lifecycle. (Step 4)
5. Add `tuglaws/app-test-harness.md` — overview lifted from
   `tests/app-test/README.md`; the README is reduced to procedural
   test-author content + a pointer up to the new doc. (Step 5)
6. Strip the law-text appendix from `framework-architecture.md`;
   replace with anchored cross-refs to `tuglaws.md`. (Step 6)
7. Repair cross-references — add missing links across the docs
   surfaced by SC08, SC09, SC10. (Step 7)
8. Final audit + verification. (Step 8)

#### Non-goals (Explicitly out of scope) {#non-goals}

- **Token-system consolidation.** `color-palette.md`,
  `theme-engine.md`, `token-naming.md`, and `tuglaws.md` L15-L20 do
  overlap, but each is scoped narrowly and the overlap is hierarchical
  (palette feeds tokens feed components). Collapsing them risks
  losing specificity. Defer.
- **Moving `tugplan-skeleton.md`.** User confirmed it stays in
  `tuglaws/` as architecture for plan documents.
- **Behavior changes.** No code refactors, no test refactors, no
  identifier renames. Pure docs work plus path-comment updates.
- **Adding new laws or design decisions for newly-identified
  architectural invariants.** If, while writing `state-preservation.md`,
  it becomes obvious that a new law is needed (e.g., "every
  component owning state opts into preservation via opt-in keys"),
  *flag it in [Q01]* and defer the new law to a follow-up plan. We
  document what exists; we don't legislate during a tidy-up.
- **Renaming `app-test-inventory.md`.** Recently renamed from
  `m-series-inventory.md` (per the 2026-04-27 cleanup); do not
  re-name.
- **Documenting the responder-chain or chain-related additions.**
  `responder-chain.md` is the most thorough doc in the set; it does
  not need updating in this pass.
- **Pre-flight baseline check** (`bun x tsc --noEmit` and `bun test`
  on `main` before Step 1). Per user clarification, trust `main`
  is clean; rely on the per-step SC12/SC13 sanity gates.

#### Dependencies / Prerequisites {#dependencies}

- The state-preservation rename plan is complete (commit `f0b35b91`,
  status `complete (2026-04-27)`). All identifiers used in
  `state-preservation.md` reference the post-rename names.
- The signing pipeline plan is complete (Phase 2 close-out, commit
  `72d23678`). `code-signing-mac.md` is the durable reference; the
  new `app-test-harness.md` will cross-reference it for the
  signing-related grant flow.

#### Constraints {#constraints}

- All new docs must follow the existing tuglaws style: title sentence
  + tagline, `[D##]` / `[L##]` cross-reference banner, body sections
  with H2 headers, "Files" table where applicable, "Cross-Links" or
  "Cross-References" closing block. (See `responder-chain.md` and
  `action-naming.md` for canonical reference patterns.)
- The `tugdeck/` build (`bun x tsc --noEmit`) and tests (`bun test`)
  must remain green at every step boundary.
- Commits follow the project's `<type>(<scope>): <subject>` form
  matching recent history (e.g., `docs(tuglaws): ...`).
- No grep-detectable references to the old `selection-model.md`
  filename anywhere in `tuglaws/`, `tugdeck/src/`, or `tests/` after
  Step 2.

#### Assumptions {#assumptions}

- **A01.** The current `selection-model.md` content is structurally
  sound and needs absorption (not rewriting). Its
  "ResponderChainProvider Document-Level Infrastructure" section is
  the only chunk we should consider trimming as duplicative.
- **A02.** `tests/app-test/README.md` is the right source for the
  harness overview; lifting from it means the new
  `app-test-harness.md` starts with already-authored, accurate
  content.
- **A03.** The lifecycle-delegate model has stabilized enough that
  documenting it now will not invalidate the doc next sprint. When
  the in-tree sources (`roadmap/tugplan-lifecycle-delegates.md`,
  `roadmap/lifecycle-delegate-reliability.md`,
  `tugdeck/src/components/chrome/card-host.tsx`) appear to differ
  on a point, treat `tugdeck/src/components/chrome/card-host.tsx` as
  the tie-breaker — the source code is the canonical lifecycle
  authority per [D07].
- **A04.** Portal-refactoring details are recoverable from
  `tugdeck/src/components/chrome/card-host.tsx` + `pane-model.md`
  ("portals into the host Pane's DOM"); a fresh read of the file plus
  the tugplan history is sufficient to document.
- **A05.** SC11's grep scope (`tuglaws/ tugdeck/src/ tests/`) is
  exhaustive for selection-model.md references in the repository.
  The `tests/` root path covers `tests/app-test/`; no separate
  app-test grep is needed. Per user clarification.
- **A06.** `main` is clean at start-of-phase. No pre-flight build /
  test baseline run is required before Step 1; the per-step
  SC12/SC13 sanity gates suffice. Per user clarification.

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

Standard tugplan-skeleton conventions apply (see
`tuglaws/tugplan-skeleton.md`). All execution-step anchors use
`#step-N` form; design-decision anchors use `#dNN-slug`; question
anchors use `#qNN-slug`; spec anchors use `#sNN-slug`; risk anchors
use `#rNN-slug`.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] Should new laws be added during this tidy-up? (DEFERRED) {#q01-new-laws}

**Question:** While writing `state-preservation.md` and
`lifecycle-delegates.md`, will architectural invariants emerge that
deserve new entries in `tuglaws.md` (e.g., "every preservation key
must be unique within its card subtree") or `design-decisions.md`?

**Why it matters:** A tidy-up that doubles as a law-authoring exercise
is no longer mechanical. Scope creep risk.

**Resolution:** **DEFERRED.** Document existing behavior; flag any
candidate new laws inline as `<!-- TODO: candidate law? -->` HTML
comments in the new docs. A follow-up plan can promote the candidates
into `tuglaws.md` after this phase ships. This phase does NOT modify
`tuglaws.md` except for cross-reference additions per SC08.

---

#### [Q02] Where should `framework-architecture.md` link readers for the law text? (DECIDED) {#q02-fa-appendix-replacement}

**Question:** When stripping the duplicated law-text appendix, what
should replace it?

**Resolution:** **DECIDED.** A short "Laws referenced in this
document" list with each law as `[L02](tuglaws.md#l02) — one-line
purpose`. Per OQ2 user resolution and overviewer finding OF3:
**laws are currently formatted as bold prose (`**L02. ...**`), not
as headings.** Trailing-attribute anchors (`&#123;#l02&#125;`)
require headings to attach to in most renderers. Therefore, Step 6
must promote each `**LNN. ...**` law line in `tuglaws.md` to an
`### LNN. ...` H3 heading **first**, then add the
`&#123;#lNN&#125;` trailing-attribute anchor to the new heading.
This is a structural rewrite of `tuglaws.md` (one heading
promotion + anchor addition per law) but produces real navigable
anchors that work in every renderer. The framework-architecture
appendix's content is then stripped and replaced by the new
anchored cross-ref list per the project's standard kebab-case
anchor convention.

---

#### [Q03] Should app-test scenario examples live in `app-test-harness.md` or stay in the README? (DECIDED) {#q03-test-examples}

**Question:** The README has worked examples (`launchTugApp`, scenario
shape, `holdModifier` pattern, `markDeckTrace` example). Do these go
in the new architecture doc, or stay in the README?

**Resolution:** **DECIDED.** Examples that explain **architecture**
(why a fresh app per file, why CGEvent vs. synthesized, fidelity
envelope) move to `app-test-harness.md`. Examples that explain
**procedure** (how to write a new test, the `describe.skipIf`
pattern, the `_harness/index.ts` import alias, the lint command)
stay in the README. The README becomes "test author's procedural
guide"; the new doc becomes "harness architecture reference."

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Drift between `card-state-model.md` and `state-preservation.md` after the absorption | Medium — readers re-confused | Medium | Each doc has a clear scope sentence in its opening; cross-ref each other once at the top, not throughout | If a future PR adds the same content to both docs |
| New docs go stale faster than `tuglaws.md` does | Medium | High | Cite `[L##]` and `[D##]` anchors throughout; keep narrative claims minimal — each new doc cites the law/decision it's elaborating, not redefining | Routine: any time `tuglaws.md` changes, sweep the new docs for cited laws |
| `app-test-harness.md` overlaps `tests/app-test/README.md` | Low | Medium | Q03 resolution — split by audience (architecture vs. procedure) | If a contributor reports finding the same content in both places |
| Source-code comments referencing `selection-model.md` slip through | Low | Low | SC11 grep gates the commit boundary | If post-merge the grep finds residuals |
| `framework-architecture.md` reads worse without the inline appendix | Low — reader has to click through | Medium | Replace with a *list* of laws + one-liners + anchored links — readable inline, full text one click away | If a reader complains the doc no longer stands alone |
| Lifecycle-delegate doc cites stale information | Medium | Low | Treat `card-host.tsx` as the tie-breaker source of truth ([D07]); cite the file directly when the in-tree roadmap docs disagree | If a follow-up sprint refactors lifecycle and the doc is not swept |

**Risk R01: Cross-doc drift between `card-state-model.md` and `state-preservation.md`** {#r01-cross-doc-drift}

- **Risk:** After the absorption, the same concept (e.g., "what
  `data-tug-state-key` does") is described in two places, and a
  future PR updates only one.
- **Mitigation:**
  - Each doc opens with a one-sentence scope statement that
    distinguishes contract (card-state-model) from protocol
    (state-preservation).
  - Per-axis sections in `card-state-model.md` cross-ref
    `state-preservation.md` once at the top, not throughout.
- **Residual risk:** A determined re-author can still copy content
  across; relies on reviewer discipline.

**Risk R02: SC11 false negative if grep scope misses a path** {#r02-sc11-scope}

- **Risk:** A surviving `selection-model.md` reference lives outside
  `tuglaws/`, `tugdeck/src/`, and `tests/` — e.g., in a
  `roadmap/` doc.
- **Mitigation:**
  - Step 7 includes an opportunistic broader grep
    (`grep -rln 'selection-model.md' .`) recorded in the close-out
    even if not gating.
  - Per Assumption A05, the chosen scope is the user-confirmed
    authoritative scope.
- **Residual risk:** A `roadmap/` doc could still cite the old name;
  acceptable because roadmap docs are append-only history.

**Risk R03: Lifecycle-delegate doc cites stale source authority** {#r03-lifecycle-stale-source}

- **Risk:** `roadmap/tugplan-lifecycle-delegates.md` and
  `roadmap/lifecycle-delegate-reliability.md` may differ on a
  callback's signature or firing order from the implementation in
  `tugdeck/src/lib/card-lifecycle.ts` (the primary authority) or
  `tugdeck/src/components/chrome/card-host.tsx` (secondary).
- **Mitigation:**
  - [D07] designates `tugdeck/src/lib/card-lifecycle.ts` as the
    primary tie-breaker, with `card-host.tsx` as secondary.
  - Step 4 task explicitly reads `card-lifecycle.ts` first, then
    compares against `card-host.tsx` and the roadmap docs, noting
    discrepancies in an inline `<!-- candidate law? -->` comment.
- **Residual risk:** If `tugdeck/src/lib/card-lifecycle.ts` itself
  contains a bug, the doc will codify the bug. Acceptable: the doc
  reflects current behavior; a behavior fix follow-up updates the
  doc.

---

### Design Decisions {#design-decisions}

#### [D01] Promote `selection-model.md` rather than create a sibling (DECIDED) {#d01-promote-selection-model}

**Decision:** Rename `selection-model.md` → `card-state-model.md`.
Absorb the state-preservation narrative into the renamed file.

**Rationale:**
- Selection is one axis of card state; scroll, focus, and form-control
  values are others. A doc named "selection-model" can't grow to
  cover the others without misnaming itself.
- Two adjacent docs ("selection-model" and "state-preservation")
  would have to cross-ref each other for every concept. One doc
  with internal sections is cleaner.
- The user explicitly chose this path in clarification #2.

**Implications:**
- `card-state-model.md` becomes the canonical doc for: selection
  containment (boundary, dimming, restore), focus state preservation
  (the `data-tug-focus-key` and `data-tug-state-key` attributes,
  `FocusSnapshot`), scroll preservation (`bag.scroll`,
  `bag.regionScroll`, `data-tug-scroll-key`), and form-control value
  preservation.
- `state-preservation.md` covers the protocol *implementation* (the
  hooks, the registry class, the bag shape, the lifecycle of a
  save/restore cycle) without re-stating the per-axis specifications.
- Cross-link: `card-state-model.md` → `state-preservation.md` once
  at the top of each axis; `state-preservation.md` →
  `card-state-model.md` for "what each axis means semantically."

---

#### [D02] `state-preservation.md` is implementation-centric; `card-state-model.md` is contract-centric (DECIDED) {#d02-doc-split}

**Decision:** The two docs split by *what* they describe, not *which
audience* reads them.

**Rationale:**
- A reader who wants to know "what does the framework guarantee
  about my selection across a tab switch?" reads `card-state-model.md`.
- A reader who wants to know "how does my component opt into having
  its state preserved?" reads `state-preservation.md`.
- The first answer is a behavioral contract (selection survives X, Y,
  Z); the second is an API guide (call `useComponentStatePreservation`
  with a key).

**Implications:**
- `card-state-model.md` cites `state-preservation.md` for "the
  underlying mechanism is described in [...]"; `state-preservation.md`
  cites `card-state-model.md` for "the contract this protocol
  satisfies is documented in [...]." Single backlink each direction.
- AT-tag entries in `app-test-inventory.md` cite *both* — the
  behavioral contract that's being tested + the protocol that
  produces it.

---

#### [D03] `app-test-harness.md` is "architecture"; `tests/app-test/README.md` is "test author procedure" (DECIDED) {#d03-harness-doc-split}

**Decision:** Lift architecture-flavored content (lifecycle model,
fidelity envelope, native-gesture rationale, accessibility-grant
mechanics) into `tuglaws/app-test-harness.md`. Reduce the
`tests/app-test/README.md` to: pointer up to the new doc, Running,
Environment variables (mostly), Adding a new test, Lint, Directory
layout. Remove the duplicated "Accessibility grant failure modes"
section from the README — it's already in `code-signing-mac.md` and
will be cross-referenced from the new `app-test-harness.md`.

**Rationale:** Q03 resolution. Keeps each doc scoped to one audience.

**Implications:**
- The README's current ~445 lines drop to roughly ~270–300. The
  retained sections (Related docs, Running, Environment variables,
  Live-mode, Adding a new test, Lint, Directory layout, TUGAPP_APP_TEST
  note) realistically total in this range; the gate at Step 5 is
  `wc -l < 320`. The reduction is still meaningful (~30%) — what
  moves out is the architectural narrative, not the procedural
  bulk.
- Test authors editing scenario tests rarely need to read the
  architecture doc.
- Architecture readers (someone proposing a harness change) read the
  new doc first and consult the README only for the procedural shape.

---

#### [D04] Strip the law-text appendix from `framework-architecture.md` (DECIDED) {#d04-strip-fa-appendix}

**Decision:** Replace `framework-architecture.md`'s "Appendix: Laws
referenced" block (currently re-prints L02/L03/L04/L05/L06/L07/L08/L11/L24)
with a list of the same laws each as `[L02] — one-line purpose
([full text](tuglaws.md#l02))`.

**Rationale:**
- Drift risk. The appendix is already slightly out of sync with
  `tuglaws.md` (e.g., L24 is the most-recently-added law and the
  appendix copy might lag).
- The full text exists in `tuglaws.md` — the appendix is a
  reading-convenience optimization that costs maintenance.

**Implications:**
- `tuglaws.md` must contain anchors `&#123;#l02&#125;` through
  `&#123;#l11&#125;` (and `&#123;#l24&#125;`) on every law
  referenced from the new list. Per [Q02] / OF3, the laws in
  `tuglaws.md` are currently formatted as bold prose
  (`**LNN. ...**`), not as headings. Step 6 therefore performs a
  structural rewrite: each referenced `**LNN. ...**` line is
  promoted to an `### LNN. ...` H3 heading, and the
  trailing-attribute anchor `&#123;#lNN&#125;` is added to the
  new heading. This is a heading promotion across at least the 9
  laws cited from `framework-architecture.md` (L02, L03, L04, L05,
  L06, L07, L08, L11, L24). For consistency and to support future
  cross-references, Step 6 also promotes every other
  `**LNN. ...**` law line in `tuglaws.md` (L01, L09–L25 inclusive
  of those not yet listed) to the same heading form with anchor —
  this is a one-time canonicalization, deliberately scoped to the
  heading level and anchor only (the law text and reference
  brackets stay intact).
- **Anchor-convention divergence (per OF2).** The existing
  tuglaws/ doc set's only law-anchor precedent is the
  `<a id="lNN"></a>` HTML-marker form inside
  `framework-architecture.md`'s appendix — the exact block this
  plan strips. The new convention adopted here
  (`### LNN. ... &#123;#lNN&#125;`) matches the kebab-case
  trailing-attribute pattern documented in `tugplan-skeleton.md`
  and used by every step / decision / spec / risk / question
  anchor in plan documents. This is intentional: laws live only
  in `tuglaws.md`, so consistency with other tuglaws doc anchor
  styles is moot (no other tuglaws doc carries `lNN` anchors).
  Adopting the project-wide kebab-case convention keeps law
  anchors aligned with the rest of the anchor system rather than
  preserving an HTML-marker style whose only use site is being
  deleted.
- Readers click one link to read full law text. Acceptable trade.

---

#### [D05] One INDEX, one read; no per-section preambles (DECIDED) {#d05-index-shape}

**Decision:** `tuglaws/INDEX.md` is a single flat list. Each entry
is one line: `- [doc-name.md](doc-name.md) — one-sentence
description with link to most-relevant section if applicable`. ≤ 150
lines total.

**Rationale:**
- An INDEX that grows section preambles becomes another doc to read
  before reading the actual doc. Defeats the purpose.
- One-line entries fit in a single screen for a typical viewport.

**Implications:**
- The descriptions must distinguish overlapping docs. E.g., for
  `card-state-model.md` and `state-preservation.md` the descriptions
  must explicitly answer "when do I read which?"

---

#### [D06] Existing source-code comments referencing `selection-model.md` get updated; production code does not (DECIDED) {#d06-comment-only-source-edits}

**Decision:** The only source-code change in this plan is updating
inline comments / JSDoc that reference the old `selection-model.md`
filename. No type signatures, exports, or runtime behavior change.

**Rationale:**
- Mechanical scope. Prevents the plan from creeping into refactor.
- SC11 enforces no surviving references to the old filename
  anywhere in `tugdeck/src/` or `tests/`.

**Implications:**
- After Step 2, `grep -rln 'selection-model.md' tugdeck/ tests/` must
  return 0 lines.
- Per the clarifier's review, the only known hits in
  `tugdeck/src/` are inline comments in
  `selection-guard.ts` and `use-copyable-text.tsx`. Both are
  comment-only and well within the [D06] scope.
- If the grep finds non-comment matches (production-code references
  to the filename), that is a different problem and requires a
  follow-up. Halt the step in that case. The user-confirmed baseline
  is that no such matches exist; this is a defensive guard, not an
  expected branch.

---

#### [D07] `card-lifecycle.ts` is the lifecycle source-of-truth tie-breaker (DECIDED) {#d07-lifecycle-tie-breaker}

**Decision:** When authoring `lifecycle-delegates.md`, if the
in-tree sources (`tugdeck/src/lib/card-lifecycle.ts`,
`tugdeck/src/components/chrome/card-host.tsx`,
`roadmap/tugplan-lifecycle-delegates.md`,
`roadmap/lifecycle-delegate-reliability.md`) disagree on the
shape, firing order, or signature of any lifecycle callback,
**`tugdeck/src/lib/card-lifecycle.ts` is the primary canonical
authority**, with `tugdeck/src/components/chrome/card-host.tsx` as
a secondary implementation source. The `card-lifecycle.ts` file
defines the `TugCardDelegate` interface, the four lifecycle event
names (`cardDidActivate`, `cardWillDeactivate`,
`cardWillBeginDestruction`, plus construction), the
observer-vs-delegate distinction, the MessageChannel-backed drain
queue, and the lifecycle log; `card-host.tsx` exercises only
preservation callbacks. Roadmap docs are historical.

**Rationale:**
- Per OQ1 user resolution and overviewer finding OF1: the actual
  `TugCardDelegate` interface, the three deck-level lifecycle method
  names, the drain-queue mechanism, and the observer pattern all
  live in `card-lifecycle.ts`. Designating `card-host.tsx` as
  primary would point readers at the wrong file.
- A doc that codifies past intent rather than current behavior would
  be wrong from day one.
- Roadmap docs by their nature describe what a plan aimed to ship;
  source code is what actually shipped.

**Implications:**
- Step 4 explicitly reads `tugdeck/src/lib/card-lifecycle.ts` first
  (primary) and `tugdeck/src/components/chrome/card-host.tsx` second
  (secondary), and uses their current callback names, signatures,
  and firing order.
- Any divergence between the roadmap docs and the source files
  surfaces as a `<!-- TODO: candidate law? -->` comment in the new
  doc, then defers to a follow-up per [Q01].
- This decision applies only to the lifecycle-delegates doc. Other
  new docs (state-preservation, app-test-harness) source-of-truth
  is the implementation file paired with the relevant tugplan
  close-out. For state-preservation specifically, the primary
  source is
  `tugdeck/src/components/tugways/use-card-state-preservation.tsx`
  (where `CardStatePreservationCallbacks` and `onCardActivated`
  live) plus
  `tugdeck/src/components/tugways/use-component-state-preservation.tsx`.

---

### Specification {#specification}

> The contract for each new/renamed doc.

**Spec S01: `tuglaws/INDEX.md` shape** {#s01-index}

**Shape:**

```
# Tuglaws — Reading Guide

*Where to look for what. Each entry below is a single source of truth
for its topic; cross-references take you between docs without
duplicating content.*

## Start here

- [framework-architecture.md] — Narrative overview ...
- [tuglaws.md] — The numbered laws ...
- [design-decisions.md] — The numbered decisions ...

## Component & UI architecture

- [pane-model.md] — Deck → Pane → Card hierarchy ...
- [card-state-model.md] — Selection, focus, scroll ... [DECIDED D01]
- [state-preservation.md] — The [A9] protocol ...
- [lifecycle-delegates.md] — `CardLifecycle` callbacks ...
- [responder-chain.md] — Action routing ...
- [action-naming.md] — Action vocabulary ...
- [component-authoring.md] — Component author's checklist ...

## Theming, palette, tokens

- [token-naming.md] — Seven-slot CSS custom-property naming ...
- [color-palette.md] — OKLCH palette ...
- [theme-engine.md] — Theme runtime ...

## Testing & build infrastructure

- [app-test-harness.md] — `Tug.app` integration tests ...
- [app-test-inventory.md] — AT-tag catalog ...
- [code-signing-mac.md] — `Tug Dev` signing pipeline ...

## Templates

- [tugplan-skeleton.md] — Template for `roadmap/` plan documents — kept here per user decision; not a tuglaws law/architecture doc.
```

**Constraints:**
- ≤ 150 lines.
- Every `tuglaws/*.md` file (except INDEX itself) appears exactly
  once.
- Each entry is one line.
- Section headers use H2 only — no H3 nesting.

---

**Spec S02: `tuglaws/card-state-model.md` (renamed from `selection-model.md`)** {#s02-card-state-model}

**Sections (top to bottom):**

1. *Title sentence + cross-ref banner* — `Selection, focus, scroll, and
   form-control values across tabs, pane activation, and reload.`
2. *Three Selection Categories* — kept verbatim from `selection-model.md`.
3. *Rules* — kept verbatim.
4. *`data-tug-select` Attribute* — kept verbatim.
5. *Focus Acceptance Model* — kept verbatim.
6. *Focus State Preservation Attributes* — kept; cross-ref
   `state-preservation.md` for the underlying mechanism.
7. *Scroll Preservation Attributes* — kept; same cross-ref.
   **NOTE:** the existing heading in `selection-model.md` is "Scroll
   Persistence Attributes". Rename Persistence → Preservation as
   part of the absorption (matches the recently-shipped
   state-preservation rename; "verbatim" elsewhere in this spec
   means content is preserved, not that this single heading word
   stays unchanged).
8. *Form-control Value Preservation* — **NEW**, brief — points at
   `state-preservation.md` for the protocol; documents the contract
   ("`data-tug-state-key` doubles as the focus key").
9. *Context Menu Hierarchy* — kept verbatim.
10. *SelectionGuard (Boundary Enforcer)* — kept verbatim.
11. *Relationship to Editing Components* — kept verbatim.
12. *ResponderChainProvider Document-Level Infrastructure* — **REMOVED**;
    cross-ref `responder-chain.md`.
13. *Files* — kept source-code-only (matching the precedent in the
    existing `selection-model.md` Files table; no doc-to-doc links
    introduced here).
14. *Cross-Links* (or *See also*) — **NEW closing section** at the
    bottom of the doc, mirroring `responder-chain.md`'s structure.
    Lists doc-to-doc links: `state-preservation.md` (the protocol
    behind the per-axis preservation contracts),
    `lifecycle-delegates.md` (where `cardWillBeginDestruction`
    semantics live), and the existing cross-references to
    `pane-model.md` / `responder-chain.md`. This is the right home
    for tuglaws/*.md cross-references; the Files table stays a
    source-code inventory.

---

**Spec S03: `tuglaws/state-preservation.md` (NEW)** {#s03-state-preservation}

**Sections:**

1. *Title + banner.* `The component- and card-level state
   preservation protocol — capture, persist, restore.`
2. *Why.* The L23 motivation: "save and restore is destruction with
   attempted recovery; we preserve user-visible state across
   bookkeeping operations."
3. *Two layers.*
   - **Component-level** (`useComponentStatePreservation`): an
     individual control opts in via `componentStatePreservationKey`.
     The framework captures `.value`, selection, scroll at save;
     reapplies on restore.
   - **Card-level** (`useCardStatePreservation`): a card's content
     factory registers `onSave` / `onRestore` callbacks. The card
     manages a richer payload (`bag.content`, often a domain-specific
     shape).
4. *Public identifiers.* All identifiers listed in SC03, one bullet
   per identifier with a one-line purpose. (This is the greppable
   section.) Per OQ1, this includes the preservation-layer callback
   bag types (`CardStatePreservationCallbacks`,
   `CardStatePreservationContextValue`) and their members
   (`onCardActivated`, `onSave`, `onRestore`) — these were previously
   miscategorized as belonging in `lifecycle-delegates.md` but are
   actually preservation-protocol concerns.
5. *Save/restore lifecycle.* When the framework calls onSave; what's
   in `bag` at that moment; what's in `bag` at restore time; the
   capture-phase invariant gate ([A9] tested by
   `smoke-capture-phase-save.test.ts`).
6. *DOM attributes.* Table — `data-tug-state-key`,
   `data-tug-focus-key`, `data-tug-scroll-key`,
   `data-tug-prompt-input-root`. (Repeats some of `card-state-model.md`'s
   table; that doc cross-refs here for "the protocol" while this
   doc cross-refs there for "the per-axis contract.")
7. *FocusSnapshot.* The discriminated-union shape; the four kinds.
8. *CardStateBag.* The flat object shape; how axes compose.
9. *Authoring rules.* When to opt in (uncontrolled inputs, native
   form controls); when not to (controlled inputs where React owns
   `value`); how to pick keys (uniqueness within card subtree).
10. *Relationship to AT-tags.* Cross-ref `app-test-inventory.md` for
    every AT-tag that gates this protocol.
11. *Files.* Source-of-truth file list. Primary sources:
    `tugdeck/src/components/tugways/use-card-state-preservation.tsx`
    (where `CardStatePreservationCallbacks`,
    `CardStatePreservationContextValue`, and the `onCardActivated`/
    `onSave`/`onRestore` callback shapes are defined),
    `tugdeck/src/components/tugways/use-component-state-preservation.tsx`
    (the component-level hook and registry). Secondary:
    `tugdeck/src/components/chrome/card-host.tsx` (where the
    callbacks are wired up in practice).
12. *Cross-Links.* L23, [D49]–[D50], `card-state-model.md`,
    `lifecycle-delegates.md` (for the deck-level `TugCardDelegate`
    pipe these callbacks ride atop).

---

**Spec S04: `tuglaws/lifecycle-delegates.md` (NEW)** {#s04-lifecycle-delegates}

**Scope (per OQ1 user resolution + OF1 expansion):** This doc is
strictly about the deck-level `TugCardDelegate` event pipe — every
optional method on the interface that the framework fires for
registered delegates. Per OF1, this covers all eleven methods
(`cardDidFinishConstruction`, the four will/did pairs for activate,
deactivate, move, resize, plus `cardWillBeginDestruction`), not a
3-method subset. The preservation-layer callbacks
(`onCardActivated`, `onSave`, `onRestore`) live in
`state-preservation.md`, not here.

**Sections:**

1. *Title + banner.* `Card lifecycle: the deck-level event pipe
   for construction, activation, deactivation, geometry changes
   (move/resize), and destruction. How TugCardDelegate is
   registered, drained, and surfaced to observers.`
2. *Why a delegate model.* The card-content factory pattern: the
   framework owns the timing; content owns the semantics. Delegates
   are how the deck announces framework-driven transitions to
   observers and content code that needs to react.
3. *The lifecycle moments the pipe surfaces.* Six framework-driven
   moments, surfaced to delegates as eleven optional methods:
   construction (`cardDidFinishConstruction`); activation
   (`cardWillActivate` / `cardDidActivate`); deactivation
   (`cardWillDeactivate` / `cardDidDeactivate`); move
   (`cardWillMove` / `cardDidMove`); resize (`cardWillResize` /
   `cardDidResize`); destruction (`cardWillBeginDestruction`).
   Document the strict ordering invariant from
   `card-lifecycle.ts`: `cardWillDeactivate(A)` →
   `cardWillActivate(B)` → `cardDidDeactivate(A)` →
   `cardDidActivate(B)` for cross-card focus changes — the
   will/did pairs interleave across the outgoing and incoming
   cards rather than running A's pair to completion before B's.
4. *The TugCardDelegate interface.* Defined in
   `tugdeck/src/lib/card-lifecycle.ts`. Eleven optional methods,
   each receiving a `cardId` (move/resize variants additionally
   carry geometry payloads — document the actual shapes from the
   interface). Document the observer-vs-delegate distinction: a
   delegate is a single active responder; observers are passive
   watchers.
5. *The drain queue.* The `MessageChannel`-backed enqueue/drain
   mechanism in `card-lifecycle.ts` (lines ~735–795 in the current
   source); how events are queued and surfaced to delegates and
   observers; the lifecycle log (`LIFECYCLE_LOG`) used for
   debugging.
6. *Per-moment delegate detail.*
   - `cardDidFinishConstruction(cardId)` — the deck has finished
     wiring up a new card; first moment a delegate can observe it.
   - `cardWillActivate(cardId)` / `cardDidActivate(cardId)` — pre-
     and post-activation hooks. Activation is the
     inactive-to-active transition. AT0008. Cross-ref
     `app-test-inventory.md` AT0002 / AT0004 / AT0005 / AT0006 /
     AT0007 / AT0009.
   - `cardWillDeactivate(cardId)` / `cardDidDeactivate(cardId)` —
     pre- and post-deactivation hooks. The will-phase is the
     standard moment to stash state before the active-to-inactive
     transition.
   - `cardWillMove(cardId, ...)` / `cardDidMove(cardId, ...)` —
     pre- and post-move hooks. Fired when the deck repositions a
     card within or across panes. Document the geometry payload
     shape from the interface.
   - `cardWillResize(cardId, ...)` / `cardDidResize(cardId, ...)` —
     pre- and post-resize hooks for size changes. Same geometry
     payload pattern as move.
   - `cardWillBeginDestruction(cardId)` — final flush before
     unmount. AT0019.
7. *Portal-refactoring relationship.* `CardHost` portals into the
   pane's DOM rather than remounting on cross-Pane move; this is
   what makes the lifecycle observable in the first place. Without
   the portal, every cross-Pane move would unmount and remount,
   firing destruction + mount instead of activation. L23 is the law
   this enables.
8. *When delegates fire vs. when React effects fire.* The interplay
   with `useLayoutEffect`/`useEffect`; why the drain queue runs on
   a `MessageChannel` (microtask-adjacent) rather than synchronously.
9. *Authoring rules.* When to register a `TugCardDelegate` (code
   that needs framework-driven lifecycle events outside React's
   render cycle); when to skip (chrome-only content). For
   preservation needs (`onSave`/`onRestore`/`onCardActivated`),
   point readers at `state-preservation.md`.
10. *Files.* Source-code inventory. **Primary canonical authority:
    `tugdeck/src/lib/card-lifecycle.ts`** (the `TugCardDelegate`
    interface, lifecycle event names, drain queue, lifecycle log)
    per [D07]. **Secondary implementation source:**
    `tugdeck/src/components/chrome/card-host.tsx` (where the
    delegate is registered against the deck and the portal
    lifecycle is exercised). The roadmap docs
    (`roadmap/tugplan-lifecycle-delegates.md`,
    `roadmap/lifecycle-delegate-reliability.md`) are listed as
    historical/secondary.
11. *Cross-Links.* L23, L09, L10, [D49]–[D52], `pane-model.md`,
    `state-preservation.md` (for the preservation-layer callbacks
    that ride on top of this pipe).

---

**Spec S05: `tuglaws/app-test-harness.md` (NEW)** {#s05-app-test-harness}

**Content lifted from `tests/app-test/README.md`:**

1. *Title + banner.*
2. *What the harness is.* (~current README ¶1.) Subprocess driving
   `Tug.app` via the `TestHarness` Unix-socket bridge. WKWebView,
   not happy-dom.
3. *The trusted-event problem.* Why `CGEvent.post`; why WKWebView's
   `isTrusted` paths matter; why a test posting a synthesized event
   doesn't reach the same code-paths as a real click.
4. *Lifecycle model.* One App per file; explicit reset; rationale
   from current README.
5. *Fidelity envelope.* What the harness can and cannot assert;
   visual rendering, perceived snappiness — out of envelope.
6. *Phase A surface.* Native gestures, native keyboard, introspection
   table.
7. *Accessibility-grant relationship.* Cross-ref
   `code-signing-mac.md` for the deep dive; one-paragraph summary
   here. Mentions `APP_TEST_SKIP_RESIGN` escape hatch.
8. *Smoke vs. scenario classification.* Cross-ref
   `app-test-inventory.md`.
9. *Files.* Source-of-truth file list.
10. *Cross-Links.* `app-test-inventory.md`, `code-signing-mac.md`,
    `roadmap/tugplan-in-app-bridge.md`,
    `roadmap/tugplan-harness-extensions.md`.

**Removed from `tests/app-test/README.md`:**

- "What the harness is" / "The trusted-event problem" /
  "Lifecycle model" / "Fidelity envelope" / "Phase A surface" /
  "Accessibility grant failure modes" sections (these move to the
  new doc).

**Retained in `tests/app-test/README.md`:**

- "Related docs" pointer (updated).
- "Running" — `just app-test` invocations and `VERDICT: ` summary
  format.
- "Environment variables" — table.
- "Live-mode tugcode smoke" — opt-in.
- "Adding a new test" — procedural.
- "Lint: no raw timers" — procedural.
- "Directory layout" — file tree.
- "TUGAPP_APP_TEST naming note" — historical.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tuglaws/INDEX.md` | One-page reading guide. SC01. |
| `tuglaws/state-preservation.md` | [A9] protocol end-to-end. SC03. |
| `tuglaws/lifecycle-delegates.md` | Card lifecycle delegates + portal. SC04. |
| `tuglaws/app-test-harness.md` | Harness architecture overview. SC05. |

#### Renamed files {#renamed-files}

| From | To |
|------|----|
| `tuglaws/selection-model.md` | `tuglaws/card-state-model.md` |

#### Modified files {#modified-files}

| File | Change |
|------|--------|
| `tuglaws/tuglaws.md` | **Structural rewrite per [Q02] / OF3:** promote every `**LNN. ...**` law line to `### LNN. ...` H3 heading and add `&#123;#lNN&#125;` trailing-attribute anchors. Then add cross-ref to `state-preservation.md` and `lifecycle-delegates.md` from L23 (and L09 for lifecycle). Heading promotion + anchor addition is mechanical (one edit per law line, ~25 laws total); the law text itself is preserved verbatim. |
| `tuglaws/framework-architecture.md` | Strip law-text appendix; replace with cross-ref list. SC06. (Depends on `tuglaws.md` headings + anchors landing first within Step 6.) |
| `tuglaws/pane-model.md` | Update Files-table cell; add `state-preservation.md` and `lifecycle-delegates.md` to Cross-Links. SC09. |
| `tuglaws/app-test-inventory.md` | Add cross-ref links to `state-preservation.md` per SC10 (one link per [A9] paragraph; 7 paragraphs total). |
| `tuglaws/responder-chain.md` | One-line cross-ref note: "for the focus-refusal mechanism, see `card-state-model.md`." |
| `tuglaws/component-authoring.md` | Update Selection-and-Focus section's link target from `selection-model.md` → `card-state-model.md`. |
| `tests/app-test/README.md` | Reduce to procedural sections per [D03]. Target ~270–300 lines (gate at `wc -l < 320`). |
| `tugdeck/src/**/*.{ts,tsx}` (comments only) | Path comment updates if any reference `selection-model.md`. Known hits: `selection-guard.ts`, `use-copyable-text.tsx`. |

---

### Documentation Plan {#documentation-plan}

- [ ] `tuglaws/INDEX.md` — created (Step 1).
- [ ] `tuglaws/card-state-model.md` — content absorbed (Step 2).
- [ ] `tuglaws/state-preservation.md` — created (Step 3).
- [ ] `tuglaws/lifecycle-delegates.md` — created (Step 4).
- [ ] `tuglaws/app-test-harness.md` — created (Step 5).
- [ ] `tuglaws/framework-architecture.md` — appendix replaced (Step 6).
- [ ] Cross-references repaired across docs (Step 7).
- [ ] Final audit (Step 8).

---

### Test Plan Concepts {#test-plan-concepts}

> This is a docs plan; the "tests" below are grep contracts and
> exit-code checks, not Bun test files.

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Grep contract** | Verify a doc references / doesn't reference a string | Every step boundary; SC01, SC02, SC03, SC06, SC07, SC11 |
| **`bun x tsc --noEmit`** | Sanity: no source-code edits broke types | Steps 2 (path comment update), 7 (cross-ref repairs), 8 (final) |
| **`bun test` (tugdeck)** | Sanity: no source-code edits broke tests | Same as above |
| **Manual visual** | Read-through of new docs by author | Each new-doc step (3, 4, 5) and Step 8 |

The plan does **not** require running `just app-test` — no production
behavior changes.

---

### Execution Steps {#execution-steps}

#### Step 1: Add `tuglaws/INDEX.md` reading guide {#step-1}

**Commit:** `docs(tuglaws): add INDEX reading guide`

**References:** [D05] One-page index, Spec S01, (#strategy, #scope)

**Artifacts:**
- New file `tuglaws/INDEX.md` per Spec S01.

**Tasks:**
- [ ] Write `tuglaws/INDEX.md` listing every existing
      `tuglaws/*.md` file plus the four new files (which won't
      exist yet — entries point to the future paths intentionally;
      Steps 2–5 create them).
- [ ] Verify ≤ 150 lines: `wc -l tuglaws/INDEX.md`.
- [ ] Visual readthrough: section headers are H2, no nested H3, no
      line wraps mid-link.

**Tests:**
- [ ] `wc -l tuglaws/INDEX.md` shows ≤ 150.
- [ ] `grep -c '^## ' tuglaws/INDEX.md` ≥ 4 (at least 4 section
      headers).
- [ ] Every `tuglaws/*.md` file has a matching `(filename.md)` link
      in INDEX.md (manual eyeball; ≤ 14 entries).

**Checkpoint:**
- [ ] `wc -l tuglaws/INDEX.md` shows ≤ 150.
- [ ] Visual review.

---

#### Step 2: Promote `selection-model.md` → `card-state-model.md` and absorb state-preservation content {#step-2}

**Depends on:** #step-1

**Commit:** `docs(tuglaws): rename selection-model → card-state-model and absorb preservation content`

**References:** [D01] Promote selection-model, [D02] Doc split, [D06] Comment-only source edits, Spec S02, Risk R02, (#scope, #constraints)

**Artifacts:**
- `git mv tuglaws/selection-model.md tuglaws/card-state-model.md`.
- Content edits per Spec S02:
  - Title sentence updated.
  - "Form-control Value Preservation" section added (NEW; brief).
  - "ResponderChainProvider Document-Level Infrastructure" section
    REMOVED (replaced with one-line cross-ref to
    `responder-chain.md`).
  - "Files" table updated.
- Cross-ref updates in:
  - `tuglaws/pane-model.md` (Cross-Links + Files where the old name
    appears).
  - `tuglaws/component-authoring.md` ("Selection and Focus" section's
    inline link).
  - `tuglaws/responder-chain.md` — **additive** one-line cross-ref
    note per the Modified Files table: "for the focus-refusal
    mechanism, see `card-state-model.md`." (`responder-chain.md`
    currently contains no incoming reference to `selection-model`;
    the edit adds a new pointer rather than rewriting an existing
    one.)
  - Source-code comments under `tugdeck/src/` and `tests/` that
    reference `selection-model.md`. Per [D06], the known hits are
    inline comments in `selection-guard.ts` and
    `use-copyable-text.tsx`. Comment-only.

**Tasks:**
- [ ] `git mv tuglaws/selection-model.md tuglaws/card-state-model.md`.
- [ ] Edit title sentence in the new file.
- [ ] **Insert the canonical `*Cross-references:` banner** under
      the title sentence, matching the italic-asterisk format used
      in `responder-chain.md`, `action-naming.md`, and
      `component-authoring.md`. Per OF3, the renamed file is
      treated as new for SC07 banner purposes — this task ensures
      the banner exists rather than relying on the original
      `selection-model.md` which has no banner today.
- [ ] Add "Form-control Value Preservation" section (≤ 30 lines).
- [ ] Strip "ResponderChainProvider Document-Level Infrastructure"
      section; replace with one-line cross-ref.
- [ ] Update Files table.
- [ ] Add a one-line cross-ref note in `tuglaws/responder-chain.md`
      per the Modified Files table: "for the focus-refusal
      mechanism, see `card-state-model.md`." This is an **additive**
      edit — the file currently has no incoming references to
      `selection-model`.
- [ ] `grep -rln 'selection-model.md' tuglaws/` — update each hit.
- [ ] `grep -rln 'selection-model.md' tugdeck/src/ tests/` — update
      each hit (comment-only per [D06]; if the grep finds
      production-code references, halt and ask before proceeding —
      this is not expected per the user-confirmed baseline).

**Tests:**
- [ ] `test -f tuglaws/card-state-model.md && ! test -f tuglaws/selection-model.md` (SC02).
- [ ] `grep -rln 'selection-model.md' tuglaws/ tugdeck/src/ tests/`
      returns 0 lines (SC11).
- [ ] `bun x tsc --noEmit` exits 0 (SC12).
- [ ] `bun test` passes in `tugdeck/` (SC13).

**Checkpoint:**
- [ ] All four tests above pass.

---

#### Step 3: Add `tuglaws/state-preservation.md` {#step-3}

**Depends on:** #step-2

**Commit:** `docs(tuglaws): add state-preservation protocol reference`

**References:** [D02] Doc split, Spec S03, [Q01] New laws deferred, Risk R01, (#scope)

**Artifacts:**
- New file `tuglaws/state-preservation.md` per Spec S03.
- Backlinks added from `card-state-model.md` to
  `state-preservation.md` at the top of each axis section (Focus,
  Scroll, Form-control Value).

**Tasks:**
- [ ] Author `state-preservation.md`. Cross-reference banner at top.
- [ ] Identifier section lists ≥ 10 public identifiers (SC03).
- [ ] Link to `app-test-inventory.md` AT-tags that gate this
      protocol.
- [ ] Add "for the underlying protocol mechanism, see
      [state-preservation.md]" lines at the head of
      `card-state-model.md`'s Focus / Scroll / Form-control sections.

**Tests:**
- [ ] `test -f tuglaws/state-preservation.md` (SC03).
- [ ] Per-identifier presence loop (SC03) emits no `MISSING:` line:
      ```sh
      for id in useComponentStatePreservation useCardStatePreservation \
                ComponentStatePreservationRegistry \
                CardStatePreservationContext \
                CardStatePreservationContextValue \
                CardStatePreservationCallbacks \
                FocusSnapshot CardStateBag \
                data-tug-state-key data-tug-focus-key \
                data-tug-scroll-key data-tug-prompt-input-root \
                onCardActivated onSave onRestore; do
        grep -Fc "$id" tuglaws/state-preservation.md > /dev/null \
          || echo "MISSING: $id"
      done
      ```
- [ ] `grep -c '^\*Cross-references:' tuglaws/state-preservation.md`
      ≥ 1 (SC07 banner present, anchored to start-of-line,
      italic-asterisk format).

**Checkpoint:**
- [ ] All three tests pass.
- [ ] Visual readthrough of the new doc.

---

#### Step 4: Add `tuglaws/lifecycle-delegates.md` {#step-4}

**Depends on:** #step-3

**Commit:** `docs(tuglaws): add lifecycle-delegates reference`

**References:** [D07] card-lifecycle.ts tie-breaker, Spec S04, [Q01] New laws deferred, Risk R03, (#scope)

**Artifacts:**
- New file `tuglaws/lifecycle-delegates.md` per Spec S04 — strictly
  scoped to the deck-level `TugCardDelegate` event pipe per OQ1
  resolution.

**Tasks:**
- [ ] **Read `tugdeck/src/lib/card-lifecycle.ts` first** (the
      primary canonical authority per [D07]) — use its current
      `TugCardDelegate` interface, the eleven optional lifecycle
      methods (`cardDidFinishConstruction`, `cardWillActivate`,
      `cardDidActivate`, `cardWillDeactivate`, `cardDidDeactivate`,
      `cardWillMove`, `cardDidMove`, `cardWillResize`,
      `cardDidResize`, `cardWillBeginDestruction`), the strict
      will/did pair ordering across cards, the
      observer-vs-delegate distinction, the `MessageChannel` drain
      queue, and the `LIFECYCLE_LOG` lifecycle log as the source
      of truth.
- [ ] **Read `tugdeck/src/components/chrome/card-host.tsx` second**
      (secondary implementation source per [D07]) — focus on how
      the delegate is wired up against the deck and how the portal
      lifecycle is exercised. Note: the preservation-layer
      callbacks (`CardStatePreservationCallbacks`,
      `onCardActivated`, `onSave`, `onRestore`) live in
      `use-card-state-preservation.tsx`, NOT `card-host.tsx` and
      NOT `card-lifecycle.ts`; per OQ1, those go into
      `state-preservation.md` (Step 3), not this doc.
- [ ] Compare against `roadmap/tugplan-lifecycle-delegates.md` and
      `roadmap/lifecycle-delegate-reliability.md`. Where the roadmap
      docs disagree with `card-lifecycle.ts` or `card-host.tsx`,
      follow the source files and add a
      `<!-- TODO: candidate law? roadmap doc disagrees on X -->`
      comment in the new doc per [Q01].
- [ ] Author the doc, sourced primarily from
      `tugdeck/src/lib/card-lifecycle.ts` and secondarily from
      `tugdeck/src/components/chrome/card-host.tsx` and AT0008 /
      AT0019 entries in the inventory.
- [ ] Cover all six lifecycle moments — construction, activate
      (will/did), deactivate (will/did), move (will/did), resize
      (will/did), destroy — surfaced as eleven optional
      `TugCardDelegate` methods. Document the strict
      `cardWillDeactivate(A) → cardWillActivate(B) →
      cardDidDeactivate(A) → cardDidActivate(B)` cross-card
      ordering invariant, the `TugCardDelegate` interface, the
      drain queue, and the portal relationship.
- [ ] Cross-reference banner at top.

**Tests:**
- [ ] `test -f tuglaws/lifecycle-delegates.md` (SC04).
- [ ] Per-identifier presence loop (SC04) emits no `MISSING:` line:
      ```sh
      for id in cardDidFinishConstruction \
                cardWillActivate cardDidActivate \
                cardWillDeactivate cardDidDeactivate \
                cardWillMove cardDidMove \
                cardWillResize cardDidResize \
                cardWillBeginDestruction \
                TugCardDelegate CardHost; do
        grep -Fc "$id" tuglaws/lifecycle-delegates.md > /dev/null \
          || echo "MISSING: $id"
      done
      ```
- [ ] `grep -c '^\*Cross-references:' tuglaws/lifecycle-delegates.md`
      ≥ 1 (SC07, anchored to start-of-line, italic-asterisk format).

**Checkpoint:**
- [ ] All three tests pass.
- [ ] Visual readthrough.

---

#### Step 5: Add `tuglaws/app-test-harness.md` and reduce `tests/app-test/README.md` {#step-5}

**Depends on:** #step-4

**Commit:** `docs(tuglaws): lift app-test harness architecture to tuglaws/`

**References:** [D03] Harness doc split, [Q03] Test examples, Spec S05, (#scope)

**Artifacts:**
- New file `tuglaws/app-test-harness.md`.
- Reduced `tests/app-test/README.md` (sections kept: Related docs,
  Running, Environment variables, Live-mode tugcode smoke, Adding a
  new test, Lint, Directory layout, TUGAPP_APP_TEST naming note).

**Tasks:**
- [ ] Author `tuglaws/app-test-harness.md` lifting per Spec S05.
- [ ] Strip the lifted sections from `tests/app-test/README.md`.
- [ ] Add a one-paragraph pointer at the top of the README:
      "For the harness *architecture* — lifecycle model, fidelity
      envelope, native-gesture rationale, accessibility-grant
      relationship — see [tuglaws/app-test-harness.md]. This README
      covers the **procedural** test-author workflow."
- [ ] Update `tests/app-test/README.md`'s "Related docs" block to
      include the new `tuglaws/app-test-harness.md` entry.

**Tests:**
- [ ] `test -f tuglaws/app-test-harness.md` (SC05).
- [ ] `grep -c '^\*Cross-references:' tuglaws/app-test-harness.md` ≥ 1 (SC07).
- [ ] `wc -l tests/app-test/README.md` < 320 (procedural-only target;
      per [D03] Implications and OF6, the realistic target is
      ~270–300 lines after stripping the architectural narrative).
- [ ] `grep -c 'Accessibility grant failure modes' tests/app-test/README.md`
      returns 0 (lifted out).

**Checkpoint:**
- [ ] All four tests pass.
- [ ] Visual readthrough.

---

#### Step 6: Promote law headings in `tuglaws.md`, then strip appendix from `framework-architecture.md` {#step-6}

**Depends on:** #step-5

**Commit:** `docs(tuglaws): promote law headings, anchor them, and replace framework-architecture appendix with cross-refs`

**References:** [D04] Strip FA appendix, [Q02] Law text replacement, (#scope)

**Artifacts:**
- `tuglaws/tuglaws.md` — **structural rewrite per [Q02] / OF3:**
  every `**LNN. ...**` law line promoted to `### LNN. ...` H3
  heading with a `&#123;#lNN&#125;` trailing-attribute anchor. The
  law text, citation brackets, and adjacency to related prose are
  preserved verbatim — only the heading level and anchor are added.
- `tuglaws/framework-architecture.md` — appendix block stripped,
  replaced with one-liner-list pointing to the new anchors in
  `tuglaws.md`.

**Tasks:**
- [ ] **Sub-step A (heading promotion):** For every `**LNN. ...**`
      law line in `tuglaws.md`, promote it to `### LNN. ...` H3
      heading form. Apply consistently across all laws (L01–L25
      inclusive of all currently-listed laws); do not partially
      apply. The rest of the law's prose (the explanatory body
      after the bold title sentence) stays as a normal paragraph
      below the new heading.
- [ ] **Sub-step B (anchor addition):** To each new `### LNN. ...`
      heading, append a trailing-attribute anchor
      `&#123;#lNN&#125;` (lowercase L plus two-digit law number,
      e.g. the L02 heading becomes `### L02. External state…`
      followed by the trailing-attribute anchor in the form
      `&#123;#l02&#125;`). This is the canonical kebab-case anchor
      convention per [Reference and Anchor Conventions](#reference-conventions).
- [ ] **Sub-step C (verify anchors render):** Spot-check at least
      three anchors (`#l02`, `#l11`, `#l24`) by opening
      `tuglaws.md#l02` etc. in the markdown preview. **Canonical
      renderer per OF6: GitHub web preview** — push the branch
      and click the URL on github.com. Trailing-attribute anchors
      attached to H3 headings resolve there reliably. (Local
      editor previews using strict CommonMark may not render
      trailing-attribute anchors; do not gate on those.)
- [ ] **Sub-step D (strip FA appendix):** Strip the existing
      "Appendix: Laws referenced" block from
      `framework-architecture.md`.
- [ ] **Sub-step E (FA cross-ref list):** Replace the appendix with
      a single H2 "Laws referenced in this document" section
      containing a list of the same laws each as a one-line
      summary + `[full text](tuglaws.md#l02)` link.

**Tests:**
- [ ] After Sub-step A: `grep -c '^### L' tuglaws/tuglaws.md` ≥ 25
      (every law promoted to H3; the count matches the number of
      law lines in the doc).
- [ ] After Sub-step B: every `### LNN.` heading has a
      `&#123;#lNN&#125;` anchor. Verify by counting how many H3
      law headings end with the trailing-attribute anchor brace
      pattern: `awk '/^### L[0-9][0-9]\./ && /#l[0-9][0-9]\}$/'
      tuglaws/tuglaws.md | wc -l` returns the same count as
      `grep -c '^### L' tuglaws/tuglaws.md`. (The `awk` form
      avoids placing the literal trailing-attribute anchor token
      inside a backtick span, which keeps doc-level anchor
      scanners from misclassifying the regex as a real anchor
      declaration.)
- [ ] After Sub-step D: `grep -c '^### L0' tuglaws/framework-architecture.md`
      returns `0` (SC06 — the duplicated appendix headers are gone).
- [ ] After Sub-step E: `grep -c '^## Laws referenced in this document'
      tuglaws/framework-architecture.md` returns `1`.
- [ ] Every `tuglaws.md#lNN` link target in
      `framework-architecture.md` resolves to a `&#123;#lNN&#125;`
      anchor in `tuglaws.md`. Manual verification: open both files,
      check each of the 9 links (L02, L03, L04, L05, L06, L07, L08,
      L11, L24).

**Checkpoint:**
- [ ] All five tests pass.
- [ ] Visual readthrough of `tuglaws.md` confirms law content reads
      cleanly with the new heading promotion (no orphan bold lines,
      no double-bolding).
- [ ] Visual readthrough of `framework-architecture.md` confirms the
      doc still reads cleanly without the appendix.

---

#### Step 7: Cross-reference repairs {#step-7}

**Depends on:** #step-6

**Commit:** `docs(tuglaws): repair cross-references across the doc set`

**References:** [D01] Promote selection-model, [D02] Doc split, Spec S02, Spec S03, Spec S04, Risk R02, (#scope, #success-criteria)

**Artifacts:**
- `tuglaws/tuglaws.md` — L23 cross-references
  `state-preservation.md`; L09's cross-ref list mentions
  `lifecycle-delegates.md`. (Satisfies SC08.)
- `tuglaws/pane-model.md` — Cross-Links section adds entries for
  `state-preservation.md` and `lifecycle-delegates.md`. (Satisfies
  SC09.)
- `tuglaws/app-test-inventory.md` — every paragraph using `[A9]`
  links to `state-preservation.md` at least once in the surrounding
  section. (Satisfies SC10.)

**Tasks:**
- [ ] Edit `tuglaws.md` per SC08.
- [ ] Edit `pane-model.md` per SC09 — add the new entries to the
      Cross-Links section (NOT the Files table; per OF8, doc-to-doc
      links live in Cross-Links / See also blocks, not Files
      tables).
- [ ] Edit `app-test-inventory.md` per SC10. Each of the 7 [A9]
      paragraphs must carry a link to `state-preservation.md`. The
      linking convention is to add `(see [state-preservation.md])`
      after the `[A9]` mention OR to add a paragraph-level
      cross-link in the preamble of the affected section (whichever
      reads cleaner per paragraph) — but every [A9] paragraph must
      end up with at least one nearby link. Verify with
      `grep -c 'state-preservation.md' tuglaws/app-test-inventory.md`
      ≥ 7 (matching the [A9] paragraph count).
- [ ] Opportunistic broader grep for residual selection-model.md
      references (`grep -rln 'selection-model.md' .`); record the
      result in the close-out per Risk R02. Not gating.

**Tests:**
- [ ] `grep -c 'state-preservation.md' tuglaws/tuglaws.md` ≥ 1 (SC08).
- [ ] `grep -c 'lifecycle-delegates.md' tuglaws/tuglaws.md` ≥ 1 (SC08).
- [ ] `grep -c 'state-preservation.md\|lifecycle-delegates.md' tuglaws/pane-model.md` ≥ 2 (SC09).
- [ ] **SC10 paragraph-awk gate** (per OF4) emits no `MISSING:`
      line — every `[A9]`-bearing paragraph carries its own
      `state-preservation.md` link in the same paragraph block:
      ```sh
      awk 'BEGIN{RS=""} /\[A9\]/ && !/state-preservation\.md/ \
          {print "MISSING: paragraph at record " NR " contains [A9] but no state-preservation.md link"}' \
          tuglaws/app-test-inventory.md
      ```
- [ ] `grep -c 'state-preservation.md' tuglaws/app-test-inventory.md`
      ≥ 7 (SC10 fast sanity gate — the awk script above is the
      actual gate; this count check is informational and must
      match `grep -c '\[A9\]' tuglaws/app-test-inventory.md`,
      which equals 7 in the current inventory).
- [ ] `bun x tsc --noEmit` exits 0 (SC12, sanity).
- [ ] `bun test` passes in `tugdeck/` (SC13, sanity).

**Checkpoint:**
- [ ] All six tests pass.

---

#### Step 8: Final audit + verification {#step-8}

**Depends on:** #step-1, #step-2, #step-3, #step-4, #step-5, #step-6, #step-7

**Commit:** `docs(tuglaws): final audit close-out for tidy-up`

**References:** [D01] Promote selection-model, [D02] Doc split, [D03] Harness doc split, [D04] Strip FA appendix, [D05] One-page index, [D06] Comment-only source edits, [D07] card-lifecycle.ts tie-breaker, Spec S01, Spec S02, Spec S03, Spec S04, Spec S05, (#success-criteria, #exit-criteria)

**Artifacts:**
- This plan file's Status flips from `draft` to `complete (YYYY-MM-DD)`.
- A new "Audit close-out" subsection at the bottom of this plan
  recording each SC's verification command + result.

**Tasks:**
- [ ] Run every SC verification command listed in `#success-criteria`
      and record exit code / output one-liner in the close-out.
- [ ] Visual readthrough of every modified or new doc.
- [ ] Verify no doc opens with stale cross-reference banners
      (any banner mentioning the old `selection-model.md` filename
      is a regression).
- [ ] Update the Status field in this plan's Plan Metadata.

**Tests:**
- [ ] All SC01–SC13 pass.
- [ ] `bun x tsc --noEmit` exits 0.
- [ ] `bun test` passes in `tugdeck/`.

**Checkpoint:**
- [ ] All thirteen success criteria green.
- [ ] Audit close-out subsection appended.
- [ ] Plan status flipped.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** `tuglaws/` documentation set, post-tidy, with four
new docs (INDEX, state-preservation, lifecycle-delegates,
app-test-harness), one renamed doc (selection-model →
card-state-model), the law-text appendix stripped from
framework-architecture, and cross-references repaired across the
set. Code changes limited to mechanical comment-path updates;
`tugdeck/` build and tests green throughout.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] All SC01–SC13 in `#success-criteria` verified green.
- [ ] All eight steps committed.
- [ ] This plan's Status: `complete (YYYY-MM-DD)`.
- [ ] Audit close-out subsection appended.

**Acceptance tests:**
- [ ] `wc -l tuglaws/INDEX.md` ≤ 150.
- [ ] `test -f tuglaws/card-state-model.md && ! test -f tuglaws/selection-model.md`.
- [ ] `test -f tuglaws/state-preservation.md`.
- [ ] `test -f tuglaws/lifecycle-delegates.md`.
- [ ] `test -f tuglaws/app-test-harness.md`.
- [ ] `grep -c '^### L0' tuglaws/framework-architecture.md` returns 0.
- [ ] `grep -c '^### L' tuglaws/tuglaws.md` ≥ 25 (laws promoted to H3).
- [ ] `awk '/^### L[0-9][0-9]\./ && /#l[0-9][0-9]\}$/' tuglaws/tuglaws.md | wc -l` ≥ 25 (every law has its trailing-attribute anchor; awk used in lieu of a brace-literal grep to keep doc-level anchor scanners from misclassifying the regex).
- [ ] `grep -c 'state-preservation.md' tuglaws/app-test-inventory.md` ≥ 7 (every [A9] paragraph links).
- [ ] `wc -l tests/app-test/README.md` < 320.
- [ ] `grep -rln 'selection-model.md' tuglaws/ tugdeck/src/ tests/` returns 0.
- [ ] `bun x tsc --noEmit` exits 0 in `tugdeck/`.
- [ ] `bun test` passes in `tugdeck/`.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] **Token-system consolidation.** Defer per `#non-goals`.
      Revisit if a contributor asks "where do I learn the token
      system?" and finds the four-doc traversal painful.
- [ ] **Promote any `<!-- TODO: candidate law? -->` comments** added
      during Steps 3–4 to actual entries in `tuglaws.md` /
      `design-decisions.md`. Per [Q01].
- [ ] **Cross-doc anchor inventory.** A future `validate` script
      that walks every `[link](other-doc.md#anchor)` reference and
      asserts the anchor exists. Catches drift the next time a doc
      gets reorganized.

| Checkpoint | Verification |
|------------|--------------|
| INDEX added | `test -f tuglaws/INDEX.md && wc -l tuglaws/INDEX.md` ≤ 150 |
| Selection model renamed | `test -f tuglaws/card-state-model.md && ! test -f tuglaws/selection-model.md` |
| State-preservation doc added | `grep -c 'useComponentStatePreservation' tuglaws/state-preservation.md` ≥ 1 |
| Lifecycle-delegates doc added | `grep -c 'TugCardDelegate' tuglaws/lifecycle-delegates.md` ≥ 1 |
| App-test-harness doc added | `grep -c 'CGEvent' tuglaws/app-test-harness.md` ≥ 1 |
| Laws promoted to H3 | `grep -c '^### L' tuglaws/tuglaws.md` ≥ 25 |
| Laws have anchors | `awk '/^### L[0-9][0-9]\./ && /#l[0-9][0-9]\}$/' tuglaws/tuglaws.md \| wc -l` ≥ 25 |
| FA appendix stripped | `grep -c '^### L0' tuglaws/framework-architecture.md` returns 0 |
| Cross-refs repaired | `grep -c 'state-preservation.md' tuglaws/tuglaws.md` ≥ 1 |
| Inventory [A9] links | `grep -c 'state-preservation.md' tuglaws/app-test-inventory.md` ≥ 7 |
| README reduced | `wc -l tests/app-test/README.md` < 320 |
| No stale path | `grep -rln 'selection-model.md' tuglaws/ tugdeck/src/ tests/` returns 0 |
| Code clean | `bun x tsc --noEmit` exits 0 in `tugdeck/` |
| Tests clean | `bun test` passes in `tugdeck/` |

---

### Audit Close-out {#audit-closeout}

Final verification run on 2026-04-27, end of Step 8. Every success criterion in `#success-criteria` was re-executed against the worktree state; all gates green. The selection-model rename, harness doc split, framework-architecture appendix strip, and cross-reference repairs from Steps 1–7 hold under combined audit.

**SC verification commands and results:**

| ID | Command | Result |
|----|---------|--------|
| SC01 | `wc -l tuglaws/INDEX.md` | 35 lines (≤ 150). 17 bullets matching 17 sibling docs. PASS. |
| SC02 | `test -f tuglaws/card-state-model.md && ! test -f tuglaws/selection-model.md` | exit 0. PASS. |
| SC03 | per-identifier loop (15 identifiers) over `tuglaws/state-preservation.md` | no `MISSING:` output. PASS. |
| SC04 | per-identifier loop (12 identifiers) over `tuglaws/lifecycle-delegates.md` | no `MISSING:` output. PASS. |
| SC05 | `test -f tuglaws/app-test-harness.md`; `wc -l tests/app-test/README.md` | harness file exists; README 258 lines (< 320). PASS. |
| SC06 | `grep -c '^### L0' tuglaws/framework-architecture.md` | `0`. PASS. |
| SC07 | `grep -l '^\*Cross-references:' tuglaws/*.md` | includes `card-state-model.md`, `state-preservation.md`, `lifecycle-delegates.md`, `app-test-harness.md` (plus all pre-existing banner-bearing docs). PASS. |
| SC08 | `grep -n 'state-preservation.md\|lifecycle-delegates.md' tuglaws/tuglaws.md` | L23 → `state-preservation.md` (line 67); L09 → `lifecycle-delegates.md` (line 79). PASS. |
| SC09 | `grep -nA3 'Cross-Links\|state-preservation.md\|lifecycle-delegates.md' tuglaws/pane-model.md` | Cross-Links block lists both new docs (lines 200, 201). PASS. |
| SC10 | awk `RS=""` paragraph gate over `tuglaws/app-test-inventory.md` | no `MISSING:` output. Count gate `grep -c 'state-preservation.md'` returns 7 (matches `[A9]` paragraph count). PASS. |
| SC11 | `grep -r 'tuglaws/selection-model' tuglaws/ tugdeck/src/ tests/` | 0 hits. Stronger acceptance form `grep -rln 'selection-model.md' tuglaws/ tugdeck/src/ tests/` also 0 hits. PASS. |
| SC12 | `bun x tsc --noEmit` in `tugdeck/` | exit 0. PASS. |
| SC13 | `bun test` in `tugdeck/` | 2414 pass / 0 fail across 141 files (10.29s). PASS. |

**Additional acceptance gates (from #exit-criteria):**

| Acceptance | Command | Result |
|------------|---------|--------|
| Laws promoted to H3 | `grep -c '^### L' tuglaws/tuglaws.md` | 25 (≥ 25). PASS. |
| Laws have anchors | `awk '/^### L[0-9][0-9]\./ && /#l[0-9][0-9]\}$/' tuglaws/tuglaws.md \| wc -l` | 25 (≥ 25). PASS. |

**Visual readthrough.** Banners on `card-state-model.md`, `state-preservation.md`, `lifecycle-delegates.md`, and `app-test-harness.md` all match the canonical SC07 format (`# Title` / italic tagline / `*Cross-references:` line). No doc opens with a stale `selection-model.md` reference (`grep -l '^\*Cross-references:' tuglaws/*.md | xargs grep -l 'selection-model.md'` → none).

**Residual `selection-model.md` mentions (per Risk R02).** Outside SC11's grep scope, the string survives only in roadmap/historical files: `roadmap/tugplan-state-preservation-rename.md`, `roadmap/tugplan-selection.md`, `roadmap/tugplan-tuglaws-tidyup.md`, `roadmap/archive/tugplan-vocabulary-pane-rename.md`, `roadmap/archive/tugplan-card-and-token-sweep.md`, `roadmap/archive/text-component-fit-and-finish.md`, plus `.tugtool/` planning artifacts for this plan itself. SC11's scope (`tuglaws/`, `tugdeck/src/`, `tests/`) is clean. Non-gating per Risk R02 / Assumption A05.

**Phase exit checklist.**

- [x] All SC01–SC13 in `#success-criteria` verified green.
- [x] All eight steps committed (commits land via committer-agent per workflow).
- [x] This plan's Status: `complete (2026-04-27)`.
- [x] Audit close-out subsection appended.
