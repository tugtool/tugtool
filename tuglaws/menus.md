# Menus

*The macOS menu bar is a projection of frontend state: tugdeck pushes one
`menuState` payload, Swift caches it, and every item's enablement is pulled
from that cache in `validateMenuItem(_:)`. Menu items act by sending control
frames back into the web layer — never by mutating web state directly.*

*Cross-references: [action-naming.md](action-naming.md) (the Both category),
[app-test-harness.md](app-test-harness.md) (`menuSnapshot` / `menuItemState`).
`[L##]` → [tuglaws.md](tuglaws.md).*

---

## The shape

```
tugdeck stores ──▶ host-menu-state aggregator ──▶ menuState push ──▶ MenuState cache
                                                                          │
WKWebView ◀── control frame ◀── NSMenuItem action          validateMenuItem(_:) pulls
```

Two channels, one in each direction:

- **State out** — `tugdeck/src/lib/host-menu-state.ts` projects the deck
  store (plus the dev card's published session block) into one payload,
  diffs, coalesces on a microtask, and posts to
  `webkit.messageHandlers.menuState`. `MainWindow` forwards it to
  `AppDelegate.updateMenuState`, which replaces the cached `MenuState`
  struct wholesale.
- **Commands in** — every menu item's selector calls
  `sendControl(...)`; tugdeck's `action-dispatch.ts` re-enters the
  responder chain (or a store) from there. No menu item reaches into web
  state by any other route.

## The menuState wire contract

Posted by the aggregator; parsed by `AppDelegate`'s `MenuState` struct.
**Keep both sides in sync** — they are the two halves of one contract.

```jsonc
{
  "panes": [                       // z-order, topmost first
    { "id": "...", "title": "...", "focused": true,
      "cardCount": 2, "closable": true }
  ],
  "activeCard": {                  // focused pane's active card; null when no panes
    "component": "dev",
    "closable": true
  },
  "dev": {                         // null unless the active card is a dev card
    "cardId": "...",
    "sessionBound": true,
    "canInterrupt": false,
    "permissionMode": "default",   // live metadata ?? persisted ?? "default"
    "hasAssistantMessage": false,
    "hasTurns": false
  }
}
```

Publication discipline:

- The deck half comes from the aggregator's own `DeckManager`
  subscription (wired once at boot in `main.tsx`).
- The dev block is published by the dev card's
  `use-menu-state-publication.ts` effect, which **subscribes to the
  stores directly** ([L22]) — publication is a side effect, not a render
  derivation. Every dev card publishes unconditionally; the aggregator
  decides which block rides the payload (the focused pane's active dev
  card).
- The aggregator posts only when the serialized payload changes,
  coalesced on a microtask — wire traffic is proportional to
  menu-relevant change, not store churn.
- Before the first push (app boot), the Swift cache is `MenuState.empty`
  and every state-gated item validates disabled. That is the correct
  cold-start posture, not a bug.

## Validation: pull-based, four tiers

All enablement flows through `AppDelegate.validateMenuItem(_:)`, keyed on
the item's identifier and reading only the cached `MenuState`. AppKit
re-validates on menu open and key-equivalent dispatch; nothing pushes
`isEnabled` imperatively (the page-zoom items, whose enablement reads live
`webView.pageZoom` at rebuild time, are the one exception).

| Tier | Predicate source | Examples |
|---|---|---|
| 1 — always | — | natives, Find trio, links |
| 2 — deck state | `panes` | `file.closeCard` (closable), `file.closeAllCards` / `window.previousCard` / `window.nextCard` (focused `cardCount > 1`), `maker.newCardInPane` (≥1 pane; debug-gated Maker menu), `window.cyclePanes` (≥2 panes) |
| 3 — card type | `activeCard.component == "dev"` | every `session.*` item, `edit.copyLastResponse`, `file.exportTranscript`, `help.shortcuts` |
| 4 — session state | `dev` block | `session.stop` (`canInterrupt`), `session.rewind` (`sessionBound && hasTurns`), `edit.copyLastResponse` (`hasAssistantMessage`), other `session.*` items (`sessionBound`) |

An item in tiers 3+4 requires both. The Session menu is
**disabled, not hidden** — stable menu bars preserve discoverability. The
Maker menu is the deliberate exception: it hides behind the
`maker-mode-enabled` tugbank gate, because maker mode is a *mode*, not a
focus state.

The permission-mode radio checkmarks also refresh inside
`validateMenuItem` (setting `state` during the validation sweep is the
sanctioned AppKit pattern) — one mechanism covers enablement and marks.

## The control-frame catalog

Menu-driven frames, per [action-naming.md](action-naming.md)'s
classification:

| Frame | Category | JS handling |
|---|---|---|
| `run-card-command {name, args?}` | Control-frame-only | re-dispatches `RUN_SLASH_COMMAND {name, args}` via `sendToKeyCard` — re-enters the dev card's slash-command surface map, byte-identical to typing the command |
| `set-permission-mode {mode}` | Both | validated against the four-mode menu set, then `SET_PERMISSION_MODE` via `sendToKeyCard`; the dev card commits through the chip's mode-set path |
| `interrupt-session` | Both | `INTERRUPT_SESSION` via `sendToKeyCard`; the dev card calls `codeSessionStore.interrupt()` — deliberately NOT Escape's dismiss-priority walk |
| `find` / `find-next` / `find-previous` | Both | `sendToFirstResponder` round-trips (the focused card's find session) |
| `next-tab` / `previous-tab` / `cycle-card` | Both | `sendToFirstResponder` round-trips |
| `focus-prompt` / `cycle-permission-mode` | Both | `sendToKeyCard` round-trips |
| `close` / `close-all` / `add-card-to-active-pane` | Both | as before this phase |
| `show-card` / `arrange-cards` / `focus-pane` / `set-theme` / `next-theme` / `set-maker-mode` / `reload` / `source-tree` / `show-dev-panel-toggle` | Control-frame-only | app-level RPC, no chain dispatch |

**The promoted-chord rule:** a Swift menu item with a key equivalent
swallows that chord at the menu bar — the WKWebView never sees the
keystroke. Therefore **every shortcut promoted to a menu item MUST have a
working control-frame round-trip** (a Both-category entry or equivalent),
landed *before* the key equivalent is attached. The tugdeck keybinding-map
entries for the same chords stay for browser dev, where no Swift menu
exists.

`run-card-command` arg semantics: menu items send no `args`. `rename` and
`compact` are the only `takesArgs` commands, and a bare `rename` opens the
seeded one-field sheet — exactly the wanted menu behavior.

## The identifier namespace

Every `NSMenuItem` — including dynamically built ones — carries a stable
`NSUserInterfaceItemIdentifier`, namespaced by menu:

```
app.about        file.newDevCard      edit.findNext        session.stop
view.theme.<name> window.pane.<n>      maker.devPanel       help.shortcuts
session.permissionMode.<mode>          view.zoomInAlias (hidden ⌘= alias)
```

Rules:

- **Identity never rides the title.** Titles localize and (for dynamic
  items) carry runtime data; the identifier never does. Tests and the
  harness address items by identifier only.
- Dynamic items mint identifiers at build time (`view.theme.<name>`,
  `window.pane.<n>` by position, since pane ids are session-random).
- AppKit injects its own identified items (dictation, emoji palette) and
  may clone the fullscreen item into its managed window-tiling section —
  uniqueness is guaranteed only within our `<menu>.` namespaces.

The Window menu is special: it is `NSApp.windowsMenu`, so AppKit owns
auto-added entries in it. The dynamic pane list is managed as a sectioned
slice — remove exactly the `window.pane.*` items, re-insert after the
anchor separator — and the menu is **never** wholesale-rebuilt
(`removeAllItems()` is forbidden there).

## Testing

The harness verbs `menuSnapshot` / `menuItemState` (surface 1.7.0) report
each item's *validated* enabled state — the snapshot runs the same
`NSMenuItemValidation` resolution AppKit uses — plus the checkmark
`state`, captured after the validation sweep. Structure, deck-tier,
maker-gate, and session-tier coverage lives in
`tests/app-test/at0167–at0172`. Dynamic items (View body, theme list,
pane slice) rebuild only in `menuNeedsUpdate` and are not visible to a
snapshot taken without opening the menu.
