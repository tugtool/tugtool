/**
 * gallery-session-identity.tsx — the session-reference design spike.
 *
 * The brief is `roadmap/session-reference-brief.md`: one identity model
 * (callsign / title / context / plumbing), one resolver, one component —
 * `TugSessionIdentity` — rendered at four density tiers, plus a text-only
 * citation form and a fork-lineage grammar. This card auditions the visual
 * decisions that brief left open.
 *
 * The card's organizing distinction, from the first review round: PRESENCE
 * vs CITATION. A surface that IS the session — its own masthead, the row
 * about to become it — renders the callsign as typography: the session
 * icon (the chatbox, the app's existing session mark), bold sans, no
 * enclosure. A surface that REFERS to a session from foreign context — a
 * Gazette post, the Changes orphan hint, a History commit — wraps the same
 * identity in a badge, because there a chip correctly reads as "a link to
 * the thing elsewhere." One identity, two registers.
 *
 * Two directions were auditioned here and retired by review, recorded so
 * they are not re-proposed: a hashed per-session TINT (color is a semantic
 * channel in Tug — role tokens mean things — and a hash-derived hue reads
 * as meaning and means nothing; the lexicon words already carry the
 * distinctiveness), and MONOSPACE for the callsign in graphical surfaces
 * (mono is for flat text — the commit trailer — not for session chrome).
 *
 * Everything that exists as a Tug* component is the real component: the
 * citation chip is a real {@link TugBadge} with the session icon, the rows
 * are {@link TugSessionRow} and {@link TugListRow}, the one-line title bar
 * the masthead is judged against is the real {@link CardTitleBar}, and the
 * PULSE in the three-line masthead is the real {@link TugPulse}. The one
 * prototype left is the masthead band itself, styled by this card's own
 * CSS on the real pane-chrome tokens — nothing in
 * `gallery-session-identity.css` is a rule the app inherits.
 *
 * @module components/tugways/cards/gallery-session-identity
 */

import "./gallery-session-identity.css";

import React from "react";
import {
  ArrowLeftRight,
  Copy,
  MessageSquare,
  Newspaper,
  Waves,
  X,
} from "lucide-react";

import { CardTitleBar } from "@/components/chrome/tug-pane";
import { TugBadge } from "@/components/tugways/tug-badge";
import { TugLabel } from "@/components/tugways/tug-label";
import { TugListRow } from "@/components/tugways/tug-list-row";
import { TugProgressIndicator } from "@/components/tugways/tug-progress-indicator";
import { TugPulse } from "@/components/tugways/tug-pulse";
import { TugPushButton } from "@/components/tugways/tug-push-button";
import { TugSeparator } from "@/components/tugways/tug-separator";
import {
  TUG_SESSION_ROW_INDICATOR_SIZE,
  TugSessionRow,
} from "@/components/tugways/tug-session-row";
import { sessionSessionPhaseVisual } from "@/lib/code-session-store/session-phase-visual";

// ---------------------------------------------------------------------------
// Fixtures — the roster every section draws from
// ---------------------------------------------------------------------------

interface IdentityFixture {
  /** The callsign, including any lineage suffix. */
  tag: string;
  project: string;
  branch: string | null;
  /** The description — user `/rename` or scraped ai-title; null when unnamed. */
  name: string | null;
  shortId: string;
  /** The picker's metadata line, as the ledger would supply it. */
  meta: string;
  /** Phase for the progress indicator. */
  phase: string;
  /** One-word situation label for section captions. */
  note: string;
}

const ROSTER: readonly IdentityFixture[] = [
  {
    tag: "stocky-pixie",
    project: "tugtool",
    branch: null,
    name: null,
    shortId: "7c21d3aa",
    meta: "2m ago · 4 turns · 1.2 MB",
    phase: "idle",
    note: "un-renamed",
  },
  {
    tag: "syrupy-beam",
    project: "tugtool",
    branch: null,
    name: "Explain commitImposition in deck manager",
    shortId: "f6e43925",
    meta: "6m ago · 2 turns · 885 KB",
    phase: "streaming",
    note: "live, ai-titled",
  },
  {
    tag: "bendy-sweet",
    project: "tugtool",
    branch: "content-width",
    name: "Add animation to card resize in Lens layouts",
    shortId: "ab7579ac",
    meta: "39m ago · 11 turns · 4.7 MB",
    phase: "tool_work",
    note: "off-main branch",
  },
  {
    tag: "juicy-silt",
    project: "tugtool",
    branch: null,
    name: "Make message dates context-aware relative to current date",
    shortId: "26b43a66",
    meta: "3h ago · 7 turns · 2.1 MB",
    phase: "idle",
    note: "renamed",
  },
  {
    tag: "brisk-otter",
    project: "tugdash",
    branch: null,
    name: null,
    shortId: "9e02c1b4",
    meta: "2d ago · 19 turns · 8.9 MB",
    phase: "idle",
    note: "external, tag backfilled",
  },
  {
    tag: "stocky-pixie-A1",
    project: "tugtool",
    branch: null,
    name: null,
    shortId: "d41c77e0",
    meta: "1m ago · 1 turn · 214 KB",
    phase: "streaming",
    note: "fork of stocky-pixie",
  },
] as const;

