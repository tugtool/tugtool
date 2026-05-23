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

#### [Q03] Cancel button vocabulary on PermissionDialog — is `Deny` the cancel, or a separate Cancel button? (OPEN) {#q03-cancel-vocab}

**Question:** Today PermissionDialog uses `Deny` as a *positive decision* (`respondApproval({decision: "deny"})`), distinct from `popInteractive`. QuestionDialog uses `Cancel` (outlined-danger, `popInteractive`). Should PermissionDialog gain a separate `Cancel` button alongside `Deny`, or stay with `Deny` only and surface `popInteractive` via Esc?

**Why it matters:** `Cancel ≡ Esc ≡ popInteractive` is the family rule. If `Deny` is semantically the cancel, it should call `popInteractive`. If they're different, the dialog needs both buttons.

**Plan to resolve:** Step 2 (PermissionDialog migration). Default: keep `Deny` as a positive decision (sends `respondApproval({decision: "deny"})`) and surface Esc-only as the `popInteractive` walk-away — no separate `Cancel` button on PermissionDialog. That matches current behaviour and avoids a permission-flow refactor.

**Resolution:** OPEN — pending Step 2 implementation decision.

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
| `tugdeck/src/components/tugways/chrome/tide-permission-dialog.tsx` | Swap `TugInlineDialog` → `TideInteractiveDialog`; explicit `cancelRole="action"` for `Deny` |
| `tugdeck/src/components/tugways/chrome/tide-question-dialog.tsx` | Update `handleCancel` to call `popInteractive` (Step 0); swap `TugInlineDialog` → `TideInteractiveDialog` (Step 3); drop the local CSS override for actions-row `space-between` (moved into primitive) |
| `tugdeck/src/components/tugways/chrome/tide-question-dialog.css` | Remove the `.tide-question-dialog .tug-inline-dialog-actions { justify-content: space-between }` block |
| `tugdeck/src/components/tugways/cards/tool-wrappers/ask-user-question-tool-block.tsx` | Vocabulary alignment + prose cleanup (Step 4). **Salvage UI Cancel handler is NOT updated** — it stays on local `setSalvageCancelled` per the `[D02]` carve-out. |
| `tugdeck/src/components/tugways/tug-prompt-entry.tsx` | Update Esc / Stop wiring to call `popInteractive` (Step 0). |
| `tugdeck/src/components/tugways/cards/tide-card-transcript.tsx` | One prose reference to the "Stop / Esc peel-newest gesture" updated to "Stop / Esc pop-interactive gesture" (Step 0). |
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
- [ ] Cross-reference from `chrome/tide-permission-dialog.tsx` and `chrome/tide-question-dialog.tsx` to `TideInteractiveDialog`.
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
- [ ] Swap `import { TugInlineDialog }` for `import { TideInteractiveDialog }`.
- [ ] Pass `cancelRole="action"` explicitly so `Deny` keeps its outlined-action treatment (per `[Q03]` default resolution).
- [ ] Verify the resolved-record state still in-place-transitions correctly (no remount under the same `request_id`) — `[L26]` mount-identity stability. The chrome swap must keep React-reconciliation identity byte-identical: same `key`, same component type, same renderer reference at the pending → resolved → recorded transitions. If any of the three drifts, the user-visible state (scroll, focus, in-flight CSS transitions) is torn down.
- [ ] Verify history-recording behaviour unchanged (the reducer doesn't depend on the visible chrome).

**Tests:**
- [ ] Existing `tide-permission-dialog.test.ts` cases still pass without modification.
- [ ] No new tests required unless behaviour change found during HMR.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` — clean.
- [ ] `cd tugdeck && bun test chrome/tide-permission-dialog.test.ts` — pass.
- [ ] `cd tugdeck && bun test` — full suite green.
- [ ] Manual HMR: trigger a permission prompt (`Bash` requiring approval); verify Allow / Deny paths and the recorded state render identically to pre-migration. Resolve `[Q03]` based on observed behaviour.

---

#### Step 3: Migrate `QuestionDialog` onto `TideInteractiveDialog` {#step-3}

**Depends on:** #step-1

**Commit:** `refactor(tugways): QuestionDialog composes on TideInteractiveDialog`

**References:** `[D01]` new primitive, `[D02]` cancel semantics, `[D03]` cancel button visual, `[D08]` input-form scope, (#audit-current-state)

**Artifacts:**
- Edits to `chrome/tide-question-dialog.tsx`, `chrome/tide-question-dialog.css`.

**Tasks:**
- [ ] Swap `TugInlineDialog` for `TideInteractiveDialog`.
- [ ] Drop the local `.tide-question-dialog .tug-inline-dialog-actions { justify-content: space-between }` block (the primitive owns it now). Keep the frame-width override.
- [ ] Verify the measurement helper for layout stability still works (it's component-local and untouched).
- [ ] Verify Cancel still resolves to `session.popInteractive()` (Step 0 already updated this; sanity-check after the chrome swap).

**Tests:**
- [ ] Existing `tide-question-dialog.test.ts` cases still pass without modification.
- [ ] No new tests required unless behaviour changes.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` — clean.
- [ ] `cd tugdeck && bun test chrome/tide-question-dialog.test.ts` — pass.
- [ ] `cd tugdeck && bun test` — full suite green.
- [ ] Manual HMR: a real AskUserQuestion flow with multi-question payload; verify wizard rail, auto-advance, Cancel button (`popInteractive`), Esc (`popInteractive`) all behave identically to pre-migration.

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

**Depends on:** #step-2, #step-3, #step-4

**Commit:** `N/A (verification only)`

**References:** `[D01]` new primitive, `[D02]` cancel semantics, `[D09]` rename, `[D10]` asymmetry load-bearing, (#success-criteria)

**Tasks:**
- [ ] Verify both dialog surfaces (Permission, Question) compose on `TideInteractiveDialog`.
- [ ] Verify Cancel == Esc == `popInteractive` across the family per `[D02]` (with PermissionDialog `Deny` exemption per `[Q03]`).
- [ ] Cross-check pure-logic tests across all four files (`tide-permission-dialog`, `tide-question-dialog`, `tide-interactive-dialog`, `ask-user-question-tool-block`) — every case green.
- [ ] Cross-check the visual chrome on each surface via HMR.
- [ ] `grep -r peelNewest tugdeck/src` — empty (rename complete).
- [ ] `grep -ri 'tool wrapper\|tool-wrapper' tugdeck/src --include='*.tsx' --include='*.ts'` — only `ToolWrapperChrome` / `DefaultToolWrapper` component-name references remain (out of scope per `[Q06]`).
- [ ] Quick SDK-shape sanity check: confirm `permission_request` / `permission_decision` frames still don't appear in JSONL; AskUserQuestion tool_result still carries answers (asymmetry still load-bearing per `[D10]`).

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
