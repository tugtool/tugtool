/**
 * TugSheet — Card-modal dialog scoped to a single card.
 *
 * Original component (not a Radix wrapper). Drops from the card title bar
 * like a window shade. Uses Radix FocusScope for focus trapping. Card body
 * gets `inert` attribute for card-scoped blocking. Other cards remain
 * fully interactive.
 *
 * Compound API: TugSheet (Root) / TugSheetTrigger / TugSheetContent.
 * Portals into the card root element via TugcardPortalContext.
 *
 * Laws: [L06] appearance via CSS, [L16] pairings declared, [L19] component authoring guide,
 *       [L20] token sovereignty (composes child controls)
 */

import "./tug-sheet.css";

import React, {
  createContext,
  useCallback,
  useContext,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import * as FocusScopeRadix from "@radix-ui/react-focus-scope";
import { TugcardPortalContext } from "./tug-card";
import { group } from "@/components/tugways/tug-animator";

/* ---------------------------------------------------------------------------
 * Internal context
 * ---------------------------------------------------------------------------*/

interface TugSheetContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentId: string;
}

const TugSheetContext = createContext<TugSheetContextValue | null>(null);

function useTugSheetContext(): TugSheetContextValue {
  const ctx = useContext(TugSheetContext);
  if (!ctx) {
    throw new Error("TugSheet sub-components must be used within <TugSheet>.");
  }
  return ctx;
}

/* ---------------------------------------------------------------------------
 * TugSheetHandle
 * ---------------------------------------------------------------------------*/

/** Imperative handle for TugSheet. */
export interface TugSheetHandle {
  /** Opens the sheet. */
  open(): void;
  /** Closes the sheet. */
  close(): void;
}

/* ---------------------------------------------------------------------------
 * TugSheet (Root)
 * ---------------------------------------------------------------------------*/

/** TugSheet root props. */
export interface TugSheetProps {
  /**
   * Controlled open state.
   * @selector [data-state="open"] | [data-state="closed"]
   */
  open?: boolean;
  /** Open state callback. */
  onOpenChange?: (open: boolean) => void;
  /** Trigger + Content children. */
  children: React.ReactNode;
}

/**
 * TugSheet root — manages open/close state and provides context.
 *
 * Compose with TugSheetTrigger and TugSheetContent:
 * ```tsx
 * <TugSheet>
 *   <TugSheetTrigger asChild><TugPushButton>Open</TugPushButton></TugSheetTrigger>
 *   <TugSheetContent title="Settings">…</TugSheetContent>
 * </TugSheet>
 * ```
 */
export const TugSheet = React.forwardRef<TugSheetHandle, TugSheetProps>(
  function TugSheet({ open: openProp, onOpenChange, children }, ref) {
    const [internalOpen, setInternalOpen] = useState(false);
    const contentId = useId();

    const isOpen = openProp !== undefined ? openProp : internalOpen;

    const handleOpenChange = useCallback(
      (next: boolean) => {
        if (openProp === undefined) {
          setInternalOpen(next);
        }
        onOpenChange?.(next);
      },
      [openProp, onOpenChange],
    );

    useImperativeHandle(ref, () => ({
      open() {
        handleOpenChange(true);
      },
      close() {
        handleOpenChange(false);
      },
    }));

    return (
      <TugSheetContext value={{ open: isOpen, onOpenChange: handleOpenChange, contentId }}>
        {children}
      </TugSheetContext>
    );
  },
);

/* ---------------------------------------------------------------------------
 * TugSheetTrigger
 * ---------------------------------------------------------------------------*/

/** TugSheetTrigger props. */
export interface TugSheetTriggerProps {
  /**
   * Render as child element, merging ARIA + click handler onto it.
   * @default true
   */
  asChild?: boolean;
  children: React.ReactNode;
}

/**
 * TugSheetTrigger — wraps a single child, merging ARIA attributes and open handler.
 *
 * Defaults to asChild so the caller's element is used directly.
 */
export function TugSheetTrigger({ asChild = true, children }: TugSheetTriggerProps) {
  const { open, onOpenChange, contentId } = useTugSheetContext();

  if (!asChild) {
    return (
      <button
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? contentId : undefined}
        onClick={() => onOpenChange(true)}
      >
        {children}
      </button>
    );
  }

  // asChild: merge props onto the single child element.
  const child = React.Children.only(children) as React.ReactElement<
    React.HTMLAttributes<HTMLElement> & {
      "aria-haspopup"?: string;
      "aria-expanded"?: boolean;
      "aria-controls"?: string;
    }
  >;

  return React.cloneElement(child, {
    "aria-haspopup": "dialog",
    "aria-expanded": open,
    "aria-controls": open ? contentId : undefined,
    onClick: (e: React.MouseEvent) => {
      // Call original onClick if present.
      const original = child.props.onClick as ((e: React.MouseEvent) => void) | undefined;
      original?.(e);
      onOpenChange(true);
    },
  });
}

/* ---------------------------------------------------------------------------
 * TugSheetContent
 * ---------------------------------------------------------------------------*/

/** TugSheetContent props. */
export interface TugSheetContentProps {
  /**
   * Sheet title (required — renders in header row, wired to aria-labelledby).
   */
  title: string;
  /**
   * Optional description text (wired to aria-describedby).
   */
  description?: string;
  /**
   * Override initial focus target. Call event.preventDefault() to manage manually.
   */
  onOpenAutoFocus?: (event: Event) => void;
  /** Arbitrary content. */
  children?: React.ReactNode;
}

