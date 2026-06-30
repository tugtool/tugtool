/**
 * TugVersionGate — the app-wide, blocking "update macOS" gate. A sibling of
 * {@link TugSetup} at the deck root that reuses the same TugAlert chrome (Radix
 * AlertDialog portalled into the canvas overlay, `tug-alert-overlay`/
 * `tug-alert-content` at z 99990/99991). It opens only when the host macOS
 * version is *known* to be below its line's floor ([P05], Spec S02); above the
 * floor — or while the host is still unknown (pre-handshake) — it renders
 * nothing and the deck/TugSetup proceed.
 *
 * Precedence: the gate wins over TugSetup. Both read `useVersionGateOpen`, and
 * TugSetup suppresses its own `open` while the gate is open, so the two
 * app-modals never stack (Spec S02).
 *
 * No dismiss — like TugSetup, this is strictly required. Pure read of
 * `hostInfoStore` via the gate derivation ([L02]).
 */

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { type ReactElement } from "react";
import { useCanvasOverlay } from "@/lib/use-canvas-overlay";
import { useHostInfo } from "@/lib/host-info-store";
import { useVersionGateOpen, requiredMinimumLabel } from "@/lib/macos-support";
import "./tug-alert.css";
import "./tug-version-gate.css";

export function TugVersionGate(): ReactElement {
  const open = useVersionGateOpen();
  const host = useHostInfo();
  const overlayRoot = useCanvasOverlay();
  const required = requiredMinimumLabel(host);

  return (
    <AlertDialog.Root open={open}>
      <AlertDialog.Portal container={overlayRoot}>
        <AlertDialog.Overlay className="tug-alert-overlay" />
        <AlertDialog.Content
          className="tug-alert-content tug-version-gate"
          data-slot="tug-version-gate"
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <AlertDialog.Title className="tug-version-gate-title">
            Update macOS to continue
          </AlertDialog.Title>
          <AlertDialog.Description className="tug-version-gate-body" asChild>
            <div>
              <p>
                Tug needs macOS {required} or later.
                {host !== null
                  ? ` This Mac is running macOS ${host.version}.`
                  : ""}
              </p>
              <p className="tug-version-gate-hint">
                Update in System Settings → General → Software Update, then
                reopen Tug.
              </p>
            </div>
          </AlertDialog.Description>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
