# Tugways Design System — Concepts and Roadmap

## Kickoff

Themes need to be "separate" loadable resources; not hard-coded tailwind/CSS.

However, if we think through all the implications of what changing a theme does in an app, we wind up needing to tackle quite a few complex questions like event flow, state management, rendering, component systems, and more. We have recently fixed on React as a core technology and added on shadcn as an aid to achieve quality and consistency. However, these alone are not enough. We also want a "tugcard" abstraction to encapsulate the look and feel of a single window-like component in the app, and we want all tugcards to be customizable based on a set of common behaviors. We need to specify what those behaviors are, how to store them, how to customize them, how to render them, and how to respond when they change.

There is also apprehension about React, since simple uses of it tend to accrete state changes that all too easily cause uncontrolled cascades of updates that ripple through an app, causing all sorts of undesirable effects, including brittleness and rigidness in the face of new changes, and poor performance when seemingly trivial updates occur. There are also difficult invariants like the "rule of hooks", which are like ticking time bombs that can go off at any time. We should probably lean away from states as much as possible and lean toward a model where component mutation is safe, controlled, and easy to understand.

## Feature List

- Themes need to be "separate" loadable resources; not hard-coded tailwind/CSS
- Need a settings view for adjusting themes
- Rethink themes as a precursor to the design system; build in support for revising and extending
- Custom shadcn-based components for *everything*; never use "raw" shadcn
- Tugways: the name of the tug design system for components used in tugcards and tugdeck
- Rename tuglook (the previous/tentative name for the design system) to tugways
- All UI components get a `Tug` prefix to give namespacing and allow us to inventory what we have and what we don't
- Start with `TugButton` as the first test-case component for how to design a tugways component
- Follow on with all components: selects, sliders, input, badges, etc. (ref: https://ui.shadcn.com/docs/components)
- The responder chain is key; it will determine how all components are wired up; look at Apple docs for this
- Tugcard abstraction that serves as the common base component for all cards, offering standard API for what a card is and does
- API to return calculated minsize of a tugcard, so that we can ensure content stays visible
- Accessory views in cards; find window in any text card
- A proper skeleton model to cover moments when we can't display a fully ready-to-use UI
- Full alert/dialog system; app-modal/card-modal/modeless-informational
- Examine how Terminal, Filesystem, Git, Status, and Code cards handle their datafeeds — do we actually have a TugFeed abstraction to cover these uniformly, or is each one ad-hoc? What is the state of how they provide data to tugcast?
- The task-feed: multiplexed output from skills and agents
- Change Brio style to be dark greenish
- Need a keybindings view
- Add minimize/window-shade control to the card title bar (up/down chevron icon)
- Add confirmation dropdown to x/close box for cards
- Turn hamburger menu in the card title bar 90 degrees
- Fix the dock; giving it command buttons and popout menu buttons

---

## Current State (as of March 2026)

### What Exists

**Theme system.** Three themes (Brio, Bluenote, Harmony) defined entirely in `tugdeck/styles/tokens.css` as CSS custom properties. Theme switching works via body class (`td-theme-bluenote`, `td-theme-harmony`; Brio is the `:root` default). The `use-theme.ts` hook reads/sets the current theme, persists to localStorage, dispatches a `td-theme-change` CustomEvent, and syncs to the Swift bridge. All theme data is hardcoded in that one CSS file — no separate loadable resources.

**Token architecture.** Three tiers already in place: Tier 1 palette (`--tl-*`), Tier 2 semantic (`--td-*`), Tier 3 component-specific. Shadcn bridge aliases (`--background`, `--foreground`, etc.) map from the `--td-*` layer. This architecture is sound but the values are baked in.

**Card system.** `TugCard` interface in `cards/card.ts` defines: `feedIds`, `collapsible`, `meta` (title, icon, closable, menuItems), and lifecycle methods (`mount`, `onFrame`, `onResize`, `focus`, `destroy`). `ReactCardAdapter` wraps React components to implement this interface. Eight card types are registered. Each card is a standalone React functional component with no shared base beyond what `CardContext` provides.

**shadcn components.** 13 components in `components/ui/`: Button, Card, Checkbox, Dialog, DropdownMenu, Input, RadioGroup, ScrollArea, Select, Switch, Tabs, Textarea, Tooltip. All are stock shadcn — used raw except `CardDropdownMenu` which wraps `DropdownMenu` for the card menu item model.

**Feed system.** `CardContext` provides `feedData: Map<FeedIdValue, Uint8Array>`, and the `useFeed()` hook gives individual cards access to their subscribed feed data. Each card decodes and renders its own feed data independently — there is no uniform `TugFeed` abstraction.

**Dock.** React component, 48px vertical rail on the right edge. Icon buttons for each card type, a settings dropdown menu with theme selector, dev notifications badge, and tug logo.

**Settings card.** Theme selection (RadioGroup), source tree path picker, and developer mode toggle. Minimal.

### What Doesn't Exist

- Loadable/external theme resources
- Tugways naming or namespace
- `Tug`-prefixed component wrappers
- Responder chain or structured event flow
- Common tugcard base component with shared behaviors
- Card min-size calculation API
- Accessory view system for cards
- Skeleton/loading model
- Alert/dialog system beyond raw shadcn Dialog
- Keybindings view
- Card minimize/window-shade control
- Close confirmation for cards
- Task-feed for multiplexed agent output
- Dock command buttons or popout menus

---

## Concept Areas

The work breaks down into several interconnected concept areas. Each needs discussion and design before implementation. They are listed here roughly in dependency order — later items build on earlier ones.

### 1. Theme Architecture: Loadable Resources

**Status: DESIGNED** (2026-03-01)

**The problem.** All three themes live in `tokens.css` as hardcoded CSS. Adding or modifying a theme means editing that file. Themes cannot be loaded at runtime, bundled separately, or provided by users. Worse, the three-tier architecture is only actually working for Brio — Bluenote and Harmony each duplicate all ~80 values (both `--tl-*` palette AND `--td-*` semantic) with hardcoded hex, bypassing the `var()` chain that should make semantic tokens derive automatically from palette values.

#### Decisions

**Prefix rename: `--tl-` → `--tways-`.** The old `--tl-` prefix (from "tuglook") is renamed to `--tways-` (for "tugways"). This avoids any potential conflict with Tailwind's `--tw-` internal prefix, and there's no reason the prefix needs to be two letters. `--tways-` is distinctive and self-documenting. The semantic tier keeps its `--td-` prefix (for "tugdeck" — the application's purpose-driven mappings, distinct from the design system's palette).

**Format: CSS.** A theme file is a CSS file containing custom property declarations — because that's literally what theme values are. CSS custom properties can hold any CSS value natively: colors, shadows, gradients, complex expressions. No translation, no escaping, no special cases. A structured comment header provides metadata (name, description).

Example theme file (`bluenote.css`):
```css
/**
 * @theme-name Bluenote
 * @theme-description Cool dark theme
 */
body {
  --tways-bg: #2a3136;
  --tways-bg-soft: #363e43;
  --tways-bg-line: rgba(255, 255, 255, 0.018);
  --tways-panel: #3a454c;
  --tways-panel-soft: #313b43;
  --tways-panel-ink: #d9e0e4;
  --tways-surface-1: #3b4348;
  --tways-surface-2: #343c41;
  --tways-surface-3: #30373c;
  --tways-surface-4: #2a3237;
  --tways-surface-screen: #5c6871;
  --tways-surface-screen-ink: #edf2f5;
  --tways-text: #dde4e8;
  --tways-text-soft: #a8b6bf;
  --tways-text-inverse: #edf1f3;
  --tways-accent: #ff8434;
  --tways-accent-strong: #f27024;
  --tways-accent-cool: #4bbde8;
  --tways-accent-1: #ff8434;
  --tways-accent-2: #4bbde8;
  --tways-accent-3: #ab7ee4;
  --tways-accent-4: #ff5162;
  --tways-accent-5: #73c382;
  --tways-accent-6: #ffe465;
  --tways-accent-7: #ec76c9;
  --tways-accent-8: #ff9a72;
  --tways-border: #5b6871;
  --tways-border-soft: #79858d;
  --tways-shadow-hard: #11191f;
  --tways-shadow-mid: #11191f;
  --tways-shadow-soft: rgba(0, 0, 0, 0.44);
  --tways-glow: rgba(142, 183, 190, 0.24);
  /* Complex values work naturally in CSS — no escaping or special handling */
  --tways-depth-raise:
    0 1px 0 0 rgba(255, 255, 255, 0.18),
    0 1px 2px -1px rgba(0, 0, 0, 0.44);
  --tways-track-bg: repeating-linear-gradient(
    to bottom, #6c7b85 0px, #6c7b85 1px, #84939c 2px, #84939c 4px
  );
  /* Optional overrides — omit to use Brio's default derivation */
  --tways-canvas: #2a3136;
  --tways-header-active: #344f5e;
  --tways-header-inactive: #2a3a44;
}
```

Theme files contain palette values (including complex CSS values like shadows and gradients) plus optional override tokens. Any token not specified falls back to Brio's CSS default.

**Where themes live: bundled now, loadable later.** The three current themes (Brio, Bluenote, Harmony) are bundled as separate CSS files in the app. The architecture supports loading external theme files from the filesystem via `fetch()` in the future, but implementing that is not an immediate priority.

**Themes specify palette only.** Theme files contain only Tier 1 palette values (`--tways-*`). The Tier 2 semantic layer (`--td-*: var(--tways-*)`) and the Tier 3 component layer remain in `tokens.css` as permanent `var()` references — they derive automatically when palette values change. This eliminates the current duplication where Bluenote and Harmony each redundantly specify ~80 values.

**Optional palette entries for per-theme semantic overrides.** Some tokens like `canvas`, `header-active`, `header-inactive`, `icon-active`, and `grid-color` currently vary per theme but are semantic-tier, not palette. The solution: make them optional palette entries (`--tways-canvas`, `--tways-header-active`, etc.) that themes can specify if they want to diverge from the default derivation. The semantic tier derives them from other palette values by default (e.g., `--td-canvas: var(--tways-canvas, var(--tways-bg))`). No special mechanism — just CSS `var()` with fallback.

**Brio is the blessed default.** Brio's palette values are defined in `tokens.css` as CSS defaults on `body`. When applying a different theme, the theme's CSS overrides palette properties. Missing keys automatically fall back to Brio because the CSS defaults were never overridden.

**Tailwind interaction: works unchanged.** The full chain is: Tailwind utility class (e.g. `bg-primary`) → `@theme` var in `globals.css` (`--color-primary: var(--primary)`) → legacy alias in `tokens.css` (`--primary: var(--td-accent)`) → semantic token (`--td-accent: var(--tways-accent)`) → palette value. Changing palette values at runtime cascades through the entire chain. Tailwind generates utility classes at build time referencing CSS variables; the variables resolve at runtime. No Tailwind involvement in theme switching.

#### Theme Application Mechanism

Replace the current body-class approach with stylesheet injection:

1. **Startup:** Brio's values are already in CSS (the `body { --tways-*: ... }` block in `tokens.css`). No injection needed.
2. **Apply theme:** Load the theme CSS file (bundled import or `fetch()` for external). Inject it as a `<style>` element in the document head. Because it appears after `tokens.css` in the cascade, its `body { --tways-*: ... }` declarations override Brio's defaults.
3. **Revert to Brio:** Remove the injected `<style>` element. Brio's CSS defaults in `tokens.css` take over.
4. **Swift bridge:** After applying, read the resolved `background-color` from `document.body` and post it to the Swift bridge (same as today).
5. **Persist:** Store the theme name in localStorage (or shared settings). On next load, re-inject the theme stylesheet.

**What this eliminates:**
- The `body.td-theme-bluenote` and `body.td-theme-harmony` CSS blocks (~190 lines of duplicated values in `tokens.css`)
- The body class toggling mechanism
- The `td-theme-change` CustomEvent (CSS cascade handles visual updates; no React re-render needed)
- The need for any component to "listen" for theme changes — CSS variables just work

**What stays in `tokens.css`:**
- Font declarations
- Brio's palette values as `body { --tways-*: ... }` defaults
- The entire Tier 2 semantic layer (`body { --td-*: var(--tways-*) }`)
- The legacy/shadcn bridge aliases (`--background: var(--td-bg)`, etc.)
- Shared tokens that don't vary per theme (radius, spacing, fonts, line-height)
- Scrollbar styling

**What stays in `globals.css`:**
- The `@theme` registration that maps CSS variables into Tailwind's namespace

#### Validation

When loading a theme (bundled or external), validate against Brio's palette as the canonical key set. For each key in Brio that is missing from the loaded theme, the Brio CSS default persists — no explicit fallback code needed. For external themes in the future, we may want to log warnings for missing keys.

### 2. Tugways: The Design System

**Status: DESIGNED** (2026-03-01)

**The problem.** "Tuglook" was the working name for the visual language (tokens, themes, aesthetics). We're renaming to "tugways" and expanding the scope: tugways is the complete design system — tokens, components, patterns, and conventions.

**What tugways encompasses:**
- **Tokens:** the three-tier variable system (palette, semantic, component)
- **Components:** `Tug`-prefixed components that wrap, compose, or extend shadcn primitives
- **Patterns:** how components compose (cards, accessory views, dialogs, skeletons)
- **Conventions:** naming, file organization, how new components are added
- **Behaviors:** responder chain, event flow, focus management

#### Decisions

**The `Tug` wrapper's job: cosmetic + behavioral + contractual.** Tugways components are not thin cosmetic wrappers. They encapsulate:
- **Semantic color mapping** — enforce and map tugways semantic colors to concrete elements
- **Component subtypes** — a single tugways component can represent a family of related controls (e.g., TugButton encompasses push button, icon button, icon+text button, three-state button)
- **State management** — states beyond what shadcn provides (disabled, loading, active, focused, selected), with consistent visual treatment across the design system
- **Theme-awareness** — components respond to theme changes via CSS variable cascade (no React re-render needed, per concept 1)
- **Responder chain integration** — components participate in the responder chain (concept 4)

**Tugways components carry strong opinions.** shadcn's variant model (primary/secondary/danger/ghost) is a starting point, not the final vocabulary. Tugways components define their own variant sets that reflect the actual needs of the app — including subtypes, states, and semantic color mappings. The variants should cover the full range of what the component needs to express, not just what shadcn happens to offer.

**Three kinds of tugways components:**

1. **Wrappers** — a shadcn primitive wrapped with tugways opinions. The shadcn component is the internal implementation; the Tug component is the public API. Examples: TugButton (wraps Button), TugInput (wraps Input), TugSelect (wraps Select).

2. **Compositions** — multiple shadcn primitives assembled into a higher-level component that doesn't exist in shadcn. Examples: a search bar (Input + Button), a toolbar (multiple Buttons in a group), a labeled control (Label + Input + helper text).

3. **Originals** — components that shadcn doesn't offer at all, built from scratch or from lower-level Radix primitives. Examples: card title bar, responder-chain-aware containers, skeleton placeholders, accessory view frames.

**File organization:**

```
components/
  ui/           # raw shadcn components (private implementation detail)
  tugways/      # Tug-prefixed components (public API)
    TugButton.tsx
    TugInput.tsx
    TugSelect.tsx
    TugDialog.tsx
    ...
```

**The rule: app code imports from `components/tugways/`, never from `components/ui/`.** The `ui/` directory is kept as-is (for easy shadcn updates) but is consumed only by tugways wrappers. This gives us the best of both worlds: shadcn's accessible primitives and Radix behavior under the hood, with our own opinions, subtypes, and conventions on top. We don't reinvent — we customize. And when we need something shadcn doesn't offer, we build it as an original.

#### Component Priority

After TugButton (concept 3), the rollout order is:

1. TugSelect
2. TugBadge
3. TugLabel
4. TugCheckbox
5. TugRadioGroup
6. TugSpinner
7. TugSlider
8. TugSwitch
9. TugAvatar
10. TugProgress
11. TugButtonGroup
12. TugInput
13. TugTextarea
14. TugDialog
15. TugAlertDialog

Note: some of these (Badge, Spinner, Avatar, Progress, ButtonGroup) don't have shadcn equivalents and will be originals or compositions.

#### Subtype Naming

Single component with a subtype prop is the default approach. For example, `<TugButton subtype="icon">` rather than a separate `TugIconButton`. If a subtype diverges enough that the single-component API becomes awkward, break it out into a separate component on a case-by-case basis.

#### Inventory Tracking

The `components/tugways/` directory is the inventory. If a `Tug`-prefixed component file exists, it's wrapped. If it doesn't, it's still raw. No manifest file needed.

### 3. TugButton: The Test Case

**The problem.** We need a concrete first component to establish the pattern for all tugways components.

**What TugButton needs to demonstrate:**
- How a tugways component wraps a shadcn primitive
- How it connects to the theme system (responds to theme changes without re-rendering)
- How it participates in the responder chain (see below)
- How it handles focus, keyboard interaction, accessibility
- How its variants are defined and selected
- How it's documented and inventoried

**Design exercise:** Take shadcn's `Button` component (which uses CVA for variant management) and design the `TugButton` wrapper. What does the wrapper add? What does it restrict? What API does it expose?

### 4. The Responder Chain

**This is the architectural keystone.** Get this right and everything else — keyboard handling, focus management, action dispatch, theme response — falls into place. Get it wrong and we build the same ad-hoc wiring mess we're trying to escape.

**The problem.** Components need a structured way to handle events — particularly keyboard events, focus management, and action dispatch. Without this, every component wires up its own event listeners in ad-hoc ways, leading to conflicts, missed events, and unpredictable behavior.

#### Apple's Responder Chain: What We're Drawing From

The macOS/iOS responder chain (NSResponder/UIResponder) provides the architectural model. Key mechanics:

**The chain is a linked list.** Each responder has a `nextResponder` pointer. Events and actions propagate from the most specific responder (the focused control) up toward the most general (the application). The chain is constructed automatically from the view hierarchy.

**Typical macOS chain structure:**
```
Focused view → superview → ... → content view → NSWindow → NSWindowController → NSApplication
```

**Three things flow through the chain:**
1. **Key events** — delivered to the first responder, propagated up if unhandled
2. **Actions** — semantic commands like `copy:`, `paste:`, `close:` dispatched with nil target; the chain finds the first responder that implements the action
3. **Validation queries** — "can anyone in the chain handle `paste:` right now?" — used to enable/disable menu items and toolbar buttons

**Four-stage key processing pipeline** (in priority order):
1. **Key equivalents** — global shortcuts (Cmd+S, Cmd+W) checked top-down through the view hierarchy before the chain
2. **Keyboard navigation** — Tab, Enter, Escape handled at the system level for focus management
3. **Key bindings → semantic actions** — keystroke mapped to a named action (e.g., Ctrl+E → `moveToEndOfLine:`), then the action walks up the chain
4. **Text insertion** — if no binding matches, the character is inserted into the first responder

This separation into stages is crucial. Global shortcuts take priority over card-level actions. Keyboard navigation takes priority over text editing. Each stage has clear ownership.

**First responder** — one per window. The starting point for key events and nil-targeted actions. Acquired via `makeFirstResponder:` with a negotiation protocol: the current first responder can refuse to resign (e.g., a text field with invalid input), and the new responder can refuse to accept.

**Modal boundaries** — modality works by constraining which chain is active. A modal dialog confines events to its own chain. No special-case modal logic in individual components — the constraint is at the chain-selection level.

**Menu/action validation** — the chain is queried lazily (when a menu opens, not continuously). Each responder answers "can I handle this action?" and "should it be enabled right now?" This decouples controls from handlers completely.

#### How This Maps to Tugdeck

**The chain structure for tugdeck:**
```
Focused tugways component (TugButton, TugInput, etc.)
  → Card content area
  → TugCard
  → DeckCanvas
  → TugApp (application level)
```

Each level in the chain corresponds to a real architectural boundary:
- **Tugways component** — handles component-level actions (e.g., a text input handles `selectAll`)
- **Card content** — handles content-specific actions (e.g., conversation card handles `sendMessage`)
- **TugCard** — handles card-level actions (e.g., `close`, `minimize`, `toggleMenu`)
- **DeckCanvas** — handles deck-level actions (e.g., `cycleCards`, `resetLayout`)
- **TugApp** — handles app-level actions (e.g., `showSettings`, `changeTheme`, `quit`)

**First responder = focused card.** Tugdeck has one focused card at a time. That card's chain is the active chain for key events and actions. The card's internal components form the bottom of the chain; the card itself is in the middle; the app is at the top.

**Key processing pipeline for tugdeck** (adapted from Apple's four stages):

| Stage | Scope | Examples | Direction |
|-------|-------|----------|-----------|
| 1. Global shortcuts | App-wide, always active | Cmd+N (new card), Cmd+W (close card), Cmd+, (settings) | Top-down: checked before the chain |
| 2. Keyboard navigation | Focus management | Tab (next control), Shift+Tab (prev), Escape (dismiss), Enter (confirm) | System-level |
| 3. Action dispatch | Semantic actions via chain | Copy, paste, find, card-specific commands | Bottom-up: chain walks from first responder to app |
| 4. Text input | First responder only | Typing into an input field | Delivered to first responder |

**Modal boundaries in tugdeck:**
- **App-modal dialog** — chain is confined to the dialog. No card receives events. Deck shortcuts disabled.
- **Card-modal** — chain within the card is confined to the modal (e.g., close confirmation). Other cards unaffected. Global shortcuts still work.
- **Modeless notification** — does not affect the chain at all.

**Action validation for tugdeck:**
- Dock buttons, card menu items, and keyboard shortcuts can query the chain: "can anyone handle `find` right now?"
- A card with searchable text would say yes; a terminal card might say no.
- This drives enabling/disabling of dock buttons and menu items dynamically.

#### Implementation Approach

**The chain operates outside React state.** This is the critical design decision. The responder chain is an imperative system — components register and unregister, actions are dispatched and handled, first responder status is acquired and resigned — all without triggering React re-renders.

**A `ResponderChain` manager** — a stable, mutable object provided via React context. The context value (the manager reference) never changes, so providing it does not cause re-renders. Components interact with the manager imperatively.

**Components register via a `useResponder` hook:**
```
useResponder({
  actions: {
    copy: () => { ... },
    paste: () => { ... },
    find: () => { ... },
  },
  canHandle: (action) => { ... },   // for validation queries
})
```

The hook registers the component as a responder on mount and unregisters on unmount. Internally it uses refs, not state. The `nextResponder` link is determined automatically from the React component tree (the nearest ancestor that also called `useResponder`).

**Action dispatch is a function call:**
```
responderChain.dispatch('copy')     // walks the chain, finds a handler, calls it
responderChain.canHandle('paste')   // validation query — returns true/false
```

**First responder management:**
```
responderChain.makeFirstResponder(cardId)   // sets the focused card
responderChain.resignFirstResponder()       // current first responder gives up focus
```

The manager tracks which card is first responder and starts chain traversal from that card's deepest registered responder.

**Global shortcuts are handled separately** — a top-level `keydown` listener that checks a keybinding map before the chain is consulted. If a global shortcut matches, it's handled immediately and the event doesn't reach the chain.

#### Resolved Questions

**Parent discovery: nested context (option b).** Each responder provides a context to its children containing itself as the parent. Children automatically know their parent responder without walking the fiber tree or explicit IDs.

**Mouse/pointer events: no.** The chain handles keyboard events, actions, and validation only. Mouse events go via hit-testing (DOM event bubbling), following Apple's model.

**Focus model: the responder chain is the focus model.** The deck-manager informs the responder chain when card focus changes (via `makeFirstResponder`), but the responder chain is the single authority on focus. There is no separate focus system.

#### Action Vocabulary

The action vocabulary is a defined set of action names, organized by category. Actions are strings (not an enum) to allow card-specific extensions, but the standard set is documented here. Modeled on Apple's NSResponder/UIResponder standard actions, filtered to what tugdeck actually needs.

**Clipboard actions** (handled by focused component or card):
| Action | Description |
|--------|-------------|
| `copy` | Copy selection to clipboard |
| `cut` | Cut selection to clipboard |
| `paste` | Paste from clipboard |
| `pasteAsPlainText` | Paste without formatting |

**Selection actions:**
| Action | Description |
|--------|-------------|
| `selectAll` | Select all content in the focused component |

**Find actions** (walk up the chain; text-bearing cards handle these):
| Action | Description |
|--------|-------------|
| `find` | Open find bar / focus find input |
| `findNext` | Find next occurrence |
| `findPrevious` | Find previous occurrence |
| `useSelectionForFind` | Use current selection as find query |

**Undo/Redo:**
| Action | Description |
|--------|-------------|
| `undo` | Undo last action |
| `redo` | Redo last undone action |

**Cancellation:**
| Action | Description |
|--------|-------------|
| `cancel` | Cancel current operation / dismiss modal / deselect (Escape) |

**Scrolling/Navigation:**
| Action | Description |
|--------|-------------|
| `scrollUp` | Scroll up one page |
| `scrollDown` | Scroll down one page |
| `scrollToTop` | Scroll to beginning of content |
| `scrollToBottom` | Scroll to end of content |

**Card actions** (handled at the TugCard level):
| Action | Description |
|--------|-------------|
| `closeCard` | Close the focused card (with confirmation if applicable) |
| `minimizeCard` | Minimize/window-shade the focused card |
| `restoreCard` | Restore a minimized card |
| `focusNextCard` | Move focus to the next card |
| `focusPreviousCard` | Move focus to the previous card |

**App actions** (handled at the TugApp level — end of the chain):
| Action | Description |
|--------|-------------|
| `showSettings` | Open settings card |
| `showAbout` | Open about card |
| `showKeybindings` | Open keybindings view |
| `resetLayout` | Reset card layout to default |
| `changeTheme` | Open theme picker |

**Card-specific actions** (each card type can register its own):
| Action | Card | Description |
|--------|------|-------------|
| `sendMessage` | Conversation | Send the current input |
| `clearTerminal` | Terminal | Clear terminal buffer |
| `refreshStatus` | Git | Refresh git status |
| `refreshFiles` | Files | Refresh file listing |

This vocabulary will grow as we build out the app. The key principle from Apple: actions are **semantic** (what to do), not **mechanical** (how to do it). `copy` means "copy the current selection" — the chain figures out *whose* selection and *how* to copy it.

#### Resolved Items

**Keybinding map: deferred to concept 12.** The responder chain only knows about actions, not keys. Adding keybindings later that dispatch actions into the chain can be done without changing the chain architecture.

**Action validation: two-level, following Apple's model.** Adopt Apple's battle-tested two-level validation:
1. **`canHandle(action)`** — capability query. "Does any responder in the chain implement this action?" Returns boolean. Analogous to `responds(to:)`.
2. **`validateAction(action)`** — enabled-state query. "I implement this action, but is it currently available?" Returns boolean (or could return metadata). Analogous to `validateMenuItem:`. Called on the responder that `canHandle` found.

This drives dynamic UI: a dock button or menu item is *visible* if someone in the chain can handle the action, and *enabled* if that handler says it's currently valid. For example, `copy` is visible whenever a text-bearing card is focused, but only enabled when text is selected.

### 5. Controlled Mutation vs. React State

**Status: DESIGNED** (2026-03-01)

**The problem.** React's core model is: state changes → re-render → DOM update. This is elegant for small components but becomes a liability at scale. A single state change in a high-level component triggers a re-render cascade through its entire subtree. Performance suffers. Reasoning about what re-renders when becomes difficult. Hooks like `useMemo` and `useCallback` are band-aids that add complexity without solving the fundamental issue.

The real question: how do we get *precise* control over event firing in React in a way that respects its model, allows us to manipulate *data* that belongs to components, get *targeted re-renders* when display information changes, and do *both* without one tripping over the other?

#### The Key Insight: We're Not Fighting React — We're Scoping It

The mistake most React apps make is putting *everything* in React state. Theme? State. Focus? State. Card position? State. Scroll position? State. Then every change triggers a re-render cascade and you're drowning in `useMemo`/`useCallback` band-aids.

But we've already been designing systems that operate outside React state:
- **Theme changes** (concept 1): CSS variable swap on the document element. Zero re-renders.
- **Responder chain and focus** (concept 4): imperative manager with refs. Zero re-renders.
- **Card positions and layout**: deck-manager manipulates DOM directly. Zero re-renders.

The pattern is already clear. The principle is: use React for what it's good at (rendering UI from data), and use the DOM directly for what React isn't needed for (visual state that the browser handles natively via CSS).

#### Three Zones of Change

Every change in the app falls into one of three zones. Each zone has a different mechanism and a different re-render profile:

| Zone | What Changes | Mechanism | Re-renders? |
|------|-------------|-----------|-------------|
| **Appearance** | Theme, focus indicators, animations, card position/size, scroll position, selection highlight | CSS custom properties, CSS classes, DOM `style` manipulation, data attributes | **No.** The browser handles it via CSS cascade or direct DOM mutation. React never knows it happened. |
| **Local data** | Card content (feed data), form input values, component-internal state | React state **local to the component that displays it** | **Yes, but only that component.** The re-render is targeted because the state lives at the leaf, not at the root. |
| **Structure** | Show/hide a section, add/remove a card, open/close a modal, switch tabs | React state at the **appropriate level** — the nearest common ancestor of the affected subtree | **Yes, the affected subtree.** This is what React is designed for. |

The rules:

1. **Never put appearance state in React state.** Theme tokens are CSS variables. Focus indicators are CSS classes toggled by the responder chain. Card dimensions are set by the layout engine via `element.style`. Animations are CSS transitions or `requestAnimationFrame`. None of these need React's diffing — the browser handles them natively and efficiently.

2. **Keep data state as local as possible.** A card's feed data belongs in that card's component, not in a shared parent. A form value belongs in the input component, not in the form's parent. The further down the tree state lives, the smaller the re-render blast radius.

3. **When you must share state, use selective subscriptions.** React 18+ provides `useSyncExternalStore` for this exact purpose: an external mutable store that components subscribe to selectively. Each component subscribes to a *slice* of the store. Only components whose slice changed re-render.

4. **The responder chain, theme system, and layout engine are imperative systems.** They operate outside React's state model. They touch the DOM directly or via CSS. React components can *read* from them (to render initial state), but ongoing changes flow through imperative channels, not state updates.

#### `useSyncExternalStore`: The Key React Pattern

This is the React-sanctioned escape hatch for external mutable data. It lets data live outside React (in a plain object, a WebSocket handler, a feed processor) while components subscribe to exactly the slice they need:

```
// External store — mutated imperatively (e.g., by WebSocket handler)
const feedStore = {
  data: new Map<string, Uint8Array>(),
  listeners: new Set<() => void>(),

  subscribe(callback) { ... },
  getFeed(feedId) { return this.data.get(feedId); },

  // Called by WebSocket — NOT a React action
  updateFeed(feedId, payload) {
    this.data.set(feedId, payload);
    this.listeners.forEach(l => l());
  }
};

// In a card component — subscribes to ONE feed
function GitCard() {
  const feedData = useSyncExternalStore(
    feedStore.subscribe,
    () => feedStore.getFeed('git')  // only re-renders when THIS feed changes
  );
  // render from feedData...
}
```

Data mutates freely outside React. The WebSocket handler updates the store. Only the card that subscribes to the changed feed re-renders. No cascade. No context propagation. No `useMemo`.

This pattern applies to:
- **Feed data per card** — each card subscribes to its own feed(s)
- **Responder chain state** — dock buttons subscribe to `canHandle`/`validateAction` for their action, re-rendering only when the focused card changes
- **Connection status** — components that display connection state subscribe to connection store

#### How Each Existing System Maps to the Zones

| System | Zone | Mechanism | Why |
|--------|------|-----------|-----|
| Theme switching | Appearance | CSS variable injection on `<html>` (concept 1) | Colors are CSS — the browser cascades them instantly |
| Card focus change | Appearance | Responder chain sets CSS class on focused card (concept 4) | Focus ring is visual — no component content changes |
| Card position/resize | Appearance | Deck-manager sets `element.style.transform/width/height` | Layout is geometry — React doesn't need to know |
| Feed data arrival | Local data | `useSyncExternalStore` per card per feed | Each card re-renders independently when its data changes |
| Form input typing | Local data | React `useState` in the input component | The input re-renders; nothing else does |
| Card metadata (title, icon) | Local data | State in the card header component, not above it | Only the header re-renders when title/icon changes |
| Open/close a card | Structure | React state in deck canvas | The card mounts/unmounts; other cards unaffected |
| Open a modal dialog | Structure | React state in the modal system | The modal mounts; the rest of the app doesn't re-render |
| Dock button enabled state | Local data | Dock subscribes to responder chain validation | Only affected dock buttons re-render when focus changes |

#### What This Means in Practice

When a developer adds a new feature to tugdeck, the question is never "should I use React state?" in the abstract. The question is: **which zone does this change belong to?**

- "I need to highlight the focused card" → **Appearance.** Toggle a CSS class. Don't touch state.
- "I received new git status data" → **Local data.** `useSyncExternalStore` in the git card. Only the git card re-renders.
- "The user clicked the settings dock button" → **Structure.** The settings card mounts. State change at the deck level. Other cards don't re-render.
- "The theme changed" → **Appearance.** Inject a stylesheet. Zero re-renders. Every component picks up the new colors via CSS variables instantly.
- "The user typed in the message input" → **Local data.** `useState` in the input. Only the input re-renders.

The three-zone model makes the answer mechanical, not a judgment call. And critically: **the appearance zone — the biggest source of cascade re-renders in typical React apps — never touches React at all.**

#### Specific Machinery for Each Zone

**Appearance Zone — the DOM utility layer.** We need a small set of hooks that make it ergonomic to do CSS/DOM mutations from React components without reaching for `useState`. These are thin wrappers around `ref.current.style.setProperty()` and `ref.current.classList.toggle()`, but having them as *named patterns* prevents developers from accidentally using React state instead:

```
// Set a CSS custom property on a ref'd element — no re-render
function useCSSVar(ref, name, value) {
  useEffect(() => {
    ref.current?.style.setProperty(name, value);
  }, [name, value]);
}

// Toggle a CSS class on a ref'd element — no re-render
function useDOMClass(ref, className, condition) {
  useEffect(() => {
    ref.current?.classList.toggle(className, condition);
  }, [className, condition]);
}

// Apply a style object imperatively — for layout engine, drag, resize
function useDOMStyle(ref, styles) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const [prop, value] of Object.entries(styles)) {
      el.style[prop] = value;
    }
  }, [styles]);
}
```

These live in a `tugways/hooks/` directory alongside `useResponder`. They are the sanctioned way to make appearance changes. The rule: **if you're changing how something looks (not what it shows), use one of these hooks, not `useState`.**

For high-frequency updates (drag, resize, scroll, animation), bypass even these hooks — use `requestAnimationFrame` with a ref directly:

```
// During drag — 60fps, zero React involvement
function onPointerMove(e) {
  requestAnimationFrame(() => {
    panelRef.current.style.transform = `translate(${x}px, ${y}px)`;
  });
}
// On drag end — sync final position to React state (structure zone)
function onPointerUp(e) {
  setCardPosition({ x: finalX, y: finalY });
}
```

The principle: **bypass React during the gesture, sync on commit.** This is how Excalidraw handles canvas interaction — imperative during drag, state update on completion.

**Local Data Zone — `useSyncExternalStore` with gotcha prevention.** The core mechanism is `useSyncExternalStore`, but it has specific traps that will bite us if we're not careful:

*Gotcha 1: Snapshot reference instability.* If `getSnapshot` returns a new object every call, the component re-renders on every store notification even if the data hasn't changed. React will warn: "The result of getSnapshot should be cached."

```
// WRONG — new object every call, re-renders every time
() => ({ feed: store.getFeed('git') })

// RIGHT — return the same reference
() => store.getFeed('git')
```

*Gotcha 2: Subscribe function identity.* If `subscribe` is defined inside the component, it creates a new function reference every render, causing unsubscribe/resubscribe loops:

```
// WRONG — defined inside component
function GitCard() {
  const data = useSyncExternalStore(
    (cb) => store.subscribe(cb),  // new function every render!
    ...
  );
}

// RIGHT — stable reference, defined outside or as store method
const data = useSyncExternalStore(
  store.subscribe,  // same function reference always
  ...
);
```

*Gotcha 3: Selective subscription.* Vanilla `useSyncExternalStore` notifies on *any* store change. To re-render only when a specific feed changes, the store can use per-feed listener sets, or we can use `useSyncExternalStoreWithSelector` (a React shim) which takes a selector and equality function:

```
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/shim/with-selector';

function useFeed(feedId) {
  return useSyncExternalStoreWithSelector(
    feedStore.subscribe,
    feedStore.getSnapshot,
    null, // no server snapshot
    (snapshot) => snapshot.get(feedId),  // select this feed only
    Object.is  // re-render only if the Uint8Array reference changed
  );
}
```

**Whether to use a library (Zustand, Jotai) or raw `useSyncExternalStore`:** For the feed store, raw `useSyncExternalStore` is sufficient — the pattern is simple (per-card subscription by feed ID). If we find ourselves building more complex shared state (undo/redo stacks, multi-card coordination), Zustand or Jotai would reduce boilerplate. Jotai's atomic model (each atom is its own store) is particularly clean for per-card independence. Decision: **start raw, adopt a library if/when the complexity warrants it.**

**Structure Zone — React state with discipline.** This is standard React, but with rules to prevent cascade:

*Rule 1: State lives at the lowest common ancestor, not higher.* The deck canvas owns "which cards are open" state. A card owns its own tab state. A form owns its input values. Never lift state to a parent that doesn't need it for rendering.

*Rule 2: Split contexts by domain and frequency.* Never put unrelated state in one context. A connection-status context (changes rarely) must be separate from a feed-data context (changes constantly). Otherwise every connection-status consumer re-renders on every feed update.

*Rule 3: Never derive state in `useEffect`.* If a value can be computed from props or other state, compute it during render (or use `useMemo`). Don't set it in an effect — that triggers a double render.

```
// WRONG — extra render from effect
const [filtered, setFiltered] = useState([]);
useEffect(() => {
  setFiltered(items.filter(i => i.active));
}, [items]);

// RIGHT — derive during render
const filtered = items.filter(i => i.active);
```

*Rule 4: Never define components inside components.* The inner component is recreated every render, destroying all its internal state and DOM:

```
// WRONG — CardContent is a new component type every render
function Card() {
  const CardContent = () => <div>...</div>;
  return <CardContent />;
}

// RIGHT — defined outside
const CardContent = () => <div>...</div>;
function Card() {
  return <CardContent />;
}
```

*Rule 5: Never create objects/arrays/functions inline in JSX props* (unless the React Compiler handles it — and it doesn't always, especially with third-party libraries):

```
// RISKY — new object every render
<Child style={{ color: 'red' }} />

// SAFE — stable reference
const style = { color: 'red' };  // module-level constant
<Child style={style} />
```

#### React Compiler v1.0 — What It Helps and What It Doesn't

React Compiler (shipped October 2025) automatically memoizes components and hooks at build time. This means:

**We can stop writing** `useMemo`, `useCallback`, and `memo` in most cases. The compiler inserts memoization at the correct granularity automatically. At Meta, this yielded up to 12% improvement on initial loads and >2.5x faster specific interactions.

**The compiler does NOT solve:**
- State placement problems (state too high in the tree still causes cascades)
- Context value instability (new object every render still re-renders all consumers)
- External store integration (third-party libraries may still need manual memoization)
- Side effects during render (the compiler bails out entirely on Rules-of-React violations)
- The appearance zone problem (CSS-driven state is always better than React state for visual changes, regardless of memoization)

The compiler is a safety net, not a substitute for the three-zone model. It makes the structure zone cheaper but doesn't eliminate the need to keep appearance out of React and data state local.

#### Architectural Precedent: Excalidraw

Excalidraw is the closest open-source precedent to tugdeck's architecture — a desktop-like React app with imperative rendering alongside React UI chrome:

- **React** renders the toolbar, dialogs, panels, context menus, and property inspector
- **Imperative canvas** (`<canvas>` element) handles all drawing, selection handles, collaborative cursors, and snap lines at 60fps via `requestAnimationFrame`
- **Scene class** is the single source of truth for canvas elements — a plain mutable object, not React state
- **Jotai atoms** manage UI-level state (dialog open/closed, sidebar visibility) independently from the canvas state
- **Action system** mediates user input → element mutations — actions are "entry points" for interactions, dispatched imperatively

The parallel to tugdeck: React renders card content and chrome. The deck-manager (imperative) handles card positioning and layout. The responder chain (imperative) handles focus and action dispatch. Feed data lives in an external store. Theme lives in CSS. React only re-renders when *content* changes — never for appearance, focus, layout, or theme.

#### Diagnostic Tools

When something re-renders that shouldn't:
1. **React DevTools Profiler** — enable "Highlight updates when components render" to visually see cascade re-renders
2. **`why-did-you-render` library** — patches React to log unnecessary re-renders with specific reasons
3. **React Compiler ESLint rule `react-hooks/todo`** — surfaces files where the compiler bailed out (silently skipping optimization)

#### Summary: The Complete Machinery

| Zone | Mechanism | Hooks/Tools | Re-renders |
|------|-----------|-------------|------------|
| **Appearance** | CSS custom properties, CSS classes, DOM style | `useCSSVar`, `useDOMClass`, `useDOMStyle`, `requestAnimationFrame` + refs | **Never** |
| **Local data** | External mutable store + selective subscriptions | `useSyncExternalStore` (raw or with selector), or Jotai atoms if complexity grows | **Only the subscribing component** |
| **Structure** | React state at the right ancestor level | `useState`, `useReducer`, split contexts | **The affected subtree** |

The DOM utility hooks (`useCSSVar`, `useDOMClass`, `useDOMStyle`) are our answer to "do we need a CSS-targeted API to help with mutations?" — yes, a small, lightweight set of hooks that make appearance-zone changes ergonomic and explicit. They don't do anything complex; they just make the right thing easy and the wrong thing (using `useState` for appearance) unnecessary.

#### Lessons from Excalidraw (Architectural Study)

Excalidraw (MIT licensed, github.com/excalidraw/excalidraw) is the closest open-source precedent to what we're building. It's a desktop-like React app with imperative rendering, an action system, and multiple interactive surfaces. A deep architectural study of the codebase reveals patterns to adopt, patterns to learn from, and gotchas to avoid.

**Patterns to adopt:**

1. **The action system is the best part of their architecture.** Every user operation — keyboard shortcut, toolbar button, context menu item, command palette entry — is a registered `Action` with a `perform` function, a `keyTest` for keyboard matching, a `predicate` for enable/disable, and an optional `PanelComponent` for property UI. This unifies all input paths into a single abstraction. Our responder chain action vocabulary (concept 4) maps directly to this: `perform` → our action handlers, `keyTest` → our keybinding map, `predicate` → our `canHandle`/`validateAction`.

2. **CSS variables for theming, not React context.** Confirmed — they use `--icon-fill-color`, `--color-selection`, `--color-surface-lowest`, etc. Theme switches are nearly free in performance terms. Same as our concept 1 approach.

3. **AppState subset types as render firewalls.** They define narrow type projections (`StaticCanvasAppState` with ~5 fields, `InteractiveCanvasAppState`, `UIAppState`) so that components receive only the state they need. A change to `openDialog` does not invalidate the static canvas. This is the manual version of selective subscriptions — and it works. For tugdeck, `useSyncExternalStore` with selectors gives us this automatically, but the *principle* is the same: never pass more state than a component needs.

4. **Separate contexts by domain (8 contexts, not 1).** They provide `useApp()`, `useAppProps()`, `useExcalidrawElements()`, `useExcalidrawAppState()`, `useExcalidrawSetAppState()`, `useExcalidrawActionManager()`, `useExcalidrawContainer()`, `useEditorInterface()` — each returning a narrow slice. Components subscribe only to what they use.

5. **Imperative for high-frequency, React for structure.** Their dual-canvas approach separates interactive feedback (selection handles, snap lines — redrawn every frame via `requestAnimationFrame`) from content rendering (scene elements — throttled to ~60fps). During drag, they call `this.setState()` directly and sometimes use `flushSync()` for low-latency. Our parallel: deck-manager handles card positioning imperatively; React handles card content.

**Patterns to learn from (but adapt):**

1. **The giant class component (395KB App.tsx) is intentional.** It centralizes all state coordination, gives direct `this` access for imperative state, and avoids distributed-state bugs. But it's an acknowledged lock-in. We should use functional components with our responder chain as the coordination mechanism instead — the chain provides the same centralized coordination without a god component.

2. **Scene class as mutable source of truth.** Their `Scene` class holds all drawable elements in a plain mutable object, not React state. It notifies subscribers via a `sceneNonce` (random integer regenerated on every mutation). Components check `sceneNonce` in their memo comparisons. For tugdeck, `useSyncExternalStore` gives us this subscription pattern automatically — the store mutates freely, components subscribe to slices.

3. **In-place element mutation for hot paths.** During drag/draw, they call `mutateElement()` which mutates the element object directly (preserving reference stability, incrementing version). For history/undo, they use `newElementWith()` which returns an immutable copy. The lesson: sometimes you need both mutable and immutable patterns for the same data, depending on the context.

**Gotchas we must avoid:**

1. **Focus management between imperative and React surfaces is fragile.** Their text editing system uses a deferred blur strategy, `setTimeout(0)` for DOM synchronization, and a dedicated `useTextEditorFocus` hook — all because browsers don't have good primitives for "this textarea belongs to that canvas." Every new panel or popover that appears during text editing must integrate with this system. We will face similar issues when text inputs inside cards need to coexist with the responder chain's keyboard handling. Plan for this from the start.

2. **State subset types require discipline.** Every new AppState field requires deciding which subset it belongs to. Put it in too many subsets → unnecessary re-renders. Miss it from a needed subset → stale renders. For tugdeck, our three-zone model provides the first-level classification (appearance/local/structure), but within the local and structure zones, we need similar discipline about what data flows where.

3. **Soft-delete, don't remove.** Excalidraw never removes elements from arrays — deletion sets `isDeleted: true`. This simplifies undo/redo and prevents array index invalidation during iteration. We should consider similar patterns for card state and feed data.

4. **Don't underutilize your atomic state library.** Excalidraw's Jotai integration is minimal (two tiny files). Most state lives in the class component's `this.state`. They acknowledged this should expand. We should be intentional from the start about what goes in external stores vs. React state, rather than defaulting everything to React and migrating later.

### 6. Tugcard: The Common Base Component

**The problem.** Each card is a standalone React component that implements `TugCard` via `ReactCardAdapter`. There is no shared behavior beyond what `CardContext` provides. Every card independently handles its own layout, loading state, error state, feed data decoding, and metadata management.

**What tugcard should provide:**
- Standard card chrome (title bar, menu, close/minimize controls)
- Min-size calculation API — returns the minimum dimensions needed for content to remain visible
- Accessory view slots (e.g., find-in-text bar that any text-bearing card can use)
- Loading/skeleton state for moments before data is available
- Error state handling
- Theme-responsive behavior (reacts to theme changes without re-rendering via the mechanism from concept 5)
- Responder chain integration (concept 4) — the card is a responder that manages its child responders
- Feed subscription and data decoding (standardized, not per-card ad-hoc)

**Questions to resolve:**
- Is tugcard a React component that other cards extend (inheritance)? A wrapper that other cards compose into (composition)? A set of hooks and utilities? React idiom strongly favors composition.
- How does min-size work? Does tugcard measure its content? Does each card declare its min-size? Is it dynamic (changes with content) or static (fixed per card type)?
- What accessory views do we need? Find-in-text is the first case. What others? A status bar? An input area?
- How does tugcard relate to the existing `card-frame.tsx` and `card-header.tsx` chrome components?

### 7. Feed Abstraction

**The problem.** Each card receives raw `Uint8Array` data via `useFeed()` and decodes it independently. There is no shared model for how feed data is structured, decoded, buffered, or refreshed.

**Current reality (per card):**
- Terminal card: passes raw bytes to xterm.js
- Git card: decodes binary to text, parses as structured data
- Files card: same pattern, different structure
- Stats card: subscribes to four different feeds, decodes each differently
- Conversation card: complex message protocol with streaming

**Questions to resolve:**
- Is a uniform TugFeed abstraction even desirable? The feeds are genuinely different (raw terminal bytes vs. structured JSON vs. streaming messages).
- If yes, what does TugFeed provide? Common decode/encode? Buffering? Refresh logic? Connection state?
- How does TugFeed relate to the task-feed (multiplexed skill/agent output)? Is the task-feed just another feed type, or does it have fundamentally different characteristics?
- See the `tug-feed.md` roadmap for the hooks-based semantic feed proposal. How does that architectural layer connect to the per-card feed rendering layer?

### 8. Skeleton and Loading States

**The problem.** When a card first appears or loses its data connection, there's no standard way to show a "loading" or "empty" state. Some cards show nothing; some show stale data.

**What we need:**
- A skeleton component that visually indicates "content is loading" — pulsing placeholder shapes that match the expected content layout
- Per-card skeleton definitions (a terminal skeleton looks different from a git status skeleton)
- Transition from skeleton → content that is smooth, not jarring
- Error states: "failed to load", "disconnected", "no data yet"

### 9. Alert and Dialog System

**The problem.** We need three levels of modal interaction:
- **App-modal:** blocks the entire application (e.g., critical error, unsaved changes confirmation)
- **Card-modal:** blocks a single card (e.g., "are you sure you want to close this card?")
- **Modeless informational:** non-blocking notification (e.g., "build succeeded", "agent completed step 3")

**Questions to resolve:**
- How do modals interact with the responder chain? App-modal should intercept the chain at the top. Card-modal should intercept within the card's subtree.
- How do modals interact with focus management? Opening a modal should trap focus; closing should restore it.
- What is the API? `showAppModal(content)`, `card.showModal(content)`, `showNotification(content)`?
- Does the close-confirmation for cards (feature list item) use the card-modal system, or is it simpler (a dropdown attached to the close button)?

### 10. Card Title Bar Enhancements

**The problem.** Several feature list items target the card title bar:
- Add minimize/window-shade control (up/down chevron)
- Add confirmation dropdown to close button
- Rotate hamburger menu icon 90 degrees

**Questions to resolve:**
- What does minimize/window-shade mean exactly? Collapse to title bar only (showing just the header)? Collapse to an icon in the dock? Collapse to a small floating chip?
- How does minimized state persist? In the card's state? In the layout engine?
- What triggers the close confirmation? Always? Only for cards with unsaved state? Only for closable cards?

### 11. Dock Redesign

**The problem.** The dock needs command buttons (not just card-toggle buttons) and popout menu buttons.

**Questions to resolve:**
- What commands belong in the dock? Reset layout, restart server, and reload frontend are currently in a settings dropdown. Should they move to dedicated buttons?
- What are "popout menu buttons"? Buttons that open a floating menu anchored to the dock?
- How does the dock interact with the responder chain? Is the dock a responder?
- Should the dock be customizable (user can add/remove/reorder buttons)?

### 12. Keybindings View

**The problem.** Currently the only keyboard shortcut is `Control+\`` for panel cycling. We need a view to display and configure keybindings.

**Questions to resolve:**
- Is this a card (like settings) or a modal dialog?
- Can users customize keybindings, or is this display-only?
- How do keybindings interact with the responder chain? The responder chain should be the mechanism that routes keyboard events to the correct handler.
- What keybindings do we need beyond panel cycling? Card-specific shortcuts? Global shortcuts? Command palette?

### 13. Brio Theme Revision

**The problem.** Brio's current palette is deep graphite. The request is to shift it to dark greenish.

**Depends on:** Theme architecture (concept 1). If themes become loadable resources, this is just a new theme file. If themes remain in CSS, it's a token value change.

---

## Dependency Map

```
                    ┌──────────────────────┐
                    │  1. Theme Architecture│
                    │  (loadable resources) │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │  2. Tugways Design   │
                    │  System Definition   │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
   ┌──────────▼──────┐  ┌─────▼──────┐  ┌──────▼──────────┐
   │ 4. Responder    │  │ 5. Mutation │  │ 3. TugButton    │
   │    Chain        │  │    Model    │  │    (test case)  │
   └──────────┬──────┘  └─────┬──────┘  └─────────────────┘
              │               │
              └───────┬───────┘
                      │
           ┌──────────▼───────────┐
           │  6. Tugcard Base     │
           │  Component           │
           └──────────┬───────────┘
                      │
        ┌─────────────┼─────────────┬─────────────┐
        │             │             │             │
   ┌────▼────┐  ┌─────▼─────┐  ┌───▼───┐  ┌─────▼─────┐
   │ 7. Feed │  │ 8. Skele- │  │ 9. Di-│  │10. Title  │
   │ Abstrac.│  │    tons   │  │ alogs │  │    Bar    │
   └─────────┘  └───────────┘  └───────┘  └───────────┘

   ┌─────────┐  ┌───────────┐  ┌─────────────┐
   │11. Dock │  │12. Key-   │  │13. Brio     │
   │ Redesign│  │  bindings │  │  Revision   │
   └─────────┘  └───────────┘  └─────────────┘
```

Concepts 11-13 can proceed somewhat independently once the core stack (1-6) is designed.

---

## Discussion Log

*This section will capture key decisions, alternatives considered, and rationale as we work through the concept areas above.*

### Entry 1: Project Kickoff (2026-03-01)

Opened with the full feature list above. Identified 13 concept areas that need design work before implementation. The core architectural challenge is the responder chain + mutation model (concepts 4-5), which determines how everything else gets wired together. The theme architecture (concept 1) is the stated starting point, but it pulls in the component system (concepts 2-3) and the card abstraction (concept 6) because theme changes must flow through all of those layers.

### Entry 2: Theme Architecture — Initial Design (2026-03-01)

Worked through all six original questions for concept 1. Initially proposed JSON as the theme format with direct property injection via `style.setProperty()`. Identified three open items: complex CSS tokens (shadows, gradients) that don't fit cleanly in flat JSON; per-theme semantic overrides (`--td-header-active`, `--td-canvas`); and the Harmony canvas color special case.

### Entry 3: Theme Architecture — Format Revised to CSS (2026-03-01)

The three open items from entry 2 exposed a flaw in the JSON recommendation. Complex CSS values (multi-part shadows, gradients) are native CSS — putting them in JSON means round-tripping CSS through JSON for no benefit. Revised to **CSS as the theme format**: a theme file is a CSS file with `body { --tways-*: ... }` declarations plus a structured comment header for metadata.

Additional decisions in this revision:

- **Prefix rename: `--tl-` → `--tways-`.** The old "tuglook" prefix is renamed to avoid any potential conflict with Tailwind's `--tw-` prefix. Four letters is fine — clarity beats brevity.
- **CSS format resolves the complex token problem.** Shadows, gradients, and any other complex CSS values work natively. No escaping, no special cases.
- **Optional palette entries resolve the semantic override problem.** Tokens like `canvas`, `header-active`, `header-inactive` become optional `--tways-*` entries. The semantic tier derives them from other palette values by default using `var()` with fallback (e.g., `--td-canvas: var(--tways-canvas, var(--tways-bg))`). Themes that want to diverge just specify the value; themes that don't, omit it.
- **Canvas color: no special mechanism.** Harmony just specifies `--tways-canvas` in its theme file. The semantic tier uses it if present, falls back to `--tways-bg` if not. Same pattern for all optional overrides.
- **Stylesheet injection replaces both body classes and property injection.** Load theme CSS, inject as `<style>` element. Remove it to revert to Brio. Simpler than iterating keys.

Next: move to concept 2 (Tugways design system definition).

### Entry 4: Tugways Design System Designed (2026-03-01)

Worked through all four questions for concept 2. Key decisions:

- **Tug wrappers are substantial.** Not cosmetic — they encapsulate subtypes (push, icon, icon+text, three-state for buttons), additional states (disabled, loading, active), semantic color mapping, theme-awareness, and responder chain integration.
- **Strong opinions.** shadcn's variant set is a starting point. Tugways components define their own variants that cover the actual needs of the app.
- **Three component kinds:** wrappers (shadcn + opinions), compositions (multiple shadcn → higher-level), and originals (no shadcn equivalent).
- **File organization:** `components/tugways/` is the public API; `components/ui/` is private implementation. App code never imports from `ui/` directly.
- **Don't reinvent — customize.** shadcn provides accessible primitives and Radix behavior; tugways adds opinions, subtypes, and conventions on top.

Open items resolved in follow-up: priority list of 15 components after TugButton; single-component-with-subtype-prop as default naming (break out on a case-by-case basis); the `tugways/` directory itself is the inventory — no manifest.

Next: concept 3 (TugButton test case).

### Entry 5: Responder Chain Drafted (2026-03-01)

Skipped concept 3 (TugButton) to design concept 4 (Responder Chain) first — TugButton's behavior depends on how the chain works. Researched Apple's NSResponder/UIResponder chain in depth. Key design decisions:

- **Chain structure:** focused tugways component → card content → TugCard → DeckCanvas → TugApp. Each level corresponds to a real architectural boundary.
- **Four-stage key processing pipeline** (adapted from Apple): global shortcuts (top-down, pre-chain) → keyboard navigation (system-level) → action dispatch via chain (bottom-up) → text input (first responder only). Stages have clear priority ordering.
- **First responder = focused card.** One at a time. Key events and nil-targeted actions start from the focused card's deepest registered responder.
- **Modal boundaries constrain the chain.** App-modal confines to dialog chain. Card-modal confines within card. No per-component modal logic.
- **Action validation** — chain is queried lazily ("can anyone handle `find`?") to enable/disable dock buttons and menu items.
- **Operates outside React state.** The chain is an imperative system: stable manager object provided via context (reference never changes, no re-renders), components register via `useResponder` hook using refs, action dispatch is function calls. This is the key to avoiding React state cascades.

Open questions resolved in follow-up: `useResponder` finds parent via nested context; mouse events excluded (hit-testing only, per Apple's model); the responder chain IS the focus model (deck-manager informs it, doesn't compete with it); action vocabulary designed from Apple's standard actions, filtered to tugdeck needs (~25 standard actions across 8 categories, plus extensibility for card-specific actions).

Remaining open items resolved: keybinding map deferred to concept 12 (chain only knows actions, not keys); action validation adopts Apple's two-level model (`canHandle` for capability, `validateAction` for enabled state) — decades of battle-tested usage.

Concept 4 is fully designed. No open items.

### Entry 7: Concept 5 Deepened — Specific Machinery (2026-03-01)

Requested more specifics on the exact mechanisms for the three-zone model. Researched `useSyncExternalStore` gotchas, CSS custom property patterns, refs best practices, signals landscape, React Compiler v1.0, common anti-patterns, and real-world precedents (Excalidraw, Dockview, Figma).

Key additions to concept 5:

- **DOM utility hooks** (`useCSSVar`, `useDOMClass`, `useDOMStyle`): a small set of hooks that make appearance-zone mutations ergonomic. These are the sanctioned way to change how something looks without React state. For high-frequency updates (drag, resize), bypass even these — use `requestAnimationFrame` + refs directly, sync to React state only on gesture completion.
- **`useSyncExternalStore` gotchas codified**: snapshot reference instability (must return same reference if data unchanged), subscribe function identity (must be stable, defined outside component), and selective subscription (use `useSyncExternalStoreWithSelector` or per-feed listener sets).
- **Store decision: start raw, adopt library if needed.** Raw `useSyncExternalStore` is sufficient for feed data. Jotai's atomic model is the fallback if complexity grows.
- **Five structure-zone rules codified**: state at lowest common ancestor; split contexts by domain; never derive state in effects; never define components inside components; avoid inline object creation in JSX props.
- **React Compiler v1.0**: removes need for manual `useMemo`/`useCallback`/`memo`, but doesn't solve state placement, context instability, or the appearance-zone problem. Safety net, not substitute.
- **Excalidraw as architectural precedent**: React for UI chrome, imperative canvas for rendering, Scene class as mutable source of truth, Jotai for UI state, action system for user input mediation. Directly parallel to tugdeck's architecture.

### Entry 8: Excalidraw Deep Study (2026-03-01)

Conducted a thorough architectural study of Excalidraw (MIT, open source). Key findings for tugdeck:

**Adopt:** Their action system (unifies keyboard, toolbar, context menu, command palette into one `Action` interface with `perform`/`keyTest`/`predicate` — maps directly to our responder chain actions). CSS variables for theming. AppState subset types as render firewalls. 8 separate contexts instead of 1. Imperative for high-frequency, React for structure.

**Adapt:** The giant 395KB class component centralizes state but is a lock-in — we use functional components with the responder chain for coordination instead. Scene class as mutable source of truth — we use `useSyncExternalStore` for the same subscription pattern. In-place mutation for hot paths + immutable copies for history.

**Avoid:** Focus management between imperative and React surfaces is fragile (deferred blur hacks, `setTimeout(0)`). State subset discipline is essential — every field must go in the right subset. Don't underutilize your external store library — be intentional from the start about what goes where.

The action system is the pattern most directly applicable to our responder chain design. Excalidraw's `perform`/`keyTest`/`predicate`/`PanelComponent` maps to our `actions`/keybinding map/`canHandle`+`validateAction`/tugways component.

### Entry 6: Controlled Mutation vs. React State Designed (2026-03-01)

The fear: we're fighting an opinionated framework. The realization: we're not fighting it — we're scoping it. React is good at rendering UI from data. The DOM and CSS are good at visual state. The mistake is putting visual state in React state.

The design distills to a **three-zone model**:

1. **Appearance zone** (theme, focus, animations, layout, scroll) — CSS variables, CSS classes, DOM style manipulation. **Zero re-renders.** This is the biggest win: the entire category of changes that causes cascade re-renders in typical React apps never touches React at all.
2. **Local data zone** (feed data, form values, component-internal state) — React state local to the component that displays it, or `useSyncExternalStore` for external data with selective subscriptions. **Targeted re-renders** — only the affected component.
3. **Structure zone** (show/hide sections, mount/unmount cards, open/close modals) — React state at the appropriate ancestor level. **Subtree re-renders** — this is what React is designed for.

The three-zone model makes the answer to "should I use React state?" mechanical, not a judgment call. Each change maps to exactly one zone based on what it affects. The existing systems (theme/concept 1, responder chain/concept 4, deck-manager layout engine) are all already in the appearance zone — operating outside React state by design.

`useSyncExternalStore` is the key React-sanctioned pattern for the local data zone: external mutable stores with selective subscriptions. Feed data, responder chain validation, connection status — all fit this pattern. Each consumer subscribes to its slice. Only affected components re-render.

No open items.