/**
 * TugSheetContent — the sheet panel, overlay, focus scope, and portal logic.
 *
 * Portals into the card root element (from TugcardPortalContext). Sets `inert`
 * on `.tugcard-body` for card-scoped modality. Restores focus to the trigger
 * element on close.
 */
export function TugSheetContent({
  title,
  description,
  onOpenAutoFocus,
  children,
}: TugSheetContentProps) {
  const { open, onOpenChange, contentId } = useTugSheetContext();
  const cardEl = useContext(TugcardPortalContext);

  const titleId = `${contentId}-title`;
  const descriptionId = `${contentId}-desc`;

  // Presence: keep the portal mounted during the exit animation.
  // `mounted` becomes true when open goes true, and false only after the exit animation completes.
  const [mounted, setMounted] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const sheetContentRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
    }
    // When open goes false, mounted stays true — exit animation will set it false.
  }, [open]);

  // Enter animation: runs after mount when open && mounted (DOM is present).
  useLayoutEffect(() => {
    if (!open || !mounted) return;
    const overlayEl = overlayRef.current;
    const contentEl = sheetContentRef.current;
    if (!overlayEl || !contentEl) return;

    const g = group({ duration: "--tug-motion-duration-moderate" });
    g.animate(overlayEl, [{ opacity: 0 }, { opacity: 1 }], { key: "sheet-overlay" });
    g.animate(contentEl, [{ transform: "translateY(-100%)" }, { transform: "translateY(0)" }], {
      key: "sheet-content",
      easing: "ease-out",
    });
  }, [open, mounted]);

  // Exit animation: runs when !open && mounted (DOM still present for animation).
  useLayoutEffect(() => {
    if (open || !mounted) return;
    const overlayEl = overlayRef.current;
    const contentEl = sheetContentRef.current;
    if (!overlayEl && !contentEl) {
      setMounted(false);
      return;
    }

    const g = group({ duration: "--tug-motion-duration-moderate" });
    if (overlayEl) {
      g.animate(overlayEl, [{ opacity: 1 }, { opacity: 0 }], { key: "sheet-overlay" });
    }
    if (contentEl) {
      g.animate(contentEl, [{ transform: "translateY(0)" }, { transform: "translateY(-100%)" }], {
        key: "sheet-content",
        easing: "ease-in",
      });
    }
    g.finished.then(() => {
      setMounted(false);
    }).catch(() => {
      // Animation interrupted — unmount anyway to avoid stuck state.
      setMounted(false);
    });
  }, [open, mounted]);

  // Dev warning: aria-labelledby requires a target.
  if (process.env.NODE_ENV !== "production" && !title) {
    console.warn("[TugSheetContent] `title` prop is required for aria-labelledby.");
  }

  // Track trigger element for focus restoration on close.
  const triggerElRef = useRef<Element | null>(null);

  // Inertness management: set/remove `inert` on .tugcard-body synchronized with open state [L03].
  useLayoutEffect(() => {
    if (!cardEl) return;
    const body = cardEl.querySelector(".tugcard-body");
    if (!body) return;

    if (open) {
      // Capture trigger before body becomes inert.
      triggerElRef.current = document.activeElement;
      body.setAttribute("inert", "");
    } else {
      body.removeAttribute("inert");
    }

    return () => {
      // Cleanup on unmount: always ensure inert is removed.
      body.removeAttribute("inert");
    };
  }, [open, cardEl]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" || (e.metaKey && e.key === ".")) {
      e.preventDefault();
      onOpenChange(false);
    }
  }

  function handleMountAutoFocus(e: Event) {
    if (onOpenAutoFocus) {
      onOpenAutoFocus(e);
    }
    // Default: allow FocusScope to focus first tabbable element (don't preventDefault).
  }

  function handleUnmountAutoFocus(e: Event) {
    // Restore focus to trigger element on close.
    if (triggerElRef.current && "focus" in triggerElRef.current) {
      e.preventDefault();
      (triggerElRef.current as HTMLElement).focus();
    }
  }

  if (!mounted || !cardEl) return null;

  return createPortal(
    <>
      {/* Overlay (scrim) — positioned absolute within the card, below title bar.
           No click-to-dismiss: sheets are card-modal and require explicit dismissal
           via Cancel button, Escape, or Cmd+.
           onPointerDown preventDefault stops the browser from clearing selection
           or moving focus — the scrim is a dead zone that swallows all pointer events. */}
      <div
        ref={overlayRef}
        className="tug-sheet-overlay"
        onPointerDown={(e) => e.preventDefault()}
      />

      {/* Clip container: overflow hidden at title bar edge so sheet
           visually emerges from UNDER the title bar, not above it */}
      <div className="tug-sheet-clip">
        {/* FocusScope wraps content to trap Tab/Shift-Tab */}
        <FocusScopeRadix.FocusScope
          trapped={open}
          loop
          onMountAutoFocus={handleMountAutoFocus}
          onUnmountAutoFocus={handleUnmountAutoFocus}
        >
          <div
            ref={sheetContentRef}
            id={contentId}
            className="tug-sheet-content"
            role="dialog"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            data-slot="tug-sheet"
            onKeyDown={handleKeyDown}
          >
          {/* Sheet header: title only — no close button, sheets dismiss via Cancel/Escape */}
          <div className="tug-sheet-header">
            <h2 id={titleId} className="tug-sheet-title">{title}</h2>
          </div>

          {/* Optional description */}
          {description && (
            <p id={descriptionId} className="tug-sheet-description">{description}</p>
          )}

          {/* Sheet body: arbitrary content */}
          <div className="tug-sheet-body">{children}</div>
        </div>
        </FocusScopeRadix.FocusScope>
      </div>
    </>,
    cardEl,
  );
}
