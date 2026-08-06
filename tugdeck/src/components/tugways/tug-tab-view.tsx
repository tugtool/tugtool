/**
 * TugTabView — vertical master/detail tab layout.
 *
 * A fixed set of named panels behind a sidebar list: the master column on the
 * left names the sections, the detail area on the right shows the selected
 * one. The macOS System Settings shape — a vertical tab layout, where the tab
 * strip is a list and the panels are pages, not a stack.
 *
 * **Only the selected panel exists.** An unselected `TugTabViewItem` renders
 * nothing, so a panel's stores are constructed when it is selected and torn
 * down when the selection leaves — the same lifecycle Radix gives accordion
 * content, without Radix.
 *
 * **The detail area owns the scroller.** The root fills its container and
 * never grows past it; the sidebar stays put while the detail scrolls, with
 * `scrollbar-gutter: stable` so the bar never lands on content. A host card
 * built on this fills its pane (`height: 100%`) rather than letting the
 * pane's own scroller run.
 *
 * Per [L11], TugTabView is a control: selecting a tab — by click or by the
 * keyboard cursor — dispatches `selectTab` through the responder chain, where
 * the enclosing surface's responder (typically a `useResponderForm`
 * `selectTab` binding) updates the selected value. The component is fully
 * controlled; it holds no selection state of its own.
 *
 * Keyboard ([P01]/[P02]/[P08]): the sidebar is a **single item-container
 * stop** in the engine's Tab walk when authored into a `focusGroup`. Tab
 * lands the container ring on the list with the cursor on the selected tab;
 * arrows move the cursor and **switch the panel live** (automatic
 * activation, the same contract as `TugTabBar`), so the cursor always rides
 * the selection.
 *
 * Laws: [L06] appearance via CSS and DOM attributes; [L11] controls emit
 * actions, responders handle them; [L16] pairings declared in the CSS; [L19]
 * component authoring guide.
 */

import "./tug-tab-view.css";

import React, {
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { cn } from "@/lib/utils";
import { useControlDispatch } from "./use-control-dispatch";
import { TUG_ACTIONS } from "./action-vocabulary";
import { useItemGroupKeyboard } from "./use-item-group-keyboard";
import type { FocusPolicy } from "./focus-manager";

// ---- Context ----

/**
 * Threads the selected value from `TugTabView` down to each `TugTabViewItem`,
 * which uses it to decide whether its panel exists at all.
 */
const TabViewValueContext = React.createContext<string>("");

// ---- Props ----

export interface TugTabViewProps {
  /**
   * The selected item's value (controlled — there is no uncontrolled mode).
   * @selector [data-state="open"] on the matching panel,
   *           [data-active="true"] on the matching tab
   */
  value: string;
  /**
   * Stable opaque sender id for chain dispatches. Auto-derived via `useId()`
   * if omitted. Parent responders disambiguate multiple tab views by matching
   * this id in their `selectTab` handler bindings. [L11]
   */
  senderId?: string;
  /** Additional CSS class names. */
  className?: string;
  /** TugTabViewItem children — one per section, in sidebar order. */
  children: React.ReactNode;

  // ---- Focus engine ([P01], [P02]) ----

  /**
   * Focus group the sidebar is authored into ([P02]). When set, the list
   * registers as a **single item-container stop** in the engine's Tab walk:
   * the container ring lands on the list, the cursor ring on the selected
   * tab, and arrows move the cursor **and switch the panel live** ([P08]).
   * When omitted, the tabs stay plain non-focusable buttons.
   */
  focusGroup?: string;
  /** Order within {@link focusGroup}. Defaults to 0. */
  focusOrder?: number;
  /**
   * Walk policy when registered: `accept` (default) is an ordinary Tab stop;
   * `skip` is reachable only in accessibility mode.
   */
  focusPolicy?: FocusPolicy;
}

export interface TugTabViewItemProps {
  /** Unique identifier for this item within the tab view. */
  value: string;
  /** Sidebar label for this item. */
  label: string;
  /** Optional sidebar icon, rendered before the label. */
  icon?: React.ReactNode;
  /**
   * Disables this item: its tab renders dimmed and unselectable, and the
   * keyboard cursor skips it.
   * @selector [data-disabled] on the tab
   * @default false
   */
  disabled?: boolean;
  /** Additional CSS class names for the panel element. */
  className?: string;
  /** Panel content, mounted only while this item is selected. */
  children: React.ReactNode;
  /** Forwarded to the panel element (e.g. `data-testid`). */
  [key: `data-${string}`]: string | undefined;
}

// ---- TugTabView ----

/**
 * The sidebar is built from the children's own props — each
 * `TugTabViewItem` declares its `value`/`label`/`icon` once and the root
 * reads them, so the tab and its panel can never disagree about what a
 * section is called.
 */
interface TabSpec {
  value: string;
  label: string;
  icon: React.ReactNode | undefined;
  disabled: boolean;
}

function collectTabSpecs(children: React.ReactNode): TabSpec[] {
  const specs: TabSpec[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<TugTabViewItemProps>(child)) return;
    const { value, label, icon, disabled } = child.props;
    if (typeof value !== "string" || typeof label !== "string") return;
    specs.push({ value, label, icon, disabled: disabled === true });
  });
  return specs;
}

