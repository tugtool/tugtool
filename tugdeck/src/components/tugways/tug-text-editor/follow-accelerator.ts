/**
 * follow-accelerator — the modifier that means "follow this link" in a
 * source buffer, and the class that shows it is held.
 *
 * Two editor extensions decorate followable runs in text the user is still
 * editing — the text card's intra-document anchors and the annotator's
 * confirmed file paths — and both face the same problem: a plain click has
 * to keep placing the caret, so following needs a modifier, and a modifier
 * gesture nobody can see is a gesture nobody finds. The answer both use is
 * to light the runs up while the accelerator is down, so the affordance
 * appears exactly when it is available.
 *
 * The observer is a modifier-hold *reader*, not a chord claim: it never
 * prevents a default, never stops propagation, and never runs a command,
 * so there is nothing here for a keymap to collide with. It listens on the
 * window rather than the editor because the modifier can go down before the
 * pointer arrives, and it clears on window blur because a keyup that lands
 * in another app never reaches us — without that, the underlines would stay
 * lit after a ⌘-Tab away.
 *
 * Appearance only: the observer toggles a class and CSS does the rest
 * ([L06]).
 *
 * @module components/tugways/tug-text-editor/follow-accelerator
 */

/**
 * The platform accelerator for "follow this link". ⌘ on macOS (Ctrl there is
 * a right-click), Ctrl elsewhere — mirroring the editor's other modifier
 * gestures (see `use-outer-scroll-on-modifier-wheel`).
 */
const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");

/** Whether an event carries the follow accelerator. */
export function accelHeld(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return IS_MAC ? e.metaKey : e.ctrlKey;
}

/**
 * Toggle `className` on `host` for as long as the follow accelerator is
 * held. Construct in a view plugin's constructor, {@link destroy} in its
 * `destroy` — the class is removed either way, so an editor torn down with
 * the modifier still down does not leave it behind.
 */
export class FollowAcceleratorObserver {
  private held = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly className: string,
  ) {
    const win = host.ownerDocument.defaultView;
    win?.addEventListener("keydown", this.onModifier, true);
    win?.addEventListener("keyup", this.onModifier, true);
    win?.addEventListener("blur", this.clear);
  }

  destroy(): void {
    const win = this.host.ownerDocument.defaultView;
    win?.removeEventListener("keydown", this.onModifier, true);
    win?.removeEventListener("keyup", this.onModifier, true);
    win?.removeEventListener("blur", this.clear);
    this.host.classList.remove(this.className);
  }

  private readonly onModifier = (e: KeyboardEvent): void => {
    const held = accelHeld(e);
    if (held === this.held) return;
    this.held = held;
    this.host.classList.toggle(this.className, held);
  };

  private readonly clear = (): void => {
    if (!this.held) return;
    this.held = false;
    this.host.classList.remove(this.className);
  };
}
