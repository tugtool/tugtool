/**
 * GalleryFocusStates — proof of the three keyboard visual states ([P03]) plus
 * Space/Enter selection, with TWO lists so Tab-between-components is testable.
 *
 *  - each list registers ONE focus stop (`useFocusable`); **Tab moves the ring
 *    between the two lists** (the components), never onto an item;
 *  - arrows move a **movement cursor** (`useFocusCursor` → `data-key-cursor`)
 *    over the items of the focused list — appearance, mutated as DOM with no
 *    re-render ([L06]/[L22]);
 *  - **Space / Enter select** the current row (`data-selected`, accent) — the
 *    committed selection, distinct from the cursor and the ring.
 *
 * The card pushes a **trapped focus scope** (`useFocusTrap`) so Tab is bounded to
 * this card's two lists, and seeds the key view onto the first list on entry
 * (`focusFirstInMode`) — no stray tabs into app chrome while the model is in
 * development.
 *
 * Laws: [L06] cursor/ring are appearance (DOM), selection is data → attribute →
 * CSS; [L03] trap/seed/registration in layout effects; [L22] cursor projection
 * observes the manager and writes DOM directly; [L24] cursor=appearance,
 * selection=local data, scope=structure; [L26] stable child keys + refs;
 * [L19] gallery-card authoring.
 */

import "./gallery.css";
import "./gallery-focus.css";

import React from "react";

import { useFocusable, useFocusManager } from "@/components/tugways/use-focusable";
import { useFocusCursor } from "@/components/tugways/use-focus-cursor";
import { useFocusTrap } from "@/components/tugways/use-focus-trap";
import { TugLabel } from "@/components/tugways/tug-label";

const LISTS = [
  { key: "a", label: "List A", items: ["Alpha", "Bravo", "Charlie", "Delta", "Echo"] },
  { key: "b", label: "List B", items: ["Foxtrot", "Golf", "Hotel", "India"] },
];

export function GalleryFocusStates(): React.ReactElement {
  // Bound the Tab loop to this card's two lists ([#cfrunloop-model] trapped
  // scope), so entering the card is one predictable Tab to List A and Tab
  // cycles only the in-card lists — no stray tabs into app chrome. (Auto-
  // focusing the first list with zero tabs would require the card to be a
  // responder so the deck's activation seed doesn't clear it; out of scope for
  // a focusable-only demo card.)
  const { FocusModeScope } = useFocusTrap({ active: true, trapped: true });

  return (
    <FocusModeScope>
      <div className="cg-content" data-testid="gallery-focus-states">
        <TugLabel className="cg-section-title" data-testid="focus-states-title">
          Three visual states — Tab between lists, arrows move the cursor, Space/Enter selects
        </TugLabel>
        {LISTS.map((list, index) => (
          <FocusList key={list.key} index={index} label={list.label} items={list.items} />
        ))}
      </div>
    </FocusModeScope>
  );
}

function FocusList({
  index,
  label,
  items,
}: {
  index: number;
  label: string;
  items: readonly string[];
}): React.ReactElement {
  const groupId = React.useId();
  const manager = useFocusManager();
  const cursor = useFocusCursor();
  const itemRefs = React.useRef<Array<Element | null>>([]);
  const groupElRef = React.useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = React.useState<number | null>(null);

  const syncItems = React.useCallback(() => {
    cursor.setItems(itemRefs.current);
  }, [cursor]);

  // Space and Enter both commit the current cursor row as the selection (a plain
  // item-group has no descend, so Enter activates = select).
  const behavior = React.useCallback(
    () => ({
      container: "item" as const,
      commit: "deferred" as const,
      onSelect: () => setSelected(cursor.cursorIndex()),
      onAct: () => setSelected(cursor.cursorIndex()),
    }),
    [cursor],
  );

  const { focusableRef } = useFocusable({
    id: groupId,
    group: "gallery-focus-states",
    order: index,
    register: true,
    behavior,
  });

  const setGroupRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      groupElRef.current = el;
      focusableRef(el);
    },
    [focusableRef],
  );

  // The cursor is keyboard-only and tracks the key view (not DOM focus): land it
  // on the first item when this list becomes the keyboard key view, clear it when
  // the key view leaves. Appearance-only — the manager notifies after stamping
  // the DOM ([L22]).
  const wasKbdRef = React.useRef(false);
  React.useLayoutEffect(() => {
    if (manager === null) return;
    const onChange = () => {
      const el = groupElRef.current;
      if (el === null) return;
      const kbd = el.hasAttribute("data-key-view-kbd");
      if (kbd && !wasKbdRef.current) {
        syncItems();
        cursor.setCursor(0);
      } else if (!kbd && wasKbdRef.current) {
        cursor.clear();
      }
      wasKbdRef.current = kbd;
    };
    const unsubscribe = manager.subscribe(onChange);
    onChange();
    return unsubscribe;
  }, [manager, cursor, syncItems]);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case "ArrowDown":
        case "ArrowRight":
          event.preventDefault();
          cursor.moveCursor(1);
          break;
        case "ArrowUp":
        case "ArrowLeft":
          event.preventDefault();
          cursor.moveCursor(-1);
          break;
        case "Home":
          event.preventDefault();
          cursor.setCursor(0);
          break;
        case "End":
          event.preventDefault();
          cursor.setCursor(items.length - 1);
          break;
        default:
          break;
      }
    },
    [cursor, items.length],
  );

  return (
    <div className="cg-section" data-testid="focus-states-demo" data-list-index={index}>
      <TugLabel className="cg-section-title">{label}</TugLabel>
      <div
        ref={setGroupRef}
        tabIndex={0}
        role="listbox"
        aria-label={label}
        data-testid="focus-states-group"
        data-list-index={index}
        onKeyDown={onKeyDown}
        style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "4px", borderRadius: "8px" }}
      >
        {items.map((item, i) => (
          <div
            key={item}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            className="cg-focus-row"
            role="option"
            aria-selected={selected === i}
            data-cursor-item={i}
            data-selected={selected === i ? "true" : undefined}
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
