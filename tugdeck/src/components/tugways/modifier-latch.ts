/**
 * `modifier-latch` — the held-modifier bit, projected onto `<html>` as
 * `data-mods`.
 *
 * One consumer today: the **chord ring**. A default button whose activation is
 * `Shift+Return` rather than a plain `Return` wears the double ring dashed, and
 * the dash resolves to solid exactly while Shift is physically down — the
 * instant at which a `Return` really would fire it. So the ring never states
 * something false at any moment, and holding Shift becomes the gesture that
 * *shows you* what Return is about to do.
 *
 * Appearance, so it travels as a DOM attribute and never as React state
 * ([L06]) — the same shape as `data-app-active` (`deck-manager`) and `data-kbf`
 * (`focus-manager`).
 *
 * The latch reads `event.shiftKey` off EVERY key event rather than watching for
 * `key === "Shift"`. A modifier press and release are ordinary keydown/keyup
 * pairs that can be missed — a chord swallowed by a native menu, a keyup
 * delivered while another window is key — and a latch that only counts those
 * two events would then stay stuck down. Reading the flag off whatever key
 * event arrives next makes every keystroke a resync, so the worst case is one
 * stale frame rather than a permanently lit ring.
 *
 * Window `blur` clears it for the case no key event can correct: Shift held
 * while the user Cmd-Tabs away, whose keyup lands in the other app entirely.
 * (A background window paints no ring at all — `[data-app-active="false"]`
 * drops the outline on both paint paths — but the attribute would still be
 * wrong when the window came back, and a wrong attribute is a wrong test.)
 *
 * @module components/tugways/modifier-latch
 */

/**
 * Root attribute carrying the modifiers currently held down, space-separated,
 * absent when none are. Space-separated (rather than one attribute per
 * modifier) so CSS matches with `[data-mods~="shift"]` and the set can grow
 * without growing the projection.
 *
 * Only `shift` is tracked. The other three earn a place here when something
 * needs to paint on them; an unread bit is a per-keystroke DOM write that buys
 * nothing.
 */
export const MODS_ATTRIBUTE = "data-mods";

/** The one tracked modifier's token within {@link MODS_ATTRIBUTE}. */
export const MOD_SHIFT = "shift";

/**
 * Install the latch's listeners on `document` / `window` and return the
 * teardown. Idempotent per call site; the responder chain provider owns the
 * single installation, alongside the rest of the key pipeline.
 */
export function installModifierLatch(): () => void {
  if (typeof document === "undefined") return () => {};

  const root = document.documentElement;
  // Mirrors the attribute so the common case — a keystroke that does not
  // change the held set — costs one boolean compare and no DOM touch. The
  // composer's typing path runs through here on every key up and down.
  let shiftHeld = false;

  const apply = (next: boolean): void => {
    if (next === shiftHeld) return;
    shiftHeld = next;
    if (next) {
      root.setAttribute(MODS_ATTRIBUTE, MOD_SHIFT);
    } else {
      root.removeAttribute(MODS_ATTRIBUTE);
    }
  };

  const onKey = (event: KeyboardEvent): void => {
    apply(event.shiftKey);
  };
  const onBlur = (): void => {
    apply(false);
  };

  // Capture phase: a chord consumed by the engine's own capture stages
  // (`stopImmediatePropagation` at the window-capture keybinding stage) must
  // still resync the latch, and a bubble-phase listener would never see it.
  document.addEventListener("keydown", onKey, { capture: true });
  document.addEventListener("keyup", onKey, { capture: true });
  window.addEventListener("blur", onBlur);

  return () => {
    document.removeEventListener("keydown", onKey, { capture: true });
    document.removeEventListener("keyup", onKey, { capture: true });
    window.removeEventListener("blur", onBlur);
    apply(false);
  };
}
