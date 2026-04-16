/**
 * action-vocabulary.ts — the central registry of action names that
 * flow through the responder chain.
 *
 * Every action dispatched via `manager.sendToFirstResponder`, registered via
 * `useResponder`'s actions map, or bound in `keybinding-map.ts` must
 * reference a name from `TUG_ACTIONS` below. The `TugAction` union
 * is derived from `TUG_ACTIONS` via `as const`, so adding a new
 * action is one edit (the constants object) and the union, the
 * compile-time checks, and the call sites pick it up automatically.
 *
 * ## The constants idiom
 *
 * `TUG_ACTIONS` is the single source of truth. Each key is the
 * canonical `SCREAMING_SNAKE_CASE` constant name; each value is the
 * wire-format string dispatched on the chain. `TugAction` is
 * `typeof TUG_ACTIONS[keyof typeof TUG_ACTIONS] | Extra`, so the
 * union literally cannot drift from the constants. Call sites
 * always reference the constant, never a raw string literal:
 *
 * ```ts
 * controlDispatch.dispatch({ action: TUG_ACTIONS.CUT, phase: "discrete" });
 *
 * useResponder({
 *   id: cardId,
 *   actions: {
 *     [TUG_ACTIONS.CLOSE]: (_e: ActionEvent) => handleClose(),
 *   },
 * });
 * ```
 *
 * See `tuglaws/action-naming.md` for the naming convention, the
 * three-way classification (chain action / control frame / both),
 * and the enforcement policy.
 *
 * ## Vocabulary granularity decision (middle ground)
 *
 * One action per semantic, rich payloads carried on
 * `ActionEvent.value`. E.g. a single `set-value` action covers
 * sliders, value-inputs, and numeric fields, with the payload's
 * type documented alongside the constant in this file. This keeps
 * the name-level type union tight without exploding it into
 * per-control variants.
 *
 * Payload conventions are documented per-action below. Handlers
 * should narrow `event.value` defensively — TypeScript cannot
 * express "this value is a number *only* when action is set-value"
 * without a discriminated union, which would force all callers to
 * construct richly-typed ActionEvent objects at every dispatch
 * site. The current tradeoff is: tight action *names*, loose
 * `value` shape, with conventions documented here and enforced by
 * handler authors.
 *
 * Laws: [L11] controls emit actions; responders handle actions.
 *
 * When adding a new action:
 *   1. Pick a name following the `<verb>-<object>[-<modifier>]`
 *      rule from `tuglaws/action-naming.md`.
 *   2. Classify it: chain action, control frame, or both.
 *   3. For chain-action / both categories: add one entry to
 *      `TUG_ACTIONS` (or `TUG_GALLERY_ACTIONS`) in the appropriate
 *      section below, with an adjacent payload comment.
 *   4. Document the expected payload shape on `ActionEvent.value`.
 *   5. Document `ActionEvent.sender` expectations if multiple
 *      controls of the same kind can emit this action.
 *   6. Compile — the derived `TugAction` union picks up the new
 *      member automatically, so every call site referencing
 *      `TUG_ACTIONS.<NEW>` type-checks without any other edit.
 */

/* ---------------------------------------------------------------------------
 * TUG_ACTIONS — production action constants
 * ---------------------------------------------------------------------------
 *
 * Values are kebab-case wire strings per `tuglaws/action-naming.md`.
 * Keys are the SCREAMING_SNAKE_CASE canonical constant names every
 * call site references. Single-word names keep the same spelling
 * in both forms (`CUT` → `"cut"`); multi-word names convert at
 * word boundaries (`SELECT_ALL` → `"select-all"`).
 */
