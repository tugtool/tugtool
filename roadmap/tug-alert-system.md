# Tug Alert System — Consolidated Proposal

*Five modality tiers for interruption, confirmation, notification, and system state. Modeled on AppKit (NSAlert, beginSheet, NSPopover, Notification Center) but adapted for tug's card-based deck architecture.*

*Cross-references: `[L##]` → [laws-of-tug.md](../tuglaws/laws-of-tug.md). `[D##]` → [design-decisions.md](../tuglaws/design-decisions.md).*

---

## Overview

Tug needs five tiers of user interruption, each with distinct modality and scope:

| Tier | Component | Modality | Scope | Wraps | Analogy |
|------|-----------|----------|-------|-------|---------|
| 0 | **tug-banner** | App-modal (state) | Entire app | Original | System state barrier |
| 1 | **tug-alert** | App-modal (action) | Entire app | Radix AlertDialog | NSAlert |
| 2 | **tug-sheet** | Card-modal | Single card | Radix Dialog (non-modal) | beginSheet |
| 3 | **tug-dialog** | Card-spawned | Deck | Card registry | NSPanel / utility window |
| 4 | **tug-bulletin** | Modeless | Global viewport | Sonner | Notification Center |

Already built (Group B): **tug-confirm-popover** — button-local, non-modal, anchored to trigger. Handles the lightest confirmation case. The five tiers above handle everything heavier.

Note the two flavors of app-modal: **tug-banner** is state-driven (appears/disappears when a system condition changes, no user action can dismiss it) while **tug-alert** is action-driven (appears because something asked a question, user must respond).

### Blocked, Not Disabled — The Scrim Model

TugBox cascades `disabled` to all contained controls. Disabled means the controls themselves are unavailable — they gray out, reduce opacity, change cursor. That's the right treatment when controls are turned off.

Modal blocking is different. Controls behind a modal aren't turned off — they're **unreachable because something is in front of them**. A checkbox behind a sheet is still checked, still colored, still looks exactly like itself. The user just can't reach it right now. When the modal closes, nothing about the controls changes — they were never in a different state.

The correct visual treatment is a **dimming scrim**: a semi-transparent overlay that sits between the user and the blocked content. The content behind dims but every control looks perfectly normal underneath. This is what macOS does with sheets.

**Two layers, two jobs:**
- **Visual layer (scrim):** Dims content behind the modal. Communicates "you can't reach this." Appearance-zone only [L06].
- **Interaction layer (`inert`):** The HTML `inert` attribute on the blocked container prevents focus, pointer events, and assistive tech from reaching the content. Native browser behavior — no React context needed.

The modality model:

- **App-modal (tug-banner, tug-alert):** Full-viewport scrim. Banner manages `inert` on the deck canvas container itself. Alert gets this for free from Radix AlertDialog (sets `aria-hidden` on sibling subtrees). Both render as siblings *outside* the inert container — never as children of it.
- **Card-modal (tug-sheet):** Card-scoped scrim over `.tugcard-body` + `inert` attribute on the same element. Only that card's content is dimmed and blocked; other cards remain fully interactive and visually normal.
- **Card-spawned (tug-dialog):** No scrim, no inertness. The dialog is a peer card in the deck — it participates naturally in focus/z-order.
- **Modeless (tug-bulletin):** No scrim, no inertness. Notifications live in a fixed viewport outside the card system entirely.

---

## Component 0: tug-banner

*App-modal state barrier. Appears when a system condition prevents work; disappears when the condition resolves. No user action can dismiss it.*

### Concept

Two existing cases in Tug.app today:

1. **Disconnected banner** (`disconnect-banner.tsx`) — WebSocket connection lost. Currently a hand-built `position: fixed` div with inline styles and hardcoded fallback colors. Uses `useState` to subscribe to connection state.
2. **Error boundary** (`error-boundary.tsx`) — React render error. Currently a class component with full-screen error display, hardcoded colors, monospace stack trace, no reload mechanism.

Both share the same pattern: a system condition makes the app non-functional, a prominent visual indicator appears, and interaction is blocked until the condition resolves. Neither requires a user response — they come and go on their own.

