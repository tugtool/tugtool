# Tug Alert System — Consolidated Proposal

*Five modality tiers for interruption, confirmation, notification, and system state. Modeled on AppKit (NSAlert, beginSheet, NSPopover, Notification Center) but adapted for tug's card-based deck architecture.*

*Cross-references: `[L##]` → [laws-of-tug.md](../tuglaws/laws-of-tug.md). `[D##]` → [design-decisions.md](../tuglaws/design-decisions.md).*

---

## Overview

Tug needs five tiers of user interruption, each with distinct modality and scope:

| Tier | Component | Modality | Scope | Radix Primitive | Analogy |
|------|-----------|----------|-------|-----------------|---------|
| 0 | **tug-banner** | App-modal (state) | Entire app | None (original) | System state barrier |
| 1 | **tug-alert** | App-modal (action) | Entire app | `react-alert-dialog` | NSAlert |
| 2 | **tug-sheet** | Card-modal | Single card | `react-dialog` (non-modal) | beginSheet |
| 3 | **tug-dialog** | Card-spawned | Deck | None (card registry) | NSPanel / utility window |
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

- **App-modal (tug-banner, tug-alert):** Full-viewport scrim + Radix AlertDialog's native inertness (for alert). Banner renders above the scrim, alert renders above the scrim with its panel.
- **Card-modal (tug-sheet):** Card-scoped scrim over `.tugcard-body` + `inert` attribute on the same element. Only that card's content is dimmed and blocked; other cards remain fully interactive and visually normal.
- **Card-spawned (tug-dialog):** No scrim, no inertness. The dialog is a peer card in the deck — it participates naturally in focus/z-order.
- **Modeless (tug-bulletin):** No scrim, no inertness. Notifications live in a fixed viewport outside the card system entirely.

---

## Component 0: tug-banner

*App-modal state barrier. Appears when a system condition prevents work; disappears when the condition resolves. No user action can dismiss it.*

### Concept

Two existing cases in Tug.app today:

1. **Disconnected banner** — WebSocket connection lost. The user can't do anything useful until reconnection. Currently a hand-built `position: fixed` div.
2. **Error banner** — Vite HMR error overlay. The app is in a broken state. Currently Vite's built-in red error screen.

Both share the same pattern: a system condition makes the app non-functional, a prominent visual indicator appears, and interaction is blocked until the condition resolves. Neither requires a user response — they come and go on their own.

### How It Differs from tug-alert

| | tug-banner | tug-alert |
|---|-----------|-----------|
| **Trigger** | System state (reactive) | Code request (imperative) |
| **Dismissal** | Condition resolves | User responds |
| **User action** | None — wait for recovery | Confirm or cancel |
| **Promise API** | No | Yes |
| **Content** | Status message, maybe a spinner | Title + message + buttons |

### API Design

```tsx
// Declarative only — controlled by system state
<TugBanner
  visible={!isConnected}
  tone="danger"
  message="Connection lost — reconnecting..."
  icon="wifi-off"
/>

<TugBanner
  visible={hasError}
  tone="danger"
  message={errorMessage}
/>
```

No imperative API. Banner visibility is driven by reactive state (connection status, error boundaries). The component renders when `visible` is true and animates out when false.

### Props

| Prop | Type | Description |
|------|------|-------------|
| `visible` | `boolean` | Whether the banner is shown |
| `tone` | `"danger" \| "caution" \| "default"` | Visual severity. Default: `"danger"` |
| `message` | `string \| ReactNode` | Banner content |
| `icon` | `string` | Optional Lucide icon name |

### Visual Design

- Full-width horizontal strip at top of viewport (above all cards, above deck canvas)
- Full-viewport scrim beneath it dims the entire deck
- Banner itself is prominent — high contrast, tone-colored
- Slide down on appear, slide up on dismiss
- `inert` on the deck canvas while visible — nothing behind the scrim is interactive
- No close button, no dismiss gesture — the banner leaves when the condition resolves

### Modality Mechanism

- Scrim overlay covers the entire viewport beneath the banner
- `inert` attribute set on the deck canvas container
- Banner + scrim render above all z-index layers (above cards, above popovers)
- When `visible` transitions to false: remove `inert`, fade scrim, slide banner out

### Token Sovereignty [L20]

TugBanner owns:
- `--tugx-banner-bg`, `--tugx-banner-fg`, `--tugx-banner-border` — banner strip
- `--tugx-banner-overlay-bg` — full-viewport scrim
- Tone variants: `--tugx-banner-danger-bg`, `--tugx-banner-caution-bg`

### Files

```
tug-banner.tsx   — component (declarative, no imperative handle)
tug-banner.css   — banner strip, scrim overlay, tone variants, slide animation
```

### Replacing Existing Banners

