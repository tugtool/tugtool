<!-- tugplan v2 -->

## Tide Interactive Surfaces {#tide-interactive-surfaces}

**Purpose:** Unify Tide's two interactive transcript surfaces — `PermissionDialog` and `QuestionDialog` (`AskUserQuestion`) — under one shared `TideInteractiveDialog` primitive, harmonise their lifecycle / button / Cancel-Esc / status-icon vocabulary, and close out the polish gaps that surfaced during the AskUserQuestion deep-dive so each surface reads as "the same family, doing its own job."

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

We have two interactive transcript surfaces in the Tide rendering pipeline today:

1. **`PermissionDialog`** (`chrome/tide-permission-dialog.tsx`) — the live allow/deny prompt for tool-permission requests. Renders both the *pending* state (with an inline scope picker + body kind preview) and the *resolved record* state (compact `[Allowed Bash]` / `[Denied Edit]` row, expandable) in the **same** component. Wired into the transcript via the `permissionSlot` and into committed turns via `turn.controlRequests[]`. Composes on `TugInlineDialog`. Cancel = `Deny` → `respondApproval({decision: "deny"})`. Esc → responder chain → `peelNewest` → `interrupt`.
2. **`QuestionDialog`** + **`AskUserQuestionToolBlock`** (`chrome/tide-question-dialog.tsx`, `cards/tool-wrappers/ask-user-question-tool-block.tsx`) — the AskUserQuestion paged wizard. Live state lives in `QuestionDialog` (only renders while `pendingQuestion` is set); the *durable record* is a separate tool-wrapper component built on `ToolWrapperChrome`. No `turn.controlRequests[]` entry — questions are ephemeral per the existing `[DT07]` rule. Composes on `TugInlineDialog`. Cancel = `peelNewest` (just landed; behaviourally identical to Esc). Auto-advance on single-select. Validation-error salvage path.

These two surfaces share a lot of conceptual shape — a pending payload, a transitional state, a settled / resolved state, a "what does Cancel do" question, a "how does it record into history" question, a status-icon vocabulary — but the two concrete implementations diverged. The AskUserQuestion deep-dive this week (paged wizard rail, lucide-icon rationalisation, `TugProgress` `inherit` role, salvage path, Cancel-Esc unification) surfaced a stack of one-off changes that we want to apply consistently rather than re-derive per surface.

#### Strategy {#strategy}

- **Extract a `TideInteractiveDialog` primitive.** The shared shell that `PermissionDialog` and `QuestionDialog` both compose on today is `TugInlineDialog`. That primitive is general-purpose (alerts, single-confirm flows, etc.); the *interactive-surface* concerns — pending vs resolved state, Cancel == Esc == `peelNewest`, history recording, `confirmDisabled` gating, the Mac-HIG actions-row separation — get hoisted into a Tide-specific layer on top.
- **One pattern, two callsites.** PermissionDialog and QuestionDialog migrate onto `TideInteractiveDialog`.
- **Audit first, refactor second.** Step 1 produces a written audit of the two surfaces' current shapes (deep-dive doc). Subsequent steps execute against that audit. We do not extract the primitive before we've named the divergences we want to fold in.
- **Esc / Cancel / Stop is one gesture.** Both surfaces' "walk away" path resolves to `session.peelNewest()` — the unified Stop / Esc gesture the prompt entry already speaks. No more `respondX({})` paths that the model can read as "user picked the defaults."
- **Tests pin pure helpers; HMR vets the visual chrome.** Per project policy. The new primitive's behavioural seams (status mapping, lifecycle transitions, history recording) get pure-logic `bun:test`; the rendered chrome is HMR-vetted against live sessions.

#### Success Criteria (Measurable) {#success-criteria}

- Both interactive surfaces compose on `TideInteractiveDialog` — verified by `grep` over `chrome/tide-permission-dialog.tsx` / `chrome/tide-question-dialog.tsx` for `TideInteractiveDialog` imports.
- `Cancel` button on QuestionDialog and the salvage UI both call `session.peelNewest()` — verified by `grep` + unit tests pinning the handler resolution.
- `tide-question-dialog.test.ts` and `tide-permission-dialog.test.ts` both pass post-migration without any structural changes to their existing assertions (semantics-preserving refactor).
- `bun test` clean across the full suite (≥ 2576 cases, no regressions).
- `bun run audit:tokens lint` → zero violations.
- `bun x tsc --noEmit` → clean.
- Salvage path (AskUserQuestion only) continues to detect validation errors and post answers via `session.send` — pure helper tests still green.

#### Scope {#scope}

1. Audit & document current state of the two surfaces (Deep Dive).
2. Extract `TideInteractiveDialog` primitive at `tugways/tide-interactive-dialog.tsx` (+ `.css`).
3. Migrate `PermissionDialog` onto `TideInteractiveDialog`. Preserve all current behaviour (live ↔ resolved record, scope picker, history record).
4. Migrate `QuestionDialog` onto `TideInteractiveDialog`. Preserve wizard rail, auto-advance, layout stability, Cancel == `peelNewest`.
5. Review `AskUserQuestionToolBlock` against `PermissionDialog`'s resolved-record vocabulary; align where it makes sense (without recording questions into `turn.controlRequests` — that's an explicit non-goal per `[DT07]`).
6. Final integration checkpoint: pure-logic suite green, tsc green, audit-tokens lint clean, HMR-vetted live flows on both surfaces.