export const TUG_ACTIONS = {
  // ---- Clipboard ----
  //
  // NAMESPACE BOUNDARY: These kebab-case strings are chain-dispatch
  // names, NOT browser execCommand names. Handlers that call
  // document.execCommand must use the browser's own camelCase
  // vocabulary ("selectAll", "insertText", "delete", etc.).
  // See tuglaws/action-naming.md § "Action Names vs. Browser
  // Command Names" for the full rule.
  //
  // CUT:         payload — none. The first responder cuts its current
  //              selection. Handlers typically return a continuation for
  //              two-phase activation (copy to clipboard synchronously,
  //              delete the selection after the menu blink).
  // COPY:        payload — none. The first responder copies its current
  //              selection. No continuation expected.
  // PASTE:       payload — none. The first responder pastes clipboard
  //              content. Handlers typically return a continuation so the
  //              paste happens after any menu activation animation.
  // SELECT_ALL:  payload — none. The first responder selects all of its
  //              content. The handler calls document.execCommand("selectAll")
  //              — note the camelCase browser command name, not this
  //              kebab-case action name.
  // SELECT_NONE: payload — none. The first responder collapses its
  //              selection. NOTE: no responder currently registers a
  //              handler for this — dispatching is a silent no-op
  //              until a control wires it up.
  CUT:         "cut",
  COPY:        "copy",
  PASTE:       "paste",
  SELECT_ALL:  "select-all",
  SELECT_NONE: "select-none",

  // ---- Editing ----
  //
  // UNDO:      payload — none. macOS semantics: the innermost editor
  //            responder handles it against its own history; if none is
  //            focused, the nearest ancestor that registered for undo
  //            handles it (tab reopen, layout restore, etc.).
  // REDO:      payload — none. Symmetric with undo.
  // DELETE:    payload — none. The first responder deletes its current
  //            selection (or the item at the focus point).
  // DUPLICATE: payload — none. The first responder duplicates its
  //            current selection.
  UNDO:      "undo",
  REDO:      "redo",
  DELETE:    "delete",
  DUPLICATE: "duplicate",

  // ---- Submission ----
  //
  // TUG_ACTIONS.SUBMIT:
  //     payload — none. Dispatched by a form or submission-shaped
  //     control to mean "commit the current draft intent." The
  //     responder handler reads the live state from the store or
  //     delegate at dispatch time (per [L07]) to decide what
  //     "commit" means — send, interrupt, save, etc. For
  //     TugPromptEntry, the single action covers both send and
  //     interrupt depending on `snap.canInterrupt` at dispatch
  //     time (see plan [D05] for the submit/interrupt unification
  //     rationale). Phase is always `discrete`.
  //     sender — typically the submit button's id; handlers
  //     generally do not narrow on sender because any submit
  //     dispatch routed to the handler means the same thing.
  SUBMIT: "submit",

  // ---- Navigation ----
  //
  // CYCLE_CARD:     payload — none. Canvas-level: rotate through cards.
  // PREVIOUS_TAB:   payload — none. Card-level: switch to previous tab.
  // NEXT_TAB:       payload — none. Card-level: switch to next tab.
  // FOCUS_NEXT:     payload — none. Move keyboard focus to the next
  //                 focusable responder. NOTE: no handler yet —
  //                 ⇥/⇧⇥ are deferred per the A3 / R4 retrospective.
  //                 Dispatching is a silent no-op until a chain-wide
  //                 focus-next implementation lands.
  // FOCUS_PREVIOUS: payload — none. Move keyboard focus to the previous
  //                 focusable responder. NOTE: no handler yet — see
  //                 FOCUS_NEXT.
  // JUMP_TO_TAB:    payload — `value: number` (1-based tab index).
  //                 Card-level: switch to the Nth tab. Used by ⌘1..9.
  CYCLE_CARD:     "cycle-card",
  PREVIOUS_TAB:   "previous-tab",
  NEXT_TAB:       "next-tab",
  FOCUS_NEXT:     "focus-next",
  FOCUS_PREVIOUS: "focus-previous",
  JUMP_TO_TAB:    "jump-to-tab",

  // ---- Dialog / menu ----
  //
  // CONFIRM_DIALOG:  payload — none. The first dialog-like responder
  //                  confirms its pending action.
  // CANCEL_DIALOG:   payload — none. The first dialog-like responder
  //                  cancels its pending action.
  // DISMISS_POPOVER: payload — none. Close the nearest popover.
  // OPEN_MENU:       payload — none. Open the contextually-appropriate
  //                  menu for the first responder.
  CONFIRM_DIALOG:  "confirm-dialog",
  CANCEL_DIALOG:   "cancel-dialog",
  DISMISS_POPOVER: "dismiss-popover",
  OPEN_MENU:       "open-menu",

  // ---- Control value ----
  //
  // SET_VALUE:       payload — shape depends on control:
  //                    - sliders, value-inputs: `value: number`
  //                    - inputs, textareas:     `value: string`
  //                    - others:                domain-specific
  //                  sender — the control's stable sender id (typically
  //                  useId). Handlers disambiguate multi-control forms
  //                  by inspecting sender.
  //                  phase — sliders and scrubbable controls use
  //                  "begin" / "change" / "commit" for interactive
  //                  dragging. Discrete changes use "discrete".
  // TOGGLE:          payload — `value: boolean` (the new state). Used by
  //                  checkboxes, switches, and expand/collapse controls.
  //                  sender — stable sender id.
  // SELECT_VALUE:    payload — `value: string` (the selected item id).
  //                  Used by radio groups, choice groups, dropdowns,
  //                  tab bars.
  //                  sender — stable sender id identifying which control
  //                  or group dispatched the selection.
  // INCREMENT_VALUE: payload — optional `value: number` (step override).
  //                  Used by numeric scrubbers on arrow-up.
  // DECREMENT_VALUE: payload — optional `value: number` (step override).
  //                  Used by numeric scrubbers on arrow-down.
  SET_VALUE:       "set-value",
  TOGGLE:          "toggle",
  SELECT_VALUE:    "select-value",
  INCREMENT_VALUE: "increment-value",
  DECREMENT_VALUE: "decrement-value",

  // ---- Tab operations ----
  //
  // SELECT_TAB: payload — `value: string` (tab id).
  // CLOSE_TAB:  payload — `value: string` (tab id).
  // ADD_TAB:    payload — `value: string` (componentId of the new tab).
  //             Dispatched by card-level "new tab" controls (e.g. the
  //             tab bar's `+` popup-button menu). The responder that
  //             handles it (typically `Tugcard`) uses its own cardId
  //             plus the componentId from the payload to call
  //             `store.addTab(cardId, componentId)`. Distinct from
  //             `add-tab-to-active-card`, which is the global
  //             menu/keystroke path that targets the focused card with
  //             a hardcoded component type.
  // REOPEN_TAB: payload — none. Restore the most recently closed tab.
  //             NOTE: no handler yet — ⌘⇧T is deferred per the A3 / R4
  //             retrospective pending a closed-tab history in
  //             deck-manager. Dispatching is a silent no-op until then.
  SELECT_TAB: "select-tab",
  CLOSE_TAB:  "close-tab",
  ADD_TAB:    "add-tab",
  REOPEN_TAB: "reopen-tab",

  // ---- Accordion / section ----
  //
  // TOGGLE_SECTION: payload — `value: string | string[]` (id or list of
  //                 ids for single vs. multi-expand accordions).
  TOGGLE_SECTION: "toggle-section",

  // ---- Window / card ----
  //
  // CLOSE:                  payload — none. Close the first card responder.
  // MINIMIZE:               payload — none. Minimize the first card.
  // MAXIMIZE:               payload — none. Maximize the first card.
  // SHOW_COMPONENT_GALLERY: payload — none. Open or focus the gallery card.
  // SHOW_SETTINGS:          payload — none. Open the settings panel.
  // RESET_LAYOUT:           payload — none. Reset card positions.
  // ADD_TAB_TO_ACTIVE_CARD: payload — none. Add a new tab to the first card.
  // FIND:                   payload — none. Open the find UI for the first
  //                         searchable responder.
  // TOGGLE_MENU:            payload — none. Open the action menu for the
  //                         first card.
  CLOSE:                  "close",
  MINIMIZE:               "minimize",
  MAXIMIZE:               "maximize",
  SHOW_COMPONENT_GALLERY: "show-component-gallery",
  SHOW_SETTINGS:          "show-settings",
  RESET_LAYOUT:           "reset-layout",
  ADD_TAB_TO_ACTIVE_CARD: "add-tab-to-active-card",
  FIND:                   "find",
  TOGGLE_MENU:            "toggle-menu",

  // ---- Meta ----
  //
  // SET_PROPERTY: payload — `{ path: string; value: unknown; source?: string }`.
  //               Routes to the first responder's registered PropertyStore
  //               (if any). Used by the inspector to drive live property
  //               updates.
  SET_PROPERTY: "set-property",
} as const;

