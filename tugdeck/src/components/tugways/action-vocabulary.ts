/**
 * action-vocabulary.ts — the central registry of action names that
 * flow through the responder chain.
 *
 * Every action dispatched via `manager.dispatch`, registered via
 * `useResponder`'s actions map, or bound in `keybinding-map.ts` must
 * reference a name from the `TugAction` union below. TypeScript
 * enforces this: misspellings become compile errors at the dispatch
 * site, the handler registration, and the keybinding map.
 *
 * Vocabulary granularity decision (middle ground): one action per
 * semantic, rich payloads carried on `ActionEvent.value`. E.g. a
 * single `setValue` action covers sliders, value-inputs, and numeric
 * fields, with the payload's type documented alongside the name in
 * this file. This keeps the name-level type union tight without
 * exploding it into per-control variants.
 *
 * Payload conventions are documented per-action below. Handlers
 * should narrow `event.value` defensively — TypeScript cannot express
 * "this value is a number *only* when action is setValue" without a
 * discriminated union, which would force all callers to construct
 * richly-typed ActionEvent objects at every dispatch site. The
 * current tradeoff is: tight action *names*, loose `value` shape,
 * with conventions documented here and enforced by handler authors.
 *
 * Laws: [L11] controls emit actions; responders handle actions.
 *
 * When adding a new action:
 *   1. Add the name to the appropriate category below.
 *   2. Document the expected payload shape on `ActionEvent.value`.
 *   3. Document `ActionEvent.sender` expectations if multiple
 *      controls of the same kind can emit this action.
 *   4. Update the TugAction union.
 *   5. Compile — anything that mismatched is flagged.
 */

// ---- Clipboard ----
//
// cut:       payload — none. The first responder cuts its current
//            selection. Handlers typically return a continuation for
//            two-phase activation (copy to clipboard synchronously,
//            delete the selection after the menu blink).
// copy:      payload — none. The first responder copies its current
//            selection. No continuation expected.
// paste:     payload — none. The first responder pastes clipboard
//            content. Handlers typically return a continuation so the
//            paste happens after any menu activation animation.
// selectAll: payload — none. The first responder selects all of its
//            content.
// selectNone: payload — none. The first responder collapses its
//            selection.
export type ClipboardAction =
  | "cut"
  | "copy"
  | "paste"
  | "selectAll"
  | "selectNone";

// ---- Editing ----
//
// undo:      payload — none. macOS semantics: the innermost editor
//            responder handles it against its own history; if none is
//            focused, the nearest ancestor that registered for `undo`
//            handles it (tab reopen, layout restore, etc.).
// redo:      payload — none. Symmetric with undo.
// delete:    payload — none. The first responder deletes its current
//            selection (or the item at the focus point).
// duplicate: payload — none. The first responder duplicates its
//            current selection.
export type EditingAction =
  | "undo"
  | "redo"
  | "delete"
  | "duplicate";

// ---- Navigation ----
//
// cycleCard:      payload — none. Canvas-level: rotate through cards.
// previousTab:    payload — none. Card-level: switch to previous tab.
// nextTab:        payload — none. Card-level: switch to next tab.
// focusNext:      payload — none. Move keyboard focus to the next
//                 focusable responder.
// focusPrevious:  payload — none. Move keyboard focus to the previous
//                 focusable responder.
// jumpToTab:      payload — `value: number` (1-based tab index).
//                 Card-level: switch to the Nth tab. Used by ⌘1..9.
export type NavigationAction =
  | "cycleCard"
  | "previousTab"
  | "nextTab"
  | "focusNext"
  | "focusPrevious"
  | "jumpToTab";

// ---- Dialog / menu ----
//
// confirmDialog:   payload — none. The first dialog-like responder
//                  confirms its pending action.
// cancelDialog:    payload — none. The first dialog-like responder
//                  cancels its pending action.
// dismissPopover:  payload — none. Close the nearest popover.
// openMenu:        payload — none. Open the contextually-appropriate
//                  menu for the first responder.
export type DialogAction =
  | "confirmDialog"
  | "cancelDialog"
  | "dismissPopover"
  | "openMenu";

// ---- Control value ----
//
// setValue:       payload — shape depends on control:
//                   - sliders, value-inputs: `value: number`
//                   - inputs, textareas:     `value: string`
//                   - others:                domain-specific
//                 sender — the control's stable sender id (typically
//                 useId). Handlers disambiguate multi-control forms
//                 by inspecting sender.
//                 phase — sliders and scrubbable controls use
//                 "begin" / "change" / "commit" for interactive
//                 dragging. Discrete changes use "discrete".
// toggle:         payload — `value: boolean` (the new state). Used by
//                 checkboxes, switches, and expand/collapse controls.
//                 sender — stable sender id.
// selectValue:    payload — `value: string` (the selected item id).
//                 Used by radio groups, choice groups, dropdowns,
//                 tab bars.
//                 sender — stable sender id identifying which control
//                 or group dispatched the selection.
// incrementValue: payload — optional `value: number` (step override).
//                 Used by numeric scrubbers on arrow-up.
// decrementValue: payload — optional `value: number` (step override).
//                 Used by numeric scrubbers on arrow-down.
export type ValueAction =
  | "setValue"
  | "toggle"
  | "selectValue"
  | "incrementValue"
  | "decrementValue";