TugBanner replaces both with a proper tugways component: token-driven colors, `@tug-pairings`, `data-slot`, scrim + `inert` for modality, and CSS keyframe animations for enter/exit.

### How It Differs from tug-alert

| | tug-banner | tug-alert |
|---|-----------|-----------|
| **Trigger** | System state (reactive) | Code request (imperative) |
| **Dismissal** | Condition resolves | User responds |
| **User action** | None — wait for recovery | Confirm or cancel |
| **Promise API** | No | Yes |
| **Content** | Status message or rich error content | Title + message + buttons |

### Variants

| Variant | Content | Use Case |
|---------|---------|----------|
| `"status"` | Icon + message string. Compact horizontal strip. | Connection lost, syncing, maintenance mode |
| `"error"` | Rich content via `children` prop. Stack traces, reload button, details. Full-height. | React render errors, fatal exceptions |

The `"status"` variant is the default — a single-line horizontal banner. The `"error"` variant accepts arbitrary `children` for rich diagnostic content, including composed TugButton for reload actions [L20].

### API Design

```tsx
// Status variant (default) — compact strip
<TugBanner
  visible={!isConnected}
  tone="caution"
  message="Connection lost — reconnecting..."
  icon="wifi-off"
/>

// Error variant — rich content with children
<TugBanner
  visible={hasError}
  variant="error"
  tone="danger"
  message="Render Error"
>
  <pre>{error.message}</pre>
  <pre>{error.stack}</pre>
  <TugPushButton role="action" onClick={handleReload}>Reload</TugPushButton>
</TugBanner>
```

No imperative API. Banner visibility is driven by reactive state (connection status, error boundaries). The component renders when `visible` is true and animates out when false.

### Props

| Prop | Type | Description |
|------|------|-------------|
| `visible` | `boolean` | Whether the banner is shown. @selector `[data-visible]` |
| `variant` | `"status" \| "error"` | Banner layout variant. Default: `"status"` |
| `tone` | `"danger" \| "caution" \| "default"` | Visual severity. Default: `"danger"`. @selector `[data-tone]` |
| `message` | `string` | Banner heading/message text |
| `icon` | `string` | Optional Lucide icon name (status variant) |
| `children` | `ReactNode` | Rich content (error variant) |

### Presence Pattern

The banner stays mounted in the DOM at all times so exit animations can play. Visibility is controlled by a `data-visible` attribute, not conditional rendering:

- `data-visible="true"` → CSS keyframe enter animation, scrim fades in
- `data-visible="false"` → CSS keyframe exit animation, scrim fades out
- After exit animation completes, `inert` is removed from the deck canvas

This avoids the unmount-before-animation problem. The banner is always in the DOM; CSS controls whether it's visible. Appearance-zone only [L06].

### Visual Design

- **Status variant:** Full-width horizontal strip at top of viewport. High contrast, tone-colored. Icon + message centered.
- **Error variant:** Full-viewport panel. Error title at top, scrollable content area for stack traces, action buttons at bottom.
- Full-viewport scrim beneath both variants dims the entire deck.
- Slide down from top on appear, slide up on dismiss (status). Fade in/out (error).
- `inert` on the deck canvas while visible — nothing behind the scrim is interactive.
- No close button, no dismiss gesture — the banner leaves when the condition resolves.

### Modality Mechanism

- Banner + scrim render as siblings of the deck canvas, not children of it
- Scrim overlay covers the entire viewport beneath the banner
- `inert` attribute set on the deck canvas container element
- Banner + scrim render above all z-index layers (above cards, above popovers, above menus)
- When `visible` transitions to false: CSS exit animation plays, then `inert` removed from deck canvas

### Token Sovereignty [L20]

TugBanner owns:
- `--tugx-banner-bg`, `--tugx-banner-fg`, `--tugx-banner-border` — banner strip/panel
- `--tugx-banner-overlay-bg` — full-viewport scrim
- Tone variants: `--tugx-banner-danger-bg`, `--tugx-banner-caution-bg`, etc.

Error variant composes TugPushButton for reload actions — TugButton keeps its own tokens [L20].

### Law Citations