/* ---------------------------------------------------------------------------
 * TUG_GALLERY_ACTIONS — demo / test-only actions
 * ---------------------------------------------------------------------------
 *
 * These are used only by gallery cards and tests to demonstrate chain
 * features (mutation-tx previews, chain-action buttons). They are
 * not intended for production use. Exported as a separate constants
 * object (and derived `GalleryAction` union) so galleries can opt in
 * via the `TugAction<GalleryAction>` generic parameter. Production
 * code uses bare `TugAction` and never sees these names in
 * autocomplete.
 *
 * DEMO_ACTION:      payload — none. Generic "something happened" for
 *                   the chain-actions gallery demonstration.
 * PREVIEW_COLOR:    payload — `{ color: string }` plus phase semantics
 *                   for scrub preview.
 * PREVIEW_HUE:      payload — `{ hue: number }` plus phase semantics.
 * PREVIEW_POSITION: payload — `{ x: number; y: number }` plus phase
 *                   semantics for draggable element preview.
 */
export const TUG_GALLERY_ACTIONS = {
  DEMO_ACTION:      "demo-action",
  PREVIEW_COLOR:    "preview-color",
  PREVIEW_HUE:      "preview-hue",
  PREVIEW_POSITION: "preview-position",
} as const;

/* ---------------------------------------------------------------------------
 * Derived types
 * ---------------------------------------------------------------------------*/

