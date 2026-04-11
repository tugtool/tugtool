# Component Authoring Guide

*How to build a tugways component. Every component follows this guide exactly — no exceptions, no shortcuts. Consistency is the product.*

*Cross-references: `[D##]` → [design-decisions.md](design-decisions.md). `[L##]` → [tuglaws.md](tuglaws.md). `[P##]` → [color-palette.md](color-palette.md). `[T##]` → [token-naming.md](token-naming.md). Chain mechanics: [responder-chain.md](responder-chain.md). Action vocabulary: [action-naming.md](action-naming.md).*

---

## Scope Boundary (This Pass)

The current theme simplification pass does **not** rewrite every existing component token contract.

- Keep existing component contracts stable unless a component-level change is explicitly required.
- Do not introduce new ad-hoc theme logic in TSX/JS (no local recipe objects, no derivation helpers, no one-off color math).
- New theme behavior must come from `--tug-*` tokens and CSS cascade only.

---

## Files

Every component produces exactly two files in `components/tugways/`:

```
tug-{name}.tsx    — component implementation
tug-{name}.css    — all styles
```

One component per file pair. No barrel exports, no index files. The file name is the component name in kebab-case with the `tug-` prefix.

### Public vs Internal

Components at the top level of `components/tugways/` are the **public API** — what app code imports directly. Components in `components/tugways/internal/` are **building blocks** — infrastructure composed by other tugways components, not intended for direct use by app code.

```
tugways/
  tug-push-button.tsx    ← public: app code uses this for standalone action buttons
  tug-popup-button.tsx   ← public: app code uses this for dropdown triggers
  tug-checkbox.tsx        ← public: app code uses this
  tug-switch.tsx          ← public: app code uses this
  tug-input.tsx           ← public: app code uses this
  ...
  internal/
    tug-button.tsx        ← building block: composed by TugPushButton, TugPopupButton, TugTabBar
    tug-button.css        ← building block: button styling
```

The directory structure is the signal. A developer scanning `tugways/` sees the components they should use. The `internal/` folder tells them "these are not for you."

**Rules for internal components:**

- Follow all the same authoring rules as public components (docstring, `data-slot`, `@tug-pairings`, `forwardRef`, etc.)
- Module docstring opens with a clear statement: "Internal building block — app code should use [public component] instead."
- Internal components are imported by relative path (`./internal/tug-button`), never from a barrel export
- Public components that wrap an internal component should re-export the types app code needs (e.g., `TugButtonEmphasis`, `TugButtonRole`, `TugButtonSize`)

**When to make a component internal:**

- It provides infrastructure that multiple public components compose (TugButton → TugPushButton, TugPopupButton, TugTabBar)
- App code should never import it directly — there's always a more appropriate public component
- Moving it to `internal/` reduces confusion about which component to choose

Most components are public. Internal components are the exception, not the rule.

---

## TSX Structure

Every `.tsx` file follows this structure in this order:

```
1. Module docstring
2. CSS import
3. Library imports
4. Internal imports
5. Constants
6. Props interface (exported)
7. Component (exported)
8. Sub-components (if any, banner-delimited)
```

### Module Docstring

Opens every file. States what the component does, not how it evolved.

```typescript
/**
 * TugSwitch — Toggle switch with track and thumb.
 *
 * Wraps @radix-ui/react-switch. Supports size variants, inline label,
 * disabled state, and role-based color injection.
 *
 * Laws: [L06] appearance via CSS, [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide
 * Decisions: [D05] component token naming
 */
```

Rules:
- First line: component name and one-sentence purpose
- Second paragraph: implementation details (what it wraps, what it supports)
- Laws and Decisions: cite every law and decision the component obeys
- No history, no "Phase N", no "replaces X", no spec references from plans

**Standardized citation set:** Every component docstring must cite the minimum set of governing laws:

| Citation | Meaning | Required For |
|----------|---------|-------------|
| [L06] | Appearance changes via CSS/DOM, never React state | All components |
| [L11] | Controls emit actions; responders own state that actions mutate | Any component that dispatches or handles an action |
| [L15] | Token-driven states; color transitions only | Interactive controls |
| [L16] | Every foreground rule declares its rendering surface | Components with CSS |
| [L19] | Component authoring guide | All components |
| [L20] | Token sovereignty — composed children keep own tokens | Compound composition |

Interactive components effectively always cite [L11] because any interactive component either emits an action, handles one, or both. Decorative or layout-only components that do not participate in the chain omit it. Add component-specific laws on top of this minimum (e.g., [L09] for card composition, [L03] when registration timing matters).

**Plan spec references are prohibited.** Docstrings must cite tuglaws (`[L##]`) and design decisions (`[D##]`) only. References like `Spec S04` or `Spec S##` are implementation history from plan artifacts — they are not governing law and must not appear in module docstrings.

### Props Interface

Exported. Extends native HTML element props when wrapping a native element. JSDoc on every non-obvious prop. Use `@selector` to document the CSS selector for stateful props.

```typescript
export interface TugSwitchProps {
  /** Whether the switch is on. @selector [data-state="checked"] */
  checked?: boolean;
  /** Callback when toggled. */
  onCheckedChange?: (checked: boolean) => void;
  /** Inline label text. */
  label?: string;
  /** Visual size. @default "md" */
  size?: "sm" | "md" | "lg";
  /** Semantic role for color injection. No role = accent. @selector [data-role="<role>"] */
  role?: "action" | "agent" | "data" | "success" | "caution" | "danger" | "option";
  /** @selector [aria-disabled="true"] */
  disabled?: boolean;
}
```

Rules:
- Extend `React.ComponentPropsWithoutRef<'element'>` for native wrappers
- Omit and redefine props whose semantics change (e.g., `role`, `size`)
- `@selector` annotations map props to CSS selectors — this is how styling agents find the right hook
- `@default` annotations document defaults

**`@selector` is mandatory for every CSS-targetable prop.** A prop is CSS-targetable if its value affects which CSS selector applies — data attributes, class variants, pseudo-classes. The `@selector` annotation is the bridge between the TSX API and the CSS: it tells a coding agent exactly which selector to write when styling a prop's visual effect.

Patterns from the reference implementations (tug-checkbox.tsx):