The disconnected banner and error overlay currently in the codebase would be replaced by TugBanner instances. The error boundary case may need a specialized variant (showing stack traces, reload button) — but the banner + scrim + inert pattern is the same.

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
| `open` | `boolean` | Controlled open state |
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

- Full-viewport scrim overlay (semi-transparent, token-driven)
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

### Files

```
tug-alert.tsx   — component + imperative handle
tug-alert.css   — overlay, panel, layout, animations
```

---

## Component 2: tug-sheet

*Card-modal dialog scoped to a single card. Other cards remain fully interactive.*

### Why Not Radix Dialog `modal={true}`?

Radix Dialog with `modal={true}` makes the **entire page** inert — every card, every toolbar, everything. That's app-modal, not card-modal. We need card-scoped modality.

### Architecture

Use Radix Dialog with `modal={false}` for its compound API, focus management utilities, and `data-state` animation support. Layer card-scoped inertness on top:

1. Sheet opens → set `inert` attribute on the card's `.tugcard-body` element
2. Sheet content renders as a positioned overlay **within the card frame** (not portaled to document root)
3. Focus moves into sheet content
4. Escape closes sheet → remove `inert` → restore focus to trigger
5. Other cards remain fully interactive throughout

### Portal Scoping

Radix Dialog's Portal defaults to `document.body`. For card-modal, use the `container` prop to portal into the card's frame element instead. This keeps the sheet visually and structurally scoped to its parent card.

```tsx
<Dialog.Portal container={cardFrameRef.current}>
  <Dialog.Overlay className="tug-sheet-overlay" />
  <Dialog.Content className="tug-sheet-content">
    {children}
  </Dialog.Content>
</Dialog.Portal>
```

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
| `title` | `string` | Sheet title (renders in a header bar) |
| `children` | `ReactNode` | Arbitrary content |

### Card-Modal Mechanics

**Inertness via `inert` attribute:**
- When sheet opens: `cardBodyEl.setAttribute("inert", "")`
- When sheet closes: `cardBodyEl.removeAttribute("inert")`
- The `inert` attribute disables all pointer events, focus, and assistive tech within the element — a native browser feature, no React context needed
- This is the TugBox insight applied at the DOM level: a single attribute cascading disable to all contained elements

**Finding the card body:**
- TugSheetContent uses a ref callback or `closest('[data-slot="tug-card"]')` to find its parent card
- Selects the `.tugcard-body` child element
- Sets/removes `inert` in `useLayoutEffect` synchronized with open state [L03]

**Responder chain:**
- When the sheet is open and the card body is inert, pointer/keyboard events within the card body are suppressed by the browser
- The sheet itself is NOT inert, so it receives events normally
- Actions dispatched from sheet content travel up the responder chain through the card's node as usual

### Visual Design