// ---- Tab operations ----
//
// selectTab:  payload — `value: string` (tab id).
// closeTab:   payload — `value: string` (tab id).
// addTab:     payload — `value: string` (componentId of the new tab).
//             Dispatched by card-level "new tab" controls (e.g. the
//             tab bar's `+` popup-button menu). The responder that
//             handles it (typically `Tugcard`) uses its own cardId
//             plus the componentId from the payload to call
//             `store.addTab(cardId, componentId)`. Distinct from
//             `addTabToActiveCard`, which is the global menu/keystroke
//             path that targets the focused card with a hardcoded
//             component type.
// reopenTab:  payload — none. Restore the most recently closed tab.
export type TabAction =
  | "selectTab"
  | "closeTab"
  | "addTab"
  | "reopenTab";

// ---- Accordion / section ----
//
// toggleSection: payload — `value: string | string[]` (id or list of
//                ids for single vs. multi-expand accordions).
export type AccordionAction = "toggleSection";

// ---- Window / card ----
//
// close:                 payload — none. Close the first card responder.
// minimize:              payload — none. Minimize the first card.
// maximize:              payload — none. Maximize the first card.
// showComponentGallery:  payload — none. Open or focus the gallery card.
// showSettings:          payload — none. Open the settings panel.
// resetLayout:           payload — none. Reset card positions.
// addTabToActiveCard:    payload — none. Add a new tab to the first card.
// find:                  payload — none. Open the find UI for the first
//                        searchable responder.
// toggleMenu:            payload — none. Open the action menu for the
//                        first card.
export type WindowAction =
  | "close"
  | "minimize"
  | "maximize"
  | "showComponentGallery"
  | "showSettings"
  | "resetLayout"
  | "addTabToActiveCard"
  | "find"
  | "toggleMenu";

// ---- Meta ----
//
// setProperty: payload — `{ path: string; value: unknown; source?: string }`.
//              Routes to the first responder's registered PropertyStore
//              (if any). Used by the inspector to drive live property
//              updates.
export type MetaAction = "setProperty";

// ---- Gallery / demo actions ----
//
// These are used only by gallery cards and tests to demonstrate chain
// features (mutation-tx previews, chain-action buttons). They are not
// intended for production use. Exported as a separate string-literal
// union so galleries can opt into them via the `TugAction<Extra>`
// generic parameter: `TugAction<GalleryAction>`. Production code uses
// bare `TugAction` and never sees these names in autocomplete.
//
// demoAction:      payload — none. Generic "something happened" for
//                  the chain-actions gallery demonstration.
// previewColor:    payload — `{ color: string }` plus phase semantics
//                  for scrub preview.
// previewHue:      payload — `{ hue: number }` plus phase semantics.
// previewPosition: payload — `{ x: number; y: number }` plus phase
//                  semantics for draggable element preview.
export type GalleryAction =
  | "demoAction"
  | "previewColor"
  | "previewHue"
  | "previewPosition";

// ---- Union ----

/**
 * The complete set of typed action names recognized by the responder
 * chain. Every ActionEvent's `action`, every `useResponder` actions
 * map key, and every KeyBinding.action must be one of these.
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
 * const action: TugAction = "cut";           // OK
 * const bad: TugAction = "previewColor";     // compile error
 *
 * // Gallery opt-in: pass GalleryAction as the Extra parameter.
 * const demo: TugAction<GalleryAction> = "previewColor"; // OK
 * ```
 *
 * The chain's dispatch and registration APIs are likewise generic on
 * `Extra`, defaulting to `never`. Production call sites see only
 * production names; gallery call sites thread `GalleryAction` (or any
 * other string-literal union) through the type parameter and see
 * their extras alongside the production names.
 */
export type TugAction<Extra extends string = never> =
  | ClipboardAction
  | EditingAction
  | NavigationAction
  | DialogAction
  | ValueAction
  | TabAction
  | AccordionAction
  | WindowAction
  | MetaAction
  | Extra;

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
// addTab: (event: ActionEvent) => {
//   if (typeof event.value !== "string") return;
//   store.addTab(cardId, event.value);
// },
//
// setProperty: (event: ActionEvent) => {
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