/**
 * The complete set of typed action names recognized by the responder
 * chain. Every ActionEvent's `action`, every `useResponder` actions
 * map key, and every KeyBinding.action must be one of these.
 *
 * Derived from `TUG_ACTIONS` via `as const`, so the union literally
 * cannot drift from the constants object. Adding a new action is a
 * single edit to `TUG_ACTIONS`; the union updates automatically.
 *
 * Generic on `Extra extends string` so non-production consumers
 * (galleries, demos, tests) can opt into additional action names
 * without polluting the production vocabulary's autocomplete. The
 * default is `never`, so bare `TugAction` is the production-only set.
 *
 * Usage:
 *
 * ```ts
 * // Production: bare TugAction — GalleryAction names are NOT in the union.
 * const action: TugAction = TUG_ACTIONS.CUT;       // OK
 * const bad: TugAction = TUG_GALLERY_ACTIONS.PREVIEW_COLOR; // compile error
 *
 * // Gallery opt-in: pass GalleryAction as the Extra parameter.
 * const demo: TugAction<GalleryAction> = TUG_GALLERY_ACTIONS.PREVIEW_COLOR; // OK
 * ```
 *
 * The chain's dispatch and registration APIs are likewise generic on
 * `Extra`, defaulting to `never`. Production call sites see only
 * production names; gallery call sites thread `GalleryAction` (or any
 * other string-literal union) through the type parameter and see
 * their extras alongside the production names.
 */
