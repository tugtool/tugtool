<!-- tugplan-skeleton v2 -->

## T3.4.d — Tide Card Polish & Exit Criteria {#tide-card-polish}

**Purpose:** Close out Phase T3 by working through the polish, ergonomics, and exit-criteria items folded into [tide.md §T3.4.d](./tide.md#t3-4-d-polish-exit). The Tide card landed in [T3.4.c](./archive/tugplan-tide-card.md) as a registered, functional surface that round-trips a single turn against real Claude. This plan picks that surface up and finishes it: the small-but-irritating ergonomic gaps (focus, labels, keyboard jumps), the layout bugs that show up the first time you open completions inside a small card, the participant-aware multi-turn transcript that the Step 5 wire-up deferred, and the larger feature-coverage / quality / a11y bars that gate Phase T3 exit.

The work is staged smallest-blast-radius first: each step is one commit, the build stays green at every commit, and the early steps are deliberately scoped so any of them could be cherry-picked without taking the rest. The big-ticket items (participant model, transcript rendering, permission/question UI) come later in the sequence, with the small ergonomic wins paying down user pain immediately.

This plan supersedes the bullet list under [tide.md §T3.4.d](./tide.md#t3-4-d-polish-exit) — same items (plus the participant model and explicit user-submission rendering added during plan authoring), ordered for execution and broken into commit-sized steps.

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

[T3.4.c](./archive/tugplan-tide-card.md) shipped the Tide card as a registered surface with a real `CodeSessionStore`, project picker, `spawn_session` / `close_session` lifecycle, per-workspace session-id ledger, resume-vs-new picker, fresh-spawn default, and a single-turn `TugMarkdownView` wire-up. Step 5 of that plan deliberately wired *only* `inflight.assistant` — multi-turn accumulation, thinking blocks, and tool surfaces were called out as T3.4.d follow-ups. The status badge in `tide-card.tsx:828` still hard-codes `"Project path /gallery/demo"` as a gallery-copy artifact. The card body inherits the polished ergonomics of `gallery-prompt-entry.tsx` but, when used as a *real* Claude surface (rather than a gallery demo), several small interaction gaps became obvious immediately:

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

The bigger items deferred from T3.4.c — multi-turn transcript rendering, thinking + tool surfaces, markdown styling pass, mid-stream behaviors E2E, `control_request_forward` UI — are all in scope here too. They land later in the sequence after the small ergonomic wins.

#### Strategy {#strategy}

- **Easy first.** The first eight steps are scoped so that a single commit per step is realistic: a string rename, a focus call, a key handler, a label swap. Each lands user-visible improvement immediately and does not need follow-on work to be useful. The deeper items (participant primitive, transcript, permission UI) come later.
- **Design before wire-up.** The participant model (Step 9) lands as a designed primitive in a gallery card *before* the transcript rendering step (Step 10) wires it into the live `CodeSessionStore`. That keeps the visual design tunable in isolation and the wiring step focused on data binding.
- **One commit per step.** Where a step might want to grow (transcript, atom line-heights, participant primitive), the step's Work section calls out the minimal viable shape and defers richer treatment to a noted follow-up rather than expanding the commit.
- **Build stays green at every commit.** `bun run check`, `bun test`, `bun run audit:tokens lint`, and `cargo nextest run` pass on every step. `-D warnings` enforced.
- **No new IndexedDB.** Per [D-T3-10](./tide.md#decisions-t3). Any persistence goes through tugbank.
- **Tuglaws apply.** Every step that touches `tide-card.tsx`, `tug-prompt-entry.tsx`, the new transcript primitive, or new helpers re-checks against [tuglaws.md](../tuglaws/tuglaws.md). The closing step records a walkthrough.
- **Reuse the existing surfaces.** Focus / keybinding work threads through the existing `TugPromptEntryDelegate` handle and `ResponderScope`. Transcript rendering uses `TugMarkdownView`'s imperative `setRegion` handle (already in use for the streaming region), now plugged into the new `TugTranscriptEntry` body slot. Permission / question UI uses the existing CONTROL frame plumbing — no new transport.
- **Defer P2-gated multi-session work to its own step.** Two concurrent Tide cards already work post-[4k](./archive/tugplan-tide-card.md#step-4k); the multi-session *exit criterion* in tide.md §T3.4.d is about formalizing the verification, not building new infrastructure. It rides as a late step.
- **Manual smoke at every behaviorally-visible step.** Where a step ships a new interaction (focus, keybinding, transcript rendering, participant rendering), the verification includes a manual scenario the user can walk through in the running tugdeck.

#### Success Criteria (Measurable) {#success-criteria}

**Ergonomics:**
- Opening a Tide card focuses the prompt input directly; the user can type immediately. (verification: manual + test)
- After submitting a turn, focus returns to the prompt input. (verification: manual + test)
- With a Tide card active and the prompt input not focused, pressing Tab or Cmd+K places a blinking caret in the prompt input. (verification: manual + test)
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
- Auto-focus on card mount; auto-refocus after submit.
- Card-level keybindings: Tab and Cmd+K → focus prompt; Cmd+J → jump transcript.
- Completion popup overflow / clipping fix.
- Atom rendering at tighter line-heights.
- Participant model + `TugTranscriptEntry` primitive (Slack-like layout, no chat bubbles), with gallery demo.
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
- Live `shell` and `command` participant rows in the transcript — the primitive supports them and the gallery demos them, but the live wires arrive with Phase T4 (tugshell) and Phase T10 (`:` surface built-ins) respectively. This plan only wires `user` and `code` rows to live data.
- `BuildStatusCollector` per-workspace ([tide.md line 2102](./tide.md#prefix-router-prompt-input)).
- Claude `--resume` (P14) and stream-json version gate (P15) — separate plans.
- P2 multi-session router work — landed independently; this plan's multi-session step exercises whatever the router state is at landing time.
- Image attachments (U15) — Phase T11.
- Subagent activity display (U8) — Phase T9.

#### Resolved Decisions {#resolved-decisions}

- **D1 — Route label.** `Code`. Decided by the user in this plan's authoring conversation. Rationale: "Prompt" describes the input control, not what the route *is*; "Code" reflects the assistant's purpose and keeps "Claude" out of the chrome. `>` and `❯` continue to route to it.
- **D2 — Cwd presentation.** Replace the gallery string with the bound `projectDir` rendered into the existing `TugBadge`. Shortening / icon variants are a follow-up (Step 1 ships the literal string; later cosmetic refinement is not blocked here).
- **D3 — Tab vs Cmd+K.** Both focus the prompt input. Cmd+K is the canonical "focus the prompt" gesture; Tab is the keyboard-first user's shortcut from card chrome into the entry. The card swallows Tab only when the prompt is *not* already focused; once focused, Tab returns to the editor's normal Tab-handling.
- **D4 — Cmd+J semantics.** With a history entry navigated to in the prompt-entry, Cmd+J scrolls the transcript to that entry's location. With no history selection, Cmd+J behaves like End / Cmd+Down: scroll to bottom.
- **D5 — Atom line-height target.** Tighter than 1.7 must work without baseline jump. Concrete minimum decided in [Step 7](#step-7) once the engine work surfaces the constraint.
- **D6 — Participant model is Slack-like, *not* chat bubbles.** Decided by the user during plan authoring. Rationale: chat bubbles are wrong for a developer surface that mixes human, AI, shell, and command output — alternating sides and rounded backgrounds make a transcript hard to scan. Layout: left-aligned icon column (~32–40px), then a content column with a header row (bold identifier + small timestamp), then the body, then an optional controls/badges/icons strip beneath the body. Initial participants: `user`, `code` (Claude Code), `shell` (post-T4), `command` (post-T10). The model is open for extension via a token registration, not a code rewrite. No avatar photos; participant icons are glyphs/marks.

---

### Steps {#steps}

Each step is its own commit. `bun run check`, `bun test`, `bun run audit:tokens lint`, and `cargo nextest run` pass at the end of every step.

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

#### Step 3 — Auto-focus the prompt input on card mount {#step-3}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (post-mount focus effect).
- `tugdeck/src/components/tugways/tug-prompt-entry.tsx` (confirm `TugPromptEntryDelegate` exposes a `focus()` method; add if missing).

**Work:**
- Confirm `TugPromptEntryDelegate` has a `focus(): void` method that places the caret in the editor. If absent, add it — its body delegates to the underlying `TugPromptInput`'s focus path.
- In `TideCardContent`, add a `useLayoutEffect` (after `services` is non-null and `entryDelegateRef.current` is bound) that calls `entryDelegateRef.current?.focus()` once. The effect's deps gate it on the binding becoming non-null, so the focus fires when the picker disappears and the entry first mounts.
- One-frame caveat: if the delegate is not yet bound on the first commit, the effect re-runs on the next commit when the ref attaches. Document the gate.

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- New test: render `<TideCardContent cardId="t1" />` against a fake binding → assert the prompt input receives focus (e.g., `document.activeElement === <textarea-or-equivalent>`).
- Manual: open a Tide card with a chosen project path; observe the caret blinking in the prompt input without a click; type immediately.

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

#### Step 5 — Tab and Cmd+K focus the prompt input from card chrome {#step-5}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (card-level key handler).

**Work:**
- Add a card-level `keydown` handler (on the `tide-card` root or via the existing `ResponderScope`) that intercepts Tab and Cmd+K when the prompt input is *not* the active element, calling `entryDelegateRef.current?.focus()` and `event.preventDefault()`. When the prompt input *is* already focused, the handler is a no-op so the editor's normal Tab handling runs.
- Determine "prompt is focused" via the editor's existing focused-state ref or `document.activeElement` check — pick whichever is already canonical in the codebase.
- Cmd+K: also call `event.preventDefault()` to avoid any browser default (Safari focuses the address bar; we are inside the app so this is mostly defensive).

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- New test: render a Tide card → focus an arbitrary element in the card chrome (e.g., the maximize button) → simulate Tab keydown → assert prompt input gains focus. Repeat with Cmd+K.
- Manual: open a Tide card, click into the maximize button (focus chrome), press Tab → caret in prompt input. Click chrome again, press Cmd+K → same.

#### Step 6 — Cmd+J jumps the transcript {#step-6}

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

> **Step 6 depends on [Step 10](#step-10)'s transcript rendering** for the "scroll to a transcript region" path to do anything visible. Until Step 10 lands, the bottom-scroll fallback is the only branch with user-visible effect. Both branches still ship in this commit so the keybinding is not split across two commits — the second branch becomes useful when Step 10 lands.

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

*Gallery card.* Build `gallery-transcript-entry` that stacks all four participant variants with realistic content: a `user` row reading "> tell me a haiku", a `code` row with a streaming-style markdown response and a copy button + model badge, a `shell` row with mock `git status` output and an exit-code badge, a `command` row with `:cost` output. Lets the design be tuned in isolation before [Step 10](#step-10) wires it into live data.

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- New unit test: render `TugTranscriptEntry` with each participant variant; snapshot the DOM structure (icon column + content column with header / body / controls rows).
- `bun run audit:tokens lint` exits 0; new tokens conform to seven-slot naming.
- Visual review against [D6](#resolved-decisions): no rounded per-row container, no bubble background, no left-vs-right alignment by speaker, identifier + timestamp on top of body.
- Manual: open `gallery-transcript-entry` in tugdeck; all four variants render with distinct icons / identifiers; vertical rhythm reads cleanly top-to-bottom.

**Out of scope (deferred to [Step 10](#step-10) and later phases):**
- Wiring into the live `CodeSessionStore` transcript — that's [Step 10](#step-10).
- Live `shell` rows — needs Phase T4 (tugshell) data. Gallery uses mock data for now.
- Live `command` rows — needs Phase T10 (`:` surface built-ins) data. Gallery uses mock data for now.
- Per-row reactions, threading, or message editing — Slack borrowings stop at the visual structure.

#### Step 10 — Multi-turn transcript rendering with `TugTranscriptEntry` {#step-10}

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

#### Step 11 — Markdown styling pass for assistant output {#step-11}

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

#### Step 12 — Wire thinking + tool surfaces {#step-12}

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

#### Step 13 — Mid-stream behaviors end-to-end (Stop, queued sends, tool sub-state) {#step-13}

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

#### Step 14 — `control_request_forward` UI (permission + question) {#step-14}

**Files:**
- `tugdeck/src/components/tugways/cards/tide-card.tsx` (mount the dialog component when a snapshot field carries a `control_request_forward`).
- A new component (e.g., `tugdeck/src/components/tugways/tide-control-request.tsx`) for the dialog body.
- Tests.

**Work:**
- Surface `control_request_forward` events as inline blocks inside the in-flight `code` row (consistent with the transcript style from Step 10; not a modal). Two variants:
  - `is_question: false` — permission block. Displays tool name, input, reason. Allow / deny buttons. Approving writes a `tool_approval` frame; denying does the same with the inverse decision. The turn resumes from the decision.
  - `is_question: true` — question block. Renders the question + options (single-select or multi-select per the payload). Submitting writes a `question_answer` frame.
- Keyboard: arrow keys move selection within the block; Enter submits; Esc cancels (cancel = deny / dismiss).
- Snapshot wiring: `CodeSessionStore` already exposes the inflight `control_request_forward` state; Tide card consumes it from the snapshot and renders the block in the `code` row's body for the in-flight turn.
- Phase T9 (Conversation Wiring) will iterate on the richer permission / question UX (suggestions for "always allow," etc.); this step ships the minimum that closes the T3.4.d exit criterion.

**Verification:**
- `bun x tsc --noEmit` + `bun test` green.
- New tests: render Tide card with a fixture `control_request_forward` (both variants); assert the block renders with correct fields; simulate Allow → assert `tool_approval` frame sent; simulate Deny → frame sent; simulate question Answer → `question_answer` frame sent.
- Manual smoke against live Claude: prompt that requires permission (e.g., a Bash invocation in plan mode) → permission block appears; allow → tool runs. Use `AskUserQuestion` similarly.

#### Step 15 — Feature coverage: route prefixes, indicator sync, completions, history {#step-15}

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
- Where a test exposes a real bug, fix it in the same commit (or, if the bug is large enough to warrant its own commit, split into a follow-up step before [Step 22](#step-22)).

**Verification:**
- `bun x tsc --noEmit` + `bun test` green; new tests exercise each criterion.
- Manual: walk the criteria interactively in a running Tide card.

#### Step 16 — CJK end-to-end {#step-16}

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

#### Step 17 — VoiceOver / a11y pass {#step-17}

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

#### Step 18 — Atom drag-and-drop from Finder {#step-18}

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

#### Step 19 — Typeahead jank profiling {#step-19}

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

#### Step 20 — Concurrent Tide cards regression test {#step-20}

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

#### Step 21 — Compliance close-out {#step-21}

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

#### Step 22 — Tuglaws walkthrough {#step-22}

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
  - **L22** — Store observers drive DOM writes directly (relevant for the transcript `code` rows in Step 10).
  - **L23** — User-visible state preserved across internal ops.
  - **L24** — State partitioned into appearance / local-data / structure zones.
- For each law: applies-and-satisfied, or does-not-apply (and why). Record the walkthrough below this section as a closing artifact (the same pattern as [Step 8 of T3.4.c](./archive/tugplan-tide-card.md#step-8)).
- Fix anything the walkthrough surfaces.

**Verification:**
- The walkthrough is recorded in this file, law-by-law.
- All earlier-step verifications still pass after any fixes from this step.

---

### Risks {#risks}

- **Step 6 (Cmd+J) leaks visual reach into Step 10 (transcript).** Cmd+J's "scroll to entry" branch only does anything once the transcript renders multiple entries. Mitigation: Step 6's Work section calls this out; the bottom-scroll fallback is useful immediately, and the entry-scroll branch becomes useful when Step 10 lands. No code change between steps 6 and 10 to wire them together.
- **Step 7 (atom line-heights) may surface engine work larger than one commit.** If the bisect reveals the bug is in `tug-text-engine.ts`'s line-box layout rather than just atom metrics, the work could grow. Mitigation: Step 7's Work section permits a "decide the minimum supported line-height" escape hatch; if 1.2 turns out to require a larger refactor, a documented intermediate floor (e.g., 1.4) ships in this step and the deeper work moves to a follow-up.
- **Step 8 (popup overflow) may need new primitives.** If `tug-popup-*` does not already support upward-opening + capped-height, the primitive extension lives in this step's commit. That can grow the commit; if the primitive change is itself non-trivial, split into "extend primitive" + "consume in completions" — two commits.
- **Step 9 (participant primitive) ships tokens for two participants we don't wire live in this plan.** `shell` and `command` rows exist in the gallery but do not appear in the live Tide transcript until Phases T4 and T10 respectively. Risk: the design choices for those participants are unconfirmed against real data. Mitigation: gallery uses realistic mock data; the token slots are meant to be tunable; nothing about Step 9 prevents Phase T4 / T10 from refining the participant's icon, identifier, or controls when the live wire arrives.
- **Step 9 design risk: bubble drift.** Even with [D6](#resolved-decisions) explicit, it is easy to slip toward a bubble-ish look (subtle backgrounds, rounded corners, alternating tinting). Mitigation: Step 9's verification includes an explicit visual review against D6, and the gallery card is the durable artifact future contributors can compare against.
- **Step 10 (transcript) interacts with `SmartScroll`.** The "scroll to bottom on new content unless the user has scrolled away" behavior should already be implemented by `SmartScroll`. If the Tide card's transcript needs different semantics than the existing consumers, the transcript rendering and the smart-scroll wire-up are coupled. Mitigation: Step 10's verification includes a manual scroll-away scenario.
- **Step 12 (thinking + tool surfaces) commits to a placement that Phase T1 must accept.** Choosing a placement T1 will replace defeats the point. Mitigation: Step 12's Work section names the chosen placement (default: inside the `code` row) and the rationale; T1 inherits or revises. Either is fine — the commitment is to a working surface, not a final design.
- **Step 14 (control_request_forward UI) is the largest feature commit in the plan.** It introduces a new component, a new snapshot field, and new frame-write paths. Mitigation: scope is "the minimum that closes the T3.4.d exit criterion" — Phase T9 picks up richer treatment.
- **Step 19 (typeahead jank) may not need a fix.** If the existing implementation is already jank-free at full-repo scale, the step ships as a profiled-and-documented no-op. That is acceptable; the verification still gates on the manual smoke.

---

### References {#references}

- [tide.md §T3.4.d — Polish & exit criteria](./tide.md#t3-4-d-polish-exit) — the source of the original work list.
- [tide.md §T3.4.c — Tide card](./tide.md#t3-4-c-tide-card) — the predecessor surface.
- [tugplan-tide-card.md](./archive/tugplan-tide-card.md) — the implementation that landed T3.4.c, including the deferrals this plan picks up (Step 5 transcript, Step 6 lastError, Step 8 tuglaws walkthrough pattern).
- [tide.md §T3.4.a — CodeSessionStore](./tide.md#code-session-store) — for snapshot fields, `streamingPaths`, `transcript`, `lastError`.
- [tide.md §Phase T1 — Content Block Types](./tide.md#content-block-types) — for the markdown / thinking / tool-use treatment that Step 11 and Step 12 coordinate with.
- [tide.md §Phase T4 — Shell Bridge (Tugshell)](./tide.md#shell-bridge) — provides the live data for `shell` participant rows whose primitive lands in Step 9.
- [tide.md §Phase T9 — Conversation Wiring](./tide.md#conversation-wiring) — for the richer permission / question UX that Step 14's minimum will be extended into.
- [tide.md §Phase T10 — Surface Built-Ins](./tide.md#surface-built-ins) — provides the live data for `command` participant rows whose primitive lands in Step 9.
- [tuglaws.md](../tuglaws/tuglaws.md) — the laws walked in Step 22.
- [Design Decisions](../tuglaws/design-decisions.md) — context for L02, L06, L22, L23, L24.
