<!-- tugplan v2 -->

## Tide Interactive Dialogs {#tide-interactive-dialogs}

**Purpose:** Establish a `TideInteractiveDialog` **input-form primitive** that `PermissionDialog` and `QuestionDialog` both compose on; rename `session.peelNewest()` to `session.popInteractive()` and update every callsite; replace the weak "wrapper" prose with the precise "tool block" concept; lock in the lifecycle (pending / resolved / recorded) and cancel-gesture vocabulary across the family. The asymmetry between `PermissionDialog` (the dialog owns the entire record) and `AskUserQuestion` (input dialog + transcript-position tool block) is **load-bearing and grounded in the SDK's transport model** — this plan names it honestly rather than forcing unification.

---

### Plan Metadata {#plan-metadata}

| Field | Value |
|------|-------|
| Owner | Ken Kocienda |
| Status | draft |
| Target branch | main |
| Last updated | 2026-05-23 |

---

### Phase Overview {#phase-overview}

#### Context {#context}

Tide today has two interactive transcript surfaces, and JSONL-transcript investigation (see `#investigation-asymmetry`) confirmed they are **structurally different artifacts** sharing only visual vocabulary:

1. **`PermissionDialog`** (`chrome/tide-permission-dialog.tsx`) — *out-of-band SDK control request*. The AI never sees the user's Allow/Deny decision in its conversation context. The dialog is the **entire record** — pending → resolved → recorded all live in one component because nothing else holds them. Composes on `TugInlineDialog`. `Deny` is a *positive decision* (sends `respondApproval({decision: "deny"})`), not a cancel.

2. **`QuestionDialog`** + **`AskUserQuestionToolBlock`** (`chrome/tide-question-dialog.tsx`, `cards/tool-wrappers/ask-user-question-tool-block.tsx`) — *in-band tool_use/tool_result*. The AI sees the user's answers naturally via the tool_result text content (e.g., `"User has answered your questions: 'Q?'='A'. You can now continue..."`). The dialog is the **input form** (pending state, sticky/floating, scroll-agnostic); the tool block is the **rendered representation** of the tool_use/tool_result pair at its natural conversation position. The split exists because the input form needs to be visible regardless of scroll, while the record lives where the tool_use lives.

Beyond those two surfaces, the recent AskUserQuestion deep-dive (paged wizard rail, lucide-icon vocabulary, `TugProgress` `inherit` role, salvage path, Cancel-Esc unification) produced a stack of one-off decisions that need to harmonise as a family.

#### Strategy {#strategy}

- **Stop fighting the asymmetry.** `TideInteractiveDialog` is the **input-form primitive** — it covers PermissionDialog's pending state and QuestionDialog's pending state. PermissionDialog continues to render its own resolved/recorded states because nothing else can; AskUserQuestion's tool block continues to render its tool_use/tool_result pair because that's where it naturally lives. See `[D08]`.
- **Rename `peelNewest` → `popInteractive`.** The function name should reflect the family it serves (interactive dialogs) and the LIFO stack mechanics (`pop` from a stack of pending interactives). See `[D09]`. Step 0 lands the rename first so every subsequent step writes the new name from the start.
- **Replace "wrapper" with "tool block" in prose.** The `*ToolBlock` components already use the right noun; the conceptual fuzziness is in calling them "wrappers" when they're really *renderers* of tool_use/tool_result pairs at their conversation positions. See `[D11]`.
- **Lock the lifecycle vocabulary.** `pending` / `resolved` / `recorded` — used consistently across docs, doc-comments, and tests. See `[D12]`. PermissionDialog uses all three; AskUserQuestion's dialog has only `pending` (the resolved/recorded state is the tool block at the tool_use position).
- **Esc / Cancel / Stop is one gesture.** Every cancel-class action resolves to `session.popInteractive()`. No `respondX({})` paths from a Cancel — those read to the model as "user picked the defaults" and are wrong. See `[D02]`.
- **Tests pin pure helpers; HMR vets the visual chrome.** Per project policy. No fake-DOM render tests.

#### Success Criteria (Measurable) {#success-criteria}

