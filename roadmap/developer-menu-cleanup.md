# Developer Menu Cleanup

Clean up the Developer menu: rename items, remove items, and clean up all associated middleware and backend code so nothing dangles.

## Target Menu Layout

```
Reload                          Cmd+R
-----
Show JavaScript Console         Opt+Cmd+C
-----
Show Component Gallery          Opt+Cmd+G
Show Test Card                  Opt+Cmd+T
Add Tab To Front Card
-----
Source Tree...
```

## Changes

### Renames
1. **"Reload Frontend" → "Reload"** — menu title only; action stays `reload_frontend`, handler stays the same.
2. **"Add Tab" → "Add Tab To Front Card"** — menu title only; action stays `add-tab`.
3. **"Choose Source Tree..." → "Source Tree..."** — menu title only; handler stays the same.

### Removals (menu items + all supporting code)
4. **"Restart Server"** — remove menu item, `restartServer(_:)` handler, `restartMenuItem` property, and the `restart` action branch in `actions.rs` (exit code 42). Remove the `restart` shutdown reason handling and `copyBinaryFromSourceTree()` in `ProcessManager.swift`. Remove the `test_dispatch_action_restart` test.
5. **"Relaunch App"** — remove menu item, `relaunchApp(_:)` handler, `relaunchMenuItem` property, and the `relaunch` action branch in `actions.rs`. Remove the entire relaunch orchestration in `control.rs` (`handle_relaunch`, `resolve_app_bundle`, `resolve_tugrelaunch_binary`, `connect_progress_socket`, `relay_progress`, `send_build_progress_error`, and associated tests). Remove the `relaunch` shutdown reason case in `ProcessManager.swift`. Remove the `tugrelaunch` crate from `Cargo.toml` workspace members and delete `tugcode/crates/tugrelaunch/`.
6. **"Reset Everything"** — remove menu item, `resetEverything(_:)` handler, and the `reset` action branch in `actions.rs` (exit code 43). Remove the `reset` shutdown reason handling in `ProcessManager.swift`. Remove the `reset` action handler in `action-dispatch.ts` and its tests in `action-dispatch.test.ts`.
7. **"Source Tree: /path"** (the disabled display item) — remove from menu, remove `sourceTreeMenuItem` property and any update logic.

### Structural
8. **Add a divider** between "Add Tab To Front Card" and "Source Tree...".
9. **Remove dividers** that are no longer needed (the one that used to appear above "Show JavaScript Console" remains; the one above "Show Component Gallery" remains; a new one goes before "Source Tree...").

## Files to Touch

| File | What Changes |
|------|-------------|
| `tugapp/Sources/AppDelegate.swift` | Rename 3 items, remove 4 items + handlers + properties, adjust dividers |
| `tugapp/Sources/ProcessManager.swift` | Remove `restart`/`reset`/`relaunch` shutdown reason cases, remove `copyBinaryFromSourceTree()` |
| `tugcode/crates/tugcast/src/actions.rs` | Remove `restart`, `reset`, `relaunch` match arms + tests |
| `tugcode/crates/tugcast/src/control.rs` | Remove `handle_relaunch` and all relaunch orchestration helpers + tests |
| `tugcode/Cargo.toml` | Remove `tugrelaunch` from workspace members |
| `tugcode/crates/tugrelaunch/` | Delete entire crate |
| `tugdeck/src/action-dispatch.ts` | Remove `reset` action handler |
| `tugdeck/src/__tests__/action-dispatch.test.ts` | Remove `reset` handler tests |

## What Stays Untouched

- `reload_frontend` action + handler (just a menu label rename)
- `add-tab` action + handler (just a menu label rename)
- `chooseSourceTree(_:)` handler and `choose-source-tree` action (just a menu label rename)
- `show-component-gallery`, `show-card`, `set-dev-mode`, `set-theme` actions
- `RestartDecision` enum and the restart-with-backoff logic in `ProcessManager.swift` (that handles tugcast crashes, not user-initiated restart)
- The `openWebInspector` handler
- `dev_build_progress` frame type if referenced elsewhere — verify before removing

## Open Questions

- The `RestartDecision` enum has `.restart` and `.doNotRestart` variants that are used by the crash-restart logic (not just menu-initiated restart). After removing the menu-initiated `restart` reason, verify that `.restart` is still reachable from the crash/backoff path. If not, simplify the enum.
- `copyBinaryFromSourceTree()` is only called from the `restart` shutdown reason handler. Confirm no other call sites before removing.
- Exit codes 42, 43, 45 in `actions.rs` — confirm 42 (restart) and 43 (reset) can be fully removed, and 45 (relaunch complete) goes away with the relaunch orchestration.