- Card-scoped scrim overlay (covers the card's content area, not the title bar)
- Sheet panel slides up from bottom of card (or centered, depending on content)
- Title bar with close button
- CSS keyframe enter/exit animations [L14]
- Card title bar remains visible and interactive (user can see what card the sheet belongs to)

### Token Sovereignty [L20]

TugSheet owns:
- `--tugx-sheet-overlay-bg` — card-scoped scrim
- `--tugx-sheet-bg`, `--tugx-sheet-fg`, `--tugx-sheet-border`, `--tugx-sheet-shadow` — panel chrome
- `--tugx-sheet-header-bg`, `--tugx-sheet-header-fg` — sheet header bar

Children (forms, controls) keep their own tokens.

### Files

```
tug-sheet.tsx   — compound components (Root/Trigger/Content) + imperative handle
tug-sheet.css   — overlay, panel, slide animation, header
```

---

## Component 3: tug-dialog

*A dialog that IS a card. Leverages the entire deck infrastructure.*

### The Insight

The user's observation: "tug-dialog could possibly be its own card, or a variant of it that we create with a customized title bar."

This is the right call for tug. A traditional dialog overlay duplicates what the deck already provides: positioning, z-order, focus management, title bars, close buttons, drag handles. Instead of building a parallel overlay system, **tug-dialog spawns a card**.

### How It Works

1. Caller requests a dialog via imperative API
2. DeckManager creates a new card with dialog-specific registration
3. The card renders with a customized title bar (no tabs, centered, closable)
4. Card appears centered on the deck (or near the requesting card)
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

The `"dialog"` family allows the deck to treat dialog cards differently if needed (e.g., no tab drops, centered initial position, no persist-on-reload).

### Why Card-Based?

| Concern | Traditional Dialog | Dialog-as-Card |
|---------|-------------------|----------------|
| Positioning | Custom centering logic | DeckManager handles it |
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
- Dialog family positioning — centered on deck or near requesting card
- Promise resolution — dialog content calls a resolve callback (provided via context) when done; card close resolves with `undefined`

### Files

No new component files. This is infrastructure:
```
use-tug-dialog.ts   — hook for spawning dialog cards
```

Dialog content is authored as regular card content components — they just happen to be registered with `family: "dialog"`.

---

## Component 4: tug-bulletin

*Non-blocking notification. Fire-and-forget. The tug name for what others call "toast."*

### Library Choice: Sonner

Radix Toast has a complex, verbose API (Provider → Viewport → Root → Title → Description → Action → Close) requiring each toast to be manually composed in JSX. The recommended approach in the broader React ecosystem has shifted to **Sonner** — a headless toast library by the same author (Emil Kowalski) with a dramatically simpler API:

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

- Fixed to bottom-right of viewport (configurable)
- Stack from bottom, newest on top
- Slide-in from right, slide-out on dismiss
- Pause timer on hover
- Swipe right to dismiss
- Max 3 visible; older ones compress

### Token Sovereignty [L20]

TugBulletin owns its own tokens:
- `--tugx-bulletin-bg`, `--tugx-bulletin-fg`, `--tugx-bulletin-border`, `--tugx-bulletin-shadow`
- `--tugx-bulletin-success-accent`, `--tugx-bulletin-danger-accent`, `--tugx-bulletin-caution-accent`

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

CSS keyframe enter/exit animations driven by `[data-state]` or controlled visibility [L14]. No WAAPI for enter/exit — Radix Presence owns the DOM lifecycle where applicable.

| Component | Enter | Exit |
|-----------|-------|------|
| tug-banner | Slide down from top + scrim fade | Slide up + scrim fade |
| tug-alert | Fade + scale (centered) + scrim fade | Fade + scale + scrim fade |
| tug-sheet | Slide up from card bottom + card scrim fade | Slide down + scrim fade |
| tug-dialog | Card appears (DeckManager handles positioning) | Card close |
| tug-bulletin | Slide in from right | Slide out right |

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

## What Radix Provides vs What We Build

| Concern | Radix Provides | We Build |
|---------|---------------|----------|
| State-driven barrier (banner) | — | Original component, scrim + `inert` |
| Focus trapping (alert) | AlertDialog Content | — |
| Full-page inertness (alert) | AlertDialog aria-hidden | — |
| Full-page inertness (banner) | — | `inert` attribute on deck canvas |
| Card-scoped inertness (sheet) | — | `inert` attribute on `.tugcard-body` |
| Card spawning (dialog) | — | `useTugDialog` hook |
| Toast stacking (bulletin) | — | Sonner handles it |
| Enter/exit animations | `data-state` lifecycle | CSS keyframes |
| Accessible roles | `alertdialog` / `dialog` roles | — |
| ARIA labeling | Title → aria-labelledby | — |
| Escape handling | Built-in | — |

---

## Package Requirements

| Package | Status | Needed For |
|---------|--------|------------|
| `@radix-ui/react-alert-dialog` | Not installed | tug-alert |
| `@radix-ui/react-dialog` | Installed | tug-sheet |
| `sonner` | Not installed | tug-bulletin |

---

## Build Order

1. **tug-banner** — Original component, no Radix dependency. Scrim + `inert` pattern establishes the blocking model that tug-alert and tug-sheet also use. Build this first so the scrim/inert infrastructure is proven.
2. **tug-alert** — Radix AlertDialog does the heavy lifting. App-modal with Promise API. Reuses the scrim pattern from tug-banner (full-viewport).
3. **tug-sheet** — Card-modal. Card-scoped scrim + `inert` on `.tugcard-body`. Medium complexity.
4. **tug-bulletin** — Install Sonner, wire up viewport, style with tokens. Independent of the other three.
5. **tug-dialog** — Infrastructure only (hook + card registry conventions). Can be built whenever dialog content is needed.

### Dashes

- **Dash 1:** tug-banner component + CSS + gallery card
- **Dash 2:** tug-alert component + CSS
- **Dash 3:** tug-alert gallery card
- **Dash 4:** tug-sheet component + CSS
- **Dash 5:** tug-sheet gallery card
- **Dash 6:** tug-bulletin component + CSS + gallery card
- **Dash 7:** tug-dialog hook (if proceeding)

---

## Open Questions

1. **tug-banner error variant:** Should the error boundary case (stack traces, reload button) be a TugBanner variant, or a separate specialized component? The scrim/inert pattern is the same but the content is much richer.
2. **tug-dialog positioning:** Center on deck? Near requesting card? Cascade offset like normal cards?
3. **tug-sheet slide direction:** From bottom of card (macOS-like)? Or centered overlay within card?
4. **tug-bulletin position:** Bottom-right? Bottom-center? Configurable?
5. **tug-dialog scope:** Build now in Group C, or defer to Group E where it's currently listed? The hook is small but dialog *content* components are the real work.