- `session.popInteractive()` exists; `session.peelNewest()` does not. Verified by `grep -r peelNewest tugdeck/src` returning zero results.
- Both interactive dialog surfaces compose on `TideInteractiveDialog` — verified by `grep` over `chrome/tide-permission-dialog.tsx` / `chrome/tide-question-dialog.tsx` for `TideInteractiveDialog` imports (no direct `TugInlineDialog` import in either).
- `Cancel` button on QuestionDialog calls `session.popInteractive()` — verified by `grep` + tests pinning the handler. (Salvage UI's `Cancel` is exempt per the `[D02]` carve-out; it stays on local-dismiss.)
- `tide-question-dialog.test.ts` and `tide-permission-dialog.test.ts` both pass post-migration without structural changes to existing assertions (semantics-preserving refactor).
- `bun test` clean across the full suite (≥ 2576 cases, no regressions).
- `bun run audit:tokens lint` → zero violations.
- `bun x tsc --noEmit` → clean.
- Salvage path (AskUserQuestion only) continues to detect validation errors and post answers via `session.send` — pure helper tests still green.
- Prose audit: no instance of "wrapper" used to describe `*ToolBlock` components in tugdeck docstrings / doc-comments after Step 4.

#### Scope {#scope}

0. Rename `session.peelNewest()` → `session.popInteractive()` and update every callsite.
1. Extract `TideInteractiveDialog` input-form primitive at `tugways/tide-interactive-dialog.tsx` (+ `.css`).
2. Migrate `PermissionDialog` onto `TideInteractiveDialog`. Preserve all current behaviour (live ↔ resolved-record state machine, scope picker, history record).
3. Migrate `QuestionDialog` onto `TideInteractiveDialog`. Preserve wizard rail, auto-advance, layout stability, Cancel == `popInteractive`.
4. Review `AskUserQuestionToolBlock` against the family vocabulary; align icons / progress indicators / banner tokens. Replace "wrapper" with "tool block" in tugdeck prose (docstrings, doc-comments).
5. Final integration checkpoint: pure-logic suite green, tsc green, audit-tokens lint clean, HMR-vetted live flows on both surfaces.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Recording AskUserQuestion answers into `turn.controlRequests[]`. Questions stay in-band per `[DT07]` — the tool_use/tool_result pair already IS the recorded state. The tool block is the user-visible representation of that pair.
- Generalising the salvage path (post-validation-error answer recovery) to other tools. Salvage is `AskUserQuestion`-only — Bash / Edit / etc. validation errors continue to fall back to `DefaultToolWrapper`'s generic error band.
- Renaming `ToolWrapperChrome` / `DefaultToolWrapper` files or component names — see `[Q06]`. Prose cleanup happens here; component-file renames are a follow-on.
- Inlining the QuestionDialog at its tool_use conversation position (Path 2 from the design discussion). The sticky/floating placement is preserved — the dialog needs to be visible regardless of scroll. See `[D08]` for the rationale.
- Replacing `TugInlineDialog`. It stays as the lower-level primitive that `TideInteractiveDialog` composes on; non-interactive callsites (one-shot alerts, confirm prompts) keep using `TugInlineDialog` directly.
- Building a "salvage UI standard." Keep the AskUserQuestion-specific surface as-is.

#### Dependencies / Prerequisites {#dependencies}

- The just-landed AskUserQuestion work (commits `77f6b7c6` / `8dd1d7ae`): paged wizard, validation salvage, Cancel → `peelNewest`. This plan refines and harmonises that work — it does not redo it. Step 0 catches the recent `peelNewest` callsite that landed in `8dd1d7ae`.
- `session.peelNewest()` semantics (`code-session-store.ts:603`): LIFO peel queued sends, fall through to `interrupt()` for the running turn. The rename is name-only; semantics are unchanged.
- `TugInlineDialog`'s `confirmDisabled` + `cancelRole` props (landed earlier this session).
- `TugProgress` `inherit` role (landed this session). The salvage path and any in-flight indicators rely on it for tone-correct rendering.

#### Constraints {#constraints}

- The rename (Step 0) must be exhaustive — zero `peelNewest` references after the step. Mechanical search-and-replace plus test updates; no semantics change.
- The migration must be **behaviour-preserving** for `PermissionDialog`'s existing pending ↔ resolved ↔ recorded state transitions. No regressions to scope picker, history recording, or the resolved-record expand affordance.
- The migration must be **behaviour-preserving** for `QuestionDialog`'s wizard rail — including layout-stability measurement, auto-advance on single-select, `confirmDisabled` gating on the Submit-all button.
- All existing `tide-permission-dialog.test.ts` and `tide-question-dialog.test.ts` assertions must continue to pass after migration. New tests may be added; existing ones must not be silently modified.
- No new tokens introduced unless they replace a duplicated definition across the two surfaces.

#### Assumptions {#assumptions}

- `TugInlineDialog` is the right base layer to compose on. We are not redesigning the underlying primitive.
- The architectural asymmetry between PermissionDialog and AskUserQuestion is load-bearing (confirmed by JSONL investigation — see `#investigation-asymmetry`). Plans that try to force unification fight the SDK's transport model.
- The user accepts a phase that lifts a primitive and renames a function without adding net-new user-visible functionality. The user-visible outcome is "everything reads more consistent and is less likely to drift."

---

### Reference and Anchor Conventions (MANDATORY) {#reference-conventions}

This plan format relies on **explicit, named anchors** and **rich `References:` lines** in execution steps.

#### 1) Use explicit anchors everywhere you will cite later

- Append explicit anchors with `{#anchor-name}` (kebab-case, lowercase a-z + digits + hyphen only).
- Prefix conventions: `step-N`, `dNN-...`, `qNN-...`, `rNN-...`, `lNN-...`, `mNN-...`, `sNN-...`.

#### 2) `**Depends on:**` lines for execution step dependencies

Anchor references (`#step-N`), comma-separated. Omit the line for steps with no dependencies.

#### 3) `**References:**` lines are required for every execution step

Cite decisions by ID (`[D05]`), specs / lists / tables by label (`Spec S15`, `List L03`), open questions when resolved (`[Q03]`), and anchors as `#anchor-name`. Never cite line numbers.

---

### Open Questions (MUST RESOLVE OR EXPLICITLY DEFER) {#open-questions}

#### [Q01] What does the `TideInteractiveDialog` primitive own vs delegate to `TugInlineDialog`? (RESOLVED) {#q01-primitive-boundary}

**Question:** Where does the boundary sit? Thin wrapper / lifecycle owner / lifecycle + session integration?

**Resolution:** RESOLVED — `TideInteractiveDialog` is the **input-form primitive** (thin wrapper variant). It owns the *pending input form* defaults (`cancelRole: "danger"`, `actions row: space-between`, `Esc / Cancel → popInteractive`) and nothing more. It does NOT own lifecycle transitions (pending → resolved → recorded). PermissionDialog owns its own lifecycle because the SDK has no native record to delegate to. AskUserQuestion's lifecycle is split across the dialog (pending) and the tool block (the rendered tool_use/tool_result pair) — the dialog primitive only ever sees the pending state. See `[D08]`.

#### [Q02] Should QuestionDialog gain a `turn.controlRequests` record like PermissionDialog has? (RESOLVED) {#q02-question-history}

**Question:** Today PermissionDialog persists decisions in `turn.controlRequests[]`. AskUserQuestion doesn't. Should we add one?

**Resolution:** RESOLVED (no). The investigation confirmed AskUserQuestion's answers round-trip via tool_use/tool_result — the conversation context already contains the record. The tool block IS the rendered representation of that record. Adding a parallel `turn.controlRequests[]` entry would duplicate state that the conversation already holds. The asymmetry between the two surfaces is architectural per `[D10]`, not a problem to solve. See `#investigation-asymmetry` for the JSONL evidence.

#### [Q03] Cancel button vocabulary on PermissionDialog — is `Deny` the cancel, or a separate Cancel button? (RESOLVED) {#q03-cancel-vocab}

**Question:** Today PermissionDialog uses `Deny` as a *positive decision* (`respondApproval({decision: "deny"})`), distinct from `popInteractive`. QuestionDialog uses `Cancel` (outlined-danger, `popInteractive`). Should PermissionDialog gain a separate `Cancel` button alongside `Deny`, or stay with `Deny` only and surface `popInteractive` via Esc?

**Why it matters:** `Cancel ≡ Esc ≡ popInteractive` is the family rule. If `Deny` is semantically the cancel, it should call `popInteractive`. If they're different, the dialog needs both buttons.

**Resolution:** RESOLVED — keep `Deny` as a positive decision (sends `respondApproval({decision: "deny"})`); surface `popInteractive` via Esc only. No separate `Cancel` button on PermissionDialog. The pending dialog passes `cancelRole="action"` to opt out of the family danger-tone default. Verified by HMR in Step 2: Allow / Deny paths and the recorded state render correctly; the family `space-between` actions-row layout reads as Mac HIG opposed-choices. Documented as a carve-out in `[D02]` and the `code-session-store.ts` `popInteractive` docstring.

#### [Q05] Should the salvage path live inside `TideInteractiveDialog`? (DEFERRED) {#q05-salvage-primitive}

**Question:** The validation-error salvage path is AskUserQuestion-only. The pattern — wrapper detects an error, mounts an inline recovery UI, posts a follow-up via `session.send` — is reusable. Worth hoisting?

**Resolution:** DEFERRED. Keep component-local in `AskUserQuestionToolBlock` per the user's direction. Revisit when a second concrete callsite emerges.

#### [Q06] Should `ToolWrapperChrome` / `DefaultToolWrapper` be renamed to `ToolBlockChrome` / `DefaultToolBlock`? (DEFERRED) {#q06-tool-wrapper-rename}

**Question:** `[D11]` deprecates "wrapper" in prose, but two component files keep the word in their names: `ToolWrapperChrome` (the shared frame) and `DefaultToolWrapper` (fallback for unrecognised tools). Should they be renamed for consistency?

**Why it matters:** Internal consistency. After the prose cleanup in Step 4, readers will see "tool block" in docs and "ToolWrapper*" in code, which is a small but persistent friction.

**Plan to resolve:** DEFERRED to a follow-on refactor. The rename touches many import sites and is mechanical; this plan focuses on the primitive extraction and prose cleanup. Track as a follow-on item.

**Resolution:** DEFERRED.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| `peelNewest` rename misses a callsite, breaks Cancel/Esc/Stop | high | low | `grep -r peelNewest` after rename; integration HMR pass on prompt entry, both dialogs, salvage UI | First HMR run after Step 0 |
| Migration regresses PermissionDialog's pending ↔ resolved transition | high | med | Pin existing tests; HMR-vet against a real permission prompt | First HMR run after Step 2 |
| QuestionDialog's measurement-based layout-stability breaks after refactor | med | low | Keep the measurement helper in QuestionDialog (not the primitive); migration only swaps the outer chrome | Visible layout shift on Next/Back |
| The new primitive accumulates "yet another opinionated wrapper" without clear cuts vs. `TugInlineDialog` | med | low | `[D08]` pins the boundary: input-form only, no lifecycle ownership. Anything outside that is a follow-on | Step 1 PR review |
| Cancel == `popInteractive` confuses the model in PermissionDialog (today `Deny` is the positive decision) | med | low | This plan intentionally does NOT change PermissionDialog's `Deny` semantics — `[Q03]` surfaces the choice; default is "keep Deny" | If `[Q03]` flips |

**Risk R01: TugInlineDialog tests drift** {#r01-inline-dialog-tests}

- **Risk:** Hoisting opinionated defaults into a new primitive may inadvertently change `TugInlineDialog`'s prop defaults (since `TideInteractiveDialog` configures it).
- **Mitigation:** `TugInlineDialog` is not modified by this plan. The new primitive composes on top via call-site defaults, not by editing `TugInlineDialog`'s defaults.
- **Residual risk:** Anyone reading `tide-permission-dialog.tsx` post-migration has to follow two layers (`PermissionDialog → TideInteractiveDialog → TugInlineDialog`) to understand the final rendered chrome. Mitigated by the doc-strings on `TideInteractiveDialog`.

**Risk R02: Doc/code drift between asymmetry framing and reality** {#r02-asymmetry-drift}

- **Risk:** The asymmetry framing in `[D10]` is grounded in JSONL evidence captured at plan-write time. If Claude Code's SDK changes how permission frames are delivered (e.g., adds an AI-visible record), the framing breaks.
- **Mitigation:** Step 5's integration checkpoint includes a quick re-grep of the SDK frame shapes to confirm the asymmetry still holds.
- **Residual risk:** Low; SDK shape is stable.

---

### Design Decisions {#design-decisions}

> Record *decisions* (not options). Each decision includes the "why" so later phases don't reopen it accidentally.

#### [D01] `TideInteractiveDialog` is a new primitive that composes on `TugInlineDialog` (DECIDED) {#d01-new-primitive-on-tug-inline-dialog}

**Decision:** Introduce `tugways/tide-interactive-dialog.tsx` as a Tide-specific composition layer on top of `TugInlineDialog`. The two existing dialog callsites (`PermissionDialog`, `QuestionDialog`) migrate onto it. `TugInlineDialog` is not modified.

**Rationale:**
- `TugInlineDialog` is general-purpose; baking the input-form opinions (Cancel-Esc-popInteractive, danger-toned outlined cancel, Mac-HIG separation, `confirmDisabled` gating) into it would push those defaults onto non-interactive callsites (alerts, single-confirm prompts) that shouldn't carry them.
- A Tide-specific layer keeps the opinions in one place — every interactive input form in Tide composes on the same shell.
- The boundary is clean: `TugInlineDialog` owns the visible chrome (frame, icon column, title/description, options stack, actions row); `TideInteractiveDialog` owns the Tide opinions (button vocabulary, cancel convention, `confirmDisabled` default).

**Implications:**
- New file pair: `tugways/tide-interactive-dialog.{tsx,css}`.
- `PermissionDialog`, `QuestionDialog` swap their `TugInlineDialog` import for `TideInteractiveDialog`.
- `TugInlineDialog` keeps every existing prop unchanged.

#### [D02] Cancel ≡ Esc ≡ `popInteractive` across the family (DECIDED) {#d02-cancel-equals-esc-equals-popinteractive}

**Decision:** Every interactive surface's cancel gesture — button click, Esc keypress, Stop-button click — resolves to `session.popInteractive()`. No `respondX({})` paths that the assistant can read as "user picked the defaults."

**Rationale:**
- Validated this session: AskUserQuestion's `respondQuestion({})` cancel was read by the model as "user accepts the defaults," which was wrong.
- `popInteractive` is the unified pop-from-LIFO-stack gesture; it handles queued sends LIFO and falls through to `interrupt()` for the running turn.
- One gesture, one wire signal, one model reading.

**Implications:**
- QuestionDialog's `Cancel` button calls `session.popInteractive()`.
- Esc keeps reaching `popInteractive` through the responder chain (no per-dialog Esc handler).

**Carve-outs** (gestures that look like "cancel" but are *not* part of this rule):
- **PermissionDialog's `Deny` button** — a *positive decision* via `respondApproval({decision: "deny"})`, not a walk-away. See `[Q03]`.
- **AskUserQuestionToolBlock salvage UI's `Cancel` button** — a *local dismissal* of the recovery surface. The failed AskUserQuestion tool call has already resolved with an error before the salvage UI mounts; there is no pending interactive on the stack to pop. Calling `popInteractive` here would either no-op (empty queue) or interrupt an unrelated running turn — both wrong. The salvage Cancel uses local React state (`setSalvageCancelled(true)`) and stays that way.

#### [D03] Cancel button visual: outlined + danger, leading edge, Mac-HIG separation (DECIDED) {#d03-cancel-button-visual}

**Decision:** When an interactive surface renders a Cancel button, it uses:
- `emphasis="outlined"`, `role="danger"`,
- Leading edge of the actions row (Mac HIG `Don't Save` position),
- `justify-content: space-between` so Cancel and the primary action anchor opposite edges.

**Rationale:**
- Cancel is destructive-secondary (walk away from this), distinct from the primary action.
- Mac HIG separation makes the two choices read as opposed rather than as a tightly-grouped pair.
- Already in place on QuestionDialog; the primitive lifts it as the family default.

**Implications:**
- `TideInteractiveDialog` defaults `cancelRole` to `"danger"`.
- `TideInteractiveDialog`'s actions row uses `space-between` layout.
- PermissionDialog's `Deny` already uses outlined-action; this decision doesn't change `Deny` (see `[Q03]`).

#### [D04] Status icons: lucide only, one vocabulary across the family (DECIDED) {#d04-status-icons}

**Decision:** Row / state status indicators across the interactive family use lucide icons:
- `Check` — confirmed / completed / done
- `Circle` — empty / pending / not-yet
- `CircleDot` — recommended / soft default (the seeded radio option)
- `ChevronRight` — current / focused
- `Loader2` — in-flight / actively running (CSS-animated)

**Rationale:** Established for QuestionDialog. Lucide icons paint via `currentColor`, sit on the cap-height baseline cleanly, and respect `prefers-reduced-motion`.

**Implications:** QuestionDialog already uses `Check` / `Circle` / `CircleDot` / `ChevronRight`. Future interactive-family components pick from this vocabulary, not from text glyphs.

#### [D05] In-flight indicators: `TugProgress` ring with `role="inherit"` (DECIDED) {#d05-progress-role-inherit}

**Decision:** "Work in flight" indicators across the family render `TugProgress variant="ring" size="sm" role="inherit"` so the ring picks up surrounding text colour rather than the brand accent.

**Rationale:** Established for `StreamingPlaceholder` this session. The ring reads as part of the surrounding muted prose, not as a foreground accent. `role="inherit"` mirrors `TugBadge`'s `inherit` role.

**Implications:** `StreamingPlaceholder` already uses this. Any new in-flight surface in the family adopts the same shape.

#### [D06] Salvage path stays AskUserQuestion-only (DECIDED) {#d06-salvage-scope}

**Decision:** The "post-validation-error, mount inline recovery UI, post answers via `session.send`" pattern is implemented in `AskUserQuestionToolBlock` and only there.

**Rationale:** Per the user's direction. Premature generalisation without a second concrete callsite invites design churn.

**Implications:** `[Q05]` deferred. The salvage helpers stay in `cards/tool-wrappers/ask-user-question-tool-block.tsx`.

#### [D08] `TideInteractiveDialog` is the input-form primitive, not a lifecycle owner (DECIDED) {#d08-input-form-primitive}

**Decision:** `TideInteractiveDialog` owns the **pending input form** chrome and defaults only. It does NOT own lifecycle transitions (pending → resolved → recorded). PermissionDialog owns its own three-state lifecycle in its own component because the SDK has no native record to delegate to. AskUserQuestion's lifecycle is naturally split across the dialog (pending) and the tool block (the rendered tool_use/tool_result pair) — the dialog primitive only ever sees the pending state.

**Rationale:**
- JSONL investigation (`#investigation-asymmetry`) confirmed the two surfaces are structurally different artifacts. PermissionDialog operates out-of-band (SDK control frames invisible to the AI); AskUserQuestion operates in-band (tool_use/tool_result visible to the AI). They share visual vocabulary but not lifecycle shape.
- Forcing a unified lifecycle would either (a) bloat the primitive with PermissionDialog-specific state, (b) require inlining the QuestionDialog at its tool_use position (Path 2 — out of scope), or (c) split PermissionDialog into dialog + record components (Path 3 — invents transcript positions that don't exist).
- An input-form-only primitive is the smallest cut that captures the shared concerns (cancel gesture, button styling, confirmDisabled, actions row) without misrepresenting the architecture.

**Implications:**
- `TideInteractiveDialogProps` is `Omit<TugInlineDialogProps, "cancelRole"> & { cancelRole?: TugInlineDialogCancelRole }` — thin wrapper, no lifecycle props.
- The primitive does NOT subscribe to `session.pendingX` — callers do that and conditionally render the primitive.
- PermissionDialog's pending → resolved → recorded state machine stays in PermissionDialog. Same for the tool block's render of the tool_use/tool_result pair.
- Resolves `[Q01]`.

#### [D09] Rename `session.peelNewest()` to `session.popInteractive()` (DECIDED) {#d09-popinteractive-rename}

**Decision:** The session method `peelNewest` is renamed to `popInteractive`. Every callsite — Cancel handlers, Esc handlers, the Stop button, doc-comments, tests — updates in one mechanical pass (Step 0). Semantics are unchanged.

**Rationale:**
- `peelNewest` reads oddly at every callsite ("clicking Cancel should peel the newest...?"). The name was a stack-internals leak.
- `popInteractive` names the family (interactive dialogs) and the stack mechanic (`pop`). Reads correctly at every callsite: `Cancel handler → session.popInteractive()`; `Esc handler → session.popInteractive()`; `Stop button → session.popInteractive()`.
- Tighter than `popCancelInteractive` while preserving the two essential pillars (LIFO + family marker). The "cancel" verb stays present where it matters (button label, Esc semantics, `[D02]` prose).

**Implications:**
- `code-session-store.ts` — rename the method and any references.
- `chrome/tide-question-dialog.tsx` — update `handleCancel`.
- `cards/tool-wrappers/ask-user-question-tool-block.tsx` — update salvage UI Cancel handler.
- Prompt entry (`tide-prompt-entry/*`) — update Esc / Stop wiring.
- Tests pinning the method name.
- Doc-comments referencing the method.

#### [D10] The PermissionDialog ↔ AskUserQuestion asymmetry is load-bearing (DECIDED) {#d10-asymmetry-load-bearing}

**Decision:** PermissionDialog and AskUserQuestion are not variants of the same shape. They are structurally different artifacts that share visual vocabulary. This plan names the asymmetry honestly and does not attempt to force unification.

**Rationale:**
- JSONL investigation (`#investigation-asymmetry`) confirmed: permission decisions are out-of-band SDK control frames (invisible to the AI); AskUserQuestion answers are in-band tool_use/tool_result (visible to the AI via tool_result text content).
- The dialog/tool-block split for AskUserQuestion isn't accidental — it falls out of the SDK's transport model. The dialog is the input form (sticky/floating, scroll-agnostic); the tool block is the rendered representation of the tool_use/tool_result pair at its conversation position.
- PermissionDialog's three-state-in-one-component shape isn't accidental either — there's no AI-side record to attach a separate component to.

**Implications:**
- Resolves `[Q02]` (no, don't add a `turn.controlRequests` record for questions).
- The primitive is input-form only per `[D08]`.
- Future PRs that try to "unify" the two surfaces should re-read `[D08]` and `[D10]` first.

#### [D11] "Wrapper" is deprecated in prose; "tool block" is the canonical term (DECIDED) {#d11-tool-block-vs-wrapper}

**Decision:** In documentation, doc-comments, and conversational prose, the rendered representation of a tool_use/tool_result pair is called a **tool block**, not a **tool wrapper**. The `*ToolBlock` component names already use the right noun; only the prose changes.

**Rationale:**
- "Wrapper" suggests the component is wrapping something underneath. It isn't — the tool block IS the rendered representation. There's nothing to wrap.
- "Tool block" is more accurate: it's a block in the transcript that renders a tool.
- The component-file names (`ToolWrapperChrome`, `DefaultToolWrapper`) retain "Wrapper" for now per `[Q06]` (DEFERRED).

**Implications:**
- Step 4 includes a prose audit: replace "wrapper" with "tool block" in tugdeck docstrings, doc-comments, and any plan-referenced prose.
- Component-file renames are out of scope (follow-on).

#### [D12] Lifecycle vocabulary: pending / resolved / recorded (DECIDED) {#d12-lifecycle-vocab}

**Decision:** The canonical lifecycle states across the family are:

- **`pending`** — awaiting user input. The dialog is up; no decision yet.
- **`resolved`** — user made a decision (Allow / Deny / submitted answers). May be a transient state before recorded.
- **`recorded`** — committed to transcript history.

PermissionDialog uses all three states in one component. AskUserQuestion's dialog has only `pending`; the resolved/recorded state lives in the tool block at the tool_use position (no transient `resolved` — once the tool_result lands, the tool block IS the recorded state).

**Rationale:** Eliminates drift between "live", "settled", "resolved-record", "live↔resolved" wording variations. One vocabulary across docs, doc-comments, and tests.

**Implications:**
- Plan prose uses these three terms consistently.
- Tests can pin state values using these names.
- Drop "live" and "settled" from the family vocabulary.

---

### Deep Dives {#deep-dives}

#### Investigation — the AskUserQuestion / PermissionDialog asymmetry {#investigation-asymmetry}

JSONL transcript investigation (`~/.claude/projects/.../*.jsonl`) confirmed the architectural asymmetry between the two surfaces.

**Finding 1 — AskUserQuestion answers round-trip via tool_result.** When AskUserQuestion succeeds, the SDK delivers the answers back to the AI as text content in the matching `tool_result` frame:

```
"User has answered your questions: \"<question text>\"=\"<answer text>\". 
 You can now continue with the user's answers in mind."
```

The AI sees the full Q→A pairs in its conversation context, attached to the `tool_use_id` of the original `AskUserQuestion` call. AskUserQuestion is a first-class round-trip through the standard tool_use/tool_result mechanism.

**Finding 2 — Permission decisions are invisible to the AI.** A grep across a heavy-use transcript (3300+ lines, 11 AskUserQuestion calls, dozens of permissioned Bash calls) returned **zero** `permission_request` / `permission_decision` / `tool_approval` frames in the JSONL. Permission decisions are out-of-band SDK control frames — they never enter the conversation context the AI sees.

**Finding 3 — The asymmetry is architectural.** The two surfaces' structural shapes fall out of their delivery channels:

| | PermissionDialog | AskUserQuestion |
|---|---|---|
| Channel | Out-of-band SDK control frame | In-band tool_use / tool_result |
| AI visibility | Invisible | Visible in tool_result text |
| Where the record lives | **Invented by us** (`turn.controlRequests[]`) | **Already in conversation context** |
| Natural transcript position | None | At the tool_use position |
| UI shape | One component, three states (we own the whole story) | Input dialog (sticky) + tool block (at tool_use position) |

**Finding 4 — The "wrapper" misnomer hides a clean concept.** What we call "tool wrapper" is the *rendered representation* of a tool_use/tool_result pair at its transcript position. Calling it a wrapper suggests it's wrapping something — it isn't. It IS the tool's rendering. `[D11]` replaces "wrapper" with "tool block" in prose.

#### Surface audit — current state {#audit-current-state}

**`PermissionDialog`** (`chrome/tide-permission-dialog.tsx`):
- One component, three lifecycle states (pending → resolved → recorded), in-place transition via local `decision` state + store-driven `isPending`.
- Composes `TugInlineDialog` with: icon `ShieldAlert`, iconRole `caution`, title `"Permission requested"`, body via `PendingBody` (smart-picks a body kind by tool), `options` for scope picker, `confirmLabel: "Allow"`, `cancelLabel: "Deny"`.
- History: writes to `turn.controlRequests[]` via the reducer (the UI is the only place this record exists).
- Cancel = `Deny`, a positive decision (sends `respondApproval({decision: "deny"})`, not `popInteractive`).
- Esc currently → responder chain → `popInteractive` (post-rename).

**`QuestionDialog`** (`chrome/tide-question-dialog.tsx`):
- One component, `pending` state only. Renders `null` when no `pendingQuestion`.
- Composes `TugInlineDialog` with: icon `MessageCircleQuestion`, iconRole `info`, title `"Claude has questions"` / `"Claude has a question"`, body = the wizard rail or single-question option group, `confirmLabel: "Submit all"` (gated via `confirmDisabled`), `cancelLabel: "Cancel"` (role `"danger"`).
- History: none in `turn.controlRequests`. The conversation context holds the Q→A via tool_use/tool_result.
- Cancel = `popInteractive` (post-rename).
- Esc → responder chain → `popInteractive`.

**`AskUserQuestionToolBlock`** (`cards/tool-wrappers/ask-user-question-tool-block.tsx`):
- The rendered representation of the AskUserQuestion tool_use/tool_result pair at its conversation position. NOT a dialog.
- Renders `null` while streaming (the dialog is the surface during pending); renders Q&A summary post-answer; renders the salvage UI on validation errors with parseable input.
- Composes `ToolWrapperChrome` (the shared frame for tool blocks).
- Salvage UI Cancel handler: **local `setSalvageCancelled(true)` (React state), not `popInteractive`.** Correct semantics — the failed AskUserQuestion tool call has already resolved with an error before the salvage UI mounts; there is no pending interactive on the stack to pop. Local-dismiss is the right gesture. This is a deliberate carve-out from `[D02]`.
- Not migrated to `TideInteractiveDialog` — it's not an input form per `[D08]`. Reviewed in Step 4 for vocabulary alignment only.

#### The boundary question (resolved) {#primitive-boundary-question}

`[Q01]` is resolved by `[D08]`. The primitive is the input-form layer — see `Spec S01` for the prop contract. Implementation sketch:

```ts
export interface TideInteractiveDialogProps
  extends Omit<TugInlineDialogProps, "cancelRole"> {
  cancelRole?: TugInlineDialogCancelRole;  // defaults to "danger"
}

export const TideInteractiveDialog: React.FC<TideInteractiveDialogProps> = ({
  cancelRole = "danger",
  className,
  ...rest
}) => (
  <TugInlineDialog
    {...rest}
    data-slot="tide-interactive-dialog"
    cancelRole={cancelRole}
    className={cn("tide-interactive-dialog", className)}
  />
);
```

CSS scopes the actions-row `space-between` override under `.tide-interactive-dialog [data-slot="tug-inline-dialog-actions"]` — targeting the **documented `data-slot` surface** that `TugInlineDialog` exposes on its actions row (`tug-inline-dialog.tsx:383`), not the internal `.tug-inline-dialog-actions` class. This preserves `[L20]` composition sovereignty: the outer component reaches in only through the inner component's published surface, not its private CSS naming. If `TugInlineDialog` later refactors its internal class names, the slot selector keeps working.

#### Why this isn't a `TugInlineDialog` refactor {#why-not-tug-inline-dialog}

`TugInlineDialog` is also used by surfaces that are NOT input forms in this sense (one-shot alerts, transient confirms). Pushing the Cancel-Esc-popInteractive opinion into it would force those callsites either to opt out or inherit semantics that don't apply.

A Tide-specific layer on top — composable, narrowly-scoped — is the cheaper and reversible move.

---

### Specification {#specification}

#### Spec S01: `TideInteractiveDialog` prop contract {#s01-primitive-props}

**Default behaviours** that distinguish `TideInteractiveDialog` from `TugInlineDialog`:

| Behaviour | `TugInlineDialog` | `TideInteractiveDialog` |
|-----------|-------------------|-------------------------|
| `cancelRole` default | `"action"` | `"danger"` |
| Actions-row layout | `flex-end` (tightly grouped) | `space-between` (Mac HIG separation) |
| `confirmDisabled` semantics | Optional prop, default `false` | Same — surfaced by callers when gating submit |
| Esc handling | None (bubbles to responder chain) | None (explicit: stays the same) |
| Cancel onClick | Caller-supplied | Caller-supplied; family convention is `session.popInteractive()` (`[D02]`) |
| Lifecycle ownership | None | None — primitive is input-form only (`[D08]`) |

**Pass-through.** Every other `TugInlineDialog` prop flows through unchanged.

**Type:**

```ts
export interface TideInteractiveDialogProps
  extends Omit<TugInlineDialogProps, "cancelRole"> {
  cancelRole?: TugInlineDialogCancelRole;
}
```

#### Spec S02: Cancel semantics contract {#s02-cancel-semantics}

For every interactive-family surface:

1. Cancel button → `session.popInteractive()` directly OR a callback that ultimately calls `popInteractive()`. **Carve-outs:** PermissionDialog's `Deny` (positive decision per `[Q03]`); AskUserQuestionToolBlock salvage UI's `Cancel` (local dismissal — the failed tool call has already resolved; no pending interactive to pop). Per `[D02]`.
2. Esc keypress → responder chain → `CANCEL_DIALOG` action → prompt entry's `popInteractive()` handler. The dialog does not intercept Esc locally.
3. No `respondX({})` paths from a Cancel gesture. (Cancel ≠ "submit empty.")

#### Spec S03: Family visual vocabulary {#s03-visual-vocabulary}

- Status icons: per `[D04]`.
- In-flight indicator: per `[D05]`.
- Cancel button visual: per `[D03]`.
- Frame width: each surface picks its own (`PermissionDialog`: 520 px CTA-sized; `QuestionDialog`: 700 px wide for question prose). The primitive doesn't lock width.

#### Spec S04: Lifecycle state vocabulary {#s04-lifecycle-vocab}

Per `[D12]`:

| State | Meaning | PermissionDialog | QuestionDialog | AskUserQuestionToolBlock |
|-------|---------|------------------|----------------|--------------------------|
| `pending` | Awaiting user input | ✓ | ✓ | — (returns null while streaming) |
| `resolved` | User made a decision; not yet committed to record | ✓ (transient) | — | — |
| `recorded` | Committed to transcript history | ✓ | — | ✓ (the tool block IS the recorded state) |

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/tide-interactive-dialog.tsx` | New input-form primitive composing on `TugInlineDialog` |
| `tugdeck/src/components/tugways/tide-interactive-dialog.css` | Style overrides (actions-row `space-between`) |
| `tugdeck/src/components/tugways/tide-interactive-dialog.test.ts` | Pure-logic test pinning the default-substitution surface |

#### Files modified {#files-modified}

| File | Change |
|------|--------|
| `tugdeck/src/lib/code-session-store.ts` | Rename `peelNewest` → `popInteractive` (Step 0) |
| `tugdeck/src/components/tugways/chrome/tide-permission-dialog.tsx` | (Step 2) Pending state swaps `TugInlineDialog` → `TideInteractiveDialog`; explicit `cancelRole="action"` for `Deny`. (Step 3 follow-up) Recorded state swaps custom button+chevron chrome → `ToolWrapperChrome`; dropped `recordExpanded` state + the `composePermissionRecordSummary` helper; added `recordedPermissionPresentation` helper for the chrome's label/icon. |
| `tugdeck/src/components/tugways/chrome/tide-permission-dialog.css` | (Step 3 follow-up) Removed all `--tugx-perm-record-*` / `--tugx-perm-collapse-*` tokens + every `.tide-permission-dialog-record-*` rule (the disclosure-pattern scaffolding). Two pending-state fragments remain (`-inline-icon`, `-reason`); one new rule tints `[data-decision]` on the recorded chrome's status span. |
| `tugdeck/src/components/tugways/chrome/tide-permission-dialog.test.ts` | (Step 3 follow-up) Replaced the `composePermissionRecordSummary` describe block with a `recordedPermissionPresentation` block (4 cases instead of 4). |
| `tugdeck/src/components/tugways/chrome/tide-question-dialog.tsx` | Update `handleCancel` to call `popInteractive` (Step 0); swap `TugInlineDialog` → `TideInteractiveDialog` (Step 3); drop the local CSS override for actions-row `space-between` (moved into primitive) |
| `tugdeck/src/components/tugways/chrome/tide-question-dialog.css` | Remove the `.tide-question-dialog .tug-inline-dialog-actions { justify-content: space-between }` block |
| `tugdeck/src/components/tugways/cards/tool-wrappers/ask-user-question-tool-block.tsx` | Vocabulary alignment + prose cleanup (Step 4). **Salvage UI Cancel handler is NOT updated** — it stays on local `setSalvageCancelled` per the `[D02]` carve-out. |
| `tugdeck/src/components/tugways/tug-prompt-entry.tsx` | Update Esc / Stop wiring to call `popInteractive` (Step 0). |
| `tugdeck/src/components/tugways/cards/tide-card-transcript.tsx` | (Step 0) One prose reference: "peel-newest gesture" → "pop-interactive gesture". (Step 3) **Two-stage layout fix.** First-pass JSX reorder moved both slots to the end of the cell. Second-pass refactored permission rendering into a `ReadonlyMap<tool_use_id, ReactNode>` so permission entries thread inline into `TranscriptToolCalls` and render immediately after their tool block; an orphan-permissions array stays at the body foot as a defensive fallback; `questionSlot` remains at the foot (questions belong at the end of the cell). Stable empty sentinels added (`EMPTY_PERMISSION_MAP`, `EMPTY_PERMISSION_ARRAY`). |
| `tugdeck/src/components/tugways/cards/tide-card-transcript-tool-calls.tsx` | (Step 3) Accept `permissionByToolUseId?: ReadonlyMap<string, ReactNode>` on both Static and Streaming variants; thread to `ToolCallsList`; render the matching permission node inside a `React.Fragment` keyed by `toolUseId` as the immediate sibling of each tool block. |
| `tugdeck/src/lib/code-session-store/__tests__/code-session-store.queue.test.ts` | Rename `peelNewest` references — 4 occurrences (Step 0). |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `popInteractive` | method | `code-session-store.ts` | Renamed from `peelNewest`; same semantics |
| `TideInteractiveDialog` | React.FC | `tide-interactive-dialog.tsx` | The new input-form primitive |
| `TideInteractiveDialogProps` | interface | `tide-interactive-dialog.tsx` | Per Spec S01 |
| `DEFAULT_CANCEL_ROLE` | const | `tide-interactive-dialog.tsx` | `"danger"` |

---

### Documentation Plan {#documentation-plan}

- [x] Module docstring on `TideInteractiveDialog` explaining the boundary with `TugInlineDialog`, the `[D08]` input-form scope, the `[D02]` / `[D03]` defaults, and the family convention. *(Done in Step 1.)*
- [x] Module docstring on `code-session-store.ts` `popInteractive` method explaining the LIFO semantic and what "interactive" means in this family. *(Done in Step 0.)*
- [x] Cross-reference from `chrome/tide-permission-dialog.tsx` and `chrome/tide-question-dialog.tsx` to `TideInteractiveDialog`. *(Done in Steps 2 and 3 — both module docstrings name `TideInteractiveDialog` as the direct composition target with `TugInlineDialog` one layer down.)*
- [ ] Step 4 prose audit: replace "wrapper" with "tool block" in tugdeck docstrings / doc-comments per `[D11]`.

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Pure-logic unit** | Pin helpers (already done for question dialog, permission dialog) | Existing tests must continue to pass post-rename |
| **Default substitution** | Verify `TideInteractiveDialog` flips the right defaults | Step 1 |
| **Rename coverage** | Verify zero `peelNewest` references; `popInteractive` semantics preserved | Step 0 |
| **Live HMR** | Verify the rendered chrome reads correctly (permission allow/deny, question wizard, salvage) | Each migration step |

Pure-logic tests stay attached to the consumer modules. The primitive adds a tiny `tide-interactive-dialog.test.ts` that pins the default substitution + the `confirmDisabled` pass-through. No fake-DOM render tests.

---

### Execution Steps {#execution-steps}

> Commit after every step's checkpoints pass.

#### Step 0: Rename `session.peelNewest()` → `session.popInteractive()` {#step-0}

**Commit:** `refactor(tugdeck): rename peelNewest to popInteractive`

**References:** `[D09]` popInteractive rename, `[D02]` cancel semantics, (#audit-current-state)

**Artifacts:**
- Edits to `code-session-store.ts`, every callsite, tests, doc-comments.

**Tasks:**
- [x] Rename method in `code-session-store.ts:603`. Update the dispatch case in `tide-prompt-entry.tsx` (lines 910, 914, 974, 980, 988 — both call sites + the surrounding doc-prose).
- [x] Update `chrome/tide-question-dialog.tsx` `handleCancel` (line 807) and the surrounding doc-prose (lines 795, 797, 813).
- [x] Update the existing test cases in `src/lib/code-session-store/__tests__/code-session-store.queue.test.ts` (4 references, line 259 onward — rename the `it("peelNewest …")` block label and the 3 `store.peelNewest()` calls).
- [x] Update any other doc-comments referencing the method. (One more found and updated: `cards/tide-card-transcript.tsx:469` — "Stop / Esc peel-newest gesture" → "Stop / Esc pop-interactive gesture".)
- [x] `grep -r peelNewest tugdeck/src` returns zero results.
- [x] **Salvage UI is NOT touched** in this step — its Cancel handler uses local state (`setSalvageCancelled`) per the `[D02]` carve-out; that is correct behaviour and unchanged.
- [x] Rewrote the `popInteractive` doc-string to explain the LIFO semantic, what "interactive" means in this family, and the `[D02]` carve-outs (Documentation Plan item).

**Tests:**
- [x] Existing `code-session-store.queue.test.ts` cases (`peelNewest drains the queue newest-first (LIFO), then interrupts the turn`, etc.) renamed to `popInteractive …` and still passing — semantics unchanged. (6 pass / 0 fail in the file; 49 expect calls.)

**Checkpoint:**
- [x] `cd tugdeck && bun x tsc --noEmit` — clean (exit 0).
- [x] `cd tugdeck && bun test` — full suite green: 2576 pass / 0 fail / 9654 expect calls / 157 files.
- [x] `cd tugdeck && bun run audit:tokens lint` — zero violations.
- [x] `grep -r peelNewest tugdeck/src` → empty.
- [x] Manual HMR: Cancel button on question dialog, Esc keypress, Stop button — all three still cancel correctly. *(Verified by user in live session.)*

---

#### Step 1: Extract `TideInteractiveDialog` primitive {#step-1}

**Depends on:** #step-0

**Commit:** `feat(tugways): TideInteractiveDialog input-form primitive`

**References:** `[D01]` new primitive, `[D02]` cancel semantics, `[D03]` cancel button visual, `[D08]` input-form scope, Spec S01, (#why-not-tug-inline-dialog)

**Artifacts:**
- `tugdeck/src/components/tugways/tide-interactive-dialog.tsx`
- `tugdeck/src/components/tugways/tide-interactive-dialog.css`
- `tugdeck/src/components/tugways/tide-interactive-dialog.test.ts`

**Tasks:**
- [x] Implement `TideInteractiveDialog` per Spec S01. Default `cancelRole: "danger"`.
- [x] Created the actions-row `space-between` override in `tide-interactive-dialog.css`. Selector targets the published `[data-slot="tug-inline-dialog-actions"]` surface, not the internal `.tug-inline-dialog-actions` class — per `[L20]`. *(The matching block in `tide-question-dialog.css` will be removed in Step 3 when QuestionDialog migrates onto the primitive; until then the two coexist with no conflict because the primitive's CSS is not yet loaded — nothing imports `tide-interactive-dialog.tsx` yet.)*
- [x] Applied `[L19]` conformance with a deliberate scope. **No separate `data-slot="tide-interactive-dialog"` was added**: the primitive owns no DOM of its own — it returns a `TugInlineDialog` React element directly, and adding a wrapper div purely to carry an extra `data-slot` would change DOM topology (cascading specificity, layout, event-bubbling) for no real benefit. The family identifier is the `tide-interactive-dialog` className composed onto `TugInlineDialog`'s root — same precedent that `QuestionDialog` already uses (it composes on `TugInlineDialog` via className, with no separate data-slot). The module docstring on `.tsx` documents this choice. `@tug-pairings` annotation present at the top of the `.css` (acknowledging composition with `TugInlineDialog`'s tokens — the primitive owns no colour tokens of its own); no `@tug-renders-on` needed because the only rule in the file is layout-only (`justify-content`).
- [x] Module docstring per `[D01]` and `[D08]`. Cites `[D02]` for the cancel convention; `[L19]`, `[L20]`, `[L26]` for the contract; `[D03]` and `[D08]` for the visual/scope defaults.
- [x] Pure-logic test: `cancelRole="action"` override, default substitution, `confirmDisabled` pass-through (plus extras: className composition + ordering).

**Tests:**
- [x] `TideInteractiveDialog` defaults `cancelRole` to `"danger"` when omitted.
- [x] `cancelRole="action"` from the caller overrides the default.
- [x] `confirmDisabled` propagates to `TugInlineDialog` unchanged (true / false / undefined cases).
- [x] *(Bonus)* `tide-interactive-dialog` className composed onto consumer-supplied classes, family class first.

**Checkpoint:**
- [x] `bun x tsc --noEmit` — clean (exit 0).
- [x] `bun test src/components/tugways/tide-interactive-dialog.test.ts` — 10 pass / 0 fail / 20 expects.
- [x] `bun test` — full suite green: 2586 pass / 0 fail / 9674 expects / 158 files (+10 over Step 0's baseline).
- [x] `bun run audit:tokens lint` — zero violations.

---

#### Step 2: Migrate `PermissionDialog` onto `TideInteractiveDialog` {#step-2}

**Depends on:** #step-1

**Commit:** `refactor(tugways): PermissionDialog composes on TideInteractiveDialog`

**References:** `[D01]` new primitive, `[D02]` cancel semantics, `[D08]` input-form scope, `[Q03]` cancel vocab on permissions, (#audit-current-state)

**Artifacts:**
- Edits to `chrome/tide-permission-dialog.tsx`.

**Tasks:**
- [x] Swap `import { TugInlineDialog }` for `import { TideInteractiveDialog }`. (Kept the type-only `import type { TugInlineDialogOption }` — `buildPermissionOptions` still returns that type; the prop contract lives on `TugInlineDialog`.)
- [x] Pass `cancelRole="action"` explicitly so `Deny` keeps its outlined-action treatment (per `[Q03]` default resolution). Inline comment added at the JSX cite-point explaining the `[D02]` / `[Q03]` carve-out.
- [x] Verify the resolved-record state still in-place-transitions correctly (no remount under the same `request_id`) — `[L26]` mount-identity stability. **Verified:** `PermissionDialog` itself is the long-lived component; its `useState` for `decision` and `recordExpanded` survives the pending → resolved transition because the parent stays mounted. The pending → resolved transition swaps the *child* tree (`TideInteractiveDialog` → resolved-record `<div>`), which is expected — the dialog is replaced by the compact record once Allow/Deny is clicked. The migration changes only the pending-branch JSX (`TugInlineDialog` → `TideInteractiveDialog`); React-reconciliation identity at the consumer level is byte-identical because `PermissionDialog`'s own position, key, type, and renderer reference are unchanged.
- [x] Verify history-recording behaviour unchanged (the reducer doesn't depend on the visible chrome). **Verified:** `respondApproval` is called identically; the reducer writes `turn.controlRequests[]` unchanged.
- [x] Update module docstring: now names `TideInteractiveDialog` as the direct composition target, with the underlying `TugInlineDialog` named one layer down. `[L20]` line updated to reflect the two-layer composition.

**Tests:**
- [x] Existing `tide-permission-dialog.test.ts` cases still pass without modification (34 pass / 0 fail / 67 expects).
- [x] No new tests added — the migration is semantics-preserving and the existing pure-helper tests cover the public surface.

**Checkpoint:**
- [x] `bun x tsc --noEmit` — clean (exit 0).
- [x] `bun test src/components/tugways/chrome/tide-permission-dialog.test.ts` — 34 pass / 0 fail.
- [x] `bun test` — full suite green: 2586 pass / 0 fail / 9674 expects / 158 files (no regression from Step 1's baseline).
- [x] `bun run audit:tokens lint` — zero violations.
- [x] Manual HMR: trigger a permission prompt (`Bash` requiring approval); verify Allow / Deny *paths* and the *recorded state* render identically to pre-migration. *(Verified by user in live session. The `space-between` actions-row layout reads correctly as Mac HIG opposed-choices; functional paths and recorded-state visual unchanged.)*

---

#### Step 3: Migrate `QuestionDialog` onto `TideInteractiveDialog` {#step-3}

**Depends on:** #step-1

**Commit:** `refactor(tugways): QuestionDialog composes on TideInteractiveDialog`

**References:** `[D01]` new primitive, `[D02]` cancel semantics, `[D03]` cancel button visual, `[D08]` input-form scope, (#audit-current-state)

**Artifacts:**
- Edits to `chrome/tide-question-dialog.tsx`, `chrome/tide-question-dialog.css`.

**Tasks:**
- [x] Swap `TugInlineDialog` for `TideInteractiveDialog` (import + JSX open + JSX close).
- [x] Drop the local `.tide-question-dialog .tug-inline-dialog-actions { justify-content: space-between }` block from `tide-question-dialog.css` — the primitive owns it now. Frame-width override (`--tugx-question-frame-width: 700px`) kept. A short comment in the CSS records *why* the local override is gone (cross-reference to `[D03]` + the primitive's CSS rule).
- [x] *(Bonus)* Dropped the explicit `cancelRole="danger"` prop from the JSX — that is now the family default that `TideInteractiveDialog` supplies. Omitting it is the cleaner expression: the dialog gets the family vocabulary without restating it.
- [x] Verify the measurement helper for layout stability still works — component-local, untouched. The hidden measurement wrapper (`tide-question-dialog-measure`) lives in the `children` slot the primitive passes through verbatim.
- [x] Verify Cancel still resolves to `session.popInteractive()` (Step 0 already updated this) — `handleCancel` body is unchanged; the chrome swap does not perturb the callback.
- [x] Update module docstring: cross-references `TideInteractiveDialog` as the direct composition target ([D01] / [D08]); the stale **"Skip"** paragraph (which described the old `respondQuestion({})` cancel behaviour) is replaced with the current **"Cancel ≡ Esc ≡ `popInteractive`"** paragraph naming `[D02]` and the wire round-trip. `[L20]` line acknowledges the two-layer composition.

**Tests:**
- [x] Existing `tide-question-dialog.test.ts` cases still pass without modification (38 pass / 0 fail / 50 expects).
- [x] No new tests added — the migration is semantics-preserving and the existing pure-helper tests cover the public surface.

**Checkpoint:**
- [x] `bun x tsc --noEmit` — clean (exit 0).
- [x] `bun test src/components/tugways/chrome/tide-question-dialog.test.ts` — 38 pass / 0 fail.
- [x] `bun test` — full suite green: 2586 pass / 0 fail / 9674 expects / 158 files (no regression).
- [x] `bun run audit:tokens lint` — zero violations.
- [x] Manual HMR: a real AskUserQuestion flow with multi-question payload; verify wizard rail, auto-advance, Cancel button (`popInteractive`), Esc (`popInteractive`) all behave identically to pre-migration. *(Verified by user in live session: the migration itself works; wizard rail, auto-advance, and the family cancel gesture all behave correctly.)*

**Discovered-and-fixed during HMR review — body-slot ordering bug.** The user surfaced a layout problem present *before* this plan started: in `cards/tide-card-transcript.tsx`, the assistant-cell body mounted `permissionSlot` and `questionSlot` at fixed positions *near the top* of the body, above `TranscriptToolCalls` and `TugMarkdownBlock`. So when the AI emitted Bash + text + `AskUserQuestion`, the dialog appeared at the *top* of the cell with the tool output and text streaming in *below* it — inverted from conversational order.

- [x] *(First pass.)* Reordered the body JSX so the slots sit at the *end* of the cell. Sufficient for QuestionDialog (questions naturally belong at the end of an assistant turn — after the text that introduces them), but **insufficient for PermissionDialog** — the user's follow-up HMR showed the `Bash — Allowed` record sitting at the bottom of the cell with the assistant's prose commentary between it and the Bash tool block. The user's rule: *"This tool approval should appear immediately below the tool call. Nothing else should be able to weasel its way in there."*
- [x] *(Second pass — the architecturally correct fix.)* Threaded permission entries into the tool stream by `tool_use_id`. The wire ships `control_request_forward` frames with a `tool_use_id` field (verified against the v2.1.x stream-json catalog and the `ControlRequestForward` index signature — the SDK has carried it since 2.1.104), so a permission record always knows which tool block it gates.
  - In `tide-card-transcript.tsx`: split the old `permissionSlot` `ReactNode` output into two: a `ReadonlyMap<tool_use_id, ReactNode>` keyed by `tool_use_id`, and a defensive `orphanPermissions` array for entries that arrive without the field. Stable `EMPTY_PERMISSION_MAP` / `EMPTY_PERMISSION_ARRAY` sentinels are reused on every empty render so `useSyncExternalStore`'s `Object.is` check skips no-op re-renders.
  - In `tide-card-transcript-tool-calls.tsx`: accept `permissionByToolUseId?: ReadonlyMap<...>` on both Static and Streaming props; in `ToolCallsList`, after each rendered tool block, look up the matching node and render it as the immediate sibling within the same flex column. A tool block with no matching permission stays as a bare `Component`; a tool block with a permission renders inside a `React.Fragment` keyed by `toolUseId` so the pair reconciles as one unit.
  - In the body JSX: `permissionSlot` removed; `orphanPermissions` rendered at the body foot as a defensive fallback (typically empty); `questionSlot` stays at the foot (questions naturally belong at the end of the cell).
- [x] Slot keys (`request.request_id` on the permission node; `toolUseId` on the wrapping Fragment) preserve React-reconciliation mount identity (`[L26]`) across pending → resolved → recorded transitions of the permission UI.
- [x] Added a multi-paragraph comment above the body documenting the conversational-order rule + the inline-permission-threading rule, so future readers see both baked into the layout.

**Third pass during HMR review — unify the two post-interaction records.** With the layout now correct, the *visual* divergence between the two recorded surfaces became the next problem: PermissionDialog's recorded view was a custom button + chevron + "expand to see more" affordance (vintage scaffolding from a permission-only era), while AskUserQuestionToolBlock's recorded view was already a clean `ToolWrapperChrome`-based card. The user's read: *"They look similar but are different enough for no good reason. The disclosure feels silly; the always-expanded Q&A feels right."*

- [x] PermissionDialog's recorded branch now composes on `ToolWrapperChrome` — the same chrome the `AskUserQuestionToolBlock` recorded view uses. Both records read as siblings of the same family.
- [x] Dropped the chevron + click handler + `recordExpanded` `useState` + the `[data-collapsed]` / `[data-state="resolved"]` / `[data-decision]` DOM-attribute machinery. The record is always visible (no toggle); the body is intentionally empty (the gated tool block one position above already carries the input context — the Bash command, the file diff, the file path).
- [x] Replaced `composePermissionRecordSummary` (the old `"{Tool} — Allowed"` string composer) with `recordedPermissionPresentation` — a tiny pure helper that returns `{label: "Allowed"|"Denied"|"Resolved", icon: ReactNode}` for the chrome's `toolName` + `toolIcon` + `argsSummary` slots. Test coverage updated (the existing `composePermissionRecordSummary` describe block is replaced by a `recordedPermissionPresentation` describe block with one extra case pinning that each decision picks its own icon node).
- [x] CSS: dropped the entire `--tugx-perm-record-*` / `--tugx-perm-collapse-*` / `--tugx-perm-focus-ring` / `--tugx-perm-record-detail-pad` token family and every `.tide-permission-dialog-record-*` rule. The file went from ~187 lines to ~70 — most of it was scaffolding for the disclosure pattern. Two small rules remain (`.tide-permission-dialog-inline-icon` for the inline Shell glyph and `.tide-permission-dialog-reason` for the muted reason span — both used inside the *pending* dialog's description). Added one new rule: `.tide-permission-dialog-record-status[data-decision]` tints the decision word (success/danger) to match the lucide icon paired with it in the chrome header.
- [x] Updated the module docstring and `[L20]` cross-reference to name the new composition path: *pending* → `TideInteractiveDialog` → `TugInlineDialog`; *recorded* → `ToolWrapperChrome`. This component itself now contributes only the small inline-icon + reason fragments.

**Fourth pass — status-chip vocabulary.** With the chrome unified, the next snag was the `argsSummary` text both records carried — `4 of 4 answered` and `Allowed` / `Denied` rendered as mono-styled prose (inherited from the chrome's default `argsSummary` font family). The user's read: *"The monospace looks a little goofy."*

- [x] Both records now render their status text through `TugBadge` (`emphasis="tinted"`, `size="sm"`) inside the chrome's `argsSummary` slot. The badge owns its own padding, colour, and typography — no mono prose.
- [x] Roles per the family vocabulary: `action` for the AskUserQuestion question-count chip (neutral progress indicator); `success` for an allowed permission; `danger` for a denied permission; `action` for the out-of-band `Resolved` fallback.
- [x] `recordedPermissionPresentation` helper grew a third field (`badgeRole`) so the role is pinned by the same contract that picks the label and icon. The test cases assert the role mapping alongside label + icon.
- [x] Dropped the `.ask-user-question-tool-block-args` CSS rule (mono font + muted colour) — the badge owns its own styling.
- [x] Dropped the `.tide-permission-dialog-record-status[data-decision]` colour tints — the badge handles success / danger tone via its role token vocabulary, not the dialog's own CSS.

**Fifth pass — HMR survival.** Experimenting with badge sizes/styles surfaced a real defect: *the recorded chrome did not survive Vite's Fast Refresh.* When `PermissionDialog` / `QuestionDialog` reloaded, their recorded views fell out of the rendered tree.

Root cause: the slot computations in `tide-card-transcript.tsx` (`permissionByToolUseId`, `orphanPermissions`, `questionSlot`) memoised the React *elements* themselves. Each cached element carries the `Component` reference returned by `dispatchRenderInput` at the time the `useMemo` last ran. When Fast Refresh swaps the component function for a new one, the cached element's `type` still points at the *old* function — so React renders the stale version, and Fast Refresh can't remount the chrome to apply the edit. `TranscriptToolCalls` doesn't have this problem because it calls `dispatchToolCallState` *inline inside its `map()`* every render, always picking up the latest reference.

- [x] Refactored: the lightweight `SlotEntry[]` derivation stays inside `useMemo` (keyed on the data sources — `isCommitted` / `turn` / `controlRequestLog` / `pendingApproval`), but the React-element construction now runs **every render** in a plain `forEach` over the memoised entries. Same pattern for the question slot: `if (!isCommitted && pendingQuestion !== null) { ... }` inline, no `useMemo` over the element.
- [x] Added a stable `EMPTY_PERMISSION_ENTRIES` sentinel so the empty-case `useMemo` return preserves `Object.is` identity and the fast-path branch skips map/array allocation.
- [x] Added an explanatory comment block in `tide-card-transcript.tsx` so future readers see the **HMR contract** baked in: *"caching React elements inside `useMemo` would freeze the `Component` reference returned by `dispatchRenderInput`."* Same rule applies any time `dispatchRenderInput` or `dispatchToolCallState` is called from a memoised context.

---

#### Step 3.5: Persist permission decisions via JSONL replay derivation {#step-3-5}

**Depends on:** #step-3

**Commit:** `feat(code-session-store): derive permission decisions from tool_result on replay`

**References:** `[D10]` asymmetry is load-bearing, `[D13]` inline-not-modal recorded chrome, (#investigation-asymmetry, #step-3)

##### Why this step exists {#step-3-5-context}

After the Step 3 visual-unification work, the user surfaced the real architectural defect underneath the polish: **the recorded permission chrome was not actually durable**. It survived neither HMR (when the in-memory store reset) nor app relaunch (when the in-memory store rebuilt from JSONL on cold boot). The HMR-survival fix in the Step 3 fifth pass addressed *React-element caching* but did nothing for the underlying data-loss case — because the data itself was only ever populated by the live `respondApproval` action, never by replay.

The data model the user was asking us to honour:

- The SDK's `session.jsonl` on disk is Tide's durable transcript of "what happened in this session." Every cold boot and session re-bind replays the JSONL through `code-session-store`'s reducer to rebuild in-memory state.
- `control_request_forward` frames **are** in the JSONL. `tool_use` / `tool_result` pairs **are** in the JSONL.
- The user's Allow/Deny click — a `respond_approval` action dispatched client-side — is **not** in the JSONL. It is a client-side gesture the reducer hears once, live, and never again.

The reducer currently only writes to `controlRequestLog` from `handleRespondApproval` (`reducer.ts:1885`). On replay there is no `respond_approval` event to process, so `controlRequestLog` stays empty and `turn.controlRequests` freezes empty at `turn_complete`. The recorded chrome — whose data source is exactly that log — has nothing to render.

**The decision is sometimes derivable from the `tool_result` content that lands after a `control_request_forward`.** Verified against 140 denied tool_results across 444 real Claude Code transcripts: every denied tool_result so far has carried the SDK's signature rejection text (the opener `"The user doesn't want to proceed with this tool use"` and the secondary phrase `"The tool use was rejected"`). Two stylistic suffixes exist (`"STOP what you are doing…"` for plain Deny; `"To tell you how to proceed, the user said: …"` when the user added a follow-up message), but both share the same signature phrases. A forgiving substring scan over multiple signal phrases (case-insensitive) catches both, and stays resilient if the SDK shifts wording later — as long as the new wording carries at least one of the recognised signals.

**Assertive posture.** The derivation rule is allowed to *assert* both `allow` and `deny` because the calling gate constrains the call site so tightly that "lack of denial in a gated call IS approval" is a logical inference, not speculation.

The gate (`pendingApproval !== null` + matching `tool_use_id` + `is_question === false`) guarantees:

1. A `control_request_forward` arrived for this exact `tool_use_id` — the SDK forwarded a permission request to the client.
2. A `tool_result` is now resolving that same `tool_use_id` — the SDK has reached a terminal decision.

The SDK only resolves a *gated* `tool_result` along two paths: the user approved (the tool ran, the result is the tool's actual output) or the user denied (the result is the SDK's rejection text). There is no third path through the wire model. So within the gated call site, **absence of the deny signal *is* the allow signal**.

`inferPermissionDecisionFromToolResult` therefore returns `"allow" | "deny"` (never `null`):

- `"deny"` when the text matches a forgiving heuristic over the SDK's signature rejection phrases.
- `"allow"` for everything else — empty result, the tool's normal output, an unrecognised future SDK denial format.

**Why we prefer assertive over conservative.** Visual consistency: the recorded chrome's badge state matches the original decision after HMR, Developer Reload, *and* full app relaunch. Content the user has already seen doesn't get pulled away on cold boot. That continuity is the user-visible reason for Step 3.5 to exist; an asymmetry where allows vanish on relaunch but denies persist re-creates the very inconsistency Step 3.5 was meant to close.

**Known risk and its bound.** If a future SDK rephrases deny text such that none of our signal phrases match, our helper would label that denial as `"allow"` — a *false allow* across replay. The risk is real but bounded:

- The user-visible badge would be a green pill instead of a red one. The *tool_result content itself* (still visible inside the tool block above the record) would still carry the SDK's rejection text in plain English. So the user has the full evidence to read what actually happened; the badge is the only thing that could mislead briefly.
- Such a regression would surface on the first relaunch of any session with a known denial. We'd catch it in dogfooding, not in production silence.
- Mitigation: keep `inferPermissionDecisionFromToolResult` 's signal list short, multi-word, SDK-specific, and easy to extend with one line when the SDK shape shifts. The helper is a small intentional `currentSDK->decision` adapter, not a stable contract.

The live `respond_approval` path is the source of truth during a running session. The derived path's purpose is solely to reconstruct that same `controlRequestLog` from a JSONL replay so HMR / Reload / cold boot stop dropping content the user has already seen.

##### Why this is permission-only (and not also question) {#step-3-5-permission-only}

- **AskUserQuestion** is already durable. The questions are in the `tool_use.input` (replayed) and the answers are in the `tool_result.content` text (replayed). The `AskUserQuestionToolBlock` reads both straight from `turn.toolCalls` — no `controlRequestLog` involvement.
- **PermissionDialog** is the lone gap because permission requests have no native AI-side artifact (`[D10]`) — the recorded chrome is the only durable surface, and its data lives in `controlRequestLog` and only there.

Step 3.5 is therefore scoped narrowly: extend `handleToolResult` for the permission case only.

##### Gating rationale — how we know a tool was gated {#step-3-5-gating-rationale}

The derived path runs only when *all three* of these predicates hold at the moment a `tool_result` lands:

1. `state.pendingApproval !== null` — a `control_request_forward` arrived earlier in the stream and has not been resolved yet.
2. `state.pendingApproval.tool_use_id === event.tool_use_id` — this `tool_result` is resolving the same tool the gate was opened for (so we don't false-write for sibling tool calls that happen to land in the same window).
3. `state.pendingApproval.is_question === false` — questions go through `respond_question` and never write to `controlRequestLog` per `[D10]`.

These predicates are derived from wire-level facts that are durable in the JSONL — `control_request_forward` is a first-class frame, and the reducer's replay logic re-derives `pendingApproval` from it deterministically.

The wire-level signal `control_request_forward` is exactly the "this tool was gated" predicate. Tools that don't need permission (auto-approved, internal, allowlist-matched, rule-bound from a prior decision) get their `tool_use → tool_result` round-trip with no `control_request_forward` between them. Our gate's `pendingApproval !== null` predicate therefore distinguishes the gated and ungated cases at the wire level — no heuristic involved.

**Four-quadrant behaviour table.** What happens at each `tool_result` arrival:

| Scenario | `pendingApproval` when `tool_result` lands | Derived path |
|---|---|---|
| Gated, denied (replay) | set, matching `tool_use_id` | runs → helper returns `"deny"` → writes `decision: "deny"` record |
| Gated, allowed (replay) | set, matching `tool_use_id` | runs → helper returns `"allow"` → writes `decision: "allow"` record (lack of denial in a gated call IS approval) |
| Gated, decided live | already `null` (cleared by live `respond_approval`) | gate fails on predicate 1 — no-op (live path already wrote the record) |
| **Ungated tool** (no permission ever asked) | `null` | gate fails on predicate 1 — no-op (no false record written; the structural signal "this tool didn't need permission" is preserved) |
| Different gated tool in flight (parallel) | set but mismatched `tool_use_id` | gate fails on predicate 2 — no-op (sibling tool_result doesn't trigger derivation for the gated one) |
| Pending AskUserQuestion (live or replay) | set but `is_question === true` | gate fails on predicate 3 — no-op (question answers are durable elsewhere via the tool_use/tool_result mechanism per `[D10]`) |

**The model assumes** the SDK only emits its signature rejection text inside `tool_result.content` for a tool that was actually gated. I.e., no ungated tool ever produces a `tool_result` whose text matches the deny signals. This holds today (the deny text is the SDK's literal response to a `tool_approval(decision: "deny")` action, which only exists in response to a `control_request_forward`), and the gate catches any false positive either way (no `pendingApproval` → no record, regardless of the text content).

##### Artifacts {#step-3-5-artifacts}

- `tugdeck/src/lib/code-session-store/reducer.ts` — extend `handleToolResult`; extract a pure helper for the deny-text detection.
- `tugdeck/src/lib/code-session-store/__tests__/reducer.permission-replay.test.ts` *(new)* — replay-shaped fixtures asserting `controlRequestLog` is populated by the tool_result path.
- A small addition under `#investigation-asymmetry` documenting the verified SDK denial-text pattern (so future readers see the evidence for the derivation rule).

##### Tasks {#step-3-5-tasks}

- [ ] Add a pure helper `inferPermissionDecisionFromToolResult(text: string | undefined | null): "allow" | "deny"` to `reducer.ts` (or a sibling pure module). Contract:
  - Returns `"deny"` when the text contains any of a small set of SDK rejection signals (case-insensitive substring match):
    - `"doesn't want to proceed with this tool use"` (the primary opener)
    - `"the tool use was rejected"` (the secondary phrase the SDK pairs with the opener)
  - Returns `"allow"` for everything else: empty / undefined / non-string input, a normal Bash / Read / Grep output, or any text that doesn't carry a recognised deny signal. Per the assertive-posture rationale above (lack of denial in a gated call IS approval), the helper is only ever invoked from a gated call site where this inference is sound.
  - Match phrases are kept SDK-specific enough that a normal Read/Grep/Bash output is extremely unlikely to false-positive. Each signal is a multi-word fragment of the SDK's signature rejection prose, not a single common word. Keep the list short (currently two phrases); extend with one line when an SDK rephrase is observed.
- [ ] In `handleToolResult`, after the existing tool-call-state update, gate on:
  - `state.pendingApproval !== null`,
  - `state.pendingApproval.is_question === false` (questions go through `respond_question`, which writes nothing to `controlRequestLog` per `[D10]`),
  - `state.pendingApproval.tool_use_id === event.tool_use_id`.

  If all three hold:
  - Call `inferPermissionDecisionFromToolResult` on the tool_result content.
  - Append a `ControlRequestRecord` with the inferred `decision` via the shared `commitApprovalToLog(state, decision)` helper.
  - The helper clears `pendingApproval`, restores `prevPhase`, closes the awaiting-approval interval, and appends to `controlRequestLog` — the same state-update shape `handleRespondApproval` produces, so the live and derived paths can't drift apart.
- [ ] Dedup contract: the live path writes via `handleRespondApproval`. The derived path writes via `handleToolResult`. On live sessions, `respond_approval` fires first and clears `pendingApproval`; when the subsequent `tool_result` arrives, the gate's `pendingApproval !== null` predicate fails and the derived path is a no-op. On replay, `respond_approval` never fires; the derived path runs and writes the inferred record. The two paths therefore produce **exactly one** entry per gated request, by mutual exclusion on `pendingApproval` state. No request-id dedup scan needed.
- [ ] Update the existing `reducer.ts` doc-comments on `handleToolResult` and `handleRespondApproval` to cross-reference each other and name the dedup invariant explicitly.
- [ ] Add `#investigation-asymmetry` subsection: *"SDK denial-text pattern."* Cites the verified opener, the two suffix variants, the 140-sample count, and the JSONL file where samples came from.

##### Tests {#step-3-5-tests}

- [ ] `inferPermissionDecisionFromToolResult` — pure-helper unit tests:
  - The exact STOP-form rejection text from a real JSONL sample → `"deny"`.
  - The exact clarify-form rejection text from a real JSONL sample → `"deny"`.
  - Case variation (`"THE USER DOESN'T WANT TO PROCEED…"`, `"the user Doesn't…"`) → `"deny"` (case-insensitive match).
  - Text containing only one of the two signal phrases (e.g., a hypothetical future SDK that drops the opener but keeps `"the tool use was rejected"`) → `"deny"` (either signal triggers).
  - A normal Bash output (e.g., `"hello\n"`, a tokei table) → `"allow"`.
  - A normal Read output (a TypeScript file body, a JSON tree) → `"allow"`.
  - Empty string / null / undefined → `"allow"`.
  - **Hostile-coincidence guard.** A long source-file Read output that happens to *contain* the phrase `"the tool use was rejected"` deep inside (because some user file has that prose) — would yield a false `"deny"`. Out of scope: the helper is only invoked on `tool_result.content` for a `tool_use_id` matching `pendingApproval`, which means a permission *was* asked. Risk is non-zero but contained. Document as a known accepted limitation.
- [ ] New `reducer.permission-replay.test.ts`:
  - **Allow-replay.** Apply `[session_init, tool_use(Bash, tool_use_id=X), control_request_forward(Bash, tool_use_id=X, request_id=R), tool_result(tool_use_id=X, content="hello\n"), turn_complete]`. Assert `state.controlRequestLog` has **one entry** with `decision: "allow"`, `request.request_id === R`, `request.tool_use_id === X`. Assert `state.pendingApproval === null` after the tool_result. Assert `turn.controlRequests` (frozen at turn_complete) carries the same record.
  - **Deny-replay (STOP form).** Same frame shape, tool_result content matches the SDK STOP-form rejection. Assert `controlRequestLog` has one entry with `decision: "deny"`. Same downstream assertions.
  - **Deny-replay (clarify form).** Same frame shape, tool_result content matches the clarify-form rejection. Assert `decision: "deny"`.
  - **Future-SDK-deny-format false-allow tripwire.** Synthesise a hypothetical denial text that doesn't match any signal (e.g., `"User rejected this tool call."`). Assert `controlRequestLog` has one entry with `decision: "allow"` — this is the **known limitation**: a future SDK rephrase that no longer matches any signal phrase would produce a false allow record. The test pins the current behaviour explicitly so the bound is visible and the assertion flips when the helper is updated to recognise the new phrase.
  - **Live-then-tool_result dedup.** Apply `[…, control_request_forward, respond_approval(allow), tool_result(normal output), …]`. Assert `controlRequestLog` has exactly **one** entry with `decision: "allow"` (the live path wrote it; the derived path saw `pendingApproval === null` and did nothing). Same shape with `respond_approval(deny)` and a matching rejection-text tool_result → one entry with `decision: "deny"`.
  - **Question is not touched.** Apply `[…, control_request_forward(AskUserQuestion, is_question=true), tool_result, …]`. Assert `controlRequestLog` is empty (questions never write here per `[D10]`; the `is_question === false` gate skips them).
  - **Tool_use without a prior control_request_forward.** Apply `[tool_use, tool_result]` only. Assert `controlRequestLog` is empty (the derived path's gate `pendingApproval !== null` is the safety net). This is the structural test that *ungated* tool calls never produce a permission record.

##### Checkpoint {#step-3-5-checkpoint}

- [ ] `bun x tsc --noEmit` — clean.
- [ ] `bun test src/lib/code-session-store/__tests__/reducer.permission-replay.test.ts` — every case green.
- [ ] `bun test` — full suite green; no existing test regresses.
- [ ] `bun run audit:tokens lint` — zero violations.
- [ ] Manual HMR: cause a permission decision live, then save an unrelated `.tsx` file to trigger Fast Refresh; the recorded chrome stays put with the correct badge.
- [ ] Manual relaunch: cause a permission decision live, then fully quit and re-launch Tide on the same session; the recorded chrome is reconstructed by JSONL replay with the correct badge.

---

#### Step 4: `AskUserQuestionToolBlock` vocabulary alignment + "wrapper" prose cleanup {#step-4}

**Depends on:** #step-3

**Commit:** `chore(tugways): align AskUserQuestionToolBlock and replace wrapper prose with tool block`

**References:** `[D04]` status icons, `[D05]` progress indicators, `[D06]` salvage scope, `[D11]` tool-block vs wrapper prose, (#audit-current-state)

**Artifacts:**
- Possible minor edits to `cards/tool-wrappers/ask-user-question-tool-block.tsx` / `.css`.
- Prose updates in tugdeck docstrings / doc-comments where "wrapper" was used to describe `*ToolBlock` components.

**Tasks:**
- [ ] Review the tool block's icons against `[D04]`. The streaming state returns `null`; the answered state uses arrow-style "→" prefixes. Consider whether the latter should be a lucide `ArrowRight` for vocabulary consistency.
- [ ] Review the salvage path's `Cancel` and `Send answers` buttons against `[D03]`. Already aligned (filled action + outlined danger, Mac HIG separation).
- [ ] Confirm the salvage banner uses the shared `--tugx-block-tone-caution-*` band.
- [ ] Verify the tool block's `null`-while-streaming behaviour remains correct after Step 3.
- [ ] Prose audit. **Pattern:** case-insensitive `tool[- ]wrapper` (i.e., "tool wrapper" and "tool-wrapper" only — **do not match bare "wrapping" / "wrapper"**, which appears in many legitimate technical contexts: "thin wrapper on Radix", "wrapping chrome region", "stable wrapper", etc.). **Scope:** `tugdeck/src/components/tugways/cards/tool-wrappers/**/*.{tsx,css}` (the tool-block files themselves) plus any explicit cross-references in chrome / wrapping / body-kinds prose. **Action:** replace with "tool block" / "tool-block" where the prose describes a `*ToolBlock` component or the tool_use/tool_result rendering concept. Component-file names (`ToolWrapperChrome`, `DefaultToolWrapper`) stay as-is (out of scope per `[Q06]`).

**Tests:**
- [ ] Existing `ask-user-question-tool-block.test.ts` cases still pass without modification.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` — clean.
- [ ] `cd tugdeck && bun test` — full suite green.
- [ ] `cd tugdeck && bun run audit:tokens lint` — zero violations.
- [ ] Manual HMR: trigger a normal AskUserQuestion (success path) and a validation-error AskUserQuestion (salvage path); verify both render in the family's visual vocabulary.

---

#### Step 5: Integration checkpoint {#step-5}

**Depends on:** #step-2, #step-3, #step-3-5, #step-4

**Commit:** `N/A (verification only)`

**References:** `[D01]` new primitive, `[D02]` cancel semantics, `[D09]` rename, `[D10]` asymmetry load-bearing, `[D13]` durable recorded chrome, (#success-criteria, #step-3-5)

**Tasks:**
- [ ] Verify both dialog surfaces (Permission, Question) compose on `TideInteractiveDialog`.
- [ ] Verify Cancel == Esc == `popInteractive` across the family per `[D02]` (with PermissionDialog `Deny` exemption per `[Q03]`).
- [ ] Cross-check pure-logic tests across all four files (`tide-permission-dialog`, `tide-question-dialog`, `tide-interactive-dialog`, `ask-user-question-tool-block`) plus the new `reducer.permission-replay.test.ts` — every case green.
- [ ] Cross-check the visual chrome on each surface via HMR.
- [ ] **Durability checkpoint** (`#step-3-5`): with a permission decided live (both Allow and Deny variants tested), then fully quit and re-launch Tide on the same session, the recorded chrome reconstructs from JSONL replay with the correct badge (`success` for allow, `danger` for deny). HMR / Developer Reload behave identically. Content the user has already seen does not get pulled away on any boundary.
- [ ] `grep -r peelNewest tugdeck/src` — empty (rename complete).
- [ ] `grep -ri 'tool wrapper\|tool-wrapper' tugdeck/src --include='*.tsx' --include='*.ts'` — only `ToolWrapperChrome` / `DefaultToolWrapper` component-name references remain (out of scope per `[Q06]`).
- [ ] Quick SDK-shape sanity check: confirm `permission_request` / `permission_decision` frames still don't appear in JSONL; AskUserQuestion tool_result still carries answers (asymmetry still load-bearing per `[D10]`); denied tool_results still match the verified `"The user doesn't want to proceed with this tool use."` opener (the `#step-3-5` derivation rule's invariant).

**Tests:**
- [ ] Aggregate: full `bun test` suite green (no regressions).
- [ ] `bun run audit:tokens lint` — zero violations.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` — clean.
- [ ] `cd tugdeck && bun test` — full suite green.
- [ ] `cd tugdeck && bun run audit:tokens lint` — zero violations.
- [ ] HMR-verified live flows on Permission (allow + deny + recorded), Question (multi-question wizard + Cancel + Esc + Submit), AskUserQuestion validation salvage.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A `TideInteractiveDialog` input-form primitive that `PermissionDialog` and `QuestionDialog` both compose on. `session.popInteractive()` replaces `peelNewest` at every callsite. "Wrapper" replaced by "tool block" in tugdeck prose. Family vocabulary (icons, lifecycle states, cancel gesture) consistent across the two surfaces.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] `session.popInteractive()` exists; `session.peelNewest()` does not.
- [ ] `TideInteractiveDialog` ships at `tugways/tide-interactive-dialog.tsx` with module docstring, pure-logic test, CSS file.
- [ ] `PermissionDialog` uses `TideInteractiveDialog` for its pending input-form chrome; existing tests pass unchanged. (The resolved / recorded chrome stays inside `PermissionDialog` per `[D08]` — the primitive is input-form only.)
- [ ] `QuestionDialog` uses `TideInteractiveDialog` for its pending input-form chrome; existing tests pass unchanged; the local actions-row CSS override is gone.
- [ ] Cancel ≡ Esc ≡ `popInteractive` on QuestionDialog and the salvage UI (PermissionDialog's `Deny` exempt per `[Q03]`).
- [ ] Prose audit: no instance of "wrapper" / "wrapping" used to describe `*ToolBlock` components in tugdeck docstrings / doc-comments.
- [ ] **Durable recorded chrome** (`#step-3-5`): both allow and deny decisions reconstruct from `tool_result` content on JSONL replay, so the recorded chrome's badge state survives HMR (in-memory store reset), Developer Reload, and full app relaunch (cold-boot replay). The derivation rule's gate is the wire-level "this tool was gated" predicate (`pendingApproval !== null` matching `tool_use_id`); within that gate, lack-of-denial is treated as allow per `#step-3-5-gating-rationale`. Ungated tool calls are structurally skipped — no false records.
- [ ] Open questions `[Q01]`, `[Q02]` resolved; `[Q03]` resolved during Step 2; `[Q05]`, `[Q06]` recorded as deferred follow-ons.
- [ ] Tests + audit-tokens lint + tsc all green.

**Acceptance tests:**
- [ ] `cd tugdeck && bun test` — full suite green.
- [ ] `cd tugdeck && bun x tsc --noEmit` — clean.
- [ ] `cd tugdeck && bun run audit:tokens lint` — zero violations.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] `[Q06]` — rename `ToolWrapperChrome` / `DefaultToolWrapper` files / components for full consistency with `[D11]`.
- [ ] `[Q05]` — revisit salvage-path generalisation when a second concrete callsite emerges.
- [ ] Persistent/updatable todo list facility (the work pulled out of the original "Interactive Surfaces" framing). Separate plan.

| Checkpoint | Verification |
|------------|--------------|
| `peelNewest` rename complete | `grep -r peelNewest tugdeck/src` → empty |
| `TideInteractiveDialog` extracted | `grep -l TideInteractiveDialog tugdeck/src/components/tugways/*.tsx` returns the primitive file |
| PermissionDialog migrated | `tide-permission-dialog.tsx` imports `TideInteractiveDialog` and does NOT import `TugInlineDialog` directly |
| QuestionDialog migrated | Same shape for `tide-question-dialog.tsx` |
| "Wrapper" prose cleaned | `grep -ri 'tool wrapper\|tool-wrapper' tugdeck/src --include='*.tsx' --include='*.ts' --include='*.md'` — only component-name references remain |