```
Laws: [L06] appearance via CSS, [L16] pairings declared, [L19] component authoring guide,
      [L20] token sovereignty (error variant composes TugButton)
```

[L15] does not apply — the banner strip itself is not an interactive control.

### Files

```
tug-banner.tsx   — component (declarative, always-mounted presence pattern)
tug-banner.css   — banner strip, error panel, scrim overlay, tone variants, enter/exit animations
```

---

## Component 1: tug-alert

*App-modal dialog for critical interruptions that require explicit user response.*

### Radix Primitive

`@radix-ui/react-alert-dialog` — purpose-built for this. Key properties:
- **Always modal** — no `modal` prop; cannot be dismissed by clicking outside
- **Focus trapped** inside Content automatically
- **Cancel + Action** buttons (not a generic Close) — forces explicit user choice
- **`aria-labelledby` / `aria-describedby`** wired automatically from Title/Description
- **Escape** closes (maps to Cancel)

### API Design

```tsx
// Imperative (primary API — mirrors tug-confirm-popover)
const alertRef = useRef<TugAlertHandle>(null);
const result = await alertRef.current.alert({
  title: "Delete Card",
  message: "This action cannot be undone.",
  confirmLabel: "Delete",
  confirmRole: "danger",
});
// result: true (confirmed) | false (cancelled)

// Declarative (for static/controlled use)
<TugAlert
  open={open}
  onOpenChange={setOpen}
  title="Delete Card"
  message="This action cannot be undone."
  confirmLabel="Delete"
  confirmRole="danger"
  onConfirm={handleConfirm}
  onCancel={handleCancel}
/>
```

### Props

| Prop | Type | Description |
|------|------|-------------|
| `title` | `string` | Alert title (required) |
| `message` | `string \| ReactNode` | Body content |
| `confirmLabel` | `string` | Confirm button text (default: "OK") |
| `cancelLabel` | `string` | Cancel button text (default: "Cancel"). Pass `null` to hide. |
| `confirmRole` | `TugButtonRole` | Semantic role for confirm button (default: "action") |
| `open` | `boolean` | Controlled open state. @selector `[data-state]` |
| `onOpenChange` | `(open: boolean) => void` | Open state callback |
| `onConfirm` | `() => void` | Confirm callback |
| `onCancel` | `() => void` | Cancel callback |

### Imperative Handle

```tsx
interface TugAlertHandle {
  alert(options?: {
    title?: string;
    message?: string | ReactNode;
    confirmLabel?: string;
    cancelLabel?: string | null;
    confirmRole?: TugButtonRole;
  }): Promise<boolean>;
}
```

Options passed to `alert()` override props for that invocation. The Promise resolves `true` for confirm, `false` for cancel/escape.

### Visual Design

- Full-viewport scrim overlay (semi-transparent, token-driven) — dimming, not disabling
- Centered dialog panel with constrained max-width
- Title + message + button row
- Confirm button rightmost (nearest to default pointer position)
- Enter activates confirm; Escape activates cancel
- CSS keyframe enter/exit animations on `[data-state]` [L14]

### Token Sovereignty [L20]

TugAlert owns:
- `--tugx-alert-overlay-bg` — scrim color
- `--tugx-alert-bg`, `--tugx-alert-fg`, `--tugx-alert-border`, `--tugx-alert-shadow` — panel chrome

Composed TugButton children keep their own tokens (emphasis × role). No descendant restyling.

### Law Citations

```
Laws: [L06] appearance via CSS, [L16] pairings declared, [L19] component authoring guide,
      [L20] token sovereignty (composes TugButton)
```

### Files

```
tug-alert.tsx   — component + imperative handle
tug-alert.css   — overlay, panel, layout, animations
```

---

## Component 2: tug-sheet

*Card-modal dialog scoped to a single card. Other cards remain fully interactive. Drops from the card title bar like a window shade.*

### Why Not Radix Dialog `modal={true}`?

Radix Dialog with `modal={true}` makes the **entire page** inert — every card, every toolbar, everything. That's app-modal, not card-modal. We need card-scoped modality.

### Architecture

