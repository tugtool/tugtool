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
// addTab:     payload — optional domain-specific. Used by card-level
//             "new tab" controls.
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
// intended for production use. Kept separate so real production code
// can grep for TugAction minus these and get only shipping actions.
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
 */
export type TugAction =
  | ClipboardAction
  | EditingAction
  | NavigationAction
  | DialogAction
  | ValueAction
  | TabAction
  | AccordionAction
  | WindowAction
  | MetaAction
  | GalleryAction;

// ---- narrowValue ----

/**
 * Narrow an `ActionEvent.value` to a known type via a user-provided
 * type-guard. Returns the narrowed value on success, `null` on failure.
 *
 * The responder chain's action names are typed via `TugAction`, but
 * payloads on `ActionEvent.value` are `unknown` by design (see Part 4
 * decision 1 in the audit: "middle ground" granularity — one action
 * per semantic, rich payloads documented per-action in this file
 * rather than baked into the type system). Handlers that read
 * `event.value` should reach for this utility instead of a bare cast,
 * so a wrong-shape dispatch fails gracefully instead of silently.
 *
 * Convention: every handler that depends on a specific payload shape
 * calls `narrowValue` with a matching type guard and early-returns on
 * `null`. The payload shape is documented on the action's definition
 * above (e.g. `setValue` → `value: number` for sliders, `value: string`
 * for inputs). Handlers pick the guard that matches their use case.
 *
 * Example:
 *
 * ```ts
 * const handleSetValue: ActionHandler = (event) => {
 *   const n = narrowValue(event, (v): v is number => typeof v === "number");
 *   if (n === null) return; // wrong shape — silently ignore
 *   // use n safely as a number
 * };
 * ```
 *
 * This is a convention, not compile-time enforcement. The compiler
 * can't catch a handler that casts `event.value as number` directly
 * — it can only catch that by migrating to per-action discriminated
 * unions, which the audit decision deferred. Code reviews and the
 * documented convention are the enforcement mechanism for now.
 */
export function narrowValue<T>(
  event: { value?: unknown },
  guard: (value: unknown) => value is T,
): T | null {
  if (guard(event.value)) return event.value;
  return null;
}