export const TugTabView = React.forwardRef<HTMLDivElement, TugTabViewProps>(
  function TugTabView(
    {
      value,
      senderId,
      className,
      children,
      focusGroup,
      focusOrder = 0,
      focusPolicy,
    }: TugTabViewProps,
    ref,
  ) {
    const specs = collectTabSpecs(children);

    // Chain dispatch [L11]: every selection — click or cursor — goes through
    // the chain to the parent responder. Outside a provider it is a no-op.
    const { dispatch: controlDispatch } = useControlDispatch();
    const fallbackSenderId = useId();
    const effectiveSenderId = senderId ?? fallbackSenderId;
    const dispatchSelectTab = useCallback(
      (tabValue: string) => {
        controlDispatch({
          action: TUG_ACTIONS.SELECT_TAB,
          value: tabValue,
          sender: effectiveSenderId,
          phase: "discrete",
        });
      },
      [controlDispatch, effectiveSenderId],
    );

    // ---- Item-container keyboard ([P01], [P03]) — live commit ----
    //
    // One focusable id for the whole sidebar. The cursor traverses the
    // enabled tabs; every arrow move selects ([P08] automatic activation), so
    // the cursor rides the selection and never strands on an un-shown panel.
    const focusEngineActive = focusGroup !== undefined;
    const autoFocusId = useId();
    const listRef = useRef<HTMLDivElement | null>(null);

    const enabledTabs = useCallback((): HTMLElement[] => {
      const list = listRef.current;
      if (!list) return [];
      return Array.from(
        list.querySelectorAll<HTMLElement>("[data-tab-value]"),
      ).filter((el) => !(el as HTMLButtonElement).disabled);
    }, []);
    const valueOf = (el: Element | null): string =>
      el?.getAttribute("data-tab-value") ?? "";

    const { attachRoot, onKeyDown, syncItems, setCursor } = useItemGroupKeyboard({
      id: autoFocusId,
      group: focusGroup ?? "",
      order: focusOrder,
      policy: focusPolicy,
      register: focusEngineActive,
      commit: "live",
      collectItems: enabledTabs,
      initialIndex: () => {
        const i = enabledTabs().findIndex((el) => valueOf(el) === value);
        return i >= 0 ? i : 0;
      },
      // Live ([P08]): every arrow move selects; Space/Enter re-affirm.
      onMove: (element) => {
        const v = valueOf(element);
        if (v) dispatchSelectTab(v);
      },
      onSelect: (element) => {
        const v = valueOf(element);
        if (v) dispatchSelectTab(v);
      },
    });

    // Keep the cursor's range current as the items or the selection change.
    useLayoutEffect(() => {
      if (focusEngineActive) syncItems();
    }, [focusEngineActive, specs.length, value, syncItems]);

    const setListRef = useCallback(
      (el: HTMLDivElement | null) => {
        listRef.current = el;
        attachRoot(el);
      },
      [attachRoot],
    );

    // Click selects the tab and parks the cursor on it, so a following arrow
    // continues from the clicked tab.
    const handleTabClick = useCallback(
      (tabValue: string) => {
        const idx = enabledTabs().findIndex((el) => valueOf(el) === tabValue);
        if (idx >= 0) setCursor(idx);
        dispatchSelectTab(tabValue);
      },
      [enabledTabs, setCursor, dispatchSelectTab],
    );

    return (
      <div
        ref={ref}
        className={cn("tug-tab-view", className)}
        data-slot="tug-tab-view"
      >
        <div
          ref={setListRef}
          className="tug-tab-view-list"
          role="tablist"
          aria-orientation="vertical"
          data-testid="tug-tab-view-list"
          tabIndex={focusEngineActive ? 0 : undefined}
          onKeyDown={focusEngineActive ? onKeyDown : undefined}
        >
          {specs.map((spec) => (
            <button
              key={spec.value}
              type="button"
              role="tab"
              className="tug-tab-view-tab"
              data-tab-value={spec.value}
              data-active={spec.value === value ? "true" : undefined}
              data-testid={`tug-tab-view-tab-${spec.value}`}
              aria-selected={spec.value === value}
              disabled={spec.disabled}
              tabIndex={-1}
              data-tug-focus="refuse"
              onClick={() => handleTabClick(spec.value)}
            >
              {spec.icon !== undefined && (
                <span className="tug-tab-view-tab-icon" aria-hidden="true">
                  {spec.icon}
                </span>
              )}
              <span className="tug-tab-view-tab-label">{spec.label}</span>
            </button>
          ))}
        </div>
        <div className="tug-tab-view-detail">
          <TabViewValueContext.Provider value={value}>
            {children}
          </TabViewValueContext.Provider>
        </div>
      </div>
    );
  },
);

// ---- TugTabViewItem ----

/**
 * One section of a `TugTabView`: a sidebar entry (declared by props, rendered
 * by the parent) plus the panel it opens. Renders `null` while unselected —
 * the panel's subtree does not exist until the section is chosen.
 */
export function TugTabViewItem({
  value,
  label: _label,
  icon: _icon,
  disabled: _disabled,
  className,
  children,
  ...rest
}: TugTabViewItemProps) {
  const selected = useContext(TabViewValueContext);
  if (selected !== value) return null;
  return (
    <div
      role="tabpanel"
      data-slot="tug-tab-view-panel"
      data-state="open"
      className={cn("tug-tab-view-panel", className)}
      {...rest}
    >
      {children}
    </div>
  );
}