Use Radix Dialog with `modal={false}` for its compound API, focus management utilities, and `data-state` animation support. Layer card-scoped inertness on top:

1. Sheet opens → set `inert` attribute on the card's `.tugcard-body` element
2. Scrim overlay fades in over the card content area
3. Sheet panel drops down from just below the card title bar
4. Focus moves into sheet content
5. Escape closes sheet → sheet slides up, scrim fades → remove `inert` → restore focus to trigger
6. Other cards remain fully interactive throughout

### Portal Scoping

Radix Dialog's Portal defaults to `document.body`. For card-modal, use the `container` prop to portal into the card element instead. This keeps the sheet visually and structurally scoped to its parent card.

```tsx
<Dialog.Portal container={cardRef.current}>
  <Dialog.Overlay className="tug-sheet-overlay" />
  <Dialog.Content className="tug-sheet-content">
    {children}
  </Dialog.Content>
</Dialog.Portal>
```

The sheet renders as a child of the card's root `[data-slot="tug-card"]` element, positioned absolutely to sit below the title bar and above the card body content.

### API Design

```tsx
// Compound API (primary — sheet content is arbitrary)
<TugSheet open={open} onOpenChange={setOpen}>
  <TugSheetTrigger asChild>
    <TugPushButton>Open Settings</TugPushButton>
  </TugSheetTrigger>
  <TugSheetContent title="Card Settings">
    {/* arbitrary content */}
  </TugSheetContent>
</TugSheet>

// Imperative (for programmatic open/close)
const sheetRef = useRef<TugSheetHandle>(null);
sheetRef.current.open();
sheetRef.current.close();
```

### Props — TugSheet (Root)

| Prop | Type | Description |
|------|------|-------------|
| `open` | `boolean` | Controlled open state |
| `onOpenChange` | `(open: boolean) => void` | Open state callback |
| `children` | `ReactNode` | Trigger + Content |

### Props — TugSheetContent

| Prop | Type | Description |
|------|------|-------------|
| `title` | `string` | Sheet title (renders in a header row) |
| `children` | `ReactNode` | Arbitrary content |

### Card-Modal Mechanics

**Inertness via `inert` attribute:**
- When sheet opens: `cardBodyEl.setAttribute("inert", "")`
- When sheet closes: `cardBodyEl.removeAttribute("inert")`
- The `inert` attribute disables all pointer events, focus, and assistive tech within the element — a native browser feature, no React context needed
- The card body is dimmed by the scrim but every control underneath looks normal — they're blocked, not disabled

**Finding the card body:**
- TugSheetContent uses `closest('[data-slot="tug-card"]')` to find its parent card
- Selects the `.tugcard-body` child element
- Sets/removes `inert` in `useLayoutEffect` synchronized with open state [L03]

**Responder chain:**
- When the sheet is open and the card body is inert, pointer/keyboard events within the card body are suppressed by the browser
- The sheet itself is NOT inert, so it receives events normally
- Actions dispatched from sheet content travel up the responder chain through the card's node as usual

### Visual Design — Window Shade

The sheet drops from the bottom edge of the card title bar like a window shade:

- **Position:** Absolutely positioned inside the card, top anchored to the bottom of the title bar (`top: var(--tug-chrome-height)`)
- **Animation:** `translateY(-100%)` → `translateY(0)` on open. No swoop, no spring — a clean linear drop. Reverse on close.
- **Width:** Full card width (no horizontal margins)
- **Height:** Sized to content, max-height constrained to the card content area
- **Scrim:** Covers the `.tugcard-body` area, fades in simultaneously with the sheet drop
- **Title bar:** The card's title bar remains fully visible and interactive above the sheet — the user always sees which card the sheet belongs to
- **Sheet header:** A header row inside the sheet with the sheet title and a close button
- CSS keyframe enter/exit animations [L14]

### Token Sovereignty [L20]

TugSheet owns:
- `--tugx-sheet-overlay-bg` — card-scoped scrim
- `--tugx-sheet-bg`, `--tugx-sheet-fg`, `--tugx-sheet-border`, `--tugx-sheet-shadow` — sheet panel
- `--tugx-sheet-header-bg`, `--tugx-sheet-header-fg` — sheet header row