```typescript
/**
 * Controlled checked state. Supports true, false, or "indeterminate".
 * @selector [data-state="checked"] | [data-state="unchecked"] | [data-state="indeterminate"]
 */
checked?: TugCheckedState;

/**
 * Visual size variant.
 * @selector .tug-checkbox-size-sm | .tug-checkbox-size-md | .tug-checkbox-size-lg
 * @default "md"
 */
size?: TugCheckboxSize;

/**
 * Disables the checkbox.
 * @selector :disabled | [data-disabled]
 * @default false
 */
disabled?: boolean;

/**
 * Semantic role for the on-state color. Omit for the theme's accent color.
 * @selector [data-role="<role>"]
 */
role?: TugCheckboxRole;
```

Props that do **not** need `@selector`:
- Callback props (`onCheckedChange`, `onClick`, `onChange`)
- String data props (`name`, `value`, `aria-label`)
- `className` — always passed through to `cn()`, no selector needed

### Component

Use `React.forwardRef` for any component that wraps a DOM element or Radix primitive. Name the function explicitly (provides displayName for DevTools).

```typescript
export const TugSwitch = React.forwardRef<HTMLButtonElement, TugSwitchProps>(
  function TugSwitch({ checked, onCheckedChange, label, size = "md", role, disabled, ...rest }, ref) {
    // ...
    return (
      <Switch.Root
        ref={ref}
        data-slot="tug-switch"
        className={cn("tug-switch", `tug-switch-${size}`)}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        {...rest}
      >
        <Switch.Thumb className="tug-switch-thumb" />
      </Switch.Root>
    );
  }
);
```

Rules:
- `data-slot="tug-{name}"` on the root element — always. This is the stable semantic anchor for CSS and tooling.
- `className` via `cn()` (from `lib/utils.ts`) — composes base class, size variant, and caller's className
- Spread `...rest` last to allow prop overrides
- No React state for appearance [L06]. All visual changes via CSS custom properties, classes, or data attributes. **This includes text content in input fields** — see "Input Value Management" below.
- Functional components (no refs needed) skip `forwardRef` but still get `data-slot`

### Code Quality — Common Bugs to Avoid

Components must be high-quality, carefully reviewed code. The following bugs have been found in past audits and must not recur:

**Every caller prop must reach the DOM.** If a prop is destructured, it must be used. A `className` prop that is silently dropped in one code path (e.g., when an optional wrapper is absent) is a bug. Test both branches: with and without optional wrappers like `label`.

**`...rest` must be spread onto the root DOM element.** Without it, callers cannot pass `data-*` attributes, `aria-*` attributes, event handlers, or any other standard HTML attributes. This is not optional — it is required for composability.

