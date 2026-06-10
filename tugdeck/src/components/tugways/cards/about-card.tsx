/**
 * about-card.tsx — About box (app-level singleton card).
 *
 * An Apple-style About box: app icon tile, wordmark, version + build,
 * build diagnostics (profile · branch, commit), and copyright. All
 * identity comes from {@link appInfoStore}, populated by the Swift
 * host's `show-card` payload; with no host (browser-only dev) every
 * field renders an em-dash placeholder.
 *
 * Shown via the app menu's About Tug item, which routes through
 * `DeckManager.showSingletonCard("about")` — at most one About card
 * exists at a time.
 *
 * Laws: external state enters through `useSyncExternalStore` [L02];
 * layout/appearance live in about-card.css [L06].
 *
 * @module components/tugways/cards/about-card
 */

import React, { useSyncExternalStore } from "react";
import { Ship } from "lucide-react";
import { registerCard } from "@/card-registry";
import { appInfoStore } from "@/lib/app-info-store";
import "./about-card.css";

const PLACEHOLDER = "—";

/** Shorten a full SHA to the conventional 8-character display form. */
function shortCommit(commit: string | undefined): string {
  if (!commit) return PLACEHOLDER;
  return commit.slice(0, 8);
}

export function AboutCardContent() {
  const info = useSyncExternalStore(
    appInfoStore.subscribe,
    appInfoStore.getSnapshot,
  );

  const version = info?.version ?? PLACEHOLDER;
  const build = info?.build ?? PLACEHOLDER;
  const profile = info?.profile ?? PLACEHOLDER;
  const branch = info?.branch ?? PLACEHOLDER;
  const copyright = info?.copyright ?? PLACEHOLDER;

  return (
    <div className="about-card" data-testid="about-card">
      {info?.icon ? (
        <img
          className="about-card-icon-image"
          src={info.icon}
          alt=""
          aria-hidden="true"
          data-testid="about-card-icon"
        />
      ) : (
        <div className="about-card-icon" aria-hidden="true">
          <Ship size={40} strokeWidth={1.5} />
        </div>
      )}
      <h1 className="about-card-name">Tug</h1>
      <p className="about-card-version" data-testid="about-card-version">
        Version {version} ({build})
      </p>
      <p className="about-card-detail">
        {profile} · {branch}
      </p>
      <p className="about-card-detail about-card-commit">
        {shortCommit(info?.commit)}
      </p>
      <p className="about-card-copyright">{copyright}</p>
    </div>
  );
}

/**
 * Register the About card. The fixed size policy (`min == max ==
 * preferred`) makes the pane non-resizable — an About box has exactly
 * one correct size — and `placement: "center"` opens it centered in
 * the canvas like a dialog. `hidden` keeps it out of the type-picker
 * `[+]` menu: it is reachable only through the app menu.
 */
export function registerAboutCard(): void {
  registerCard({
    componentId: "about",
    contentFactory: () => <AboutCardContent />,
    defaultMeta: { title: "About Tug", closable: true },
    hidden: true,
    placement: "center",
    sizePolicy: {
      min: { width: 320, height: 360 },
      max: { width: 320, height: 360 },
      preferred: { width: 320, height: 360 },
    },
  });
}