#### Non-goals (Explicitly out of scope) {#non-goals}

- Recording AskUserQuestion answers into `turn.controlRequests[]`. Questions remain ephemeral per `[DT07]`. The post-tool wrapper is the durable artifact.
- Generalising the salvage path (post-validation-error answer recovery) to other tools. Salvage is `AskUserQuestion`-only — Bash / Edit / etc. validation errors continue to fall back to `DefaultToolWrapper`'s generic error band.
- Renaming `session.peelNewest()`. The user noted the name reads awkwardly for a question-cancel callsite, but it is the established session API and is referenced by the prompt entry, the keybinding map, and the Stop button. A rename is a session-store refactor that lives in its own plan.
- Replacing `TugInlineDialog`. It stays as the lower-level primitive that `TideInteractiveDialog` composes on; non-interactive callsites (one-shot alerts, confirm prompts) keep using `TugInlineDialog` directly.
- Building a "salvage UI standard." We're keeping the AskUserQuestion-specific surface as-is per the user's explicit direction.

#### Dependencies / Prerequisites {#dependencies}

- The just-landed AskUserQuestion work (commits `77f6b7c6` / `8dd1d7ae`): paged wizard, validation salvage, Cancel → `peelNewest`. This plan refines and harmonises that work — it does not redo it.
- `session.peelNewest()` (`code-session-store.ts:603`) is the unified Stop / Esc / Cancel handler. Its semantics are load-bearing for every Cancel callsite in this plan.
- `TugInlineDialog`'s `confirmDisabled` + `cancelRole` props (landed earlier this session).
- `TugProgress` `inherit` role (landed this session). The salvage path and any in-flight indicators rely on it for tone-correct rendering.

#### Constraints {#constraints}

- The migration must be **behaviour-preserving** for `PermissionDialog`'s existing live ↔ resolved-record state transitions. No regressions to scope picker, history recording, or the resolved-record expand affordance.
- The migration must be **behaviour-preserving** for `QuestionDialog`'s wizard rail — including layout-stability measurement, auto-advance on single-select, `confirmDisabled` gating on the Submit-all button.
- All existing `tide-permission-dialog.test.ts` and `tide-question-dialog.test.ts` assertions must continue to pass after migration. New tests may be added; existing ones must not be silently modified.
- No new tokens introduced unless they replace a duplicated definition across the two surfaces.

#### Assumptions {#assumptions}

- `TugInlineDialog` is the right base layer to compose on. We are not redesigning the underlying primitive.
- Today's `confirmDisabled`, `cancelRole`, and the Mac-HIG actions-row separation are the right surface to lift into the new primitive. They were validated on QuestionDialog this week.
- The user accepts a phase that lifts a primitive without adding net-new user-visible functionality. The user-visible outcome is "everything reads more consistent and is less likely to drift."

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

#### [Q01] What does the `TideInteractiveDialog` primitive own vs delegate to `TugInlineDialog`? (OPEN) {#q01-primitive-boundary}