Children (forms, controls) keep their own tokens.

### Law Citations

```
Laws: [L06] appearance via CSS, [L16] pairings declared, [L19] component authoring guide,
      [L20] token sovereignty (composes child controls)
```

### Files

```
tug-sheet.tsx   — compound components (Root/Trigger/Content) + imperative handle
tug-sheet.css   — overlay, panel, window-shade animation, header
```

---

## Component 3: tug-dialog

*A dialog that IS a card. Leverages the entire deck infrastructure.*

Instead of building a parallel overlay system, **tug-dialog spawns a card**. A traditional dialog overlay duplicates what the deck already provides: positioning, z-order, focus management, title bars, close buttons, drag handles. The deck already does all of this.

### How It Works

1. Caller requests a dialog via imperative API
2. DeckManager creates a new card with dialog-specific registration
3. The card renders with a customized title bar (no tabs, centered on the deck, closable)
4. Card appears centered on the deck
5. User interacts with it like any card — drag, resize, focus, close
6. Closing the dialog card resolves the caller's Promise

### API Design

```tsx
// Imperative (primary API)
const result = await tugDialog({
  componentId: "settings-dialog",
  title: "Application Settings",
  width: 480,
  height: 360,
});
// result: whatever the dialog content resolves with, or undefined if closed

// Or via hook
const openDialog = useTugDialog();
const result = await openDialog({
  componentId: "settings-dialog",
  title: "Application Settings",
});
```

### Card Registration

Dialog content is registered in the card registry like any other card:

```tsx
registerCard({
  componentId: "settings-dialog",
  contentFactory: (cardId) => <SettingsContent cardId={cardId} />,
  defaultMeta: { title: "Application Settings", icon: "settings", closable: true },
  family: "dialog",  // distinct family for dialog cards
});
```

The `"dialog"` family allows the deck to treat dialog cards differently:
- **Centered initial position** — not cascade-offset like normal cards
- **No tab drops** — dialog cards are single-purpose, not tab targets
- **No persist-on-reload** — dialog state is ephemeral

### Why Card-Based?

| Concern | Traditional Dialog | Dialog-as-Card |
|---------|-------------------|----------------|
| Positioning | Custom centering logic | DeckManager — centered on deck |
| Z-order | Manual z-index management | Array position (existing) |
| Focus | Manual focus trap | Card focus system |
| Drag | Not draggable (usually) | Free — CardFrame handles it |
| Title bar | Build another one | Tugcard title bar |
| Resize | Build resize handles | CardFrame resize handles |
| Responder chain | Wire up manually | Card responder node |
| Close | Build close logic | Card close flow |

Everything needed already exists. The only new code is the imperative spawning API and the Promise resolution on close.

### What's New

- `useTugDialog()` hook — calls `deckManager.addCard()` with dialog-specific options, returns a Promise
- Dialog family positioning — `DeckManager.addCard()` centers dialog-family cards on the deck viewport
- Promise resolution — dialog content calls a resolve callback (provided via React context) when done; card close resolves with `undefined`

### Files

No new component files. This is infrastructure:
```
use-tug-dialog.ts   — hook for spawning dialog cards + TugDialogResolveContext
```

Dialog content is authored as regular card content components — they just happen to be registered with `family: "dialog"`.

---

## Component 4: tug-bulletin

*Non-blocking notification. Fire-and-forget. The tug name for what others call "toast."*

### Library Choice: Sonner

Radix Toast has a complex, verbose API (Provider → Viewport → Root → Title → Description → Action → Close) requiring each toast to be manually composed in JSX. **Sonner** — a headless toast library by Emil Kowalski — provides a dramatically simpler API:

```tsx
// Sonner: one function call
import { toast } from "sonner";
toast("Card saved successfully");
toast.error("Connection lost");

// vs Radix Toast: mount a provider, viewport, and manually compose each toast
```

Sonner provides: auto-dismiss, stacking, swipe-to-dismiss, pause-on-hover, `aria-live` regions, and a headless mode for full styling control.

### API Design

