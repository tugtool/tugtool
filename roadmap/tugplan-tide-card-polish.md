<!-- tugplan-skeleton v2 -->

## T3.4.d — Tide Card Polish & Exit Criteria {#tide-card-polish}

**Purpose:** Close out Phase T3 by working through the polish, ergonomics, and exit-criteria items folded into [tide.md §T3.4.d](./tide.md#t3-4-d-polish-exit). The Tide card landed in [T3.4.c](./archive/tugplan-tide-card.md) as a registered, functional surface that round-trips a single turn against real Claude. This plan picks that surface up and finishes it: the small-but-irritating ergonomic gaps (focus, labels, keyboard jumps), the layout bugs that show up the first time you open completions inside a small card, the session ledger + full resume UX deferred from T3.4.c, the participant-aware multi-turn transcript that the Step 5 wire-up deferred, and the larger feature-coverage / quality / a11y bars that gate Phase T3 exit.

The work is staged smallest-blast-radius first: each step is one commit, the build stays green at every commit, and the early steps are deliberately scoped so any of them could be cherry-picked without taking the rest. The big-ticket items (session ledger, participant model, transcript rendering, permission/question UI) come later in the sequence, with the small ergonomic wins paying down user pain immediately.

This plan supersedes the bullet list under [tide.md §T3.4.d](./tide.md#t3-4-d-polish-exit) — same items (plus the participant model, explicit user-submission rendering, and the carried-forward session ledger placeholder added during plan authoring), ordered for execution and broken into commit-sized steps.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-04-19 |
| Roadmap anchor | [tide.md §T3.4.d](./tide.md#t3-4-d-polish-exit) |
| Predecessor | [tugplan-tide-card.md](./archive/tugplan-tide-card.md) (T3.4.c) |

---

### Phase Overview {#phase-overview}

#### Context {#context}

[T3.4.c](./archive/tugplan-tide-card.md) shipped the Tide card as a registered surface with a real `CodeSessionStore`, project picker, `spawn_session` / `close_session` lifecycle, per-workspace session-id ledger, resume-vs-new picker, fresh-spawn default, and a single-turn `TugMarkdownView` wire-up. Step 5 of that plan deliberately wired *only* `inflight.assistant` — multi-turn accumulation, thinking blocks, and tool surfaces were called out as T3.4.d follow-ups. [Step 4.6 of T3.4.c](./archive/tugplan-tide-card.md#step-4-6) was authored as a design sketch for a tugcast-side session ledger + full resume UX but deliberately deferred to T3.4.d — this plan carries that placeholder forward. The status badge in `tide-card.tsx:828` still hard-codes `"Project path /gallery/demo"` as a gallery-copy artifact. The card body inherits the polished ergonomics of `gallery-prompt-entry.tsx` but, when used as a *real* Claude surface (rather than a gallery demo), several small interaction gaps became obvious immediately:

- The prompt input does not get focus when a card is opened. Every interaction starts with a click-to-focus.
- After submitting a turn, focus is lost. Typing the next prompt requires another click.
- There is no global "focus the prompt" key. Cmd+K does nothing; Tab does not enter the entry from card chrome.
- The route gutter labels the Claude route as "Prompt", which describes the *input control*, not what the route *is*. The user-facing concept is closer to "Code" (the assistant talking through code-aware tooling).
- Completion popups (`/` slash, `@` file) can render past the card's bottom edge in small-card layouts, breaking the pinned prompt-entry's bottom alignment.
- Atoms only render cleanly at line-height ≥ 1.7. Tighter leading values jump the line when an atom is inserted.
- The transcript is missing. The top pane shows the in-flight assistant turn and the (sticky) last completed turn; prior turns and the user's own submissions never appear.
- There is no "speaker" model to distinguish *who* produced an entry in the transcript. Tide will mix at least four participants — the user, Claude Code, shell output (post-T4), and `:` surface command output (post-T10) — and there is currently no shared component vocabulary for rendering them so a reader can tell at a glance who said what.
- There is no way to navigate the transcript with the keyboard — no jump-to-history-entry, no jump-to-bottom.
- The status badge that should display the bound `projectDir` (or a cwd glyph) still shows the gallery string.
- Session bookkeeping still lives in the tugbank map landed by [Step 4i of T3.4.c](./archive/tugplan-tide-card.md#step-4i): one id per workspace, no metadata, no branching, no "forget one specific session." The resume-vs-new picker landed in [Step 4.5 of T3.4.c](./archive/tugplan-tide-card.md#step-4-5) is honest but minimal — users will hit its limits the moment they have more than one session per workspace they care about.

The bigger items deferred from T3.4.c — session ledger + full resume UX, multi-turn transcript rendering, thinking + tool surfaces, markdown styling pass, mid-stream behaviors E2E, `control_request_forward` UI — are all in scope here too. They land later in the sequence after the small ergonomic wins.

#### Strategy {#strategy}

- **Easy first.** The first eight steps are scoped so that a single commit per step is realistic: a string rename, a focus call, a key handler, a label swap. Each lands user-visible improvement immediately and does not need follow-on work to be useful. The deeper items (participant primitive, session ledger, transcript, permission UI) come later.
- **Design before wire-up.** The participant model (Step 9) lands as a designed primitive in a gallery card *before* the transcript rendering step (Step 11) wires it into the live `CodeSessionStore`. That keeps the visual design tunable in isolation and the wiring step focused on data binding.
- **Placeholders carry forward explicitly.** The session ledger + full resume UX (Step 10) arrives as a *design placeholder only*, carried over from [Step 4.6 of T3.4.c](./archive/tugplan-tide-card.md#step-4-6). Before implementation, the sketch is promoted into its own concrete plan (`roadmap/tugplan-tide-session-ledger.md` or equivalent) that enumerates files, sub-steps, verifications, and exit criteria. The placeholder in this plan documents intent, non-goals, and open questions — not a landable commit sequence.
- **One commit per step.** Where a step might want to grow (transcript, atom line-heights, participant primitive), the step's Work section calls out the minimal viable shape and defers richer treatment to a noted follow-up rather than expanding the commit. The session ledger step is the deliberate exception — it is a "stop and design" marker, not a commit.
- **Build stays green at every commit.** `bun run check`, `bun test`, `bun run audit:tokens lint`, and `cargo nextest run` pass on every step. `-D warnings` enforced.
- **No new IndexedDB.** Per [D-T3-10](./tide.md#decisions-t3). Any persistence goes through tugbank or, in the session ledger case, the purpose-built sqlite store that replaces it.
- **Tuglaws apply.** Every step that touches `tide-card.tsx`, `tug-prompt-entry.tsx`, the new transcript primitive, or new helpers re-checks against [tuglaws.md](../tuglaws/tuglaws.md). The closing step records a walkthrough.
- **Reuse the existing surfaces.** Focus / keybinding work threads through the existing `TugPromptEntryDelegate` handle and `ResponderScope`. Transcript rendering uses `TugMarkdownView`'s imperative `setRegion` handle (already in use for the streaming region), now plugged into the new `TugTranscriptEntry` body slot. Permission / question UI uses the existing CONTROL frame plumbing — no new transport.
- **Defer P2-gated multi-session work to its own step.** Two concurrent Tide cards already work post-[4k](./archive/tugplan-tide-card.md#step-4k); the multi-session *exit criterion* in tide.md §T3.4.d is about formalizing the verification, not building new infrastructure. It rides as a late step.
- **Manual smoke at every behaviorally-visible step.** Where a step ships a new interaction (focus, keybinding, transcript rendering, participant rendering), the verification includes a manual scenario the user can walk through in the running tugdeck.

#### Success Criteria (Measurable) {#success-criteria}

**Ergonomics:**
- Opening a Tide card focuses the prompt input directly; the user can type immediately. (verification: manual + test)
- After submitting a turn, focus returns to the prompt input. (verification: manual + test)
- With a Tide card active, pressing Cmd+K places a blinking caret in the prompt input regardless of where focus sits inside the card. (verification: manual + test)
- Cmd+J jumps the transcript view to the currently-selected history entry; with no history selection, Cmd+J scrolls the transcript to the bottom. (verification: manual + test)
- The status row shows the card's bound `projectDir` (or a shortened form), not the gallery placeholder. (verification: `rg 'Project path /gallery/demo' tugdeck/src/components/tugways/cards/tide-card.tsx` returns zero matches)

**Labeling:**
- The route gutter labels the Claude route as `Code`, not `Prompt`. The `>`/`❯` keystrokes still flip to the same route. (verification: `rg '"Prompt"|'Prompt'' tugdeck/src/components/tugways/tug-prompt-entry.tsx` returns zero matches; manual)

**Layout:**
- Slash and file completion popups never render outside the card's bottom edge or push the prompt-entry above the card's bottom pane bound. The prompt-entry's pinned-bottom layout survives all completion states. (verification: manual at small card sizes)
- Atom insertion preserves baseline at line-height values below 1.7 (down to a documented minimum, e.g., 1.2). The line does not jump when an atom is added or removed. (verification: manual; integration test if feasible)

**Participant model + transcript:**
- A `TugTranscriptEntry` primitive exists, with a Slack-like layout: left-aligned participant icon column, header row with bold identifier + timestamp, content body, optional controls/badges row beneath. **No chat bubbles** — no rounded per-row container, no left-vs-right alignment by speaker. (verification: gallery card + manual visual review against [D6](#resolved-decisions))
- The primitive supports the four initial participants (`user`, `code`, `shell`, `command`), each with its own icon and identifier styling. Adding a participant variant is a token + a registration, not a code rewrite. (verification: gallery demo renders all four)
- User-submitted prompts/commands appear in the transcript flow as `participant: "user"` rows, in line with the assistant responses they precede. The user sees their own submission appear the moment they hit Enter. (verification: test + manual)
- Multi-turn conversations accumulate in the top pane: pairs of `user` + `code` rows for each turn render as the conversation grows. The in-flight turn streams into the `code` row's body region; completed turns occupy permanent rows. (verification: manual; test against a recorded session fixture)
- The "sticky last turn" Step 5 fallback is removed once transcript rendering lands. (verification: code review; `rg` for the relevant comment)

**Session ledger + resume UX:**
- A concrete plan for the session ledger + full resume UX exists at `roadmap/tugplan-tide-session-ledger.md` (or equivalent), promoted from the design sketch in [Step 10](#step-10). The concrete plan's own exit criteria replace this line once it lands. (verification: the file exists; this plan's Step 10 references it as promoted.)
- Until the concrete plan lands, this plan's Step 10 is a placeholder — it does not commit code, and downstream steps do not depend on ledger-backed behavior.

**End-to-end coverage:**
- Type `> hello` → `user_message` on `CODE_INPUT` → `assistant_text` deltas on `CODE_OUTPUT` → streaming render → `turn_complete(success)` → entry returns to idle.
- Mid-stream Stop → `interrupt` → `turn_complete(error)` → `interrupted → idle`, accumulated text preserved.
- Mid-stream `user_message` sends → queued → auto-flush on idle.
- `tool_use` and `tool_use_structured` drive `tool_work` sub-state; submit button stays in Stop mode throughout.
- `control_request_forward { is_question: false }` surfaces a permission block; allow/deny writes a `tool_approval` frame.
- `control_request_forward { is_question: true }` surfaces a question block; answer writes a `question_answer` frame.

**Feature coverage:**
- `>`, `$`, `:` route prefixes dispatch correctly. (`>` is live; `$` is inert pre-tugshell; `:` routes through the local surface registry.)
- Route indicator and route atom remain bidirectionally synced.
- `@` file completion returns FILETREE-backed results and inserts file atoms.
- `/` slash command completion merges `SessionMetadataStore.slashCommands` and skills.
- History navigation (Cmd+Up/Down) works per-route from `PromptHistoryStore`.

**Quality:**
- CJK end-to-end (Japanese, Chinese) verified — IME compose → submit → streamed response.
- VoiceOver announces atoms, route indicator, submit/stop button, and transcript participant rows correctly.
- Atom drag-and-drop from Finder produces file atoms.
- No jank during typeahead over full-project file listings.

**Multi-session (gated on P2):**
- Two Tide cards open simultaneously run two independent `CodeSessionStore` instances, each keyed by its own `tugSessionId`. Submitting in one does not affect the other. (Already true post-[4k](./archive/tugplan-tide-card.md#step-4k); this step adds the formal verification + a regression test.)

**Compliance:**
- All new/changed components pass the component authoring guide checklist.
- All new tokens conform to the seven-slot naming convention.
- `bun run audit:tokens lint` exits 0.
- Vitest + Rust nextest suites pass with `-D warnings`.
- No new IndexedDB dependencies introduced (D-T3-10). Any new persistence goes through tugbank.

#### Scope {#scope}

**In scope:**
- Status badge `projectDir` wiring (replaces the `tide-card.tsx:830` gallery string).
- Route label rename: `Prompt` → `Code` in `tug-prompt-entry.tsx:85`.
- Auto-focus the prompt editor whenever the tide card becomes the key card (mount, click, Ctrl+` cycle); auto-refocus after submit.
- Card-level keybindings: Cmd+K → focus prompt; Cmd+J → jump transcript.
- Completion popup overflow / clipping fix.
- Atom rendering at tighter line-heights.
- Participant model + `TugTranscriptEntry` primitive (Slack-like layout, no chat bubbles), with gallery demo.
- **Session ledger + full resume UX as a design placeholder** — a carry-forward of [Step 4.6 of T3.4.c](./archive/tugplan-tide-card.md#step-4-6). Implementation is gated on a promoted plan; the placeholder here captures intent, schema sketch, CONTROL protocol additions, migration notes, lifecycle policies, non-goals, and open questions.
- Multi-turn transcript rendering using the participant primitive; user submissions visible in-flow; removal of the sticky-last-turn fallback.
- Markdown typography / spacing / chrome polish for Claude Code output.
- Thinking and tool-use surface wiring (placement TBD in the step).
- Mid-stream behaviors: Stop, queued sends, tool sub-state, permission/question dialogs.
- Feature-coverage hardening: `>`/`$`/`:` routing, indicator sync, `@` completion, `/` completion, history nav.
- CJK + VoiceOver quality passes.
- Atom drag-drop from Finder.
- Typeahead jank profiling.
- Concurrent Tide cards regression test.
- Compliance close-out (tokens lint, IndexedDB grep, full check matrix).
- Tuglaws walkthrough.

**Out of scope (deferred):**
- Implementation of the session ledger + full resume UX — lives in its own promoted plan (Step 10's promotion gate).
- Live `shell` and `command` participant rows in the transcript — the primitive supports them and the gallery demos them, but the live wires arrive with Phase T4 (tugshell) and Phase T10 (`:` surface built-ins) respectively. This plan only wires `user` and `code` rows to live data.
- `BuildStatusCollector` per-workspace ([tide.md line 2102](./tide.md#prefix-router-prompt-input)).
- Claude `--resume` (P14) and stream-json version gate (P15) — separate plans.
- P2 multi-session router work — landed independently; this plan's multi-session step exercises whatever the router state is at landing time.
- Image attachments (U15) — Phase T11.
- Subagent activity display (U8) — Phase T9.

#### Resolved Decisions {#resolved-decisions}

- **D1 — Route label.** `Code`. Decided by the user in this plan's authoring conversation. Rationale: "Prompt" describes the input control, not what the route *is*; "Code" reflects the assistant's purpose and keeps "Claude" out of the chrome. `>` and `❯` continue to route to it.
- **D2 — Cwd presentation.** Replace the gallery string with the bound `projectDir` rendered into the existing `TugBadge`. Shortening / icon variants are a follow-up (Step 1 ships the literal string; later cosmetic refinement is not blocked here).
- **D3 — Cmd+K only; Tab dropped.** Cmd+K is the canonical "focus the prompt" gesture and the only card-level focus chord. Tab was considered as a second gesture (hop from chrome into the editor) but dropped during Step 5 implementation: Tab has too much established meaning in card chrome (focus-ring movement, tab stops in popovers, accepting a completion) for a card-level claim to be unambiguous.
- **D4 — Cmd+J semantics.** With a history entry navigated to in the prompt-entry, Cmd+J scrolls the transcript to that entry's location. With no history selection, Cmd+J behaves like End / Cmd+Down: scroll to bottom.
- **D5 — Atom line-height target.** Tighter than 1.7 must work without baseline jump. Concrete minimum decided in [Step 7](#step-7) once the engine work surfaces the constraint.
- **D6 — Participant model is Slack-like, *not* chat bubbles.** Decided by the user during plan authoring. Rationale: chat bubbles are wrong for a developer surface that mixes human, AI, shell, and command output — alternating sides and rounded backgrounds make a transcript hard to scan. Layout: left-aligned icon column (~32–40px), then a content column with a header row (bold identifier + small timestamp), then the body, then an optional controls/badges/icons strip beneath the body. Initial participants: `user`, `code` (Claude Code), `shell` (post-T4), `command` (post-T10). The model is open for extension via a token registration, not a code rewrite. No avatar photos; participant icons are glyphs/marks.
- **D7 — Session ledger starts as a design placeholder.** Carried forward from [Step 4.6 of T3.4.c](./archive/tugplan-tide-card.md#step-4-6). Rationale: the sketch is rich enough that treating it as a single commit would under-specify the sqlite schema, CONTROL protocol additions, migration, and picker reshape. Starting preferences captured in [Step 10](#step-10)'s open-questions list (sqlite over JSONL; tugcast CLI flag over CONTROL round-trip; `resume_failed` → `"failed"` state rather than delete). Promotion to a concrete plan happens before implementation, in its own document.

---

### Steps {#steps}

Each step is its own commit. `bun run check`, `bun test`, `bun run audit:tokens lint`, and `cargo nextest run` pass at the end of every step. [Step 10](#step-10) is the deliberate exception — it is a design placeholder that promotes to its own plan before any code lands.

#### Step 1 — Status row shows the bound `projectDir` {#step-1}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (`statusContent` near line 828).

**Work:**
- Replace the hard-coded `Project path /gallery/demo` string in the `TugBadge` with the bound `projectDir` from the card's `CardSessionBinding` (already available via the `useTideCardServices` binding subscription per [4b](./archive/tugplan-tide-card.md#step-4b)).
- Render the literal path for now. Shortening (e.g., `~/...`, basename-only, or a cwd icon) is a deliberate later refinement so this commit stays a one-line swap. Note the follow-up in a code comment if appropriate.
- The badge still uses `size="sm"`, `emphasis="tinted"`, `role="data"` — no token changes.

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- `rg 'Project path /gallery/demo' tugdeck/src/components/tugways/cards/tide-card.tsx` returns zero matches.
- Manual: open a Tide card on `/u/src/tugtool`; the status badge reads `/u/src/tugtool` (or your chosen path). Open another Tide card on `/tmp`; badge reads `/tmp`.

#### Step 2 — Rename the Claude route label `Prompt` → `Code` {#step-2}

**Files:**
- `tugdeck/src/components/tugways/tug-prompt-entry.tsx` (`ROUTE_ITEMS` at line 85).
- `tugdeck/src/components/tugways/__tests__/tug-prompt-entry.test.tsx` (any test asserting the label string).
- Any other production reference to the literal route label `"Prompt"` in this file or its callers.

**Work:**
- Change the label in the `ROUTE_ITEMS` entry: `{ value: "❯", label: "Code", icon: "❯" }`.
- Search for any other production reference to the literal string `"Prompt"` as a route label and update consistently. Comments referring to "the Prompt route" can stay or be edited at discretion — the plan does not require a mass rename of internal terminology, only the user-visible label.
- Tests asserting the rendered label update accordingly.
- VoiceOver / aria-label fields tied to the route choice update to read "Code".

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- `rg '"Prompt"' tugdeck/src/components/tugways/tug-prompt-entry.tsx` returns zero matches.
- Manual: open a Tide card; the route indicator reads `Code`; typing `>` at position zero still flips to it; typing `❯` still flips to it; `$` and `:` still flip to Shell / Command.

#### Step 3 — Auto-focus the prompt input whenever the tide card becomes key {#step-3}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (key-card observer).
- `tugdeck/src/components/tugways/tug-prompt-entry.tsx` (confirm `TugPromptEntryDelegate` exposes a `focus()` method; add if missing).

**Work:**
- Confirm `TugPromptEntryDelegate` has a `focus(): void` method that places the caret in the editor. If absent, add it — its body delegates to the underlying `TugPromptInput`'s focus path.
- In `TideCardBody`, add a `useLayoutEffect` that subscribes to `manager.observeKeyResponder("card", ...)`:
  - On subscribe, synchronously check `manager.getKeyCard() === cardId`; if so, call `entryDelegateRef.current?.focus()` (covers the "body first mounts and was already the key card" case — observer callbacks don't fire on subscribe).
  - On each observed transition, if the next key card id is this card's id, focus the editor.
  - Return the observer's unsubscribe for cleanup.
- This unified mechanism handles every path that makes the tide card active: initial bind / picker-dismiss, click on any card element (pointerdown promotion flips the key card), Ctrl+` cycle, and any future programmatic key-card change. No bespoke mount-only effect.
- [L07]: handler reads the delegate via the ref, never a closed-over value.

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- Manual: open a tide card — caret blinks in the editor without a click. Click a sibling card, then click back — caret returns to the editor. Ctrl+` cycles through cards; when the tide card rotates to the front, caret is in the editor immediately.
- **No automated focus assertion.** happy-dom's `document.activeElement` diverges from browser behavior enough that asserting it in these tests produces megabyte-scale failure dumps without catching real regressions; focus is verified manually and by the lower-level tests that target the delegate directly.

#### Step 4 — Re-focus the prompt input after submit {#step-4}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (or wherever `handleBeforeSubmit` / submit completion runs).

**Work:**
- After a successful submit, call `entryDelegateRef.current?.focus()`. Tie it to the submit completion path (whether that's `onBeforeSubmit` returning, the `CodeSessionStore` snapshot transitioning to `submitted`, or the `TugPromptEntry`'s `onSubmit` callback — whichever fires last and is the natural seam in the existing code).
- Do not refocus on submit *failure*; the user may want to inspect an error inline before typing again. (If the post-failure UX warrants refocus too, decide here.)

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- New test: simulate submit of `> hi` → on completion, assert the prompt input regains focus.
- Manual: open a Tide card, submit a prompt, watch focus return to the input as the assistant streams; start typing the follow-up immediately without clicking.

#### Step 5 — Cmd+K focuses the prompt input from card chrome {#step-5}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (card-level key handler).

**Work:**
- Add a card-level `keydown` handler on the `tide-card` root that intercepts Cmd+K (or Ctrl+K on non-Mac), calls `entryDelegateRef.current?.focus()`, and `event.preventDefault()`. Idempotent when the prompt is already focused. `event.defaultPrevented` short-circuits so any child (completion menu, dialog) that already consumed the key wins — the card is a fallback, not a top-level claim.
- `event.preventDefault()` is defensive against browser hotkeys that might otherwise claim the chord.
- Tab is NOT handled per [D3](#resolved-decisions) — the ambiguity with card-chrome focus-ring movement, popover tab stops, and completion acceptance makes a card-level claim unsafe.

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- New test: render a Tide card → focus an arbitrary element in the card chrome (e.g., the maximize button) → simulate Cmd+K keydown → assert prompt input gains focus.
- Manual: open a Tide card, click into the maximize button (focus chrome), press Cmd+K → caret in prompt input.

#### Step 5.5 — Unified card-activation lifecycle {#step-5-5}

**Why this exists.** Step 3 landed an observer-based auto-focus that watches `manager.observeKeyResponder("card", ...)`, and Step 5 wired Cmd+K through the `scope: "key-card"` keybinding path. Both depend on the responder chain's key card transitioning when the user activates a card. During manual testing a class of activations was found to NOT transition the key card: clicks on `data-tug-focus="refuse"` elements (title bar, chrome buttons). `handleFramePointerDown` updates the deck store's focused card; the capture-phase `promoteOnPointerDown` skips focus-refuse targets and does not touch the responder chain. Result: the user activates a tide card by clicking its title bar, the store's focused card updates, z-order flips, `data-focused` flips — but `manager.getKeyCard()` still points at the previously-active card, no observer fires, the editor doesn't receive focus, the next keystroke beeps.

The underlying problem is architectural, not local to tide card: "activate a card" is three state updates (store z-order, responder chain first responder, selection guard) across three systems kept in sync by convention. Each trigger path (pointerdown non-refuse, pointerdown refuse, Ctrl+\`, initial load, show-component-gallery) touches a different subset. Consumers then subscribe to whichever subset they happen to need and silently miss activations on paths that skipped their system.

This step consolidates card activation into a single first-class lifecycle operation with a single event, so future cards and shortcuts can subscribe once and trust the signal.

**The investigation artifact.** Three independent notions of "active card" exist today:

| State system | What it is | Drives |
|---|---|---|
| `store.focusedCardId` | last entry in store.cards array | z-index, `card-frame[data-focused]` |
| `manager.firstResponderId` (+ `getKeyCard()`) | responder chain's first-responder, walked up to the nearest `kind: "card"` | keyboard shortcut routing, `scope: "key-card"` dispatch |
| `selectionGuard.activeCardId` | the card whose inactive-selection highlight is suppressed | inactive-card dimming |

Each activation path hits a different subset:

| Path | store | responder chain | selection guard |
|---|---|---|---|
| pointerdown on non-focus-refuse target | ✓ | ✓ (descendant) | effect |
| pointerdown on focus-refuse target (title bar, chrome) | ✓ | ✗ | effect |
| Ctrl+\` (CYCLE_CARD) | ✓ | ✓ (card) | effect |
| Initial load | ✓ | ✓ (card) | effect |
| SHOW_COMPONENT_GALLERY | ✓ | ✓ (card) | effect |

Consumers accordingly read from different sources: z-index watchers read `store.focusedCardId`; keyboard routing reads `getKeyCard()`; tide card's auto-focus observer reads key-card transitions. The focus-refuse path's divergence between store and responder chain is the root cause of the beep-on-title-bar-click.

**Proposed shape.**

1. A single activation function emits one signal, synchronously:
   ```ts
   deck.activateCard(cardId: string): void
   ```
   In order:
   a. `store.handleCardFocused(cardId)` — z-order update.
   b. If `manager.getKeyCard() !== cardId` → `manager.makeFirstResponder(cardId)`. (Preserves in-card descendant focus when the chain is already inside this card.)
   c. Notify `CardActivationObserver`s registered for this cardId and for the wildcard (`null`).

2. A subscription API:
   ```ts
   deck.observeCardActivation(
     cardId: string | null,   // null = any card
     callback: (cardId: string) => void,
   ): () => void
   ```
   Fires on transitions. Fires synchronously on subscribe for the currently-active card so mount-time activation isn't a special case.

3. A React convenience hook:
   ```ts
   useOnCardActivated(cardId: string, callback: () => void): void
   ```

4. Post-`activateCard(cardId)` invariant (synchronously observable):
   - `store.focusedCardId === cardId`
   - `manager.getKeyCard() === cardId`
   - `selectionGuard.activeCardId === cardId` (via subscription — see 5(d) below)
   - all observers for `cardId` have been notified

This invariant is the property the current system lacks and the reason consumers can't trust a single signal today.

**Resolved design decisions (user, 2026-04-19 plan-review):**

- **D7 — Placement.** New `card-lifecycle.ts` module that both `DeckManager` and `DeckCanvas` use. Keeps the activation vocabulary separable from either consumer.
- **D8 — `handleCardFocused` visibility.** Delete. After migration, no external caller remains; the store-internal z-order method stays under a different name or stays private to the store.
- **D9 — Observer model.** Plain pub/sub on the deck lifecycle, not an extension of `observeKeyResponder`. Responder-chain concerns stay separate.
- **D10 — Selection guard integration.** `selectionGuard` subscribes to `observeCardActivation(null, ...)`. No direct call from inside `activateCard`. Keeps activation's side-effect surface at one call.
- **D11 — Descendant promotion on pointerdown.** Keep `promoteOnPointerDown` exactly as-is. It promotes responders *below* the card (editor, popover, inner button), never the card itself. Card-level promotion lives solely in `activateCard`.

**Files:**
- `tugdeck/src/lib/card-lifecycle.ts` (new — exports `activateCard`, `observeCardActivation`, and the observer/store types).
- `tugdeck/src/lib/card-lifecycle.tsx` or equivalent (new — `useOnCardActivated` React hook; or colocate in the `.ts` if React dependencies are already there).
- `tugdeck/src/deck-manager.ts` (expose an `activateCard` entry that delegates to `card-lifecycle`; remove `handleCardFocused` public surface per [D8](#step-5-5)).
- `tugdeck/src/components/chrome/deck-canvas.tsx` (delete the local `handleCardFocused`; replace call sites in `CYCLE_CARD`, `SHOW_COMPONENT_GALLERY`, initial-load effect with `activateCard`).
- `tugdeck/src/components/chrome/card-frame.tsx` (`handleFramePointerDown` calls `activateCard` instead of `onCardFocused`; the `onCardFocused` prop becomes `onActivate` or is removed if the function can be imported directly).
- `tugdeck/src/components/tugways/selection-guard.ts` (subscribe to `observeCardActivation` on install; drop the `useLayoutEffect` wiring in `deck-canvas`).
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (replace the current `observeKeyResponder` effect in `TideCardBody` with `useOnCardActivated(cardId, () => entryDelegateRef.current?.focus())`).

**Work:**

a. **Create `card-lifecycle.ts`.** Export:
   - `CardActivationObserver = (cardId: string) => void`.
   - A `CardLifecycle` construct (plain class or module-scoped singleton accepting `store` + `manager` at construction / registration time) with:
     - `activateCard(cardId: string): void` — runs the four steps above, synchronously.
     - `observeCardActivation(cardId: string | null, cb): () => void` — stores the observer, fires initial-sync for the currently-active card if `cardId === null || cardId === store.focusedCardId`, returns unsubscribe.
     - `getActiveCardId(): string | null` — mirrors `store.focusedCardId` post-activation; reads directly from the store.
   - `useOnCardActivated` React hook that takes `cardId` + `callback`, resolves the lifecycle instance via existing context (likely a new `CardLifecycleContext` or export from `deck-manager`), and wires `observeCardActivation` through `useLayoutEffect` with stable deps.

b. **Wire activateCard into DeckManager.** `DeckManager` constructs / holds the lifecycle instance. `deck.activateCard` becomes a thin pass-through. `handleCardFocused`'s public export is removed (per [D8](#step-5-5)).

c. **Replace all call sites.**
   - `card-frame.handleFramePointerDown` → `deck.activateCard(id)` (or the imported `activateCard` directly; decision during step b).
   - `deck-canvas.CYCLE_CARD` — replace the three-line sequence (`handleCardFocused` + `setDeselected(false)` + `makeFirstResponder`) with `activateCard(nextId)`. `setDeselected(false)` either moves into `activateCard` or onto a separate observer.
   - `deck-canvas.SHOW_COMPONENT_GALLERY` — same three-line replacement.
   - `deck-canvas` initial-load effect — replace with `activateCard(focusedCardId)` when `initialFocusedCardId` is set.

d. **Migrate `selectionGuard`.** Replace its `useLayoutEffect`-driven activation (currently keyed on `focusedCardId` via `selectionGuard.activateCard`) with a subscription to `observeCardActivation(null, ...)`. Attach on `selectionGuard.attach()`, detach on cleanup.

e. **Replace tide card's observer effect.** In `TideCardBody`:
   ```tsx
   useOnCardActivated(cardId, () => {
     entryDelegateRef.current?.focus();
   });
   ```
   Delete the `observeKeyResponder` useLayoutEffect and the `useResponderChain()` call used solely for it.

f. **Test pass.** Units for `card-lifecycle` exercising the invariant (post-`activateCard`, all three state systems match), for `observeCardActivation` (fires on transition, initial-sync for current active card on subscribe, unsubscribe stops future calls), and for the wildcard form. Regression test that keyboard shortcut routing (existing Cmd+W, Ctrl+\`) still targets the active card post-migration.

**Verification:**
- `bun x tsc --noEmit` + `bun test` + `bun run audit:tokens lint` green.
- Unit test: after `activateCard("A")`, `store.focusedCardId === "A"`, `manager.getKeyCard() === "A"`, `selectionGuard.activeCardId === "A"`, observer registered for `"A"` has fired once with `"A"`, wildcard observer has fired with `"A"`.
- Unit test: subscribing after activation fires the callback synchronously on subscribe.
- Unit test: `activateCard("A")` twice in a row fires observers only on the first call (no-op on unchanged active card).
- Manual smoke: open tide card + gallery card. Click tide title bar → editor caret blinks. Click gallery title bar → focus leaves editor. Click tide title bar again → editor caret returns. Press Ctrl+\` to cycle → same behavior. Press Cmd+K from any chrome → caret lands in editor. Press Ctrl+K inside the editor → macOS deleteToEndOfLine runs (not swallowed).
- Manual smoke: typing into the editor works immediately after any activation path; no beeps.

**Risks:**
- **Subscription ordering.** If `selectionGuard` and `tide-card` both subscribe, their callbacks run in subscription order. If one throws, later subscribers may miss the event. Mitigation: wrap each callback dispatch in a try/catch that logs but keeps iterating.
- **Initial-sync firing for inactive cards.** `useOnCardActivated("card-A", ...)` on a card that isn't active at mount should NOT fire the callback. The `observeCardActivation` initial-sync rule: fire only if `cardId === null || cardId === store.focusedCardId`. Tests lock this.
- **Selection guard install timing.** `selectionGuard.attach()` runs inside `ResponderChainProvider`'s mount effect. If `card-lifecycle` is accessed there before its instance is constructed, we risk a null-ref. Mitigation: construct the lifecycle at the same time as the manager (or earlier), and document the install order.
- **Breadth of touch.** Six files change. No single file is large, but the cross-cutting nature raises review surface. Mitigation: land in a single atomic commit (or tight sequence) so no intermediate state has two call sites disagreeing on the activation contract.

---

> **Steps 5.5.a–5.5.c below absorb the follow-up work that grew out of Step 5.5 during implementation.** Step 5.5 unified card activation; the implementation pass produced a full App + Card lifecycle delegate subsystem (`card-lifecycle.ts`, `app-lifecycle.ts`, `lifecycle-cascade.ts`), a portal-based identity-preserving content pipeline (`CardHost` + `CardPortal` + `pane-content-registry` + `pane-root-registry`), and a two-table data model (`DeckState.cards` + `DeckState.panes`).
>
> Along the way four vocabulary / token / data-layer plans forked off and landed in `roadmap/archive/`: `tugplan-vocabulary-rename.md`, `tugplan-vocabulary-pane-rename.md`, `tugplan-tabstate-rename.md`, `tugplan-card-and-token-sweep.md`. The resulting vocabulary — `TugPane` (frame + chrome), `CardHost` (per-content bridge), `useCard*` hooks, `--tugx-pane-*` tokens, `.tug-pane-*` classes, `data-pane-id` / `data-card-id`, `cardstate/{cardId}` tugbank rows, v4 wire — is codified in `tuglaws/pane-model.md` (law **L25**).
>
> Steps 5.5.a–5.5.c tighten the seams that mid-implementation review surfaced but deferred: deprecated code that violates invariants, duplicated helpers, semantic inversions in the delegate layer, a god-component starting to form in `CardHost`, and missing safety-net tests. Landing these **before** Steps 6–23 keeps the tide-card feature work on a coherent foundation.

#### Step 5.5.a — Lifecycle & DeckManager tightening (audit follow-ups) {#step-5-5-a}

**Why this exists.** Step 5.5 shipped a working delegate layer; implementation review found a cluster of seams that are each small and each a future-bug attractor. This step bundles the high-urgency items: deprecated code that fires no lifecycle events, two helpers where one suffices, a semantic inversion the delegate layer doesn't document, and a handful of doc-only clarifications. None blocks the next tide-card step; any of them will quietly compound as more cards land on top of the same API.

**Files (high level):**
- `tugdeck/src/deck-manager.ts` — delete `applyLayout`; consolidate `_setFirstResponder` / `_flipFirstResponder`; evaluate `getActiveCardId` vs `getFirstResponderCardId`.
- `tugdeck/src/lib/card-lifecycle.ts`, `tugdeck/src/lib/app-lifecycle.ts` — JSDoc pass on `cardWill*` / `applicationWill*` methods describing the deferred-delivery semantic; add observer-vs-delegate guidance in the module header; document startup-drop behavior.
- `tugdeck/src/lib/delegate-drain.ts` (new) — shared `MessageChannel` drain queue consumed by both `useCardDelegate` and `useAppDelegate`; guarantees cross-module ordering.
- Call sites for `applyLayout`: currently `deck-manager.ts` (defn + 2 call sites), `layout-tree.ts`, `__tests__/deck-manager.test.ts`. Update tests to use the mutator API (`addCard`, `removeCard`, `setActiveCardInPane`) or the new diff-based replacement.

**Work:**

a. **Delete `applyLayout`** (audit L7 / P13). Fires no lifecycle events, violates the invariants every other mutator enforces, deprecated in JSDoc but still present. Replace each call site with explicit mutator calls. If a test truly needs wholesale state replacement, implement a minimal `replaceLayout(next)` that diffs and routes through `addCard` / `removeCard` / `_setFirstResponder` — not the free-form assignment the current version permits.

b. **Consolidate `_setFirstResponder` and `_flipFirstResponder`** (audit L4). The latter exists because some mutators need caller-provided commit closures; the former reads `oldFR` from current state and commits internally. The division invites wrong-snapshot bugs. Produce one `_flipFirstResponder(newFR, commitClosure)` helper that snapshots `oldFR` itself and delegates the commit — the mechanism that would catch a mistake (read current state) stays inside the helper.

c. **Consolidate `getActiveCardId` vs `getFirstResponderCardId`** (audit L3). Both are public; they diverge after detach/move. Pick one as canonical (the composite-bit reader `getFirstResponderCardId`) and either delete the other or rename it to something unambiguous (`getTopOfPaneCardId`). Internal call sites that still use `getActiveCardId` get updated to whichever survives. Tests update with them.

d. ~~**Share one drain queue** across `useCardDelegate` and `useAppDelegate` (audit L2).~~ **Withdrawn.** The audit framing was wrong and this work item is not going to happen.

   Background: `roadmap/lifecycle-delegate-reliability.md` §2.E (April 2026) deliberately chose "dedicated drain queue owned by each lifecycle module" as a *promoted variant* of the MessageChannel design, with reasons including: single ordering authority per module (no cross-hook interleaving surprises), per-module `try/catch` with known-event-name logging, and one-file retirement when the underlying mechanism is later swapped. The audit entry reopened that decision by re-framing non-interleaving as a speculative race ("cross-module ordering is not guaranteed … before any future app/card delegate pair exhibits it") without addressing the study's reasoning.

   On review, the study's position stands: the one real cross-module ordering case (app → card on app-lifecycle transitions) is handled explicitly in `lib/lifecycle-cascade.ts`, not through drain ordering; no concrete code path needs interleaved drain. A shared-drain attempt (commit `bc80ab74`) was implemented and then reverted (commit `054e8197`) once the contradiction with the reliability study was caught. No further work under this item.

e. **Document will-delegate semantic inversion** (audit L1). `useCardDelegate` / `useAppDelegate` subscribers run on the next MessageChannel drain — *after* the transition commits. Methods named `cardWillDeactivate` / `applicationWillResignActive` therefore run in a world where the transition has already happened. Add one JSDoc line to each `will*` delegate method on the `TugCardDelegate` / `TugAppDelegate` interfaces: "Delegate runs after the transition commits. Subscribe via `observeCard*` directly for synchronous pre-mutation semantics." Also add a short observer-vs-delegate decision rule at the top of `card-lifecycle.ts` (audit L6): synchronous observer for pre-mutation state or ordering with other synchronous observers; delegate hook for React-context-bound focus/DOM work that must survive gesture.

f. **Document startup-event drop** (audit L8) in the `app-lifecycle.ts` banner: "Swift-side control frames sent before `AppLifecycle` registers are silently dropped. Subscribers that need a reliable 'fire once at app start' signal must coordinate with Swift through a different channel."

g. **Pin lifecycle-silent paths in JSDoc** (audit P10, P11): `setActiveCardInPane` on an inactive pane fires no lifecycle events; `_closePane` fires destruction in `cardIds` order. Add one JSDoc sentence on each.

h. **Portal mount-ordering note** (audit P4): add a paragraph to `card-portal.tsx`'s header: "Children render into a null host until the content-registry subscriber fires on the next commit; do not assume children are in the DOM on first render."

**Verification:**
- `bun x tsc --noEmit` + `bun test` + `bun run audit:tokens lint` all green.
- `rg "applyLayout" tugdeck/src` returns zero matches (only test file may retain if `replaceLayout` wasn't built; note the exception).
- `rg "_setFirstResponder|_flipFirstResponder" tugdeck/src` returns one name (whichever survived).
- `rg "getActiveCardId" tugdeck/src` returns zero matches (if deleted) or only the new unambiguous name.

**Risks:**
- `applyLayout` deletion may surface test fixtures that rely on its "jump to arbitrary state" semantics. Resolution: convert to the mutator chain; the conversion itself documents the intended state transition.
- Consolidating the two FR helpers risks a mistranslated call site. Mitigation: cover every caller with a targeted unit test before the refactor.

---

#### Step 5.5.b — Decompose `CardHost` into per-concern hooks {#step-5-5-b}

**Why this exists.** `CardHost` (`tugdeck/src/components/chrome/card-host.tsx`, currently 384 lines) accreted every per-card concern: PropertyStore registration, persistence callbacks, dirty/auto-save, content-restore effect, scroll/selection listeners, FeedStore subscription, responder scope, portal mount. Each concern is reasonable in isolation; the file is the wiring harness *and* each concern's implementation. The next per-card concern (session metadata, cross-turn state, whatever the next tide feature needs) would land here by default, pushing it past the 500-line threshold where nobody wants to touch it.

Decomposing into per-concern hooks now — while the vocabulary is stable and `Tugcard*` → `Card*` renames have landed — gives each concern a testable surface and leaves `CardHost` as the wiring harness it should be.

**Files:**
- `tugdeck/src/components/tugways/hooks/use-card-property-store.ts` (new).
- `tugdeck/src/components/tugways/hooks/use-card-dirty-state.ts` (new).
- `tugdeck/src/components/tugways/hooks/use-card-content-restore.ts` (new).
- `tugdeck/src/components/tugways/hooks/use-card-feed-store.ts` (new).
- `tugdeck/src/components/tugways/hooks/use-card-selection-and-scroll.ts` (new — if the scroll/selection effect decomposes cleanly; may fold into `use-card-content-restore.ts`).
- `tugdeck/src/components/chrome/card-host.tsx` — reduced to wiring: each hook called in order, portal wrapper, context providers, responder scope.
- `tugdeck/src/components/tugways/card-portal.tsx` — define a teardown contract for portal cleanup (audit P5): either guarantee cards finish destruction before the host content div unmounts, or expose an explicit `onHostGone(cb)` subscription for effects that need deterministic teardown.
- `tugdeck/src/__tests__/` — one test file per new hook, each exercising the hook in isolation via a minimal host.
- Test helper `tugdeck/src/__tests__/wait-for-portal.ts` (new — audit P12): `waitForPortal(paneId): Promise<HTMLElement>` resolves when the content registry reports an element for that paneId. Adopted by existing portal-sensitive tests.

**Work:**

a. **Extract `useCardPropertyStore`** first. Smallest seam. Takes `cardId` + `ResponderProvider`; registers the PropertyStore in `useLayoutEffect`; exposes the registered store via ref. `CardHost` loses ~30 lines.

b. **Extract `useCardPersistence`** — wait, this is already extracted (`use-card-persistence.tsx`). Skip.

c. **Extract `useCardDirtyState`** — the dirty-bit + debounced auto-save pipeline. Takes `cardId` + `saveFn`. Returns a `markDirty` callback. `CardHost` loses the dirty-bit state, the timer ref, and the debounced-save closure.

d. **Extract `useCardContentRestore`** — the initial-restore effect that runs when `CardHost` mounts and the tugbank row arrives. Takes `cardId`. Consults `DeckManager.getCardState(cardId)`, calls `onRestore` via the `CardPersistenceContext` when available.

e. **Extract `useCardFeedStore`** — the FeedStore subscription that drives `CardDataProvider`'s `feedData` map. Takes `cardId` + list of `feedIds` from the registration. Returns `feedData`.

f. **Optional: `useCardSelectionAndScroll`** — scroll-position and selection listeners that write back through `useCardDirtyState`. If the coupling with dirty state is too tight, leave inside `useCardContentRestore` or `CardHost` directly.

g. **`CardHost` becomes the wiring harness.** Call each hook in order, assemble the context providers, render the portal. Target: 120–150 lines.

h. **Define `CardPortal` teardown contract** (audit P5). When the host pane closes, the registry unregisters before React unmounts the card's effects. The current window — where effects run against detached DOM — is small but load-bearing. Either: (a) order destruction before host-content unmount (preferred, guarantees the invariant), or (b) expose `onHostGone` subscription. Decide during implementation based on where the actual race risk is.

i. **Test helper `waitForPortal(paneId)`** (audit P12). Replaces ad-hoc `await act(() => {})` / `await waitFor(...)` patterns in portal-sensitive tests with one explicit wait. Portals over the content registry's `subscribe(paneId, cb)`.

**Verification:**
- `bun x tsc --noEmit` + `bun test` all green after each hook extraction (land as a chain of small commits).
- `wc -l card-host.tsx` reports ~150 lines (down from 384).
- Each new hook has an isolated unit test.
- Existing integration tests (`tide-card.test.tsx`, `card-identity-preservation.test.tsx`) pass unchanged — the decomposition is internal.

**Risks:**
- Extraction order matters: the dirty-bit + save loop is the tightest coupling. Extract it last, after `useCardPropertyStore` and `useCardFeedStore` have proven the seam shape.
- React effect ordering between sibling hooks: every hook uses `useLayoutEffect` for registration; the order they're called in `CardHost` is the order effects fire. Write a one-paragraph note in `card-host.tsx`'s header documenting the ordering.
- A hook extraction that accidentally drops a dependency on `cardId` / `hostPaneId` / `componentId` will produce a stale closure. Each hook signature should take these as explicit arguments; don't reach through context.

---

#### Step 5.5.c — Invariants and safety-net tests {#step-5-5-c}

**Why this exists.** `validateDeckState` is the model: encode invariants in executable form, run in dev on every mutation, give clear errors on violation. The same pattern would catch an entire class of drift bug in the lifecycle / selection / save-callback layers that are currently only covered by happy-path tests. The four missing tests the audit calls out are the ones most likely to fail silently when the next layer lands.

**Files:**
- `tugdeck/src/lib/card-lifecycle.ts` — export `validateCardLifecycleState(cardLifecycle, deckState)` dev-only validator.
- `tugdeck/src/components/tugways/selection-guard.ts` — export `validateSelectionBoundaryMap(selectionGuard, deckState)` dev-only validator.
- `tugdeck/src/deck-manager.ts` — the `saveCallbacks` map: add `validateSaveCallbackKeys(manager, deckState)` dev-only. Also tighten `registerSaveCallback(id, callback)` signature to accept only `cardId` (audit P7): change the parameter name, JSDoc states "must be a cardId"; consider a branded-type check if the split map approach proves noisy.
- `tugdeck/src/deck-manager.ts` — wire all three validators into dev-mode `notify()`, alongside the existing `validateDeckState` call.
- `tugdeck/src/__tests__/hmr-lifecycle-registration.test.ts` (new — audit L5).
- `tugdeck/src/__tests__/concurrent-move-destruction.test.ts` (new — cross-cutting).
- `tugdeck/src/__tests__/portal-orphan-recovery.test.ts` (new — cross-cutting).
- `tugdeck/src/__tests__/construction-event-order.test.ts` (new — cross-cutting).
- `tugdeck/src/__tests__/non-focused-pane-activation.test.tsx` (new — audit P8): click an interactive element in a non-focused pane; assert activation event fires *before* the click event.

**Work:**

a. **Validator extension.**
   - `validateCardLifecycleState`: the set of ids tracked by `CardLifecycle.constructedCards` must equal the set of ids in `deckState.cards`. If a card is destroyed but the lifecycle's tracking set still contains it (or vice versa), throw `CardLifecycleInvariantError` naming the drift.
   - `validateSelectionBoundaryMap`: the keys in `selectionGuard.boundaries` map should be a subset of `deckState.cards.map(c => c.id)` — a boundary registered for a card that no longer exists is a leak.
   - `validateSaveCallbackKeys`: keys in `saveCallbacks` should be a subset of live `cardId`s. Stale keys after close indicate an unregister was missed.
   - All three run inside the dev-only `notify()` guard; production builds strip the calls.

b. **Stable-render-order invariant test** (audit P8). Render a deck with two panes. Click an interactive element (checkbox, button) in the non-focused pane. Assert the activation event fires *before* the click handler runs, and that the click handler runs on the same synthetic event (no stale-synthetic-event bugs). This is the regression test for the scenario the `sortedStacks` sort exists to prevent; if someone ever removes the sort, this test fails.

c. **HMR re-registration test** (audit L5). Construct `DeckManager` → destroy → construct again. Install cascade subscribers on generation 2. Fire a cascade event. Assert only generation-2 subscribers received it (gen-1 subscribers are silent). Protects against module-level singleton drift during HMR.

d. **Concurrent move + destruction test.** Drag card A from pane P1 to pane P2 while closing P2 mid-drag. Expected: graceful rejection of one operation, no invariant violation (validators stay green through the race). Pins the mutator synchronization that currently works by `notify()` ordering alone.

e. **Portal orphan recovery test.** Close the host pane while the card's content effects are mid-debounce (dirty-bit save timer fired but commit pending). Assert no exception, no duplicate save, no stale listener on detached DOM.

f. **Construction event order on loaded layout.** Mount with a pre-populated 5-card / 3-pane layout via tugbank rows. Assert 5 `cardDidFinishConstruction` events fire in `deckState.cards` array order before the React root commits visible content. This is the test that a `cardDidFinishConstruction` subscriber on a card that exists at cold-launch gets its event reliably.

**Verification:**
- All four new tests pass.
- Dev-mode validators run on every `notify()` without noticeable slowdown on the test suite (if validators add > 100ms to test-run time, make them opt-in per test file via a flag).
- `bun x tsc --noEmit` + `bun test` + `bun run audit:tokens lint` all green.
- Production build (if checked) does not include validator call sites — gate on `import.meta.env?.DEV`.

**Risks:**
- A validator that throws during a legitimate intermediate state (mid-mutation invariants temporarily violated) would break more than it catches. Mitigation: validators run *after* the commit closure, *before* `notify()` — the same point `validateDeckState` already runs. Same contract.
- Concurrent-op tests are inherently timing-sensitive and may be flaky. Mitigation: use deterministic promise sequencing (`await Promise.all([...])` with explicit `await`s rather than setTimeout races).

---

#### Step 6 — Cmd+J scrolls to the selected history entry (or bottom) {#step-6}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (Cmd+J handler).
- `tugdeck/src/components/tugways/tug-prompt-entry.tsx` (expose currently-selected history entry's index/key on the delegate, if not already exposed).
- `tugdeck/src/components/tugways/cards/tide-card.css` (scroll target styles if needed).

**Work:**
- Extend `TugPromptEntryDelegate` to expose the currently-selected history entry's identifier (e.g., `getSelectedHistoryEntryId(): string | null`) — `null` when no history navigation is active.
- Add a card-level Cmd+J keydown handler:
  1. Read the entry id from the delegate.
  2. If non-null and a corresponding rendered region exists in the transcript view, scroll that region into view (use `scrollIntoView({ block: "center" })` or the equivalent imperative on `TugMarkdownView` if exposed).
  3. If null or no matching region, scroll the transcript to the bottom (mirror End / Cmd+Down behavior — call the same scroll-to-bottom path the streaming view uses on `turn_complete`).
- Cmd+J fires regardless of which element holds focus inside the card (chrome, prompt input, transcript) — the card-level handler claims the chord.

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- New test: render a Tide card with a recorded transcript fixture, set selected history entry → simulate Cmd+J → assert the transcript scroll position changes to that entry's region. Then clear selection → simulate Cmd+J → assert scroll-to-bottom.
- Manual: with a multi-turn transcript visible, navigate history with Cmd+Up to a past entry; press Cmd+J; transcript jumps to that entry. Press Esc to clear history navigation; press Cmd+J; transcript scrolls to bottom.

> **Step 6 depends on [Step 11](#step-11)'s transcript rendering** for the "scroll to a transcript region" path to do anything visible. Until Step 11 lands, the bottom-scroll fallback is the only branch with user-visible effect. Both branches still ship in this commit so the keybinding is not split across two commits — the second branch becomes useful when Step 11 lands.

#### Step 7 — Atoms render cleanly at tighter line-heights {#step-7}

**Files:**
- `tugdeck/src/lib/tug-text-engine.ts` (atom layout constraints, if that's where the line-height baseline math lives).
- `tugdeck/src/components/tugways/tug-prompt-entry.css` (atom CSS — vertical-align / line-height interaction).
- `tugdeck/src/lib/tug-atom-img.ts` or `tugdeck/src/lib/tug-atom-fonts.ts` (atom rendering pipeline; whichever owns the metrics).

**Work:**
- Investigation first: bisect the 1.7 minimum. Identify whether the jump is caused by atom intrinsic height exceeding the line box at lower leading values, or by the SVG-rendered atom's vertical-align baseline computation, or by both.
- Fix the metrics so atoms participate correctly in the line box at the editor's actual `lineHeight`. The atom must accept a line-height prop (or read the editor's resolved leading) and size its bounding box to fit *within* the line — the current 1.7 floor is the symptom of an oversized fixed metric.
- Decide and document a minimum supported line-height (target: 1.2). Below that minimum, the editor still lays out correctly; below the absolute floor, atoms can opt out (clamp) — but the jump-on-insert must be gone for any value at or above the documented minimum.
- Update `EditorSettingsStore`'s `LINE_HEIGHT_OPTIONS` if the available choices need adjusting (e.g., to expose 1.2, 1.3, 1.4 as choices in the leading popover).

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- New test: insert an atom at `lineHeight = 1.2` → assert the line's resolved height does not change vs. the same line without the atom.
- Manual: open a Tide card, set Leading to 1.2 via the popover, paste a file path that produces an atom — observe no line-jump. Repeat at 1.3, 1.4, 1.5 — same. Above 1.7 (the prior floor), behavior is unchanged.

#### Step 8 — Completion popups respect the card's bottom edge {#step-8}

**Files:**
- `tugdeck/src/components/tugways/tug-prompt-entry.tsx` and `.css` (slash + file completion popup positioning).
- Possibly `tugdeck/src/components/tugways/tug-popup-*.tsx` if the popup primitive is the source of the overflow.

**Work:**
- Reproduce the layout bug at small card sizes: open `/` or `@` completion in a Tide card whose bottom pane is shrunk to its `minSize`. The popup currently overflows the card's bottom or pushes the prompt-entry off the pinned-bottom layout.
- Fix the popup positioning to:
  1. Open *upward* (above the prompt input) when there is insufficient space below within the card body.
  2. Cap its height to the available space — never overflow the card bounds.
  3. Scroll internally if the cap clips the option list.
- Whichever direction the popup opens, the prompt input itself stays pinned to the card's bottom pane bound. The popup is a portal-style overlay, not a flow-layout sibling.
- If the existing `tug-popup-*` primitives already support the upward / capped-height variant, the fix is to opt into them; if not, extend the primitive (and note the extension in the commit message).

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- New test: render a Tide card, force the bottom pane to its `minSize`, open `/` completion → assert the popup's bounding rect lies inside the card's bounding rect; the prompt input's bounding rect's bottom edge is unchanged.
- Manual: drag the split pane to compress the bottom pane, open `/` and `@` completions — neither overflows; the prompt-entry stays pinned.

#### Step 9 — Participant model + `TugTranscriptEntry` primitive {#step-9}

**Files:**
- `tugdeck/src/components/tugways/tug-transcript-entry.tsx` (new component).
- `tugdeck/src/components/tugways/tug-transcript-entry.css` (new styles).
- `tugdeck/src/components/tugways/cards/gallery-transcript-entry.tsx` (new — gallery card showcasing all four participant variants stacked).
- `tugdeck/styles/themes/brio.css` and `tugdeck/styles/themes/harmony.css` (new `--tugx-transcript-*` tokens; per-participant overrides via `[data-participant="..."]`).

**Work:**

*Participant model.* Define a `Participant` type covering the speakers Tide will mix in the transcript:

| Participant | Source | Identifier (default) | Body | Controls/badges (suggested) |
|-|-|-|-|-|
| `user` | the human's submitted text | "You" | the submission, rendered per its route (markdown for `>`, monospace for `$`/`:`) | route prefix glyph (`❯` / `$` / `:`) |
| `code` | Claude Code assistant turn | "Code" or active model | streamed/finalized markdown via `TugMarkdownView` | model name, token usage, duration, copy button |
| `shell` | tugshell command output (live wire post-Phase T4) | the command's first token (e.g., `git`, `cargo`) | adapter-rendered or monospace | exit code, duration |
| `command` | `:` surface built-in output (live wire post-Phase T10) | the command name (e.g., `:cost`, `:status`) | structured response | refresh / dismiss as appropriate |

The type is open for extension. Adding a participant variant means registering an icon, identifier styling, and (optionally) a controls-row template via `--tugx-transcript-*` tokens — no code change in the primitive.

*Visual structure (Slack-like, NOT chat bubbles per [D6](#resolved-decisions)).* Two-column layout per row:

- **Left column (~32–40px):** participant icon. Glyph or mark, never a photo. Per-participant via `[data-participant="..."]`.
- **Right column header row:** bold identifier (`<strong>`), then a small relative or absolute timestamp.
- **Right column body:** the actual content. Slot — `TugMarkdownView` plugs in for `code`; plain text for `user`; adapter components for `shell`; structured renderers for `command`.
- **Right column controls/badges row (beneath the body):** trailing affordances per participant (model name, exit code, copy, dismiss, etc.).

No rounded surrounding container per row. No left-vs-right alignment by speaker. Every row reads top-to-bottom in a single column. Vertical separation is whitespace + the bold identifier line — no horizontal rules between rows by default.

*`TugTranscriptEntry` component.* Composable, slot-based:

```ts
type Participant = "user" | "code" | "shell" | "command";

interface TugTranscriptEntryProps {
  participant: Participant;
  identifier: React.ReactNode;        // bold label
  timestamp?: React.ReactNode;        // relative or absolute
  body: React.ReactNode;              // markdown / monospace / structured
  controls?: React.ReactNode;         // trailing badge/icon row
  // accessibility:
  // - role="article" or "group" with aria-label = `${identifier} at ${timestamp}`
}
```

The component renders a `data-participant` attribute on its root for theme overrides and a `data-slot` attribute (`transcript-entry`) for stable querying / e2e tests.

*Tokens.* New `--tugx-transcript-*` token set (icon size, identifier weight + color, body line-height, controls-row spacing, row vertical gap). Per-participant overrides keyed by `[data-participant="..."]`. All names conform to the seven-slot naming convention; `bun run audit:tokens lint` exits 0.

*Gallery card.* Build `gallery-transcript-entry` that stacks all four participant variants with realistic content: a `user` row reading "> tell me a haiku", a `code` row with a streaming-style markdown response and a copy button + model badge, a `shell` row with mock `git status` output and an exit-code badge, a `command` row with `:cost` output. Lets the design be tuned in isolation before [Step 11](#step-11) wires it into live data.

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- New unit test: render `TugTranscriptEntry` with each participant variant; snapshot the DOM structure (icon column + content column with header / body / controls rows).
- `bun run audit:tokens lint` exits 0; new tokens conform to seven-slot naming.
- Visual review against [D6](#resolved-decisions): no rounded per-row container, no bubble background, no left-vs-right alignment by speaker, identifier + timestamp on top of body.
- Manual: open `gallery-transcript-entry` in tugdeck; all four variants render with distinct icons / identifiers; vertical rhythm reads cleanly top-to-bottom.

**Out of scope (deferred to [Step 11](#step-11) and later phases):**
- Wiring into the live `CodeSessionStore` transcript — that's [Step 11](#step-11).
- Live `shell` rows — needs Phase T4 (tugshell) data. Gallery uses mock data for now.
- Live `command` rows — needs Phase T10 (`:` surface built-ins) data. Gallery uses mock data for now.
- Per-row reactions, threading, or message editing — Slack borrowings stop at the visual structure.

#### Step 10 — Tugcast-side session ledger + full resume UX (placeholder; design before implementation) {#step-10}

**Status:** Design sketch only. Do NOT start implementation from these notes — they capture intent, not a landable plan. Carry-forward of [Step 4.6 of T3.4.c](./archive/tugplan-tide-card.md#step-4-6); promotion to a full plan (files, work, verification) happens in a dedicated document (e.g., `roadmap/tugplan-tide-session-ledger.md`) before any code commits, so the plumbing already in place from T3.4.c ([4.5](./archive/tugplan-tide-card.md#step-4-5)'s `sessionMode`, `resume_failed`, picker list shape; [4.5.5](./archive/tugplan-tide-card.md#step-4-5-5)'s post-implementation audit) is concrete before the richer UX and storage redesign are scoped.

**Why this exists:** T3.4.c's [4.5](./archive/tugplan-tide-card.md#step-4-5) wires the user-facing choice but keeps storage inside the tugbank map — one id per workspace, no metadata, no branching. That is enough to make resume *work*; it is not enough to make it *right*. Users will hit every one of these the moment they have more than one session per workspace they care about:

- "I have three sessions going in this repo — which one am I resuming?"
- "I closed a card; did that throw away my session?"
- "Two cards both resumed the same session — now the JSONL is corrupt."
- "I want to forget one specific session without forgetting all of them."
- "The resume timestamp is opaque; I want to see what the conversation was about."

This step addresses all of these by moving session bookkeeping out of tugbank and into a purpose-built tugcast-side ledger, and by reshaping the picker around the richer data the ledger exposes.

**Why a tugcast-side ledger (not tugbank):**
- **Row-level queries with ordering:** N sessions per workspace, sorted by `last_used_at`, filtered by state, keyed on `workspace_key`. Tugbank is a KV store; modelling this as JSON blobs would push all the logic into the reader and re-parse on every picker paint.
- **Write volume:** the ledger updates on every `turn_complete` frame (to tick `turn_count` and `last_used_at`), plus on every `spawn_session_ok` / `close_session` / `resume_failed`. Tugbank is not built for that cadence and the churn would pollute its change-notification stream.
- **Ownership:** the ledger is tugcast-process-local state about tugcast-managed child processes. It has no meaning outside tugcast; routing it through tugbank spreads responsibility across a boundary that doesn't carry its weight.
- **Lifecycle:** migration from T3.4.c 4.5's tugbank map is one-shot (read once, synthesize rows, delete the tugbank key). After migration, tugbank has no role in session bookkeeping.

**Sketch of the ledger:**
- **Location:** `tugrust/crates/tugcast/src/session_ledger.rs`, owned by the tugcast process. A single `SessionLedger` instance lives on the server, shared by the supervisor and the CONTROL handler.
- **Storage backing:** preferred **`rusqlite` with a single-file database** under the user's data dir (`~/Library/Application Support/Tug/sessions.db` on macOS, `$XDG_DATA_HOME/tugcast/sessions.db` on Linux). Sqlite carries its weight because row-level queries with `ORDER BY last_used_at DESC` and concurrent reads while the supervisor writes are exactly what it's for. Alternative considered: JSONL per workspace. Cheaper to introduce, O(N) to query, no index, worse eviction. The promotion pass picks one; sqlite is the starting preference.
- **Schema (sqlite sketch):**
  ```sql
  CREATE TABLE sessions (
    session_id        TEXT PRIMARY KEY,
    workspace_key     TEXT NOT NULL,
    project_dir       TEXT NOT NULL,
    created_at        INTEGER NOT NULL,  -- unix millis
    last_used_at      INTEGER NOT NULL,
    turn_count        INTEGER NOT NULL DEFAULT 0,
    first_user_prompt TEXT,              -- first user_message, truncated to 256 chars
    state             TEXT NOT NULL,     -- "live" | "closed" | "failed"
    card_id_live      TEXT               -- set while a card is bound; NULL otherwise
  );
  CREATE INDEX sessions_workspace ON sessions(workspace_key, last_used_at DESC);
  ```
- **Ledger writes (driven by tugcast's supervisor, not tugcode):**
  - On `spawn_session_ok`: `INSERT OR IGNORE`; set `state="live"`, `card_id_live=<card_id>`, `created_at=now`, `last_used_at=now`.
  - On first `user_message` of a session: `UPDATE first_user_prompt` (only if NULL) with the trimmed body.
  - On every `turn_complete`: `UPDATE turn_count = turn_count + 1, last_used_at = now`.
  - On `close_session` / tugcode exit: `UPDATE state="closed", card_id_live=NULL`.
  - On `resume_failed`: `UPDATE state="failed"` (ledger retains the crumb for diagnostics; Forget is the only path to full deletion).

**CONTROL protocol additions:**
- `list_sessions { workspace_key }` → `{ sessions: [{ session_id, created_at, last_used_at, turn_count, first_user_prompt, state, card_id_live }, ...] }`. Picker calls on mount and on path change.
- `forget_session { session_id }` → deletes the row; kills the tugcode child if any; moves the underlying `~/.claude/projects/.../<id>.jsonl` to a trash subdir (recoverable for a week).
- `forget_workspace_sessions { workspace_key }` → batch Forget for the picker's "Forget all sessions for this workspace" button.
- `session_updated { session_id, fields... }` → broadcast on every write above; tugdeck's picker subscribes while open so turn counts tick and state indicators stay current without polling.

**Migration from T3.4.c 4.5:**
- On tugcast startup (one-time): read `dev.tugtool.tide / session-id-by-workspace` from tugbank, synthesize ledger rows (`state="closed"`, metadata defaulted), delete the tugbank key. Guard against partial failures with a single transaction.
- tugcode stops reading/writing the tugbank map. The preferred shape: tugcast resolves the session id *before* spawning tugcode and passes it as a `--resume-session-id <id>` flag, so tugcode is entirely free of session bookkeeping. The alternative — tugcode calls out to tugcast over CONTROL for the id — keeps tugcode closer to its current shape but adds a round-trip on every spawn. Promotion picks one.

**Sketch of the UX:**
- Picker reshaped around the ledger's richer rows:
  - Path input (unchanged).
  - "Start fresh" row, always first.
  - N "Resume session" rows, one per ledger entry for the typed workspace, ordered by `last_used_at DESC`. Each row shows: first_user_prompt snippet (or "No prompts yet" for empty sessions), turn count, relative timestamp ("2h ago"), and a state indicator. Rows with `state="failed"` render greyed with a diagnostic subtitle.
  - Per-row "Forget" action (disabled when `card_id_live` is set). A confirmation sheet warns before deletion — this is destructive and user-visible.
  - A footer "Forget all sessions for this workspace" button.
- Live updates: picker subscribes to `session_updated` broadcasts while open. Turn counts and state change in place; no flash, no re-mount.
- Keyboard: arrow keys navigate the whole list (Start fresh + all resume rows); Enter submits; Backspace on a row triggers Forget (with confirmation sheet).
- Still no proper table component. The row shape is richer than T3.4.c 4.5's radio group; if a table primitive lands in tugdeck between T3.4.c and this step's promotion, reshape accordingly, but do **not** detour to build one inside this step. The list-with-rich-rows shape is sufficient for the session counts we expect (tens, not hundreds).

**Lifecycle policies (decidable with ledger in hand):**
- **Close semantics.** Closing a card sets `state="closed"`, `card_id_live=NULL`. Metadata preserved. Next card can resume. Explicit Forget is the only path to deletion.
- **Concurrent-resume collision.** Picker greys out resume rows with `card_id_live != null && card_id_live != this.cardId`. Defense in depth: the CONTROL `spawn_session` handler in tugcast rejects `session_mode="resume"` with `session_id` already live on another card, returning `spawn_session_err { reason: "session_live_elsewhere" }`.
- **Eviction.** Ledger cap: named constant `TIDE_LEDGER_MAX_PER_WORKSPACE` (initial: 20). On spawn, if the workspace has ≥ cap rows, evict the oldest `state="closed"` row by `last_used_at`. Age-based expiry: rows older than a named `TIDE_LEDGER_MAX_AGE` (initial: 90 days) with `state != "live"` evicted on startup. Both thresholds are named constants, not magic numbers. `state="live"` rows are never evicted.
- **Recents↔ledger coherence.** When a recent-projects entry is evicted (per [4m of T3.4.c](./archive/tugplan-tide-card.md#step-4m)'s cap), evict all ledger rows for that workspace in the same transaction. The reverse — ledger eviction triggering recents eviction — is **not** automatic; a workspace with no stored sessions can still be a recent project.
- **Explicit Forget.** Per-row Forget + per-workspace Forget-all, each with confirmation. Forget moves the session JSONL to a trash subdir (not `rm`), keyed on delete date, swept on a coarse schedule (weekly) or next startup if older than 7 days.

**Non-goals even for the promoted plan:**
- Server-side archival or search across prior sessions — requires an external index, out of this plan's scope.
- Cross-machine sync — the ledger is tugcast-process-local, backed by a single file in the user's data dir.
- Session branching ("fork from turn N") — that is a Claude-side feature, not a picker UX.
- A purpose-built table / grid component for the session list. If one lands upstream, reshape; otherwise stick with the list.

**Open design questions for the promotion pass:**
- Sqlite vs JSONL backing. Starting preference: sqlite.
- Whether tugcode reads the ledger via CONTROL round-trip, or tugcast resolves the id and passes it as a CLI flag. Starting preference: CLI flag (keeps tugcode stateless).
- Whether `resume_failed` downgrades ledger state to `"failed"` (crumb for diagnostics) or deletes outright. Starting preference: `"failed"`.
- Whether the ledger also tracks assistant response bytes / storage pressure for a future "trim old sessions" UX.
- Whether any of [4m of T3.4.c](./archive/tugplan-tide-card.md#step-4m)'s recent-projects logic should move into the ledger itself (one store, two views) or stay separate (tugbank stays the source of truth for recents). Starting preference: keep separate — recents and sessions are different entities with different eviction policies.
- Trash sweep cadence: on-demand during Forget, or background on tugcast startup? Starting preference: startup sweep of anything > 7 days old.

**Promotion gate:**
- Before a single commit lands against the ledger, author `roadmap/tugplan-tide-session-ledger.md` (or equivalent). The promoted plan enumerates: files, sub-steps (one commit each), schema + migration tests, picker tests, tugcast integration tests, and exit criteria. It resolves each open design question above.
- Downstream steps in this polish plan ([Step 11](#step-11) onwards) do **not** depend on the ledger landing. They build on T3.4.c's existing session state (tugbank map + resume-vs-new picker) and gain ledger-backed behavior only after the promoted plan ships.

**Verification (of the placeholder, not the eventual implementation):**
- The "Open design questions" list above is complete and each question has a starting preference recorded.
- The promotion-gate paragraph is explicit about the promoted-plan filename and exit criteria before any code lands.
- No code change lands under this step's SHA. If a commit is needed against this plan file to record the placeholder, its diff is documentation-only.

#### Step 11 — Multi-turn transcript rendering with `TugTranscriptEntry` {#step-11}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (replace top-pane wire-up).
- `tugdeck/src/lib/code-session-store.ts` (no behavior change expected; consume `snap.transcript` here).
- `tugdeck/src/components/tugways/__tests__/tide-card.test.tsx` (new transcript test).

**Work:**
- Replace the single-region wire-up (only `streamingPaths.assistant`) with a transcript-aware rendering path that uses `TugTranscriptEntry` from [Step 9](#step-9):
  - For each entry in `snap.transcript`, render two `TugTranscriptEntry` rows: a `participant: "user"` row carrying the submitted prompt, then a `participant: "code"` row carrying the assistant response.
  - For the in-flight turn, render the `user` row immediately on submit (so the user sees their own submission appear in the transcript flow at the moment they hit Enter), and render a `code` row whose body is bound to `streamingPaths.assistant` via `TugMarkdownView`.
- The user's submitted text appears in the transcript above the assistant response — the conversation reads as a back-and-forth, not a stream of disembodied assistant outputs.
- Use `TugMarkdownView`'s imperative `setRegion` handle (one region per `code` row) per the architecture in [tide.md §T3.4.a](./tide.md#code-session-store) line 2406. The React snapshot exposes path strings only.
- Identifier on `code` rows reads "Code" (or the active model's display name when available from `SessionMetadataStore`); identifier on `user` rows reads "You". Timestamps come from each turn's submit time.
- The "sticky last turn" Step 5 fallback becomes redundant once transcript rendering lands. Remove it as part of this commit, with a code comment pointing here.
- Append-and-scroll-to-bottom on new rows; use existing `SmartScroll` infra in `tugdeck/src/lib/smart-scroll.ts` so the user opting out of auto-scroll (by scrolling up) is honored.

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- New test: load a recorded multi-turn session fixture into `CodeSessionStore` → render Tide card → assert N pairs of (`user`, `code`) `TugTranscriptEntry` rows present + an active streaming region while a turn is in flight; on `turn_complete(success)`, the streaming region's body finalizes into the corresponding `code` row.
- New test: simulate submit of `> hi` → assert a `user` `TugTranscriptEntry` row carrying `> hi` appears in the transcript *immediately* (before any assistant deltas arrive).
- Manual: open a Tide card, submit `> tell me a haiku`; observe the `user` row appear immediately, then the `code` row stream in beneath it. Submit `> now another`; both prior rows stay visible above the new pair. Scroll up while a new turn streams; auto-scroll defers per `SmartScroll`.

#### Step 12 — Markdown styling pass for assistant output {#step-12}

**Files:**
- `tugdeck/styles/themes/brio.css` and `tugdeck/styles/themes/harmony.css` (`--tugx-md-*` token tuning).
- `tugdeck/src/components/tugways/cards/tide-card.css` (Tide-specific overrides if any are needed).

**Work:**
- Tune typography (font-family, size, weight), spacing (paragraph margins, list indents, code-block padding), code-block chrome (border, background, copy affordance hover state), and overall vertical rhythm of the rendered markdown so Claude Code output reads cleanly inside a `TugTranscriptEntry` `code` row.
- Coordinate with [Phase T1](./tide.md#content-block-types)'s GFM / TugCodeBlock polish: avoid landing tokens here that T1 will relitigate. Where possible, the values chosen here are the values T1 inherits.
- Token-driven; no inline styles. Conform to the seven-slot naming convention. `bun run audit:tokens lint` exits 0.

**Verification:**
- `bun x tsc --noEmit` + `bun test` + `bun run audit:tokens lint` green.
- Manual: side-by-side comparison of Claude Code output in a Tide card before vs. after this commit. Headings, paragraphs, lists, blockquotes, inline code, fenced code blocks, tables — each looks polished. Both `brio` and `harmony` themes verified.

#### Step 13 — Wire thinking + tool surfaces {#step-13}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (`streamingPaths.thinking` + `streamingPaths.tools` consumers).
- `tugdeck/src/components/tugways/cards/tide-card.css` (placement styling).

**Work:**
- Decide visual placement up front (and document the decision in the commit message + a code comment): inline within the `code` row's body, collapsible alongside assistant text, or as a sibling row in the transcript with its own participant variant. Default recommendation: inline + collapsible inside the `code` row, so the transcript reads top-to-bottom and the user can expand a thinking / tool block when curious.
- Wire `streamingPaths.thinking` and `streamingPaths.tools` to dedicated regions of `TugMarkdownView` (or a small companion component if the rendering needs differ enough from markdown to warrant it).
- Coordinate with [Phase T1](./tide.md#content-block-types)'s thinking-block (U6) and tool-use-display (U7): pick a surface T1 can extend, not one T1 will throw away.
- Streaming behavior: thinking blocks stream into their region during the turn and finalize on `turn_complete`. Tool-use blocks render in turn order alongside the assistant text.
- If "tool use" feels participant-flavored enough on review (e.g., a `Bash` tool feels like a transient `shell`-adjacent speaker), consider promoting it to its own participant in a follow-up. The default for this step is to keep tool blocks inside the `code` row.

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- New test: render Tide card against a fixture turn that includes thinking + tool_use events → assert thinking region and tool region are both rendered, in correct order, with correct content, inside the `code` row.
- Manual: submit a prompt that elicits both thinking and tool use (e.g., `> use bash to list /tmp`); observe thinking block and tool_use / tool_result blocks rendering inline alongside the assistant response.

#### Step 14 — Mid-stream behaviors end-to-end (Stop, queued sends, tool sub-state) {#step-14}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (verify; behavior is mostly in `CodeSessionStore` already).
- `tugdeck/src/components/tugways/__tests__/tide-card.test.tsx` (E2E coverage tests).

**Work:**
- Walk the four mid-stream scenarios end-to-end against a real or recorded session and ensure each works correctly through the Tide card surface:
  1. **Stop:** click the Stop button mid-stream → `interrupt` frame on `CODE_INPUT` → `turn_complete(error)` → `interrupted → idle`, accumulated text preserved (in the active `code` row).
  2. **Queued sends:** type and submit a second `> ...` while a turn is in flight → the new `user` row appears in the transcript immediately, marked as queued; on idle it auto-flushes (per U19) and a new `code` row begins streaming.
  3. **Tool sub-state:** during `tool_use` / `tool_use_structured`, the submit button stays in Stop mode; the entry remains in `tool_work` sub-state.
  4. **No regressions:** the basic round-trip (`> hello` → response → idle) still works and is exercised by an existing test.
- Most of this logic lives in `CodeSessionStore`; this step is primarily about *coverage* — confirming the Tide card consumes the right snapshot fields and renders the right affordances. Bug fixes that fall out of the walkthrough land in this commit.

**Verification:**
- `bun x tsc --noEmit` + `bun test` green; new tests exercise each scenario.
- Manual smoke against live Claude: each of the four scenarios behaves as described.

#### Step 15 — `control_request_forward` UI (permission + question) {#step-15}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (mount the dialog component when a snapshot field carries a `control_request_forward`).
- A new component (e.g., `tugdeck/src/components/tugways/tide-control-request.tsx`) for the dialog body.
- Tests.

**Work:**
- Surface `control_request_forward` events as inline blocks inside the in-flight `code` row (consistent with the transcript style from Step 11; not a modal). Two variants:
  - `is_question: false` — permission block. Displays tool name, input, reason. Allow / deny buttons. Approving writes a `tool_approval` frame; denying does the same with the inverse decision. The turn resumes from the decision.
  - `is_question: true` — question block. Renders the question + options (single-select or multi-select per the payload). Submitting writes a `question_answer` frame.
- Keyboard: arrow keys move selection within the block; Enter submits; Esc cancels (cancel = deny / dismiss).
- Snapshot wiring: `CodeSessionStore` already exposes the inflight `control_request_forward` state; Tide card consumes it from the snapshot and renders the block in the `code` row's body for the in-flight turn.
- Phase T9 (Conversation Wiring) will iterate on the richer permission / question UX (suggestions for "always allow," etc.); this step ships the minimum that closes the T3.4.d exit criterion.

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- New tests: render Tide card with a fixture `control_request_forward` (both variants); assert the block renders with correct fields; simulate Allow → assert `tool_approval` frame sent; simulate Deny → frame sent; simulate question Answer → `question_answer` frame sent.
- Manual smoke against live Claude: prompt that requires permission (e.g., a Bash invocation in plan mode) → permission block appears; allow → tool runs. Use `AskUserQuestion` similarly.

#### Step 16 — Feature coverage: route prefixes, indicator sync, completions, history {#step-16}

**Files:**
- `tugdeck/src/components/tugways/__tests__/tug-prompt-entry.test.tsx` and/or `tide-card.test.tsx` (new coverage tests).
- Bug-fix touches as needed.

**Work:**
- Add tests that assert the T3.4.d "Feature coverage" criteria from tide.md:
  - `>` (and `❯`) flips to Code; `$` flips to Shell; `:` flips to Command. `>`/`❯` are consumed at position-zero per the existing route-prefix-eat behavior.
  - Route indicator changes update the route atom (and vice versa) — bidirectional sync.
  - `@` completion returns FILETREE-backed results; selecting an entry inserts a file atom.
  - `/` completion merges `SessionMetadataStore.slashCommands` and the skill list; selecting an entry inserts the slash command into the input.
  - Cmd+Up / Cmd+Down navigate `PromptHistoryStore` per-route; per-route drafts persist.
- Where a test exposes a real bug, fix it in the same commit (or, if the bug is large enough to warrant its own commit, split into a follow-up step before [Step 23](#step-23)).

**Verification:**
- `bun x tsc --noEmit` + `bun test` green; new tests exercise each criterion.
- Manual: walk the criteria interactively in a running Tide card.

#### Step 17 — CJK end-to-end {#step-17}

**Files:**
- Test fixtures (Japanese, Chinese strings).
- Possibly `tug-text-engine.ts` if IME composition exposes a bug.

**Work:**
- Verify IME composition end-to-end with Japanese and Chinese input: compose into the prompt input, submit, observe the streamed assistant response render correctly inside its `code` row.
- Add a test fixture that exercises CJK strings through the engine + render path (composition events; submission; streaming output).
- Fix any rendering, segmentation, or composition bugs that surface (this is a verification step; if the surface is already clean, the commit is small).

**Verification:**
- `bun x tsc --noEmit` + `bun test` green; new CJK tests pass.
- Manual: with a Japanese IME active, type `> こんにちは`, submit, verify the assistant responds in kind. Repeat with Chinese.

#### Step 18 — VoiceOver / a11y pass {#step-18}

**Files:**
- `tugdeck/src/components/tugways/tug-prompt-entry.tsx` (aria-label / role attributes on atoms, route indicator, submit/stop button).
- `tugdeck/src/components/tugways/tug-transcript-entry.tsx` (aria-label per row; landmark roles).
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (transcript region landmarks).
- Tests.

**Work:**
- Walk the Tide card with VoiceOver active. Verify:
  - Atoms in the prompt input announce their type and label.
  - Route indicator announces the current route.
  - Submit / Stop button announces its current mode.
  - Each `TugTranscriptEntry` announces the participant identifier + timestamp before the body content (e.g., "You at 12:45 PM, tell me a haiku" → "Code at 12:45 PM, [response text]").
  - Transcript regions are navigable by VoiceOver (each row is a landmark or has an appropriate role).
- Fix any gaps surfaced (missing labels, role mismatches, focus-order issues).
- Accessibility regression tests where feasible.

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- Manual VoiceOver walkthrough recorded; each criterion above passes.

#### Step 19 — Atom drag-and-drop from Finder {#step-19}

**Files:**
- `tugdeck/src/components/tugways/tug-prompt-entry.tsx` (drop target wiring).
- `tugdeck/src/lib/tug-text-engine.ts` (insert-atom path for dropped paths).

**Work:**
- Wire a drop target on the prompt input that accepts file path data from the OS (Finder drags expose `text/uri-list` or `text/plain` with `file://` URLs). On drop, normalize the path and insert it as a file atom.
- Drop position respects the caret if the drop is inside the editor; defaults to end of input otherwise.
- Multi-file drops insert multiple atoms in order.

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- Manual: drag a file from Finder onto the Tide card's prompt input; observe a file atom appear; submit; verify the path is included in the user message.

#### Step 20 — Typeahead jank profiling {#step-20}

**Files:**
- `tugdeck/src/lib/filetree-store.ts` and/or completion provider for `@`.
- Tests.

**Work:**
- Profile typeahead latency on full-project file listings (the largest realistic FILETREE — e.g., a checkout of the full tugtool repo). Look for jank during the `@`-prefixed query.
- Likely culprits: linear scans on every keystroke, missing debounce, recompute of the full sorted list per query, layout thrash from popup re-render.
- Apply the fix the profile points at (debounce, memoization, virtualized result list, incremental filtering — pick the smallest fix that meets the jank-free bar).

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- Manual: in a Tide card pointed at the full tugtool checkout, type `@` and several characters quickly; observe no perceptible jank; results update smoothly.
- Performance test (if the test infra supports it): query latency stays under ~16ms per keystroke for FILETREEs of N files.

#### Step 21 — Concurrent Tide cards regression test {#step-21}

**Files:**
- `tugdeck/src/components/tugways/cards/__tests__/tide-card.test.tsx` (new test).

**Work:**
- Two Tide cards open simultaneously already work post-[4k](./archive/tugplan-tide-card.md#step-4k) — each gets its own fresh session, its own tugcode subprocess, its own JSONL. This step *formalizes* that with a regression test:
  - Mount two `<TideCardContent cardId="t1" />` and `<TideCardContent cardId="t2" />` against a fake connection.
  - Submit picker for each with distinct project paths.
  - Simulate `spawn_session_ok` for both, with distinct `tug_session_id` values.
  - Submit `> hi` from card t1.
  - Assert: `user_message` frame is sent on `CODE_INPUT` filtered to t1's session; t2's snapshot is unaffected; t1's transcript has a new `user` row, t2's does not.
  - Submit from t2; assert the inverse.
- This step is *not* gated on P2 router work — the test exercises whatever the router state is at this commit. If P2 has not landed yet, the test still passes (sessions are routed by the existing per-binding feed filtering).
- When P2 lands, this test stays meaningful and may grow to assert the additional router-level isolation.

**Verification:**
- `bun x tsc --noEmit` + `bun test` green; new test exercises the two-card scenario.
- Manual smoke: open two Tide cards on different projects, submit in each, verify no cross-talk.

#### Step 22 — Compliance close-out {#step-22}

**Files:**
- Whatever last-mile cleanup the audit surfaces; ideally none.

**Work:**
- Run the full check matrix:
  - `bun x tsc --noEmit` clean.
  - `bun run check` clean.
  - `bun test` green.
  - `bun run audit:tokens lint` exits 0.
  - `cargo nextest run` green across the workspace.
- Grep for IndexedDB references introduced anywhere by this plan: `rg -i 'indexeddb' tugdeck/src/components/tugways/cards/tide-card.* tugdeck/src/components/tugways/tug-prompt-entry.* tugdeck/src/components/tugways/tug-transcript-entry.*` returns zero matches.
- Grep for any leftover gallery / mock / fixture references that may have crept into the production Tide path: `rg -i 'gallery|mock|fixture' tugdeck/src/components/tugways/cards/tide-card.* tugdeck/src/components/tugways/tug-transcript-entry.*` — review every match; remove if production, ignore if comment-as-history.
- All new components pass the component authoring guide checklist.
- All new tokens conform to the seven-slot naming convention.

**Verification:**
- The full check matrix above passes.
- The audit greps return clean results.

#### Step 23 — Tuglaws walkthrough {#step-23}

**Files:**
- `roadmap/tugplan-tide-card-polish.md` (this file — append the walkthrough to this section).
- Bug-fix touches as needed.

**Work:**
- Re-read [tuglaws.md](../tuglaws/tuglaws.md). Walk the Tide card surface law-by-law, focusing on:
  - **L01** — One `root.render()` at mount, ever.
  - **L02** — External state via `useSyncExternalStore` only.
  - **L03** — Registrations in `useLayoutEffect` for events that depend on them (e.g., the new focus / keybinding handlers from Steps 3–6).
  - **L06** — Appearance changes via CSS/DOM, not React state (relevant for the popup-overflow fix in Step 8 and the per-participant theming in Step 9).
  - **L07** — Action handlers access state via refs or stable singletons.
  - **L19** — Component authoring guide (relevant for `TugTranscriptEntry`).
  - **L22** — Store observers drive DOM writes directly (relevant for the transcript `code` rows in Step 11).
  - **L23** — User-visible state preserved across internal ops.
  - **L24** — State partitioned into appearance / local-data / structure zones.
- For each law: applies-and-satisfied, or does-not-apply (and why). Record the walkthrough below this section as a closing artifact (the same pattern as [Step 8 of T3.4.c](./archive/tugplan-tide-card.md#step-8)).
- Fix anything the walkthrough surfaces.

**Verification:**
- The walkthrough is recorded in this file, law-by-law.
- All earlier-step verifications still pass after any fixes from this step.

---

### Risks {#risks}

- **Step 6 (Cmd+J) leaks visual reach into Step 11 (transcript).** Cmd+J's "scroll to entry" branch only does anything once the transcript renders multiple entries. Mitigation: Step 6's Work section calls this out; the bottom-scroll fallback is useful immediately, and the entry-scroll branch becomes useful when Step 11 lands. No code change between steps 6 and 11 to wire them together.
- **Step 7 (atom line-heights) may surface engine work larger than one commit.** If the bisect reveals the bug is in `tug-text-engine.ts`'s line-box layout rather than just atom metrics, the work could grow. Mitigation: Step 7's Work section permits a "decide the minimum supported line-height" escape hatch; if 1.2 turns out to require a larger refactor, a documented intermediate floor (e.g., 1.4) ships in this step and the deeper work moves to a follow-up.
- **Step 8 (popup overflow) may need new primitives.** If `tug-popup-*` does not already support upward-opening + capped-height, the primitive extension lives in this step's commit. That can grow the commit; if the primitive change is itself non-trivial, split into "extend primitive" + "consume in completions" — two commits.
- **Step 9 (participant primitive) ships tokens for two participants we don't wire live in this plan.** `shell` and `command` rows exist in the gallery but do not appear in the live Tide transcript until Phases T4 and T10 respectively. Risk: the design choices for those participants are unconfirmed against real data. Mitigation: gallery uses realistic mock data; the token slots are meant to be tunable; nothing about Step 9 prevents Phase T4 / T10 from refining the participant's icon, identifier, or controls when the live wire arrives.
- **Step 9 design risk: bubble drift.** Even with [D6](#resolved-decisions) explicit, it is easy to slip toward a bubble-ish look (subtle backgrounds, rounded corners, alternating tinting). Mitigation: Step 9's verification includes an explicit visual review against D6, and the gallery card is the durable artifact future contributors can compare against.
- **Step 10 (session ledger placeholder) reads as done when it is merely designed.** The placeholder captures intent but ships no code; a reader skimming the step list might conclude the feature is landed. Mitigation: the Status and Promotion Gate paragraphs are explicit; the "Session ledger + resume UX" section of Success Criteria names the promoted plan as the exit criterion; the polish plan's top-matter calls out the placeholder nature. The plan is *not* fully closed until the promoted plan has shipped its own exit criteria.
- **Step 10's open design questions may not all resolve in one promotion pass.** Sqlite-vs-JSONL, CLI-flag-vs-CONTROL-round-trip, and `resume_failed` semantics are each load-bearing. Mitigation: promotion-pass plan enumerates each question and picks an answer; if a question cannot be resolved cheaply, the promoted plan's Strategy names the deferred sub-question and the step that revisits it.
- **Step 11 (transcript) interacts with `SmartScroll`.** The "scroll to bottom on new content unless the user has scrolled away" behavior should already be implemented by `SmartScroll`. If the Tide card's transcript needs different semantics than the existing consumers, the transcript rendering and the smart-scroll wire-up are coupled. Mitigation: Step 11's verification includes a manual scroll-away scenario.
- **Step 13 (thinking + tool surfaces) commits to a placement that Phase T1 must accept.** Choosing a placement T1 will replace defeats the point. Mitigation: Step 13's Work section names the chosen placement (default: inside the `code` row) and the rationale; T1 inherits or revises. Either is fine — the commitment is to a working surface, not a final design.
- **Step 15 (control_request_forward UI) is the largest feature commit in the plan (after the ledger's promoted plan).** It introduces a new component, a new snapshot field, and new frame-write paths. Mitigation: scope is "the minimum that closes the T3.4.d exit criterion" — Phase T9 picks up richer treatment.
- **Step 20 (typeahead jank) may not need a fix.** If the existing implementation is already jank-free at full-repo scale, the step ships as a profiled-and-documented no-op. That is acceptable; the verification still gates on the manual smoke.

---

### References {#references}

- [tide.md §T3.4.d — Polish & exit criteria](./tide.md#t3-4-d-polish-exit) — the source of the original work list.
- [tide.md §T3.4.c — Tide card](./tide.md#t3-4-c-tide-card) — the predecessor surface.
- [tugplan-tide-card.md](./archive/tugplan-tide-card.md) — the implementation that landed T3.4.c, including the deferrals this plan picks up (Step 5 transcript, Step 6 lastError, Step 8 tuglaws walkthrough pattern, Step 4.6 session ledger design sketch).
- [Step 4.6 of T3.4.c](./archive/tugplan-tide-card.md#step-4-6) — the session ledger design sketch carried forward into [Step 10](#step-10) of this plan.
- [Step 4.5 of T3.4.c](./archive/tugplan-tide-card.md#step-4-5) — the resume-vs-new picker whose storage Step 10 replaces.
- [Step 4.5.5 of T3.4.c](./archive/tugplan-tide-card.md#step-4-5-5) — the post-implementation audit whose findings Step 10 builds on.
- [Step 4m of T3.4.c](./archive/tugplan-tide-card.md#step-4m) — the recent-projects plumbing Step 10 must stay coherent with.
- [tide.md §T3.4.a — CodeSessionStore](./tide.md#code-session-store) — for snapshot fields, `streamingPaths`, `transcript`, `lastError`.
- [tide.md §Phase T1 — Content Block Types](./tide.md#content-block-types) — for the markdown / thinking / tool-use treatment that Step 12 and Step 13 coordinate with.
- [tide.md §Phase T4 — Shell Bridge (Tugshell)](./tide.md#shell-bridge) — provides the live data for `shell` participant rows whose primitive lands in Step 9.
- [tide.md §Phase T9 — Conversation Wiring](./tide.md#conversation-wiring) — for the richer permission / question UX that Step 15's minimum will be extended into.
- [tide.md §Phase T10 — Surface Built-Ins](./tide.md#surface-built-ins) — provides the live data for `command` participant rows whose primitive lands in Step 9.
- [tuglaws.md](../tuglaws/tuglaws.md) — the laws walked in Step 23.
- [Design Decisions](../tuglaws/design-decisions.md) — context for L02, L06, L22, L23, L24.