**Question:** Where does the boundary sit? Three sketches:
- **Thin wrapper.** `TideInteractiveDialog` is mostly a typed bag — opinionated defaults (`cancelRole: "danger"`, `actions row: space-between`, `Esc / Cancel → peelNewest`) baked into a `TugInlineDialog` call. Adds maybe 30-50 lines of glue.
- **Lifecycle owner.** The primitive owns the live ↔ resolved-record shape switch that PermissionDialog has today (and that QuestionDialog *doesn't* — its resolved view is the separate wrapper component). The primitive exposes a `state: "pending" | "resolved" | "settled"` prop and re-renders accordingly. Bigger, with a clearer payoff.
- **Lifecycle owner + session integration.** The primitive subscribes to `session.pendingX` itself and renders nothing when there's no pending request. Pulls a lot of `useSyncExternalStore` ceremony out of the two dialogs.

**Why it matters:** Determines how much PermissionDialog and QuestionDialog shrink after migration, and how much primitive surface tests need to cover.

**Plan to resolve:** Decide in Step 1's deep-dive after the audit is written. Default to the thin-wrapper sketch unless the audit shows a clear lifecycle-owner win.

**Resolution:** OPEN

#### [Q02] Should QuestionDialog gain a `turn.controlRequests` record like PermissionDialog has? (OPEN) {#q02-question-history}

**Question:** Today permission decisions persist in `turn.controlRequests[]` and PermissionDialog renders them as compact `[Allowed Bash]` resolved records. Questions don't — they leave no transcript artifact when the dialog clears. The post-tool `AskUserQuestionToolBlock` wrapper IS the durable artifact, but it lives at a different position in the transcript than the dialog did.

**Why it matters:** Symmetry across the family. Today a permission decision feels like a "thing that happened" in the conversation; a question answer feels like "the dialog vanished, and the wrapper updated." Different mental models.

**Plan to resolve:** Treat as a follow-on. This phase preserves current behaviour (questions stay ephemeral per `[DT07]`); a future phase can revisit if the inconsistency proves disorienting in dogfooding.

**Resolution:** DEFERRED — revisit after the migration if dogfooding flags the inconsistency.

#### [Q03] Cancel button vocabulary across the family — is it always `Cancel`? (OPEN) {#q03-cancel-vocab}

**Question:** Today:
- PermissionDialog uses `Deny` (cancel-position, outlined-action) as a *specific decision*, not a generic cancel.
- QuestionDialog uses `Cancel` (outlined-danger, `peelNewest`).
- The salvage UI uses `Cancel` (outlined-danger, local-only dismiss).

Should PermissionDialog's `Deny` and `Cancel`-style cancellation be separated (Deny = positive decision; Cancel = walk away via `peelNewest`), or is Deny semantically the cancel?

**Why it matters:** `Cancel ≡ Esc ≡ peelNewest` is the design rule for the family. If `Deny` is the equivalent of `Cancel` in PermissionDialog, it should call `peelNewest`. If they're different, the dialog needs both buttons.

**Plan to resolve:** Surface in Step 3 (Permission migration). Default proposal: keep `Deny` as a positive decision (sends `respondApproval({decision: "deny"})`), and surface Esc-only as the `peelNewest` walk-away — no separate `Cancel` button on PermissionDialog. That matches current behaviour and avoids forcing a refactor of the permission flow.

**Resolution:** OPEN — pending Step 3 implementation decision.

#### [Q05] Should the salvage path live inside `TideInteractiveDialog`? (OPEN) {#q05-salvage-primitive}

**Question:** The validation-error salvage path is AskUserQuestion-only (per the user's direction). But the *pattern* — wrapper detects an error, mounts an inline recovery UI, posts a follow-up via `session.send` — is a reusable shape. Worth hoisting into the primitive?

**Why it matters:** Future tools may want similar salvage UX. But adding it now without a second consumer risks over-generalising.

**Plan to resolve:** DEFERRED. Keep the salvage path component-local to `AskUserQuestionToolBlock` per the user's direction. Revisit only when a second concrete callsite emerges.

**Resolution:** DEFERRED — explicit non-goal for this phase.

---

### Risks and Mitigations {#risks}

| Risk | Impact | Likelihood | Mitigation | Trigger to revisit |
|------|--------|------------|------------|--------------------|
| Migration regresses PermissionDialog's live↔resolved transition | high | med | Pin existing tests; HMR-vet against a real permission prompt | First HMR run after Step 3 |
| QuestionDialog's measurement-based layout-stability breaks after refactor | med | low | Keep the measurement helper in QuestionDialog (not the primitive); migration only swaps the outer chrome | Visible layout shift on Next/Back |
| The new primitive accumulates "yet another opinionated wrapper" without clear cuts vs. `TugInlineDialog` | med | med | Step 1's audit defines what moves up and what stays. Anything outside that list is a follow-on, not phase work | Step 2 PR review |
| Cancel == `peelNewest` confuses the model in PermissionDialog (today it gets `respondApproval`-deny on Cancel) | med | low | This phase intentionally does NOT change PermissionDialog's Cancel semantics — [Q03] surfaces the choice; default is "keep Deny as a positive decision" | If [Q03] flips to "Cancel is `peelNewest` for permissions too" |

**Risk R01: TugInlineDialog tests drift** {#r01-inline-dialog-tests}

- **Risk:** Hoisting opinionated defaults into a new primitive may inadvertently change `TugInlineDialog`'s prop defaults (since `TideInteractiveDialog` configures it).
- **Mitigation:** `TugInlineDialog` is not modified by this plan. The new primitive composes on top via call-site defaults, not by editing `TugInlineDialog`'s defaults.
- **Residual risk:** Anyone reading `tide-permission-dialog.tsx` post-migration has to follow two layers (`PermissionDialog → TideInteractiveDialog → TugInlineDialog`) to understand the final rendered chrome. Mitigated by the doc-strings on `TideInteractiveDialog`.

**Risk R02: Audit drift between plan and code** {#r02-audit-drift}

- **Risk:** This plan's audit (Step 1) captures the state at a moment in time; if the AskUserQuestion / Permission code shifts between Step 1 and Step 4, later steps fail to map.
- **Mitigation:** Steps 2-4 execute in a tight window. Each step re-reads the deep-dive's "current state" subsection before starting and updates the doc if anything has drifted.
- **Residual risk:** Low; we control the cadence.

---

### Design Decisions {#design-decisions}

> Record *decisions* (not options). Each decision includes the "why" so later phases don't reopen it accidentally.

#### [D01] `TideInteractiveDialog` is a new primitive that composes on `TugInlineDialog` (DECIDED) {#d01-new-primitive-on-tug-inline-dialog}

**Decision:** Introduce `tugways/tide-interactive-dialog.tsx` as a Tide-specific composition layer on top of `TugInlineDialog`. The two existing dialog callsites (`PermissionDialog`, `QuestionDialog`) migrate onto it. `TugInlineDialog` is not modified.

**Rationale:**
- `TugInlineDialog` is general-purpose; baking the interactive-surface opinions (Cancel-Esc-peelNewest, danger-toned outlined cancel, Mac-HIG separation, `confirmDisabled` gating) into it would push those defaults onto non-interactive callsites (alerts, single-confirm prompts) that shouldn't carry them.
- A Tide-specific layer keeps the opinions in one place — every interactive surface in Tide composes on the same shell.
- The boundary is clean: `TugInlineDialog` owns the visible chrome (frame, icon column, title/description, options stack, actions row); `TideInteractiveDialog` owns the Tide opinions (button vocabulary, lifecycle conventions, walk-away gesture).

**Implications:**
- New file pair: `tugways/tide-interactive-dialog.{tsx,css}`.
- `PermissionDialog`, `QuestionDialog` swap their `TugInlineDialog` import for `TideInteractiveDialog`.
- `TugInlineDialog` keeps every existing prop unchanged.

#### [D02] Cancel ≡ Esc ≡ `peelNewest` across the interactive family (DECIDED) {#d02-cancel-equals-esc-equals-peelnewest}

**Decision:** Every interactive surface's Cancel gesture — button click, Esc keypress, Stop-button click — resolves to `session.peelNewest()`. No `respondX({})` paths that the assistant can read as "user picked the defaults."

**Rationale:**
- Validated this session: AskUserQuestion's `respondQuestion({})` cancel was read by the model as "user accepts the defaults," which was wrong.
- `peelNewest` is the existing unified Stop/Esc gesture (`code-session-store.ts:603`); it handles queued sends LIFO and falls through to `interrupt()` for the running turn.
- One gesture, one wire signal, one model reading.

**Implications:**
- AskUserQuestion's `Cancel` button calls `session.peelNewest()` (landed in `8dd1d7ae`).
- Esc keeps reaching `peelNewest` through the responder chain (no per-dialog Esc handler).
- `[Q03]` calls out whether PermissionDialog's `Deny` (a positive decision via `respondApproval`) should remain distinct from a `Cancel` (peelNewest) on that surface — default is to keep `Deny` as-is and surface Cancel via Esc only.

#### [D03] Cancel button visual: outlined + danger, leading edge, Mac-HIG separation (DECIDED) {#d03-cancel-button-visual}

**Decision:** When an interactive surface renders a Cancel button (any surface in the family), it uses:
- `emphasis="outlined"`, `role="danger"` (via `TugPushButton` / `TugDialogButton`'s role props),
- Leading edge of the actions row (Mac HIG `Don't Save` position),
- The action row uses `justify-content: space-between` so Cancel and the primary action anchor opposite edges.

**Rationale:**
- Establishes that Cancel is destructive-secondary (walk away from this), distinct from the primary action.
- Mac HIG separation makes the two choices read as opposed rather than as a tightly-grouped pair.
- Already in place on QuestionDialog (this session); the primitive lifts it as the family default.

**Implications:**
- `TideInteractiveDialog` defaults `cancelRole` to `"danger"`.
- `TideInteractiveDialog`'s actions row uses `space-between` layout (the CSS override that's currently scoped to `.tide-question-dialog`).
- PermissionDialog's `Deny` already uses outlined-action; this decision doesn't change `Deny` (see [Q03]). If [Q03] later flips to "Deny + Cancel are both buttons," `Cancel` adopts the family visual.

#### [D04] Status icons: lucide only, one vocabulary across the family (DECIDED) {#d04-status-icons}

**Decision:** Row / state status indicators across the interactive family use lucide icons:
- `Check` — confirmed / completed / done
- `Circle` — empty / pending / not-yet
- `CircleDot` — recommended / soft default (the seeded radio option, no user confirmation yet)
- `ChevronRight` — current / focused / "you are here"
- `Loader2` — in-flight / actively running (CSS-animated)

**Rationale:**
- Established this session for QuestionDialog. Visual + semantic vocabulary is sound; using lucide everywhere keeps the family aligned without scope creep.
- No more text-glyph shortcuts (`✓ ▸ ○`) — lucide icons paint via `currentColor`, sit on the cap-height baseline cleanly, and respect `prefers-reduced-motion` for the animated `Loader2`.

**Implications:**
- QuestionDialog already uses `Check` / `Circle` / `CircleDot` / `ChevronRight` — no change.
- Any future interactive-family component picks from this vocabulary, not from text glyphs.

#### [D05] In-flight indicators: `TugProgress` ring with `role="inherit"` (DECIDED) {#d05-progress-role-inherit}

**Decision:** "Work in flight" indicators across the interactive family render `TugProgress variant="ring" size="sm" role="inherit"` so the ring picks up the surrounding text colour rather than the brand accent.

**Rationale:**
- Established for `StreamingPlaceholder` this session. The ring reads as part of the surrounding muted prose, not as a foreground accent.
- `role="inherit"` is the canonical pattern (mirrors `TugBadge`'s `inherit` role); no bespoke styling.

**Implications:**
- `StreamingPlaceholder` already uses this (landed `77f6b7c6`).
- Any new in-flight surface in the family adopts the same shape.

#### [D06] Salvage path stays AskUserQuestion-only (DECIDED) {#d06-salvage-scope}

**Decision:** The "post-validation-error, mount inline recovery UI, post answers via `session.send`" pattern is implemented in `AskUserQuestionToolBlock` and only there. Other tools' validation errors continue to fall back to `DefaultToolWrapper`'s generic error band.

**Rationale:**
- Per the user's explicit direction. Premature generalisation without a second concrete callsite invites design churn.
- The pattern is well-contained inside the AskUserQuestion wrapper today (pure helpers + a single component).

**Implications:**
- `[Q05]` is deferred.
- The salvage helpers stay in `cards/tool-wrappers/ask-user-question-tool-block.tsx`. They are not lifted to the new primitive.

---

### Deep Dives {#deep-dives}

#### Surface audit — current state {#audit-current-state}

> Written up in detail during Step 1; sketched here as the working hypothesis.

**`PermissionDialog`** (`chrome/tide-permission-dialog.tsx`):
- One component, two states (pending → resolved-record), in-place transition via local `decision` state + store-driven `isPending`.
- Composes `TugInlineDialog` with: icon `ShieldAlert`, iconRole `caution`, title `"Permission requested"`, body via `PendingBody` (smart-picks a body kind by tool), `options` for scope picker, `confirmLabel: "Allow"`, `cancelLabel: "Deny"`.
- History: writes to `turn.controlRequests[]` via the reducer.
- Cancel = `Deny`, a positive decision (sends `respondApproval({decision: "deny"})`, not `peelNewest`).
- Esc currently → responder chain → `peelNewest` (same as for the question dialog and the prompt entry).

**`QuestionDialog`** (`chrome/tide-question-dialog.tsx`):
- One component, one state (pending only). Renders `null` when no `pendingQuestion`.
- Composes `TugInlineDialog` with: icon `MessageCircleQuestion`, iconRole `info`, title `"Claude has questions"` / `"Claude has a question"`, body = the wizard rail (multi-question) or the single-question option group, `confirmLabel: "Submit all"` (gated via `confirmDisabled`), `cancelLabel: "Cancel"` (role `"danger"`).
- History: none. Question is ephemeral per `[DT07]`.
- Cancel = `peelNewest` (landed `8dd1d7ae`).
- Esc → responder chain → `peelNewest`.

**`AskUserQuestionToolBlock`** (`cards/tool-wrappers/ask-user-question-tool-block.tsx`):
- The durable transcript artifact. Renders `null` while streaming (the live dialog is the surface); renders Q&A summary post-answer; renders the salvage UI on validation errors with parseable input.
- Composes `ToolWrapperChrome` (NOT `TugInlineDialog`).
- Not a "dialog" — a body kind in tool-wrapper clothing. Don't migrate to `TideInteractiveDialog`. Reviewed in Step 5 only for vocabulary alignment.

#### The boundary question: what does `TideInteractiveDialog` own? {#primitive-boundary-question}

See `[Q01]`. Working sketch (thin wrapper):

```ts
interface TideInteractiveDialogProps extends TugInlineDialogProps {
  // No new visible props; the layer is mostly default substitutions:
  //   cancelRole: "danger" (default, was "action")
  //   actions row uses space-between (default, was flex-end)
  //   Esc reaches responder chain; no local Esc handler
  // Plus a doc-comment lock on the contract for the family.
}
```

If Step 1's audit reveals more shared logic (e.g., both dialogs' `useSyncExternalStore` on `pendingX`), the primitive grows to absorb it. Default is thin until the audit justifies more.

#### Why this isn't a `TugInlineDialog` refactor {#why-not-tug-inline-dialog}

`TugInlineDialog` is also used by other surfaces in the app that are NOT interactive in this sense (one-shot alerts, transient confirms). Pushing the Cancel-Esc-peelNewest opinion into it would force those callsites either to opt out or inherit semantics that don't apply.

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
| Esc handling | None (bubbles to responder chain) | None (bubbles to responder chain) — explicit confirmation that this stays the same |
| Cancel onClick | Caller-supplied | Caller-supplied; family convention is `session.peelNewest()` (see `[D02]`) |

**Pass-through.** Every other `TugInlineDialog` prop (icon, title, description, options, confirmLabel, etc.) flows through unchanged.

**Type:**

```ts
export interface TideInteractiveDialogProps
  extends Omit<TugInlineDialogProps, "cancelRole"> {
  /** Cancel-button colour domain. Defaults to "danger" for the
   *  interactive-family vocabulary. Pass "action" explicitly to
   *  opt out (PermissionDialog's "Deny" likely does so). */
  cancelRole?: TugInlineDialogCancelRole;
}
```

#### Spec S02: Cancel semantics contract {#s02-cancel-semantics}

For every interactive-family surface:

1. Cancel button → `session.peelNewest()` directly OR a callback that ultimately calls `peelNewest()`. (PermissionDialog's `Deny` is exempt per `[Q03]`.)
2. Esc keypress → responder chain → `CANCEL_DIALOG` action → prompt entry's `peelNewest()` handler. The dialog does not intercept Esc locally.
3. No `respondX({})` paths from a Cancel gesture. (Cancel ≠ "submit empty.")

#### Spec S03: Family visual vocabulary {#s03-visual-vocabulary}

- Status icons: per `[D04]`.
- In-flight indicator: per `[D05]`.
- Cancel button visual: per `[D03]`.
- Frame width: each surface picks its own (`PermissionDialog`: 520 px CTA-sized; `QuestionDialog`: 700 px wide for question prose). The primitive doesn't lock width.

---

### Definitive Symbol Inventory {#symbol-inventory}

#### New files {#new-files}

| File | Purpose |
|------|---------|
| `tugdeck/src/components/tugways/tide-interactive-dialog.tsx` | New primitive composing on `TugInlineDialog` |
| `tugdeck/src/components/tugways/tide-interactive-dialog.css` | Style overrides (actions-row `space-between`) |
| `tugdeck/src/components/tugways/tide-interactive-dialog.test.ts` | Pure-logic test pinning the default-substitution surface |

#### Files modified {#files-modified}

| File | Change |
|------|--------|
| `tugdeck/src/components/tugways/chrome/tide-permission-dialog.tsx` | Swap `TugInlineDialog` → `TideInteractiveDialog`; explicit `cancelRole="action"` for `Deny` |
| `tugdeck/src/components/tugways/chrome/tide-question-dialog.tsx` | Swap `TugInlineDialog` → `TideInteractiveDialog`; drop the local CSS override for actions-row `space-between` (moves into primitive) |
| `tugdeck/src/components/tugways/chrome/tide-question-dialog.css` | Remove the `.tide-question-dialog .tug-inline-dialog-actions { justify-content: space-between }` block (moved into primitive) |

#### Symbols to add / modify {#symbols}

| Symbol | Kind | Location | Notes |
|--------|------|----------|-------|
| `TideInteractiveDialog` | React.FC | `tide-interactive-dialog.tsx` | The new primitive |
| `TideInteractiveDialogProps` | interface | `tide-interactive-dialog.tsx` | Per Spec S01 |
| `DEFAULT_CANCEL_ROLE` | const | `tide-interactive-dialog.tsx` | `"danger"` |

---

### Documentation Plan {#documentation-plan}

- [ ] Module docstring on `TideInteractiveDialog` explaining the boundary with `TugInlineDialog`, the [D02] / [D03] defaults, and the family convention.
- [ ] Cross-reference from `chrome/tide-permission-dialog.tsx` and `chrome/tide-question-dialog.tsx` to `TideInteractiveDialog` so future readers see "this is part of the family."

---

### Test Plan Concepts {#test-plan-concepts}

#### Test Categories {#test-categories}

| Category | Purpose | When to use |
|----------|---------|-------------|
| **Pure-logic unit** | Pin helpers (already done for question dialog, permission dialog) | Existing tests must continue to pass |
| **Default substitution** | Verify `TideInteractiveDialog` flips the right defaults | Step 2 |
| **Live HMR** | Verify the rendered chrome reads correctly (permission allow/deny, question wizard) | Each migration step |

Pure-logic tests stay attached to the consumer modules (`tide-permission-dialog.test.ts`, `tide-question-dialog.test.ts`). The primitive adds a tiny `tide-interactive-dialog.test.ts` that pins the default substitution + the `confirmDisabled` pass-through. No fake-DOM render tests.

---

### Execution Steps {#execution-steps}

> Commit after every step's checkpoints pass.

#### Step 1: Surface audit + plan validation {#step-1}

**Commit:** `docs(roadmap): audit current state of Tide interactive surfaces`

**References:** [D01] new primitive on TugInlineDialog, [Q01] primitive boundary, (#audit-current-state, #primitive-boundary-question)

**Artifacts:**
- A written audit subsection under `#audit-current-state` in this plan, expanded with line references (current at this moment) and behaviours. Each of the two dialog surfaces gets a "What it owns / What it delegates / How it transitions" paragraph; the `AskUserQuestionToolBlock` gets a shorter "post-tool wrapper — out of primitive scope" paragraph.
- A `Q01` resolution proposal at the end of the audit (thin-wrapper vs. lifecycle-owner). Default proposal recorded; user can flip if needed.

**Tasks:**
- [ ] Audit `PermissionDialog` (transitions, history, cancel semantics, props passed to `TugInlineDialog`).
- [ ] Audit `QuestionDialog` (wizard rail, measurement helper, layout-stability lock, cancel handler).
- [ ] Audit `AskUserQuestionToolBlock` (post-tool wrapper; salvage path; status mapping).
- [ ] Write the comparison table under `#audit-current-state`.
- [ ] Resolve [Q01].

**Tests:**
- [ ] _none — documentation step_

**Checkpoint:**
- [ ] Plan updated with the audit table + [Q01] resolution; reviewed before Step 2 starts.

---

#### Step 2: Extract `TideInteractiveDialog` primitive {#step-2}

**Depends on:** #step-1

**Commit:** `feat(tugways): TideInteractiveDialog primitive for interactive-family surfaces`

**References:** [D01] new primitive, [D02] cancel semantics, [D03] cancel button visual, Spec S01, (#why-not-tug-inline-dialog)

**Artifacts:**
- `tugdeck/src/components/tugways/tide-interactive-dialog.tsx`
- `tugdeck/src/components/tugways/tide-interactive-dialog.css`
- `tugdeck/src/components/tugways/tide-interactive-dialog.test.ts`

**Tasks:**
- [ ] Implement `TideInteractiveDialog` per Spec S01. Default `cancelRole: "danger"`.
- [ ] Move the actions-row `space-between` CSS override from `tide-question-dialog.css` to `tide-interactive-dialog.css`, scoped to a stable class (`.tide-interactive-dialog`).
- [ ] Module docstring per `[D01]`. Doc-link to `TugInlineDialog` for "what lives one layer down."
- [ ] Pure-logic test: passing `cancelRole="action"` overrides the default; passing nothing yields `"danger"`; `confirmDisabled` passes through.

**Tests:**
- [ ] `TideInteractiveDialog` defaults `cancelRole` to `"danger"` when omitted.
- [ ] `cancelRole="action"` from the caller overrides the default.
- [ ] `confirmDisabled` propagates to `TugInlineDialog` unchanged.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` — clean.
- [ ] `cd tugdeck && bun test tugways/tide-interactive-dialog.test.ts` — pass.
- [ ] `cd tugdeck && bun test` — full suite green (no regressions).
- [ ] `cd tugdeck && bun run audit:tokens lint` — zero violations.

---

#### Step 3: Migrate `PermissionDialog` onto `TideInteractiveDialog` {#step-3}

**Depends on:** #step-2

**Commit:** `refactor(tugways): PermissionDialog composes on TideInteractiveDialog`

**References:** [D01] new primitive, [D02] cancel semantics, [Q03] cancel vocab on permissions, (#audit-current-state)

**Artifacts:**
- Edits to `chrome/tide-permission-dialog.tsx`.

**Tasks:**
- [ ] Swap `import { TugInlineDialog }` for `import { TideInteractiveDialog }`.
- [ ] Pass `cancelRole="action"` explicitly so `Deny` keeps its outlined-action treatment (per [Q03] default resolution).
- [ ] Verify the resolved-record state still in-place-transitions correctly (no remount under the same `request_id`).
- [ ] Verify history-recording behaviour unchanged (the reducer doesn't depend on the visible chrome).

**Tests:**
- [ ] Existing `tide-permission-dialog.test.ts` cases still pass without modification (the migration is semantics-preserving).
- [ ] No new tests required unless a behaviour change is found during HMR (Step 3 must not change behaviour; only the composition layer).

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` — clean.
- [ ] `cd tugdeck && bun test chrome/tide-permission-dialog.test.ts` — pass.
- [ ] `cd tugdeck && bun test` — full suite green.
- [ ] Manual HMR: trigger a permission prompt (`Bash` requiring approval); verify Allow / Deny paths and the resolved-record state render identically to pre-migration. Resolve `[Q03]` based on observed behaviour.

---

#### Step 4: Migrate `QuestionDialog` onto `TideInteractiveDialog` {#step-4}

**Depends on:** #step-2

**Commit:** `refactor(tugways): QuestionDialog composes on TideInteractiveDialog`

**References:** [D01] new primitive, [D02] cancel semantics, [D03] cancel button visual, (#audit-current-state)

**Artifacts:**
- Edits to `chrome/tide-question-dialog.tsx`, `chrome/tide-question-dialog.css`.

**Tasks:**
- [ ] Swap `TugInlineDialog` for `TideInteractiveDialog`.
- [ ] Drop the local `.tide-question-dialog .tug-inline-dialog-actions { justify-content: space-between }` block (the primitive owns it now). Keep the frame-width override.
- [ ] Verify the measurement helper for layout stability still works (it's component-local and untouched).
- [ ] Verify Cancel still resolves to `session.peelNewest()`.

**Tests:**
- [ ] Existing `tide-question-dialog.test.ts` cases still pass without modification.
- [ ] No new tests required unless behaviour changes (which it shouldn't).

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` — clean.
- [ ] `cd tugdeck && bun test chrome/tide-question-dialog.test.ts` — pass.
- [ ] `cd tugdeck && bun test` — full suite green.
- [ ] Manual HMR: a real AskUserQuestion flow with multi-question payload; verify wizard rail, auto-advance, Cancel button (peelNewest), Esc (peelNewest) all behave identically to pre-migration.

---

#### Step 5: `AskUserQuestionToolBlock` post-tool surface review {#step-5}

**Depends on:** #step-4

**Commit:** `chore(tugways): align AskUserQuestionToolBlock vocabulary with the family`

**References:** [D04] status icons, [D05] progress indicators, [D06] salvage scope, (#audit-current-state)

**Artifacts:**
- Possible minor edits to `cards/tool-wrappers/ask-user-question-tool-block.tsx` / `.css`.

**Tasks:**
- [ ] Review the wrapper's icons against `[D04]`. Today the streaming state returns `null` (no icon needed); the answered state uses arrow-emoji-style "→" prefixes. Consider whether the latter should be a lucide `ArrowRight` for vocabulary consistency.
- [ ] Review the salvage path's `Cancel` and `Send answers` buttons against `[D03]`. Already aligned (filled action + outlined danger, Mac HIG separation).
- [ ] Confirm the salvage path's banner uses the shared `--tugx-block-tone-caution-*` band (no change expected).
- [ ] Verify the wrapper's `null`-while-streaming behaviour remains correct after Step 4.

**Tests:**
- [ ] Existing `ask-user-question-tool-block.test.ts` cases still pass without modification.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` — clean.
- [ ] `cd tugdeck && bun test` — full suite green.
- [ ] Manual HMR: trigger a normal AskUserQuestion (success path) and a validation-error AskUserQuestion (salvage path); verify both render in the family's visual vocabulary.

---

#### Step 6: Integration checkpoint {#step-6}

**Depends on:** #step-3, #step-4, #step-5

**Commit:** `N/A (verification only)`

**References:** [D01] new primitive, [D02] cancel semantics, (#success-criteria)

**Tasks:**
- [ ] Verify both dialog surfaces (Permission, Question) compose on the new primitive.
- [ ] Verify Cancel == Esc == `peelNewest` across the family per `[D02]` (with the documented PermissionDialog `Deny` exemption).
- [ ] Cross-check pure-logic tests across all four test files (`tide-permission-dialog`, `tide-question-dialog`, `tide-interactive-dialog`, `ask-user-question-tool-block`) — every case green.
- [ ] Cross-check the visual chrome on each surface via HMR.

**Tests:**
- [ ] Aggregate: full `bun test` suite green (no regressions).
- [ ] `bun run audit:tokens lint` — zero violations.

**Checkpoint:**
- [ ] `cd tugdeck && bun x tsc --noEmit` — clean.
- [ ] `cd tugdeck && bun test` — full suite green.
- [ ] `cd tugdeck && bun run audit:tokens lint` — zero violations.
- [ ] HMR-verified live flows on Permission (allow + deny + resolved record), Question (multi-question wizard + Cancel + Esc + Submit), AskUserQuestion validation salvage.

---

### Deliverables and Checkpoints {#deliverables}

**Deliverable:** A `TideInteractiveDialog` primitive that `PermissionDialog` and `QuestionDialog` both compose on, with the family's Cancel-Esc-peelNewest / icons / progress-indicator vocabulary applied consistently across both interactive surfaces.

#### Phase Exit Criteria ("Done means…") {#exit-criteria}

- [ ] `TideInteractiveDialog` ships at `tugways/tide-interactive-dialog.tsx` with module docstring, pure-logic test, CSS file.
- [ ] `PermissionDialog` imports and composes on `TideInteractiveDialog`; existing tests pass unchanged.
- [ ] `QuestionDialog` imports and composes on `TideInteractiveDialog`; existing tests pass unchanged; the local actions-row CSS override is gone.
- [ ] Cancel ≡ Esc ≡ `peelNewest` on QuestionDialog and the salvage UI (and PermissionDialog's `Deny` exempt per `[Q03]`).
- [ ] Open questions `[Q01]`, `[Q03]` resolved; `[Q02]`, `[Q05]` recorded as deferred follow-ons.
- [ ] Tests + audit-tokens lint + tsc all green.

**Acceptance tests:**
- [ ] `cd tugdeck && bun test` — full suite green.
- [ ] `cd tugdeck && bun x tsc --noEmit` — clean.
- [ ] `cd tugdeck && bun run audit:tokens lint` — zero violations.

#### Roadmap / Follow-ons (Explicitly Not Required for Phase Close) {#roadmap}

- [ ] Revisit `[Q02]` (QuestionDialog history) after dogfooding the migration.
- [ ] Revisit `[Q05]` (salvage path generalisation) when a second concrete callsite emerges.
- [ ] Consider whether `session.peelNewest()` deserves a friendlier name now that it surfaces in more callsite doc-comments (`session.cancelNewest()`? `session.abandonNewest()`?). Separate session-store plan; not a UX plan.

| Checkpoint | Verification |
|------------|--------------|
| `TideInteractiveDialog` extracted | `grep -l TideInteractiveDialog tugdeck/src/components/tugways/*.tsx` returns the primitive file |
| PermissionDialog migrated | `tide-permission-dialog.tsx` imports `TideInteractiveDialog` and does NOT import `TugInlineDialog` directly |
| QuestionDialog migrated | Same shape as above for `tide-question-dialog.tsx` |