export type TugAction<Extra extends string = never> =
  | typeof TUG_ACTIONS[keyof typeof TUG_ACTIONS]
  | Extra;

/**
 * Demo / test-only action names. Derived from `TUG_GALLERY_ACTIONS`
 * so the two stay in lockstep. Opt in via `TugAction<GalleryAction>`
 * at the dispatch / registration site.
 */
export type GalleryAction = typeof TUG_GALLERY_ACTIONS[keyof typeof TUG_GALLERY_ACTIONS];

// ---- Payload narrowing — how handlers read `event.value` safely ----
//
// `ActionEvent.value` is typed as `unknown` by design (see the file
// header for the "middle ground" rationale: one action per semantic,
// rich payloads documented per-action above rather than baked into
// the type system). Handlers that read `event.value` need a
// narrowing step before using it. Two patterns are in use across
// the codebase; each fits a different shape of handler.
//
// ### Pattern 1 — form-slot narrowing via `useResponderForm`
//
// This is the dominant pattern. Components built on top of
// `useResponderForm` (every A2.1–A2.7 control: checkbox, switch,
// radio, choice, tab bar, accordion, popup button, slider,
// value-input, text input, textarea) register their handlers
// through typed slots:
//
// ```ts
// useResponderForm({
//   toggle: { [senderId]: (v: boolean) => setChecked(v) },
//   setValueNumber: { [senderId]: (v: number, phase) => setValue(v) },
//   selectValue: { [selectGroupId]: (v: string) => setSelected(v) },
// });
// ```
//
// The hook narrows at the slot boundary (`typeof event.value !==
// "boolean"` / `"string"` / `"number"`, `Array.isArray` for
// string[] slots) and invokes the typed setter only on a match. The
// *setter's type signature is the enforcement mechanism*: consumers
// literally cannot write `(v: unknown) => …`, because the slot's
// declared type forces them to annotate the value parameter with
// the narrowed type. One narrowing point per slot, one typed
// contract at each call site. Consumers never touch `event.value`
// themselves.
//
// This is structurally safer than any ad-hoc narrowing utility and
// should be the default path for any form-style control.
//
// ### Pattern 2 — inline `typeof` gates for direct-dispatch responders
//
// A handful of non-form responders handle actions outside the
// `useResponderForm` abstraction: cards dispatching `setProperty` /
// `addTab`, the editor text-input suite dispatching clipboard
// actions, gallery demos dispatching their preview actions. These
// handlers read `event.value` directly and must guard it inline
// before use:
//
// ```ts
// [TUG_ACTIONS.ADD_TAB]: (event: ActionEvent) => {
//   if (typeof event.value !== "string") return;
//   store.addTab(cardId, event.value);
// },
//
// [TUG_ACTIONS.SET_PROPERTY]: (event: ActionEvent) => {
//   const payload = event.value as
//     | { path: string; value: unknown; source?: string }
//     | undefined;
//   if (!payload || typeof payload.path !== "string") return;
//   store.set(payload.path, payload.value, payload.source ?? "inspector");
// },
// ```
//
// Inline `typeof` for primitives; cast-plus-field-check for
// structured payloads whose shape can't be expressed in `typeof`.
// Both patterns early-return on mismatch so a wrong-shape dispatch
// is a silent no-op rather than a runtime crash.
//
// ### Why no `narrowValue` helper
//
// A Phase A1 proposal added a `narrowValue<T>(event, guard)`
// utility intended to standardize Pattern 2. It was never adopted:
// by the time A2.4 shipped, `useResponderForm` had absorbed
// narrowing into its slot contracts (Pattern 1), and the few
// remaining direct-dispatch handlers found inline `typeof` to be
// shorter than writing a type guard for `narrowValue` to consume.
// The utility was removed in A6 as dead code with zero call sites.
// If per-action payload discriminated unions ever become
// worthwhile, that's the successor — not a handler-level helper.