/** The lineage family, for the fork-grammar section. */
const LINEAGE: readonly string[] = [
  "stocky-pixie",
  "stocky-pixie-A1",
  "stocky-pixie-A2",
  "stocky-pixie-B1",
  "stocky-pixie-A1-B2",
];

/** The citation, exactly as the brief's flat-text grammar writes it. */
function citation(f: IdentityFixture): string {
  return `${f.tag} (${f.shortId})`;
}

// ---------------------------------------------------------------------------
// The two registers
// ---------------------------------------------------------------------------

/**
 * PRESENCE — the session rendered as itself. The chatbox icon (the app's
 * existing session mark), the callsign in bold sans, the project as a muted
 * run, the branch as a ghost badge. No enclosure: this register is for
 * surfaces that ARE the session, where a chip would read as a link to a
 * thing that is already here.
 */
function CallsignText({
  tag,
  context,
  branch,
  icon = true,
}: {
  tag: string;
  context?: string;
  branch?: string | null;
  icon?: boolean;
}): React.ReactElement {
  return (
    <span className="gsi-presence" title={`session ${tag}`}>
      {icon ? (
        <MessageSquare size={14} className="gsi-presence-icon" aria-hidden />
      ) : null}
      {context !== undefined ? (
        <span className="gsi-presence-context">{context}/</span>
      ) : null}
      <span className="gsi-presence-tag">{tag}</span>
      {branch != null ? (
        <TugBadge emphasis="ghost" role="data" size="2xs">
          {branch}
        </TugBadge>
      ) : null}
    </span>
  );
}

/**
 * CITATION — the session referred to from foreign context. A real
 * {@link TugBadge} carrying the session icon and `project/callsign` (the
 * project rides along exactly when the surrounding surface doesn't already
 * establish it). This is the chip tier of the future `TugSessionIdentity`.
 */
function CallsignBadge({
  tag,
  context,
  emphasis = "tinted",
  size = "sm",
}: {
  tag: string;
  context?: string;
  emphasis?: "tinted" | "outlined" | "ghost";
  size?: "2xs" | "xs" | "sm" | "md";
}): React.ReactElement {
  return (
    <TugBadge
      emphasis={emphasis}
      role="data"
      size={size}
      icon={<MessageSquare />}
    >
      {context !== undefined ? `${context}/${tag}` : tag}
    </TugBadge>
  );
}

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------

function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="gsi-section">
      <h3 className="gsi-section-title">{title}</h3>
      {blurb !== undefined ? <p className="gsi-blurb">{blurb}</p> : null}
      {children}
    </section>
  );
}

function Frame({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="gsi-frame">
      <span className="gsi-frame-label">{label}</span>
      {children}
    </div>
  );
}

