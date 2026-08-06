/**
 * settings-card.tsx — Settings card (app-level singleton).
 *
 * A single card hosting the app's preference groups, stacked in one
 * `TugAccordion` rather than hidden behind a tab strip. Shown via the app
 * menu's Settings… item (⌘,), which routes through
 * `DeckManager.showSingletonCard("settings")` — at most one Settings card
 * exists at a time.
 *
 * Its pane is placed, sized, and imposed like any other card's: it cascades on
 * open and takes a slot under an imposition. Settings is a surface the user
 * arranges alongside the work it is about, not a modal to be dismissed.
 *
 * The card grows to its content and lets the pane scroll it, so the scroll
 * offset persists into the card-state bag for free. What is persisted about
 * the sections themselves is the **collapsed** set (see
 * `lib/settings-sections-pref.ts`), so a fresh profile opens with everything
 * expanded.
 *
 * **A collapsed section's body does not exist.** Radix unmounts closed
 * `Accordion.Content`, so a body's stores are constructed when its section
 * opens and torn down when it closes — live propagation and the model chips'
 * turn-lock hold only while that section is open. Conversely, all-expanded
 * means a first open constructs all four bodies at once, including the Maker
 * body's `getSettings` bridge call. Both are intended.
 *
 * The keymap configurator is not here. It is a `TugListView`, which needs a
 * container with a definite height, and this card deliberately has none — it
 * lives in the Keyboard Shortcuts card (`keyboard-card.tsx`), reachable from
 * the app menu and the Lens.
 *
 * Laws: the collapsed set is external state read through `useTugbankValue`
 * ([L02] via `useSyncExternalStore`); the accordion dispatches
 * `toggleSectionMulti` through the chain to this card's responder scope
 * ([L11] via `useResponderForm`); layout lives in settings-card.css [L06].
 *
 * @module components/tugways/cards/settings-card
 */

import React, { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FileText, MessageSquareText, Settings2, Wrench } from "lucide-react";
import { registerCard } from "@/card-registry";
import { TugAccordion, TugAccordionItem } from "@/components/tugways/tug-accordion";
import { useResponderForm } from "@/components/tugways/use-responder-form";
import {
  SETTINGS_SECTION_IDS,
  useSettingsCollapsedSections,
  type SettingsSectionId,
} from "@/lib/settings-sections-pref";
import { registerSettingsRevealConsumer } from "@/lib/settings-reveal";
import { SettingsSessionCardBody } from "./settings-session-card-body";
import { SettingsTextCardBody } from "./settings-text-card-body";
import { SettingsAppBody } from "./settings-app-body";
import { SettingsGeneralBody } from "./settings-general-body";
import "./settings-card.css";

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

interface SettingsSectionSpec {
  readonly id: SettingsSectionId;
  readonly label: string;
  /** Distinct per-section lucide icon, rendered in the trigger. */
  readonly Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  readonly Body: React.ComponentType;
}

const SECTIONS: readonly SettingsSectionSpec[] = [
  // "General" wears a sliders icon for app-wide preferences; "Session Card"
  // wears the session card's own icon; "Text Card" a file icon; "Advanced" a
  // tool icon for the settings that change how the app itself runs.
  { id: "general", label: "General", Icon: Settings2, Body: SettingsGeneralBody },
  {
    id: "sessionCard",
    label: "Session Card",
    Icon: MessageSquareText,
    Body: SettingsSessionCardBody,
  },
  { id: "textCard", label: "Text Card", Icon: FileText, Body: SettingsTextCardBody },
  { id: "app", label: "Advanced", Icon: Wrench, Body: SettingsAppBody },
];