**Props interfaces must extend native element attributes.** Use `React.ComponentPropsWithoutRef<'element'>` (or Radix's equivalent) and `Omit` props whose semantics change. Do not manually redeclare props that the base interface already provides (`className`, `id`, `style`, etc.). A closed props interface that lists every prop by hand will always be incomplete.

**Conditional rendering must not create asymmetric behavior.** When a component has two rendering paths (e.g., with-label vs without-label), both paths must handle `className`, `...rest`, and `ref` consistently. If `className` goes on a wrapper in one path, it must go on the root element in the other — never silently dropped.

**Inline `style` must be merged, not replaced.** If a component sets inline styles (width, height, gap), destructure `style` from rest and spread the caller's style into the component's: `style={{ width, height, ...style }}`. Without this, a caller passing `style={{ margin: '10px' }}` silently replaces the component's critical layout styles.

**No dead code, no history comments.** Unused variables, pointless aliases (`const x = y;` where `y` could be used directly), and comments about what was removed ("sub-component removed", "Phase N") are noise. Delete them.

### Input Value Management [L06]

**The text displayed in an input field is appearance.** Switching between a formatted display value ("75%") and a raw edit value ("0.75"), selecting text, and restoring display format after editing — all of this is appearance-zone work. It must go through DOM, not React state.

**Never use React state to manage an input's display/edit cycle.** The standard React controlled-input pattern (`useState` + `value` prop + `onChange`) forces a re-render on every keystroke and on every mode transition. These re-renders kill text selection, can drop keystrokes, and create unnecessary render cycles for what is purely a DOM operation.

**The correct approach:** Use `defaultValue` (not `value`) so React sets the input once at mount, then manage all subsequent value changes imperatively through a ref. Track editing state in a ref, not React state. Sync the display value via `useLayoutEffect` when the external value changes and the input is not being edited. Read the DOM value directly on blur/Enter for validation and commit.

This applies to any component with an editable display that toggles between formatted and raw representations: sliders with value inputs, editable stat cards, inline-editable labels, etc.

**Reference implementation:** `tug-slider.tsx` — the value input demonstrates this pattern.

### Sub-Components

When a component has distinct structural parts (e.g., a group wrapper), define them in the same file, separated by banner comments:

```typescript
/* ---------------------------------------------------------------------------
 * TugRadioItem
 * ---------------------------------------------------------------------------*/

export interface TugRadioItemProps { /* ... */ }

export const TugRadioItem = React.forwardRef<HTMLButtonElement, TugRadioItemProps>(
  function TugRadioItem(props, ref) { /* ... */ }
);
```

---

## CSS Structure

Every `.css` file follows this structure in this order:

```
1. @tug-pairings table
2. Base styles (.tug-{name})
3. Sub-element styles (.tug-{name}-{part})
4. Size variants (.tug-{name}-sm, -md, -lg)
5. State selectors (rest → hover → active → focus → disabled)
6. Variant styles (emphasis × role, validation states, etc.)
```

### @tug-pairings Table

Opens every CSS file. Declares every foreground-on-background relationship the component creates. Machine-readable by `audit-tokens lint`. [L16]

**Both formats are required** — the compact block for tooling, the expanded table for human and agent readability.

**Compact block** (machine-readable — what `audit-tokens lint` parses):

```css
/* @tug-pairings {
  --tug7-element-checkmark-icon-normal-plain-rest  | --tug7-surface-toggle-track-normal-on-rest  | control
  --tug7-element-field-text-normal-label-rest      | --tug7-surface-global-primary-normal-default-rest | content
} */
```

Format: `element-token | surface-token | contrast-role`

**Expanded table** (human/agent-readable — documents the CSS context):

```css
/**
 * @tug-pairings
 * | Element                              | Surface                              | Role    | Context                          |
 * |--------------------------------------|--------------------------------------|---------|----------------------------------|
 * | --tug7-element-checkmark-icon-...rest  | --tug7-surface-toggle-track-...rest   | control | .tug-checkbox-indicator (color)  |
 * | --tug7-element-field-text-...rest      | --tug7-surface-global-primary-...rest | content | .tug-checkbox-label (color)      |
 */
```

The **Context column** is the key addition in the expanded table. It specifies exactly which CSS rule creates the pairing (`selector (property)`). A coding agent reading the pairings table can navigate directly to the rule that needs attention.

**Components with no contrast pairings** (decorative or animation-only components) still open with the annotation so tooling knows the absence is intentional:

```css
/* @tug-pairings: none — decorative/animation only, no foreground-on-background contrast */
```

### @tug-renders-on Annotations

Every CSS rule that sets `color`, `fill`, `stroke`, or `border-color` without setting `background-color` in the same rule must include this annotation: [L16]

```css
/* @tug-renders-on: --tug7-surface-global-primary-normal-default-rest */
.tug-label {
  color: var(--tug7-element-field-text-normal-label-rest);
}
```

### @tug-effects Declaration

Components that use effect-plane tokens (`--tug7-effect-*`) declare them in a separate `@tug-effects` block in the CSS file header, after `@tug-pairings`. Effect tokens carry non-color values — amounts, blend modes, opacity levels — and do not participate in contrast pairing.

```css
/* @tug-effects {
  --tug7-effect-card-desat-normal-dim-inactive     | desaturation overlay color
  --tug7-effect-card-desat-normal-amount-inactive   | desaturation intensity (0-1)
  --tug7-effect-card-wash-normal-dim-inactive       | wash overlay color
  --tug7-effect-card-wash-normal-blend-inactive     | wash blend mode
} */
```

Format: `token | description`. No contrast role — effect tokens define rendering parameters, not rendered colors.

Most components will not have effect tokens. Include this section only when the component uses the `effect` plane.

### Token Usage

All colors come from `--tug-*` tokens. Never hardcode colors. [L15, T##]

```css
/* Correct */
.tug-input { background-color: var(--tug7-surface-field-primary-normal-plain-rest); }

/* Wrong */
.tug-input { background-color: oklch(0.15 0.01 260); }
```

**Tokens must match what they're applied to.** The seven-slot naming system encodes what a token is *for* — the plane (`element` vs `surface`), the constituent (`text` vs `fill` vs `border`), and the component (`control` vs `field` vs `toggle`). A token applied to a CSS property must make semantic sense:

- A control fill or background → use a `surface` token, not an `element` token
- A border → use a `border` token, not a `fill` token
- A checkbox on-state → use a `toggle-primary` surface token, not a `text-muted` element token
- Role-variant fills → use `surface-toggle-primary-normal-{role}-rest`, not `element-tone-fill-*`

**The plane must match the usage.** `element` tokens are foreground marks (text, icons, borders). `surface` tokens are backgrounds. A checkbox fill is a background — it must be a `surface` token. Using an `element-tone-fill` token to color a checkbox background is a plane-level category error, even if the color value happens to look right.

**The component must match the context.** A generic `tone-fill` token is not a toggle control. If the token is being used as a checkbox fill, it should be scoped to `toggle` (the component) with `primary` (the constituent for filled control surfaces). Tokens scoped to the right component can be tuned per-theme without affecting unrelated elements.

If a token's seven-slot name doesn't describe what it's actually styling, the pairing is wrong — even if the color happens to look right. The naming system makes mismatches visible: read the name aloud. "Element tone fill for a checkbox background" sounds wrong because it *is* wrong.

### Component-Tier Alias Rules

Some components define short `--tugx-{component}-*` aliases that resolve to base-tier `--tug7-*` tokens. The decision rule:

- **Use base tokens directly** when the component is simple (fewer than 5 token references) and the seven-slot names are clear in context. Checkbox, switch, input, label, badge, skeleton, and marquee all use this pattern.
- **Use component-tier aliases** when the component is complex — many sub-parts, many tokens, or tokens referenced from multiple CSS rules — and shorter aliases improve readability. Card and tab-bar use this pattern.

When aliases are used, define them in `body {}` at the top of the CSS file, after `@tug-pairings` and before base styles. Every alias must resolve to a base-tier `--tug7-*` token in **one hop**. [L17]

```css
body {
  /* Card aliases — resolve to base tier in one hop [L17] */
  --tugx-card-border: var(--tug7-element-global-border-normal-default-rest);
  --tugx-card-bg: var(--tug7-surface-global-primary-normal-overlay-rest);
}
```

Never chain aliases (`--tugx-card-bg: var(--tugx-card-other-alias)`) — that is a second hop and violates [L17].

### Enter/Exit Animations [L13, L14]

Components that animate on mount/unmount must choose the correct regime based on **who owns the DOM lifecycle**:

**Library-managed lifecycle → CSS keyframes [L14].** When Radix, Sonner, or another library controls when elements mount and unmount, use CSS `@keyframes` on `[data-state]` or equivalent attributes. The library listens for `animationend` to time its unmount — WAAPI does not fire `animationend`, so TugAnimator would break the library's lifecycle.

- Radix wrappers (tug-alert, tug-popover, tug-accordion, tug-tooltip): CSS keyframes + `[data-state]`
- Sonner wrappers (tug-bulletin): CSS styling of Sonner's DOM

**Self-managed lifecycle → TugAnimator [L13].** When the component owns its own mount/unmount (original components, portal-based components), use `animate()` from TugAnimator. The `.finished` promise sequences post-animation work (unmount portals, remove `inert`, restore focus). Named `key` slots handle rapid open-close-open sequences cleanly.

- Original modals (tug-sheet, tug-banner): TugAnimator with `.finished` for unmount sequencing
- Group coordination: `group()` when multiple elements animate together (overlay fade + content slide)

**Never mix.** Do not use CSS keyframes with manual `animationend` listeners in self-managed components — that's hand-rolling what TugAnimator already provides. Do not use TugAnimator for library-managed lifecycle — that breaks the library's unmount timing.

**CSS still owns static properties.** Even when TugAnimator drives motion, CSS owns position, sizing, z-index, background-color, border-radius — everything that doesn't animate. Only the motion properties (transform, opacity) move to WAAPI.

### State Selectors

States progress in a consistent order. Interactive controls lighten progressively: rest (darkest) → hover → active (lightest). [L15]

```css
.tug-button { /* rest */ }
.tug-button:hover { /* hover */ }
.tug-button:active { /* active */ }
.tug-button:focus-visible { /* focus ring */ }
.tug-button:disabled,
.tug-button[aria-disabled="true"] { /* disabled */ }
```

Radix components use `[data-state="checked"]`, `[data-state="open"]`, etc. Combine with interaction states:

```css
.tug-switch[data-state="checked"]:hover { /* checked + hovered */ }
```

### Naming Convention

- Block: `.tug-{name}` — root element
- Part: `.tug-{name}-{part}` — sub-elements (thumb, indicator, track, label)
- Size: `.tug-{name}-{size}` — sm, md, lg
- Variant: `.tug-{name}-{emphasis}-{role}` — for emphasis × role components

---

## Chain Integration

Every interactive component participates in the responder chain. The chain is the single mechanism by which user gestures reach the code that owns the state they affect — keyboard shortcuts, button clicks, context menu items, Swift-menu RPCs, and gallery-inspector dispatches all funnel through the same dispatch/walk/handle cycle.

This section is the component-author's how-to. It tells you which hooks to call, which props to add (and which to refuse to add), and which attributes to write on your root element. It does not explain the chain's mechanics — the walk, the first-responder promotion, the two-phase continuation protocol, the observer pattern — those live in [responder-chain.md](responder-chain.md). Read that document once before writing a chain-participant component for the first time, then use this section as the recurring reference.

### Is your component a control, a responder, or both?

Ask one question: **does this component own the state that the action is going to mutate?** [L11]

- **No** — the state lives elsewhere (parent, store, separate component). Your component is a *control*. It dispatches an action and lets the chain find the responder. Buttons, sliders, toggles, selects, tab bars, accordions, and popup menus are controls. Most components are.

- **Yes** — the state lives inside your component and nowhere else. Your component is a *responder* for that action. It registers a handler that mutates its own state. Text editors, cards, canvases, dialog surfaces, and property stores are responders.

- **Both** — the action's state lives inside your component, AND your component also emits the action from its own internal UI. A text editor with a built-in context menu is the classic both-shape: the "Cut" menu item dispatches `cut`, the chain walks back to the editor (because it's the first responder), and the editor's registered `cut` handler runs on its own selection. Both shapes are not unusual — they are the norm for self-contained widgets with their own action surfaces.

The three shapes use different hooks: `useControlDispatch` for emitting (controls), `useResponder` / `useOptionalResponder` for registering (responders). Components that are only controls skip the registration; components that are only responders skip the dispatch; "both" components do both in the same file.

### Emitting an action (controls)

Controls use `useControlDispatch` — targeted dispatch to the parent responder.

```tsx
import { useControlDispatch } from "@/components/tugways/use-control-dispatch";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

export function TugCloseButton({ ariaLabel }: TugCloseButtonProps) {
  const controlDispatch = useControlDispatch(); // null-safe — no-op outside a provider

  const handleClick = () => {
    controlDispatch({
      action: TUG_ACTIONS.CLOSE,
      phase: "discrete",
    });
  };

  return <button type="button" aria-label={ariaLabel} onClick={handleClick}>×</button>;
}
```

The hook reads the parent responder ID from context and calls `dispatchTo(parentId, event)`. The action goes directly to the parent handler regardless of the first responder. Outside a provider the dispatch is a no-op (returns `false`).

**Why targeted dispatch?** Controls have a specific receiver — their parent responder. The nil-targeted `dispatch()` walks from the first responder, which may be a sibling or descendant of the parent. Targeted dispatch bypasses the first responder entirely and always reaches the handler. See [responder-chain.md § Dispatching from a control](responder-chain.md#dispatching-from-a-control) for the full rationale.

Rules:

- **Controls never call `manager.dispatch()`.** Always use `useControlDispatch()`. The nil-targeted `dispatch()` is reserved for keyboard shortcuts and menu items.

- **Callback props for user interactions are prohibited.** [L11] A `TugCloseButton` must NOT expose an `onClose: () => void` prop. The close action routes through the chain; a callback prop lets the consumer bypass the chain and breaks keyboard shortcuts, first-responder semantics, and observer notification. Non-user-interaction callbacks (state mirror callbacks like `onOpenChange` for Radix integration, lifecycle observers) are fine.

- **Sender id for multi-control forms.** Controls that might coexist with siblings dispatching the same action supply a stable opaque sender id so handlers can tell them apart. Default is `useId()`; expose an optional `senderId?: string` prop so tests can override.

- **Always the constant, never the raw string.** `action: TUG_ACTIONS.CLOSE`, not `action: "close"`. See [action-naming.md](action-naming.md).

**Form-shaped shortcut.** Components built on form patterns (inputs, toggles, radios, choice groups, tab bars, accordions, popup buttons) should use `useResponderForm` instead of hand-rolling `useResponder` with narrowing. The form hook exposes typed slot callbacks (`toggle`, `setValueNumber`, `selectValue`, `selectTab`, etc.) that narrow `event.value` at the slot boundary and call your setter with the already-typed value. This is the dominant pattern; reach for it whenever the component fits one of the existing slot shapes. See `use-responder-form.tsx` for the slot catalog.

### Handling actions (responders)

Register with `useResponder` (strict) or `useOptionalResponder` (tolerant). Both return a stable `ResponderScope` wrapper and a stable `responderRef` callback. Wrap your subtree in the scope, attach the ref to your root DOM element, and supply a typed `actions` map.

```tsx
import { useResponder } from "@/components/tugways/use-responder";
import type { ActionEvent } from "@/components/tugways/responder-chain";
import { TUG_ACTIONS } from "@/components/tugways/action-vocabulary";

export function TugCard({ cardId, ... }: TugCardProps) {
  // Handlers read state through refs, not stale closures. [L07]
  const handleClose = useCallback(() => { /* ... */ }, [/* ... */]);
  const handleSelectAll = useCallback(() => { /* ... */ }, [/* ... */]);

  const { ResponderScope, responderRef } = useResponder({
    id: cardId,
    actions: {
      [TUG_ACTIONS.CLOSE]:      (_e: ActionEvent) => handleClose(),
      [TUG_ACTIONS.SELECT_ALL]: (_e: ActionEvent) => handleSelectAll(),
      [TUG_ACTIONS.JUMP_TO_TAB]: (event: ActionEvent) => {
        if (typeof event.value !== "number") return;   // narrow defensively
        handleJumpToTab(event.value);
      },
    },
  });

  return (
    <ResponderScope>
      <div
        data-slot="tug-card"
        ref={responderRef as (el: HTMLDivElement | null) => void}
      >
        {/* card content */}
      </div>
    </ResponderScope>
  );
}
```

Rules:

- **`id` must be stable across renders.** Re-registering the responder on every render churns the chain's node map and breaks first-responder tracking. The id typically comes from the component's domain identity (`cardId` from the layout store), from `useId()` for a standalone leaf, or from an explicit prop for test harnesses.

- **`responderRef` attaches to the root DOM element.** The hook writes `data-responder-id="<id>"` on the element; the chain's pointerdown/focusin DOM walk reads that attribute to resolve "the innermost responder under this event target." Without the ref, the manager logs a console warning — `first responder "<id>" has no matching [data-responder-id] element`. Fix the warning by wiring the ref; do not silence it.

- **`<ResponderScope>` wraps the subtree** whose descendants should treat this node as their parent responder. Descendants calling `useResponder` see the scope's id through `ResponderParentContext` and register with that id as their `parentId`. Without the wrapper, descendant `parentId`s skip over this node and the walk order collapses.

- **Handlers read current state through refs.** [L07] `useResponder` registers once at mount and uses a live proxy to pick up handler *identity* changes on re-render, so forgetting to `useCallback`-wrap your handlers is fine. But if the handler *body* closes over a stale state snapshot (`const [tabs] = useState(...)`, handler reads `tabs`), you will see stale values. Use a ref (`tabsRef.current`) for any state the handler reads at dispatch time. This is the most common chain bug in PRs.

- **Narrow `event.value` defensively.** The `value` field is typed `unknown` because the same action name may carry different payload shapes across control instances. Use `typeof`, `Array.isArray`, or a structural field check at the top of the handler and early-return on mismatch so an out-of-shape dispatch is a silent no-op, not a runtime crash.

### `useResponder` vs `useOptionalResponder`

Both hooks have the same signature and return shape. The difference is what they do when no `ResponderChainProvider` is in scope.

- **`useResponder` throws** if the manager context is null. Use it when chain participation is load-bearing — `TugCard`, `DeckCanvas`, `TugPromptInput`, anything whose actions must be routable for the app to function. A missing provider is a programming error; the throw catches it at mount instead of letting the component silently no-op.

- **`useOptionalResponder` silently no-ops** when the manager is null. The hook still runs (returns a stable `ResponderScope` and `responderRef`), but the layout effect skips register/unregister, the ref skips writing `data-responder-id`, and the component falls through to its standalone behavior. Use it for leaf controls that must render in both contexts: inside the app (chain-connected) and standalone in previews, unit tests, or Storybook-style mounts.

**Decision rule:** if rendering without a provider is a programming error, use `useResponder`. If it's a supported configuration (tests, previews, pre-provider mounts), use `useOptionalResponder`. Never mix them in the same component. The tolerant hook exists specifically because the old "split into `TugXxxPlain` and `TugXxxWithResponder`" pattern flipped React's component identity on provider transitions and destroyed caret position, focus, and uncontrolled input state — see the long commentary in `use-responder.tsx` for the scenario it was added to fix.

### Chain-reactive dismissal (`observeDispatch`)

Transient UIs — context menus, popup menus, tooltips, non-modal popovers, confirm popovers — dismiss themselves whenever unrelated chain traffic flows past. Subscribe to `manager.observeDispatch` while open, close in the observer callback, and guard self-dispatches with a `blinkingRef`.

```tsx
const blinkingRef = useRef(false);
const [open, setOpen] = useState(false);
const manager = useResponderChain();

useLayoutEffect(() => {
  if (!open || !manager) return;
  return manager.observeDispatch(() => {
    if (blinkingRef.current) return;  // skip self-dispatches
    setOpen(false);
  });
}, [open, manager]);
```

- **Subscribe only while open.** The effect is gated on the open flag so the observer is installed exactly when the UI is visible.
- **Guard self-dispatches.** A menu that dispatches its own item activation triggers the chain walk, which fires every observer — including its own. Set `blinkingRef.current = true` before the activation dispatch and check it at the top of the observer callback. Without the guard, the menu dismisses itself mid-animation.
- **Modal surfaces opt out.** `TugAlert` and `TugSheet` do NOT install `observeDispatch` observers — they are app-modal and card-modal respectively, and closing on any chain activity would surprise users. `internal/floating-surface-notes.ts` is the canonical invariants table for the four A2.8 floating surfaces; consult it before adding or removing an observer on a floating surface.

See [responder-chain.md § observeDispatch patterns](responder-chain.md#observedispatch-patterns) for the full precedent.

### No `makeFirstResponder` in component code

First responder is managed by the chain. The document-level pointerdown and focusin listeners installed by `ResponderChainProvider` promote the innermost registered responder under the event target automatically — components do not need to call `manager.makeFirstResponder(id)` to become first responder on click or focus.

The only sanctioned programmatic promotion is `DeckCanvas` promoting a freshly-opened card, where no pointer or focus event has fired yet. If you think your component needs `makeFirstResponder`, stop and ask — you are almost certainly fighting the chain for control of first-responder state and papering over a layering bug. The correct answer is almost always "wire `responderRef` correctly and let the chain's promotion listeners do their job."

### Migration pattern — callback prop → chain dispatch

When retrofitting an existing component that uses a callback prop to emit a user action, the mechanical pattern is:

**Before** — callback prop (L11 violation):
```tsx
export interface TugCloseButtonProps {
  onClose: () => void;  // ❌ callback for a user interaction
  ariaLabel: string;
}

export function TugCloseButton({ onClose, ariaLabel }: TugCloseButtonProps) {
  return <button onClick={onClose} aria-label={ariaLabel}>×</button>;
}

// Consumer:
<TugCloseButton onClose={() => deleteCard(cardId)} ariaLabel="Close" />
```

**After** — chain dispatch + responder handler:
```tsx
// Control: dispatches through the chain, no callback prop.
export interface TugCloseButtonProps {
  ariaLabel: string;  // ← onClose is GONE
}

export function TugCloseButton({ ariaLabel }: TugCloseButtonProps) {
  const manager = useResponderChain();
  return (
    <button
      onClick={() => manager?.dispatch({ action: TUG_ACTIONS.CLOSE, phase: "discrete" })}
      aria-label={ariaLabel}
    >×</button>
  );
}

// Responder (the card): registers a handler for close.
export function TugCard({ cardId }: TugCardProps) {
  const handleClose = useCallback(() => deleteCard(cardId), [cardId]);
  const { ResponderScope, responderRef } = useResponder({
    id: cardId,
    actions: {
      [TUG_ACTIONS.CLOSE]: (_e: ActionEvent) => handleClose(),
    },
  });
  return (
    <ResponderScope>
      <div data-slot="tug-card" ref={responderRef as (el: HTMLDivElement | null) => void}>
        <TugCloseButton ariaLabel="Close card" />  {/* no callback prop */}
        {/* card content */}
      </div>
    </ResponderScope>
  );
}

// Consumer: just renders the card. The close logic lives inside the card.
<TugCard cardId="card-1" />
```

Three things change:

1. The button's `onClose` prop is deleted. The button dispatches the action directly.
2. The state owner (the card) registers a handler for the action. The handler runs the logic that used to be inside the consumer's callback.
3. The consumer stops passing a callback. It just renders the card; the card owns its close behavior.

The migration is a one-way door. Once `close` is a chain action, no part of the codebase should try to route it through a callback prop again — the responder is the single owner of "what does close mean for this card."

This is the pattern the A2 phases followed for every interactive control in the library (A2.1 through A2.8). Real worked examples in the commit history: see `git log --grep='A2\.' tugdeck/` for the per-control migrations and their test files.

---

## Component Patterns

### Emphasis × Role

For components with multiple visual emphases (filled, outlined, ghost) crossed with semantic roles (accent, action, danger, etc.). Each combination maps to a compound CSS class that selects the right tokens.

**When to use:** Buttons, badges — components where the same structural element renders in visually distinct emphasis levels with semantic color meaning.

**Implementation:**
- Props: `emphasis` and `role` (or combined into a variant prop)
- CSS class: `.tug-{name}-{emphasis}-{role}`
- Tokens: `--tug7-surface-control-primary-{emphasis}-{role}-{state}` for backgrounds, `--tug7-element-control-{constituent}-{emphasis}-{role}-{state}` for foregrounds

### Role Color Injection

For selection controls where a single structural design takes on different role colors via CSS custom property injection, without re-rendering.

**When to use:** Checkboxes, switches, radio buttons — controls where the visual structure is identical across roles but the active/on color changes.

**The default is accent.** When no `role` prop is specified, controls use the theme's accent color. The `role` prop exists for when you need something *other than* the default: a semantic signal (danger, success), a functional indicator (action, data, agent), or a deliberately subdued appearance (option).

**Role semantics:**

| Role | Purpose | Example |
|------|---------|---------|
| *(none/accent)* | Brand color. The default. "This is on." | Any checkbox, switch, radio |
| `action` | Primary action indicator. The return-key button. | Dialog confirm, chat send |
| `danger` | Destructive/irreversible operation. | Delete, disconnect, remove |
| `data` | Operation with a cost (tokens, API calls, data transfer). | "Enable AI suggestions" |
| `agent` | AI/autonomous operation involved. | "Let agent handle this" |
| `caution` | Proceed with care. Less severe than danger. | Override warning |
| `success` | Positive confirmation or good state. | Completion indicator |
| `option` | Deliberately subdued. Calm, neutral. | Dense settings panel |

**Implementation:**
- Prop: `role` (optional). Omitting it gives accent. `"accent"` is not in the type union — it's the implicit default.
- JS injection: every path (including default) injects `--tugx-toggle-on-color`, `--tugx-toggle-on-hover-color`, and `--tugx-toggle-disabled-color` as inline styles pointing to the appropriate `--tug7-surface-toggle-{constituent}-normal-{role}-{state}` tokens.
- Single path, zero branches: `const tokenSuffix = role ? (ROLE_TOKEN_MAP[role] ?? role) : "accent";`
- `data-role` attribute: set only when an explicit role prop is provided. Default (accent) emits no `data-role`.
- This is pure appearance-zone work [L06] — no React state, no re-render

### Compositional Components

For components that produce no visual output of their own, but compose two or more tugways components into a unified API. This is the simpler of the two composition patterns — see "Compound Composition" below for the richer case.

**When to use:** When a common composition pattern (e.g., TugPopupMenu + TugButton) warrants a dedicated component to reduce caller boilerplate, but the visual identity is fully owned by the child components.

**Implementation:**
- Produces only a `.tsx` file — no `.css` file.
- Documents delegation in its module docstring: which child components it renders and which styling responsibilities are delegated to them.
- Does not need `@tug-pairings` — its children own the pairings.
- Still needs: exported props interface with JSDoc, `data-slot` on the root element, and law citations.
- Use a plain function (not `forwardRef`) unless a ref to the DOM root is needed.

```typescript
/**
 * TugPopupButton — Convenience popup button composing TugPopupMenu + TugButton.
 *
 * Styling delegated to TugButton (trigger appearance) and TugPopupMenu (dropdown).
 * No component CSS — this is a pure composition.
 *
 * Laws: [L11] controls emit actions, [L19] authoring guide
 */
```

**Reference implementation:** `tug-popup-button.tsx`

### Compound Composition

For components that have their own visual identity AND compose other tugways components. This is the most common pattern for complex controls — a slider that owns its track and thumb but composes TugValueInput for editing, a radio group that owns its circle indicator but composes TugButton for click targets, a search bar that owns its layout but composes TugInput and TugButton.

**When to use:** The component has visual elements it must style directly (track, indicator, icon slots, layout chrome) and also renders one or more existing tugways components as children.

**Token sovereignty [L20].** Each component owns tokens scoped to its own `component` slot in the seven-slot system. The parent's CSS uses parent-scoped tokens; composed children use their own. Neither reaches into the other's namespace. TugSlider uses `slider` tokens for its track and thumb. TugRadioGroup uses `radio` tokens for its indicator. TugValueInput and TugButton keep their own tokens, tunable independently per theme. This is not optional — the seven-slot `component` slot is the ownership boundary.

**Pairings cover only what you own.** The parent's `@tug-pairings` block declares contrast pairings for the visual elements the parent renders directly. Composed children declare their own pairings in their own CSS files. A slider's pairings cover its label-on-track and thumb-on-range relationships, not TugValueInput's text-on-background. No duplication, no contradiction.

**No descendant restyling.** The parent never uses CSS descendant selectors to override a child component's styles (e.g., `.tug-slider .tug-value-input { ... }` is wrong). If the parent needs to position or size a child within its layout, it styles a wrapper element or uses its own layout properties (gap, grid areas, flex sizing). The child's visual internals are the child's business.

**Prop forwarding.** The parent passes relevant props to composed children — most commonly `size`, `disabled`, and `role`. The module docstring documents which props are forwarded and to which children. When children are provided via the `children` prop rather than rendered directly (e.g., radio items), use React context to propagate group-level props so each child doesn't need to repeat them.

**`asChild` for Radix merging.** When a Radix primitive renders an interactive element (button, input) and the tugways component it composes also renders one, use Radix's `asChild` prop to merge them into a single DOM element. This avoids nested buttons or nested inputs (invalid HTML). The Radix primitive contributes its ARIA attributes, keyboard handlers, and data-state; the tugways component contributes its visual rendering. One element in the DOM gets both.

**Implementation:**
- Produces both `.tsx` and `.css` files — the parent has its own visual identity.
- The parent's CSS defines tokens, aliases, and pairings only for elements it renders directly.
- Module docstring lists which children are composed and what each is responsible for.
- The parent's law citations include [L20] in addition to the standard minimum set.

```typescript
/**
 * TugSlider — Horizontal range slider with optional editable value input.
 *
 * Wraps @radix-ui/react-slider. Composes TugValueInput for the editable
 * numeric display — value input appearance is owned by TugValueInput [L20].
 *
 * Laws: [L06] appearance via CSS, [L15] token-driven states, [L16] pairings declared,
 *       [L19] component authoring guide, [L20] token sovereignty
 * Decisions: [D05] component token naming
 */
```

**Reference implementations:** `tug-slider.tsx` (composes TugValueInput), `tug-radio-group.tsx` (composes TugButton via `asChild`).

### Field Controls

For form inputs that follow the field token family.

**When to use:** Text inputs, textareas, selects — form fields with rest/hover/focus/disabled/readOnly states and optional validation.

**Implementation:**
- Tokens: `--tug7-surface-field-primary-*` for backgrounds, `--tug7-element-field-{text,border}-*` for foregrounds
- States: rest → hover → focus → disabled → readOnly
- Validation: `[aria-invalid="true"]` overrides border color (but not focus state)
- Size variants via class

**Namespace boundary for editing fields:** Components that call `document.execCommand` (text engines, contentEditable wrappers) must use the browser's camelCase command names (`"selectAll"`, `"insertText"`, `"delete"`, `"undo"`, etc.) — never the chain's kebab-case action names. These are separate vocabularies. See [action-naming.md § Action Names vs. Browser Command Names](action-naming.md#action-names-vs-browser-command-names).

---

## Selection and Focus

Every component participates in the selection model. See [selection-model.md](selection-model.md) for the full design.

### Selection categories

Determine your component's category and apply the corresponding pattern:

**Selectable** (user can directly select text via click-drag or ⌘A):
- Set `user-select: text` in the component's CSS
- Handle `selectAll` in the responder registration
- Handle `copy` (and `cut`/`paste` if editable)
- Examples: `TugInput`, `TugTextarea`, `TugValueInput`, `TugPromptInput`, `TugMarkdownView`

**Copyable** (informational text the user might want to copy, but not directly select):
- Do NOT set `user-select: text` — inherit `user-select: none`
- Use the `useCopyableText` hook — it handles responder registration, context menu, and clipboard write
- Set `data-tug-select="copy"` on the root element
- Example: `TugLabel` with `copyable` prop

**Chrome** (UI controls with no copyable text content):
- Do NOT set `user-select: text` — inherit `user-select: none`
- No selection handlers needed
- Right-click shows the app-wide "No Actions" fallback menu automatically
- Examples: buttons, toolbars, section headers, decorative elements

### Focus refusal for controls

Controls that dispatch actions but don't need keyboard input should refuse focus on click. This prevents the control from stealing focus from an active editor.

Add `data-tug-focus="refuse"` to the control's root element. That's all — the `ResponderChainProvider` handles both browser focus prevention and first-responder promotion skipping centrally.

```tsx
// Example: a control that refuses focus
<button data-tug-focus="refuse" onClick={handleClick}>
  Action
</button>
```

Controls that accept focus (text inputs, textareas, contentEditable) do NOT add this attribute.

### Context menus

The browser's native context menu is suppressed app-wide. Every right-click produces one of:
- A component-specific `TugEditorContextMenu` (selectable or copyable components)
- The "No Actions" fallback menu (chrome)

Never let the native browser context menu appear — it reveals the web implementation.

### Cursors

The cursor tells the user what will happen if they click. The baseline is `cursor: default` (arrow) on `body` and `.tugcard-content`. Components override explicitly — never leave `cursor: auto` on any element (it shows an I-beam over text, implying selectability).

| Cursor | When to use | Set by |
|--------|-------------|--------|
| `default` (arrow) | Chrome: labels, headers, toolbars, backgrounds, empty space | Inherited from `.tugcard-content` — no action needed |
| `text` (I-beam) | Selectable content: text inputs, textareas, contentEditable, markdown view | Component CSS (`cursor: text` alongside `user-select: text`) |
| `pointer` (hand) | Interactive controls: buttons, checkboxes, switches, links | Component CSS (`cursor: pointer`) |
| `not-allowed` | Disabled controls | Component CSS on disabled/aria-disabled state |
| `grab` / `grabbing` | Draggable surfaces (card title bar) | Component CSS |
| `crosshair` | Precision pick (color pickers) | Component CSS |
| `ew-resize` / `ns-resize` / `nwse-resize` | Resize handles | Component CSS |

**Rule: pair `cursor: text` with `user-select: text`.** Every selectable component sets both. If text shows an I-beam, the user expects to be able to select it. If text is non-selectable, it must show the arrow.

**Rule: chrome inherits the arrow.** Chrome components do not need to set `cursor: default` — they inherit it from `.tugcard-content`. Only set it explicitly if overriding a more specific rule (e.g., `cursor: default` on a readOnly input that would otherwise show I-beam).

---

## Accessibility

Every component must be accessible. This is not optional.

### Keyboard Navigation

- All interactive elements reachable via Tab
- Enter/Space activate buttons and toggles
- Arrow keys navigate within groups (radio, select, tabs)
- Escape closes overlays
- Focus ring visible on `:focus-visible` only (not on click)

### ARIA

- Radix wrappers inherit ARIA from the primitive — don't duplicate
- Native wrappers: add `aria-invalid`, `aria-disabled`, `aria-required` as appropriate
- Every interactive element must have an accessible name (`aria-label`, associated label, or visible text)
- `aria-disabled="true"` (not HTML `disabled`) for chain-action controls that must remain in the tab order [D06]

### Data Attributes

Components emit data attributes for external styling and tooling:

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `data-slot` | Stable semantic identifier | `data-slot="tug-button"` |
| `data-state` | Radix state | `data-state="checked"` |
| `data-role` | Semantic role variant | `data-role="danger"` |
| `data-size` | Size variant | `data-size="sm"` |

---

## Testing

Tests verify behavior, not values. [See test trimming principles.]

### What to Test

- Component renders without throwing
- Keyboard interaction works (Tab, Enter, Space, Escape)
- Prop changes produce correct DOM state (disabled → `aria-disabled`, checked → `data-state`)
- Callbacks fire on interaction
- Role injection produces correct inline style

### What NOT to Test

- Exact token values or CSS output
- Exact class names
- Snapshot tests
- Pixel-level rendering
- Internal implementation details

### Test File Location

```
src/__tests__/tug-{name}.test.tsx
```

Import `./setup-rtl` first, then `bun:test`, then `@testing-library/react`.

---

## Checklist

Before a component is done:

- [ ] `.tsx` follows the TSX structure (docstring, props, forwardRef, data-slot)
- [ ] `.css` follows the CSS structure (@tug-pairings, @tug-renders-on, base → states → variants)
- [ ] All colors via `--tug-*` tokens, zero hardcoded colors
- [ ] Every token matches what it styles: surface tokens for fills/backgrounds, border tokens for borders, text tokens for text — no semantic mismatches
- [ ] No ad-hoc theme logic in component TSX/JS
- [ ] `data-slot="tug-{name}"` on root element
- [ ] Module docstring cites minimum law set ([L06], [L11] if interactive, [L15] if interactive, [L16] if CSS, [L19]) plus any component-specific laws; no `Spec S##` references
- [ ] Props interface exported with JSDoc; every CSS-targetable prop has `@selector` annotation
- [ ] `@tug-pairings` present in both compact and expanded-table formats; components with no pairings use `@tug-pairings: none`
- [ ] Component-tier aliases (if used) defined in `body {}` and resolve to base tokens in one hop [L17]
- [ ] `@tug-effects` block present if the component uses `--tug7-effect-*` tokens
- [ ] Compositional components (no CSS): delegation documented in module docstring; no `@tug-pairings` needed
- [ ] Compound composition: own tokens scoped to own component slot; no descendant restyling of children; pairings cover only own elements; composed children documented in docstring [L20]
- [ ] Internal components: lives in `internal/`, docstring says "Internal building block — use [public component] instead", public wrapper re-exports needed types
- [ ] **Controls emit actions via targeted dispatch.** [L11] Every interactive component that responds to user input dispatches a typed action via `useControlDispatch()`. No `manager.dispatch()` calls from controls. No callback props for user interactions.
- [ ] **Responders register via `useResponder` / `useOptionalResponder`.** Every component that handles actions calls one of the two hooks with a typed `actions` map; the strict form for load-bearing chain participants, the tolerant form for standalone-capable leaves.
- [ ] **`data-slot` + `data-responder-id` on the root element.** `data-slot` via the literal attribute, `data-responder-id` via attaching `responderRef` from the hook to the root DOM element.
- [ ] **No `makeFirstResponder` calls from component code.** First responder is managed by the chain's pointerdown / focusin promotion path. The only sanctioned exception is `DeckCanvas` promoting a freshly-opened card, and it is documented inline where it occurs.
- [ ] **Transient UIs subscribe to `observeDispatch` while open** with a `blinkingRef` self-dispatch guard, unless the surface is intentionally modal (alert, sheet) per `internal/floating-surface-notes.ts`.
- [ ] Handlers read current state through refs, not stale closures [L07]
- [ ] Keyboard accessible (Tab, Enter/Space, Escape)
- [ ] `bun run build` exits 0
- [ ] `bun run test` exits 0
- [ ] `bun run audit:tokens lint` exits 0
- [ ] Renders correctly in Component Gallery across themes

---

## Reference: Token Naming

Tokens follow the seven-slot convention from [token-naming.md](token-naming.md):

```
--<namespace>-<plane>-<component>-<constituent>-<emphasis>-<role>-<state>
```

| Slot | Purpose |
|------|---------|
| namespace | Always `tug7`. Identifies the design system and seven-slot convention. |
| plane | `element` (visible marks) or `surface` (backgrounds) |
| component | `global`, `control`, `field`, `toggle`, `badge`, etc. |
| constituent | `text`, `icon`, `border`, `shadow`, `primary`, `track`, etc. |
| emphasis | `normal`, `filled`, `outlined`, `ghost`, `tinted` |
| role | `default`, `accent`, `action`, `danger`, `success`, etc. |
| state | `rest`, `hover`, `active`, `focus`, `disabled` |

## Reference: Laws That Govern Components

| Law | Summary | Applies To |
|-----|---------|------------|
| [L01] | One `root.render()`, ever | All components |
| [L02] | External state via `useSyncExternalStore` only | Components reading stores |
| [L03] | `useLayoutEffect` for registrations events depend on | Responder participants |
| [L06] | Appearance changes via CSS/DOM, never React state | All components |
| [L07] | Handlers read current state through refs, not stale closures | Action handlers on responders |
| [L11] | Controls emit actions; responders own state that actions mutate | Any component that dispatches or handles an action |
| [L15] | Token-driven control states; color transitions only | Interactive controls |
| [L16] | Every foreground rule declares its rendering surface | All CSS files |
| [L17] | Component aliases (`--tugx-*`) resolve to `--tug7-*` in one hop | Component-tier tokens |
| [L18] | Element/surface vocabulary | All token usage |
| [L19] | Component authoring guide | All components |
| [L20] | Token sovereignty — composed children keep their own tokens | Compound composition |

For the chain mechanics ([L11], [L03], [L07]) in depth — the dispatch walk, first-responder promotion, the four dispatch shapes, `observeDispatch`, the keyboard pipeline — see [responder-chain.md](responder-chain.md).