function PhaseDot({ phase }: { phase: string }): React.ReactElement {
  return (
    <TugProgressIndicator
      variant="pulsing-dot"
      size={TUG_SESSION_ROW_INDICATOR_SIZE}
      phase={phase}
      phaseVisual={sessionSessionPhaseVisual}
      aria-hidden
    />
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

const LIVE = ROSTER[1];
const BRANCHED = ROSTER[2];
const UNNAMED = ROSTER[0];

export function GallerySessionIdentity(): React.ReactElement {
  return (
    <div className="gsi-root" data-testid="gallery-session-identity">
      <p className="gsi-blurb">
        One identity, two registers. <strong>Presence</strong>: a surface
        that <em>is</em> the session — the masthead, the row about to open —
        renders the callsign as typography: chatbox icon, bold sans, no
        enclosure. <strong>Citation</strong>: a surface that <em>refers</em>{" "}
        to a session from foreign context — a Gazette post, an orphan hint,
        a commit — wraps the same identity in a badge, where a chip
        correctly reads as a link to the thing elsewhere. The callsign
        leads in both; the title never leads; the UUID never paints. The
        model is <code>roadmap/session-reference-brief.md</code>.
      </p>

      <TugSeparator />

      {/* ================================================================ */}
      <Section
        title="The two registers — one callsign, both faces"
        blurb={
          <>
            Left of the rule: presence, the session as itself. Right: the
            citation badge (a real <code>TugBadge</code> with the session
            icon), in the emphases a foreign surface might carry it at.
          </>
        }
      >
        <div className="gsi-candidate-grid">
          <Frame label="presence — bare">
            <CallsignText tag={UNNAMED.tag} />
          </Frame>
          <Frame label="presence — with context">
            <CallsignText tag={UNNAMED.tag} context={UNNAMED.project} />
          </Frame>
          <Frame label="presence — off-main">
            <CallsignText
              tag={BRANCHED.tag}
              context={BRANCHED.project}
              branch={BRANCHED.branch}
            />
          </Frame>
          <Frame label="citation — tinted (the default)">
            <CallsignBadge tag={UNNAMED.tag} context={UNNAMED.project} />
          </Frame>
          <Frame label="citation — outlined">
            <CallsignBadge
              tag={UNNAMED.tag}
              context={UNNAMED.project}
              emphasis="outlined"
            />
          </Frame>
          <Frame label="citation — ghost (running-text weight)">
            <CallsignBadge
              tag={UNNAMED.tag}
              context={UNNAMED.project}
              emphasis="ghost"
            />
          </Frame>
        </div>

        <p className="gsi-blurb">
          The citation badge across the roster — a treatment is judged on
          many callsigns, not one:
        </p>
        <div className="gsi-chip-row">
          {ROSTER.map((f) => (
            <CallsignBadge key={f.tag} tag={f.tag} />
          ))}
        </div>
      </Section>

      <TugSeparator />

      {/* ================================================================ */}
      <Section
        title="Chip tier — the Gazette ref, before and after"
        blurb={
          <>
            The Gazette is app-wide, so its citation carries project
            context. The &quot;before&quot; is what ships today: the ref
            chip&apos;s path-shaped label rule is a no-op on a UUID, so the
            post prints all 36 characters.
          </>
        }
      >
        <Frame label="today — the raw UUID">
          <div className="gsi-gazette-post">
            <span className="gsi-gazette-glyph">
              <Newspaper size={14} aria-hidden />
            </span>
            <div className="gsi-gazette-body">
              <span className="gsi-gazette-stamp">2:14 PM</span>
              <p>
                Landed the FLIP width-scale change: panes now scale on the
                tween instead of snapping at the settle.
              </p>
              <div className="gsi-gazette-refs">
                <TugPushButton size="2xs" emphasis="outlined" role="data">
                  4ad2f45e-f9af-46d6-ad4e-97f577156be1
                </TugPushButton>
                <TugPushButton size="2xs" emphasis="outlined" role="data">
                  pane-flip.ts
                </TugPushButton>
              </div>
            </div>
          </div>
        </Frame>
        <Frame label="proposed — the citation badge, project context included">
          <div className="gsi-gazette-post">
            <span className="gsi-gazette-glyph">
              <Newspaper size={14} aria-hidden />
            </span>
            <div className="gsi-gazette-body">
              <span className="gsi-gazette-stamp">2:14 PM</span>
              <p>
                Landed the FLIP width-scale change: panes now scale on the
                tween instead of snapping at the settle.
              </p>
              <div className="gsi-gazette-refs">
                <CallsignBadge
                  tag={LIVE.tag}
                  context={LIVE.project}
                  size="2xs"
                />
                <TugPushButton size="2xs" emphasis="outlined" role="data">
                  pane-flip.ts
                </TugPushButton>
              </div>
            </div>
          </div>
        </Frame>
        <Frame label="Changes card — the orphan hint adopts the same citation">
          <div className="gsi-orphan-hint">
            <TugLabel size="sm" emphasis="calm">
              from
            </TugLabel>
            <CallsignBadge tag={BRANCHED.tag} size="2xs" />
          </div>
        </Frame>
      </Section>

      <TugSeparator />

      {/* ================================================================ */}
      <Section
        title="Line tier — tab strip and menus"
        blurb={
          <>
            One line, no chrome: <code>project/callsign</code>, branch when
            off <code>main</code>. The &quot;before&quot; is the tab
            strip&apos;s current blind spot — a stacked Session card is
            labeled by its registry title.
          </>
        }
      >
        <div className="gsi-candidate-grid">
          <Frame label="tab strip today">
            <span className="gsi-line">Session</span>
          </Frame>
          <Frame label="tab strip proposed">
            <span className="gsi-line">
              {UNNAMED.project}/{UNNAMED.tag}
            </span>
          </Frame>
          <Frame label="window menu / slot picker, off-main">
            <span className="gsi-line">
              {BRANCHED.project}/{BRANCHED.tag} ({BRANCHED.branch})
            </span>
          </Frame>
          <Frame label="line with the session icon — presence at one-line budget">
            <CallsignText tag={UNNAMED.tag} context={UNNAMED.project} />
          </Frame>
        </div>
      </Section>

      <TugSeparator />

      {/* ================================================================ */}
      <Section
        title="Row tier — the picker, callsign-first"
        blurb={
          <>
            Today&apos;s picker leads with the incipit and buries the tag
            in the metadata line at the timestamp&apos;s size and color.
            The proposal inverts the hierarchy on the real{" "}
            <code>TugSessionRow</code>: the callsign leads in the presence
            register (the phase dot is already the row&apos;s leading
            mark, so the name goes without the icon), the description is
            the support line, the metadata keeps its line, and the id is
            gone from ink — it lives in the tooltip and the trash
            button&apos;s label, as today.
          </>
        }
      >
        <Frame label="today — incipit-first, tag buried (real TugListRow, current format)">
          <div className="gsi-list">
            {[LIVE, UNNAMED].map((f) => (
              <TugListRow
                key={f.tag}
                title={f.name ?? "No prompts yet"}
                subtitle={`${f.tag} · ${f.meta} · id ${f.shortId}`}
              />
            ))}
          </div>
        </Frame>
        <Frame label="proposed — callsign-first (real TugSessionRow)">
          <div className="gsi-list">
            {[LIVE, UNNAMED, BRANCHED].map((f) => (
              <TugSessionRow
                key={f.tag}
                indicator={<PhaseDot phase={f.phase} />}
                name={
                  <CallsignText tag={f.tag} branch={f.branch} icon={false} />
                }
                intent={f.name ?? "No prompts yet"}
                activity={f.meta}
              />
            ))}
          </div>
        </Frame>
      </Section>

      <TugSeparator />

      {/* ================================================================ */}
      <Section
        title="Masthead — the title bar grows up"
        blurb={
          <>
            The baseline is the real <code>CardTitleBar</code> at{" "}
            <code>--tug-chrome-height</code>. The mastheads are a fixed
            second tier (<code>--tug-masthead-height</code>, one number),
            and they render the callsign in the PRESENCE register — the
            title bar is not a citation; it <em>is</em> the session, so
            there is no chip to click through to anywhere. Identity-only
            chrome; telemetry one hover away behind the wave widget.
            Overflow truncates; the bar never reflows.
          </>
        }
      >
        <Frame label="today — one line, 36px, one string">
          <div className="gsi-pane-mock">
            <CardTitleBar
              title={`${LIVE.project}/${LIVE.tag}`}
              icon="MessageSquare"
              onClose={() => {}}
            />
          </div>
        </Frame>

        <Frame label="masthead · two-line — callsign + context over the description">
          <div className="gsi-pane-mock">
            <div className="gsi-masthead" data-lines="2">
              <div className="gsi-masthead-lead">
                <CallsignText tag={LIVE.tag} context={LIVE.project} />
                <span className="gsi-masthead-spacer" />
                <span className="gsi-masthead-widget" title="Telemetry">
                  <Waves size={14} aria-hidden />
                </span>
                <span className="gsi-masthead-control" title="Move">
                  <ArrowLeftRight size={14} aria-hidden />
                </span>
                <span className="gsi-masthead-control" title="Close">
                  <X size={14} aria-hidden />
                </span>
              </div>
              <div className="gsi-masthead-title">{LIVE.name}</div>
            </div>
          </div>
        </Frame>

        <Frame label="masthead · three-line — the PULSE rides the chrome (real TugPulse)">
          <div className="gsi-pane-mock">
            <div className="gsi-masthead" data-lines="3">
              <div className="gsi-masthead-lead">
                <CallsignText
                  tag={BRANCHED.tag}
                  context={BRANCHED.project}
                  branch={BRANCHED.branch}
                />
                <span className="gsi-masthead-spacer" />
                <span className="gsi-masthead-widget" title="Telemetry">
                  <Waves size={14} aria-hidden />
                </span>
                <span className="gsi-masthead-control" title="Move">
                  <ArrowLeftRight size={14} aria-hidden />
                </span>
                <span className="gsi-masthead-control" title="Close">
                  <X size={14} aria-hidden />
                </span>
              </div>
              <div className="gsi-masthead-title">{BRANCHED.name}</div>
              <TugPulse
                layout="inline"
                headline="Scaling panes on the FLIP tween"
                activity="Edit pane-flip.ts"
              />
            </div>
          </div>
        </Frame>

        <Frame label="the telemetry placard — what the wave widget opens">
          <div className="gsi-placard">
            <div className="gsi-placard-row">
              <span className="gsi-placard-key">STATE</span>
              <span className="gsi-placard-value">live · streaming</span>
            </div>
            <div className="gsi-placard-row">
              <span className="gsi-placard-key">TURNS</span>
              <span className="gsi-placard-value">11 · 4.7 MB</span>
            </div>
            <div className="gsi-placard-row">
              <span className="gsi-placard-key">CREATED</span>
              <span className="gsi-placard-value">Aug 8, 7:02 AM</span>
            </div>
            <div className="gsi-placard-row">
              <span className="gsi-placard-key">SESSION</span>
              <span className="gsi-placard-value">
                {citation(BRANCHED)}
                <span className="gsi-placard-copy" title="Copy citation">
                  <Copy size={11} aria-hidden />
                </span>
              </span>
            </div>
            <TugPulse
              layout="stacked"
              headline="Scaling panes on the FLIP tween"
              activity="Edit pane-flip.ts"
            />
          </div>
        </Frame>
      </Section>

      <TugSeparator />

      {/* ================================================================ */}
      <Section
        title="The citation — flat text, and the History card"
        blurb={
          <>
            <code>{"<tag> (<short-id>)"}</code> is the only sanctioned
            flat-text form — mono belongs here, in actual flat text, and
            nowhere in session chrome. The commit carries the human trailer
            plus a machine <code>Tug-Session-Id</code> line; the History
            card parses both out server-side, strips them from the body,
            and renders the citation resolved — the badge when the ledger
            knows the session, quiet text when it does not.
          </>
        }
      >
        <Frame label="trailer today — truncated incipit + full UUID, unparsed body ink">
          <pre className="gsi-trailer">
            {
              "Tug-Session: When I click *Cards* or *Card Width* controls in the *Layouts* s…\n(4ad2f45e-f9af-46d6-ad4e-97f577156be1)"
            }
          </pre>
        </Frame>
        <Frame label="trailer proposed — citation + machine id">
          <pre className="gsi-trailer">
            {`Tug-Session: ${citation(LIVE)}\nTug-Session-Id: 4ad2f45e-f9af-46d6-ad4e-97f577156be1`}
          </pre>
        </Frame>
        <Frame label="History identity line — the citation badge beside the sha, trailer stripped from the body">
          <div className="gsi-history-line">
            <code className="gsi-history-sha">8ab71840</code>
            <span className="gsi-history-subject">
              tugdeck(content-width-scale): scale panes on the FLIP tween
            </span>
            <CallsignBadge tag={LIVE.tag} size="2xs" />
          </div>
        </Frame>
        <Frame label="History identity line — session unknown to this ledger: quiet static citation">
          <div className="gsi-history-line">
            <code className="gsi-history-sha">b8b7f0c1</code>
            <span className="gsi-history-subject">
              tugdeck(content-width): let Settings follow content width
            </span>
            <span className="gsi-history-citation">{citation(BRANCHED)}</span>
          </div>
        </Frame>
      </Section>

      <TugSeparator />

      {/* ================================================================ */}
      <Section
        title="Lineage — the fork grammar at chip size"
        blurb={
          <>
            <code>{"<root>-<Letter><Number>"}</code>: the letter names the
            branch point, the number sequences forks from it, chains
            extend. Deep chains truncate under a narrow budget; the tooltip
            carries the whole line.
          </>
        }
      >
        <div className="gsi-chip-row">
          {LINEAGE.map((tag) => (
            <CallsignBadge key={tag} tag={tag} />
          ))}
        </div>
        <Frame label="a deep chain under a narrow budget (prototype ellipsizes at the end; production middle-truncates so root and leaf survive)">
          <span className="gsi-chip-narrow">
            <CallsignBadge tag="stocky-pixie-A1-B2-C1" />
          </span>
        </Frame>
      </Section>
    </div>
  );
}