function SectionTrigger({ spec }: { spec: SettingsSectionSpec }) {
  const { Icon, label } = spec;
  return (
    <span className="settings-card-trigger">
      <Icon size={16} strokeWidth={2} />
      <span className="settings-card-trigger-label">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// SettingsCardContent
// ---------------------------------------------------------------------------

export function SettingsCardContent() {
  const { collapsed, setCollapsed } = useSettingsCollapsedSections();

  // Sections a reveal has forced open, held only for this card's lifetime —
  // the persisted collapsed set is never written by a reveal, so the reader's
  // own arrangement comes back on the next plain open ([L24] local-data).
  const [override, setOverride] = useState<readonly SettingsSectionId[]>([]);

  // Radix's controlled `value` is the OPEN set, while what is stored is the
  // collapsed one. `useTugbankValue` keeps its parsed snapshot
  // reference-stable, so memoize the inversion rather than handing Radix a
  // fresh array identity on every render.
  const open = useMemo(
    () =>
      SETTINGS_SECTION_IDS.filter(
        (id) => !collapsed.includes(id) || override.includes(id),
      ),
    [collapsed, override],
  );

  const rootRef = useRef<HTMLDivElement | null>(null);

  // A reveal opens the section (transiently) and brings its trigger into view.
  // Per `tuglaws/scroll-intent.md` the scroller scrolls itself: the pane's
  // `.tug-pane-content` is this card's scroller, and `scrollIntoView` on the
  // trigger is the request it answers.
  const reveal = useCallback((section: SettingsSectionId) => {
    setOverride((prev) => (prev.includes(section) ? prev : [...prev, section]));
    const trigger = rootRef.current?.querySelector(
      `[data-testid="settings-section-${section}"] .tug-accordion-trigger`,
    );
    trigger?.scrollIntoView({ block: "nearest" });
  }, []);

  // [L03]: register in a layout effect so a request parked before this card
  // mounted is flushed before paint; [L27] the registration returns its
  // unregister.
  useLayoutEffect(() => registerSettingsRevealConsumer(reveal), [reveal]);

  // The accordion dispatches `toggleSectionMulti` through the chain to this
  // responder; the handler inverts the open set back to a collapsed one.
  const accordionSenderId = useId();
  const { ResponderScope, responderRef } = useResponderForm({
    toggleSectionMulti: {
      [accordionSenderId]: (next: string[]) => {
        setCollapsed(SETTINGS_SECTION_IDS.filter((id) => !next.includes(id)));
        // The reader has spoken about these sections, so the reveal's
        // override stops standing in for them.
        setOverride((prev) => prev.filter((id) => next.includes(id)));
      },
    },
  });

  // One item-container focus stop: Up/Down roves the headers, Space toggles,
  // Enter descends into a section's content.
  const focusGroup = useId();

  // The root is both the responder scope's element and the node a reveal
  // queries for its section trigger.
  const setRoot = useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      (responderRef as (node: HTMLDivElement | null) => void)(el);
    },
    [responderRef],
  );

  return (
    <ResponderScope>
      <div
        className="settings-card"
        data-testid="settings-card"
        ref={setRoot}
      >
        <TugAccordion
          type="multiple"
          variant="plain"
          value={[...open]}
          senderId={accordionSenderId}
          focusGroup={focusGroup}
          focusOrder={0}
          className="settings-card-sections"
        >
          {SECTIONS.map((spec) => (
            <TugAccordionItem
              key={spec.id}
              value={spec.id}
              trigger={<SectionTrigger spec={spec} />}
              data-testid={`settings-section-${spec.id}`}
            >
              <spec.Body />
            </TugAccordionItem>
          ))}
        </TugAccordion>
      </div>
    </ResponderScope>
  );
}

// ---------------------------------------------------------------------------
// registerSettingsCard
// ---------------------------------------------------------------------------

/**
 * Register the Settings card. `hidden` keeps it out of the type-picker
 * `[+]` menu: it is reachable only through the app menu (⌘,).
 */
export function registerSettingsCard(): void {
  registerCard({
    componentId: "settings",
    contentFactory: () => <SettingsCardContent />,
    defaultMeta: { title: "Settings", icon: "Settings", closable: true },
    hidden: true,
    sizePolicy: {
      // The session card's envelope. Four expanded sections are taller than
      // any window, so the card scrolls by design; the room is what keeps the
      // scrolling from being the whole experience.
      min: { width: 800, height: 600 },
      preferred: { width: 800, height: 1200 },
    },
  });
}
