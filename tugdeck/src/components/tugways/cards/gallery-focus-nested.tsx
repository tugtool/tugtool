/**
 * GalleryFocusNested — proof of Enter-descend / Escape-ascend over scopes ([P02]).
 *
 * An outer item-container declares a key-view *behavior*: arrows move a cursor
 * over its items; one item ("Has content") is descendable. The engine's act
 * dispatch ([P01]) resolves the keys against that declaration:
 *
 *  - **Enter on the descendable item → descend:** the component pushes a focus
 *    scope and lands the key view on the inner button; the outer container gets
 *    `data-key-within` (the engine's visible :focus-within, depth 1);
 *  - **Space/Enter on the inner button → act:** a plain leaf act (the counter
 *    increments) — leaf act-consistency, unchanged by the engine;
 *  - **Escape → ascend:** the engine pops the scope and restores the key view to
 *    the outer container; `data-key-within` clears.
 *
 * The card pushes a **trapped focus scope** (`useFocusTrap`) so Tab is bounded to
 * this card and seeds first-focus on entry; the inner button registers into its
 * own pushed scope, so it is unreachable until the user descends.
 *
 * Laws: [L06] cursor/within/ring are appearance (DOM); [L03] trap/seed in layout
 * effects; [L19] gallery-card.
 */

import "./gallery.css";

import React from "react";

import { FocusModeContext } from "@/components/tugways/focus-manager";
import { useFocusable, useFocusManager } from "@/components/tugways/use-focusable";
import { useFocusCursor } from "@/components/tugways/use-focus-cursor";
import { useFocusTrap } from "@/components/tugways/use-focus-trap";
import { TugLabel } from "@/components/tugways/tug-label";

const ITEMS = ["Plain item", "Has content"];
const DESCENDABLE_INDEX = 1;

export function GalleryFocusNested(): React.ReactElement {
  const manager = useFocusManager();
  const { FocusModeScope } = useFocusTrap({ active: true, trapped: true });
  const seededRef = React.useRef(false);
  React.useLayoutEffect(() => {
    if (manager === null || seededRef.current) return;
    if (manager.focusFirstInMode() !== null) {
      manager.focusKeyView();
      seededRef.current = true;
    }
  });

  return (
    <FocusModeScope>
      <FocusNestedContent />
    </FocusModeScope>
  );
}

function FocusNestedContent(): React.ReactElement {
  const manager = useFocusManager();
  const cursor = useFocusCursor();
  const itemRefs = React.useRef<Array<Element | null>>([]);
  const groupElRef = React.useRef<HTMLDivElement | null>(null);

  const outerId = React.useId();
  const innerScopeId = `${outerId}-inner-scope`;
  const innerButtonId = `${outerId}-inner-button`;

  const [count, setCount] = React.useState(0);

  const syncItems = React.useCallback(() => {
    cursor.setItems(itemRefs.current);
  }, [cursor]);

  const behavior = React.useCallback(() => {
    return {
      container: "item" as const,
      commit: "deferred" as const,
      currentItemDescendable: cursor.cursorIndex() === DESCENDABLE_INDEX,
      onDescend: () => {
        if (manager === null) return;
        manager.pushFocusMode(innerScopeId, { trapped: false });
        manager.setKeyView(innerButtonId, true);
        manager.focusKeyView();
      },
    };
  }, [cursor, manager, innerScopeId, innerButtonId]);

  const { focusableRef } = useFocusable({
    id: outerId,
    group: "gallery-focus-nested",
    order: 0,
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
        default:
          break;
      }
    },
    [cursor],
  );

  const innerButton = useFocusable({
    id: innerButtonId,
    group: "gallery-focus-nested-inner",
    order: 0,
    register: true,
  });

  // A peer top-level component (in the card scope, order 1) so Tab-between is
  // testable: Tab cycles [outer list, peer button] within the trapped card.
  const peerId = React.useId();
  const peer = useFocusable({
    id: peerId,
    group: "gallery-focus-nested",
    order: 1,
    register: true,
  });
  const [peerCount, setPeerCount] = React.useState(0);

  return (
    <div className="cg-content" data-testid="gallery-focus-nested">
      <div className="cg-section" data-testid="focus-nested-demo">
        <TugLabel className="cg-section-title" data-testid="focus-nested-title">
          Descend / ascend — Enter descends, Escape ascends
        </TugLabel>
        <div
          ref={setGroupRef}
          tabIndex={0}
          role="listbox"
          aria-label="Nested focus demo"
          data-testid="focus-nested-outer"
          onKeyDown={onKeyDown}
          style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "4px", borderRadius: "8px" }}
        >
          {ITEMS.map((label, index) => (
            <div
              key={label}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              role="option"
              aria-selected={false}
              data-nested-item={index}
              style={{ padding: "6px 10px", borderRadius: "6px", fontSize: "0.875rem" }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Peer top-level component — Tab moves the ring here from the outer
            list (and back); it is a leaf, so Space/Enter act on it natively. */}
        <button
          ref={(el) => peer.focusableRef(el)}
          type="button"
          data-testid="focus-nested-peer-button"
          data-count={peerCount}
          onClick={() => setPeerCount((c) => c + 1)}
          style={{ marginTop: "8px" }}
        >
          Peer button (count: {peerCount})
        </button>

        {/* Inner content lives in the pushed scope's mode — reachable only once
            the user descends with Enter. */}
        <FocusModeContext.Provider value={innerScopeId}>
          <div style={{ marginTop: "8px", padding: "8px", border: "1px dashed gray", borderRadius: "8px" }}>
            <button
              ref={(el) => innerButton.focusableRef(el)}
              type="button"
              data-testid="focus-nested-inner-button"
              data-count={count}
              onClick={() => setCount((c) => c + 1)}
            >
              Inner action (count: {count})
            </button>
          </div>
        </FocusModeContext.Provider>
      </div>
    </div>
  );
}