```tsx
import { bulletin } from "@/components/tugways/tug-bulletin";

// Simple
bulletin("Card saved");

// With tone
bulletin.success("Export complete");
bulletin.danger("Connection lost — retrying");
bulletin.caution("Approaching rate limit");

// With options
bulletin("Processing complete", {
  duration: 8000,
  action: { label: "View", onClick: () => focusCard(cardId) },
});

// With description
bulletin("Export complete", {
  description: "3 cards exported to ~/Desktop/export.json",
});
```

### Tone Variants

| Tone | Use Case | Visual |
|------|----------|--------|
| `default` | Neutral information | Standard chrome |
| `success` | Positive outcome | Success accent |
| `danger` | Error or failure | Danger accent |
| `caution` | Warning | Caution accent |

Tones map to the existing role token system — `--tug7-surface-tone-*` and `--tug7-element-tone-*`.

### Architecture

- **TugBulletinViewport** — mounted once in the app root (alongside TugTooltipProvider). Fixed-position container for bulletin stack.
- **`bulletin()` function** — imperative fire-and-forget API. Internally calls Sonner's `toast()` with tug styling.
- **Sonner's `<Toaster>`** — rendered inside TugBulletinViewport with tug classes and token-driven styling.
- **No compound JSX API** — bulletins are fire-and-forget; there's no trigger/content composition.

### Visual Design

- **Default position:** Top-right of viewport, like macOS notification banners
- **Configurable:** All four corners via `position` prop on TugBulletinViewport (`"top-right"` | `"top-left"` | `"bottom-right"` | `"bottom-left"`)
- Stack downward from top (or upward from bottom), newest on top
- Slide in from the near edge, slide out on dismiss
- Pause timer on hover
- Swipe to dismiss (direction matches position)
- Max 3 visible; older ones compress
- Auto-dismiss after configurable duration (default: 5000ms)

### Token Sovereignty [L20]

TugBulletin owns its own tokens:
- `--tugx-bulletin-bg`, `--tugx-bulletin-fg`, `--tugx-bulletin-border`, `--tugx-bulletin-shadow`
- `--tugx-bulletin-success-accent`, `--tugx-bulletin-danger-accent`, `--tugx-bulletin-caution-accent`

### Law Citations

```
Laws: [L06] appearance via CSS, [L16] pairings declared, [L19] component authoring guide
```

[L15] does not apply — bulletins are display-only, not interactive controls. [L20] does not apply — no tugways children are composed.

### Files

```
tug-bulletin.tsx   — TugBulletinViewport + bulletin() function
tug-bulletin.css   — viewport layout, bulletin card styling, tone variants, animations
```

### Package

`sonner` — needs to be installed. Not currently in package.json.

---

## Shared Patterns

### Animation

CSS keyframe enter/exit animations [L14]. No WAAPI for enter/exit — Radix Presence owns the DOM lifecycle where Radix primitives are used. Non-Radix components (banner, bulletin) use their own CSS keyframes driven by data attributes or Sonner's animation system.

| Component | Enter | Exit |
|-----------|-------|------|
| tug-banner (status) | Slide down from top + scrim fade | Slide up + scrim fade |
| tug-banner (error) | Fade in + scrim fade | Fade out + scrim fade |
| tug-alert | Fade + scale (centered) + scrim fade | Fade + scale + scrim fade |
| tug-sheet | Drop down from title bar + card scrim fade | Slide up into title bar + scrim fade |
| tug-dialog | Card appears (DeckManager centers on deck) | Card close |
| tug-bulletin | Slide in from top-right edge | Slide out to right |

### Scrim — Dimming, Not Disabling

The scrim is the visual layer of modal blocking. It communicates "you can't reach this right now" without changing the appearance of anything underneath. Controls behind the scrim look normal — they're dimmed but not disabled.

| Component | Scrim Scope | Scrim Token | `inert` Target |
|-----------|-------------|-------------|----------------|
| tug-banner | Full viewport | `--tugx-banner-overlay-bg` | Deck canvas container |
| tug-alert | Full viewport | `--tugx-alert-overlay-bg` | Radix handles (aria-hidden) |
| tug-sheet | Card body only | `--tugx-sheet-overlay-bg` | `.tugcard-body` element |
| tug-dialog | None | — | — |
| tug-bulletin | None | — | — |

