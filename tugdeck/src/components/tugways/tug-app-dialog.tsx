/**
 * TugAppDialog — reusable, content-flexible app-modal dialog.
 *
 * The declarative, store-driven sibling of {@link TugAlert}: both compose Radix
 * `AlertDialog` portalled into the canvas-overlay root (`useCanvasOverlay`), so
 * they share the app-modal mechanism and chrome. TugAlert owns the imperative
 * confirm/cancel Promise flow; TugAppDialog owns a `open`-controlled dialog
 * with caller-supplied content (`icon`, `title`, body `children`) and a free
 * `footer` slot for actions or status. Use it for app-wide gates and notices
 * that aren't a yes/no question — e.g. the Claude sign-in gate.
 *
 * Non-dismissable by default: there is no Cancel, outside-click is ignored
 * (AlertDialog semantics), and Escape is suppressed. Visibility is owned
 * entirely by the `open` prop, which a caller drives from a store. A required
 * gate should never be closable out from under its own requirement.
 *
 * Laws: composes Radix AlertDialog like TugAlert ([L19]); pure render of the
 * `open` prop, no effects ([L02]). Tokens are component-scoped `--tugx-app-
 * dialog-*` aliases resolving one-hop to `--tug7-*` ([L17], [L20]).
 */

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { type ReactElement, type ReactNode } from "react";
import { useCanvasOverlay } from "@/lib/use-canvas-overlay";
import "./tug-app-dialog.css";

export interface TugAppDialogProps {
  /** Whether the dialog is shown. The caller owns this (store-driven). */
  open: boolean;
  /** Optional decorative glyph rendered above the title. */
  icon?: ReactNode;
  /** Dialog title (required for the accessible name). */
  title: string;
  /** Body content rendered under the title. */
  children?: ReactNode;
  /** Footer slot for actions or status (a button, a progress indicator…). */
  footer?: ReactNode;
}

export function TugAppDialog({
  open,
  icon,
  title,
  children,
  footer,
}: TugAppDialogProps): ReactElement {
  const overlayRoot = useCanvasOverlay();
  return (
    <AlertDialog.Root open={open}>
      <AlertDialog.Portal container={overlayRoot}>
        <AlertDialog.Overlay className="tug-app-dialog-overlay" />
        <AlertDialog.Content
          className="tug-app-dialog-content"
          data-slot="tug-app-dialog"
          // Suppress Radix's Escape close — a required gate owns its own
          // visibility via `open`.
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          {icon !== undefined && (
            <div className="tug-app-dialog-icon" aria-hidden="true">
              {icon}
            </div>
          )}
          <AlertDialog.Title className="tug-app-dialog-title">
            {title}
          </AlertDialog.Title>
          {children !== undefined && (
            <AlertDialog.Description asChild>
              <div className="tug-app-dialog-body">{children}</div>
            </AlertDialog.Description>
          )}
          {footer !== undefined && (
            <div className="tug-app-dialog-footer">{footer}</div>
          )}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