The scrim is an appearance-zone element [L06] — a semi-transparent overlay with a token-driven background color. It sits between the blocked content and the modal surface. The `inert` attribute handles the interaction/accessibility layer separately.

### Focus Management

- **tug-banner:** No focus target — the banner is informational. `inert` on deck canvas prevents focus from reaching cards.
- **tug-alert:** Radix AlertDialog traps focus automatically.
- **tug-sheet:** Radix Dialog Content manages focus within sheet. `inert` on card body prevents focus escape to card content.
- **tug-dialog:** Card focus system handles it (existing infrastructure).
- **tug-bulletin:** No focus trap. User reaches bulletins via hotkey (configurable).

### Responder Chain Integration

- **tug-banner:** Deck canvas is `inert`, so no pointer/keyboard events reach responder nodes. The responder chain is effectively suspended.
- **tug-alert:** While open, the alert's content is the only interactive surface. Radix's inertness on the rest of the page means no responder chain actions fire from behind the alert.
- **tug-sheet:** Sheet content participates in the card's responder subtree. Card body is `inert`, so no competing actions from card content.
- **tug-dialog:** Dialog card has its own responder node (standard card behavior).
- **tug-bulletin:** Bulletins don't participate in the responder chain. Action buttons on bulletins fire callbacks directly.

---

## What Radix/Sonner Provides vs What We Build

| Concern | Library Provides | We Build |
|---------|-----------------|----------|
| State-driven barrier (banner) | — | Original: scrim + `inert` + presence pattern |
| Focus trapping (alert) | Radix AlertDialog Content | — |
| Full-page inertness (alert) | Radix AlertDialog aria-hidden | — |
| Full-page inertness (banner) | — | `inert` attribute on deck canvas |
| Card-scoped inertness (sheet) | — | `inert` attribute on `.tugcard-body` |
| Window-shade animation (sheet) | Radix `data-state` lifecycle | CSS keyframes for drop animation |
| Card spawning (dialog) | — | `useTugDialog` hook + DeckManager centered positioning |
| Toast stacking (bulletin) | Sonner | Tug styling + token integration |
| Enter/exit animations | Radix `data-state` / Sonner | CSS keyframes |
| Accessible roles | Radix `alertdialog` / `dialog` | Banner: `role="alert"` + `aria-live` |
| ARIA labeling | Radix Title → aria-labelledby | — |
| Escape handling | Radix built-in | Banner: N/A (no dismiss) |

---

## Package Requirements

| Package | Status | Needed For |
|---------|--------|------------|
| `@radix-ui/react-alert-dialog` | Not installed | tug-alert |
| `@radix-ui/react-dialog` | Installed | tug-sheet |
| `sonner` | Not installed | tug-bulletin |

---

## Build Order

1. **tug-banner** — Original component, no Radix dependency. Scrim + `inert` + presence pattern establishes the blocking model that tug-alert and tug-sheet also use. Build first so the infrastructure is proven. Replaces existing `disconnect-banner.tsx` and `error-boundary.tsx` rendering.
2. **tug-alert** — Radix AlertDialog does the heavy lifting. App-modal with Promise API. Reuses the full-viewport scrim pattern from tug-banner.
3. **tug-sheet** — Card-modal. Card-scoped scrim + `inert` on `.tugcard-body` + window-shade animation. Medium complexity.
4. **tug-bulletin** — Install Sonner, wire up viewport, style with tokens. Independent of the other three.
5. **tug-dialog** — Infrastructure only (hook + card registry conventions). Small scope — the dialog-as-card pattern means most work is in content components, which are authored as regular cards.

### Dashes

- **Dash 1:** tug-banner component + CSS + gallery card
- **Dash 2:** tug-alert component + CSS
- **Dash 3:** tug-alert gallery card
- **Dash 4:** tug-sheet component + CSS
- **Dash 5:** tug-sheet gallery card
- **Dash 6:** tug-bulletin component + CSS + gallery card
- **Dash 7:** tug-dialog hook + centered positioning in DeckManager
