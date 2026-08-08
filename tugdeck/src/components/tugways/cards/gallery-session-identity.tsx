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
 * The citation register wears the SESSION ATOM: a rounded, specialized
 * pill — deliberately not the squared house badge — painted in one
 * theme-authored *session color* (a new role token, one value per theme),
 * so the pill's shape and color together always mean exactly one thing:
 * "a session, referenced from elsewhere." Decided by the third review
 * round: the session color seeds from the AGENT role (auditioned against
 * accent / link / success on this card), and the atom's form is always
 * `<project>/<callsign>` in a single bold run — one face, one weight, one
 * color, no muted context mixing. The branch suffix was dropped from the
 * visual form in the fourth round: a ghost badge beside the callsign read
 * as an unexplained signal, and branch is workspace state rather than
 * session identity. It survives in the telemetry placard.
 *
 * The atom is a real Tug ATOM, not a look-alike: copying one writes all
 * three clipboard flavors Tug already speaks
 * (`lib/tug-native-clipboard.ts` — the private `dev.tug.prompt-atoms`
 * sidecar, `text/plain`, `text/html`) plus the wire marker
 * (`lib/atom-mention-marker.ts`), so pasting into a Tug surface pastes
 * the atom and pasting anywhere else yields the citation.
 *
 * The fifth review round settled the stack: the masthead's three lines and
 * the row tier's four are ONE leading scheme in one place ({@link
 * IdentityStack}) — identity on the first line, then a tight group of the
 * lines that say what the session is doing. The row is Lens-like, led by
 * the pulsing phase dot. And the unresolvable citation gets a form: the
 * atom keeps its shape, drops the session color, and slashes its icon.
 *
 * Two directions were auditioned here and retired by review, recorded so
 * they are not re-proposed: a hashed PER-SESSION tint (color is a semantic
 * channel in Tug — role tokens mean things — and a hash-derived hue reads
 * as meaning and means nothing; the lexicon words already carry the
 * distinctiveness — one fixed session color is fine, per-item hue is not),
 * and MONOSPACE for the callsign in graphical surfaces (mono is for flat
 * text — the commit trailer — not for session chrome).
 *
 * Everything that exists as a Tug* component is the real component: the
 * rows are {@link TugSessionRow} and {@link TugListRow}, the one-line
 * title bar the masthead is judged against is the real
 * {@link CardTitleBar}, and the PULSE in the three-line masthead is the
 * real {@link TugPulse}. Two prototypes remain, styled by this card's own
 * CSS: the session atom (which becomes `TugSessionIdentity` with its own
 * tokens) and the masthead band (on the real pane-chrome tokens) —
 * nothing in `gallery-session-identity.css` is a rule the app inherits.
 *
 * @module components/tugways/cards/gallery-session-identity
 */

import "./gallery-session-identity.css";

import React from "react";
import {
  ArrowLeftRight,
  Copy,
  MessageSquare,
  MessageSquareOff,
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
  /** The PULSE's standing intent. */
  intent: string;
  /** The PULSE's current activity. */
  activity: string;
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
    intent: "Trace the slot-picker's keyboard route",
    activity: "Idle",
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
    intent: "Scaling panes on the FLIP tween",
    activity: "Edit pane-flip.ts",
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
    intent: "Animate card resize in Lens layouts",
    activity: "Bash just app-test-changed",
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
    intent: "Make message dates context-aware",
    activity: "Idle",
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
    intent: "Wire the dash join resolver",
    activity: "Idle",
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
    intent: "Trace the slot-picker's keyboard route",
    activity: "Read tug-slot-picker.tsx",
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
 * PRESENCE — the session rendered as itself: the chatbox icon (the app's
 * existing session mark) and `<project>/<callsign>` as ONE bold run. No
 * enclosure — this register is for surfaces that ARE the session, where a
 * chip would read as a link to a thing that is already here.
 *
 * The string is a single text node, not a context span beside a tag span.
 * Two spans meant a flex gap opened after the slash and each half could
 * truncate on its own (`tugto… syrupy-beam`); one run cannot do either.
 */
function CallsignText({
  tag,
  context,
  icon = true,
}: {
  tag: string;
  context: string;
  icon?: boolean;
}): React.ReactElement {
  return (
    <span className="gsi-presence" title={`session ${tag}`}>
      {icon ? (
        <MessageSquare size={14} className="gsi-presence-icon" aria-hidden />
      ) : null}
      <span className="gsi-presence-tag">{`${context}/${tag}`}</span>
    </span>
  );
}

/**
 * CITATION — the session referred to from foreign context, as an ATOM: the
 * rounded, specialized pill that gives session references their own look
 * and feel, distinct from the squared house badge. The form is fixed:
 * `<project>/<callsign>`, one bold run — no font-style mixing. Painted in
 * ONE color — `--gsi-session-color`, the theme-authored *session color*,
 * seeded from the AGENT role (decided on this card) — so the pill always
 * means the same thing: "this is a session, elsewhere." This is the chip
 * tier of the future `TugSessionIdentity`, which will own the token when
 * it ships.
 */
function SessionAtom({
  tag,
  context,
  size = "sm",
  missing = false,
}: {
  tag: string;
  context: string;
  size?: "sm" | "2xs";
  /**
   * The citation resolved to nothing — a post or a commit naming a session
   * this ledger has no record of. Decided in the fifth review round: the
   * atom keeps its shape, so a reader still knows what kind of thing is
   * being named, and states its failure in the ONE place that already
   * carries the meaning "session" — the icon, which gains a slash. It is
   * inert: no link, no raise, and the tooltip says why rather than
   * repeating the tag.
   */
  missing?: boolean;
}): React.ReactElement {
  const Glyph = missing ? MessageSquareOff : MessageSquare;
  return (
    <span
      className="gsi-atom"
      data-size={size}
      data-missing={missing ? "true" : undefined}
      title={
        missing
          ? `Session not found — no record of ${context}/${tag} in this ledger`
          : `session ${tag}`
      }
    >
      <Glyph
        size={size === "2xs" ? 11 : 12}
        className="gsi-atom-icon"
        aria-hidden
      />
      <span className="gsi-atom-tag">{`${context}/${tag}`}</span>
    </span>
  );
}

/**
 * The four-line identity stack — DECIDED in the fifth review round as the
 * ROW tier, and the same leading scheme the masthead uses.
 *
 * The masthead's three lines plus the metadata line: callsign, description,
 * PULSE, then time / turns / size. The row is Lens-like — the phase dot
 * leads, pulsing while the session runs and settling small and quiet when it
 * does not — because the picker and the Lens are showing the same thing and
 * had no business showing it two ways. It is not Lens-SIZED, though (sixth
 * review round): the dot takes {@link GSI_ROW_DOT_SIZE}, it rides the row's
 * left margin, and the three lines beneath it take a small indent.
 *
 * `variant` selects only where it is mounted (chrome ground vs list ground)
 * and whether the fourth line is present. The leading between lines is one
 * scheme in one place: identity on top, then a group of three that describe
 * what the session is doing.
 */
function IdentityStack({
  f,
  variant,
  trailing,
}: {
  f: IdentityFixture;
  variant: "masthead" | "row";
  trailing?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="gsi-stack" data-variant={variant}>
      <div className="gsi-stack-lead">
        {variant === "row" ? (
          <PhaseDot phase={f.phase} size={GSI_ROW_DOT_SIZE} />
        ) : null}
        <CallsignText
          tag={f.tag}
          context={f.project}
          icon={variant === "masthead"}
        />
        {trailing !== undefined ? (
          <>
            <span className="gsi-stack-spacer" />
            {trailing}
          </>
        ) : null}
      </div>
      <div className="gsi-stack-title">{f.name ?? "No prompts yet"}</div>
      <TugPulse layout="inline" headline={f.intent} activity={f.activity} />
      {variant === "row" ? (
        <div className="gsi-stack-meta">{f.meta}</div>
      ) : null}
    </div>
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

/**
 * The row tier's dot, DECIDED in the sixth review round.
 *
 * The Lens's {@link TUG_SESSION_ROW_INDICATOR_SIZE} (28) is sized for its
 * job there: to catch the eye when something changes, legibly from across
 * the room. A list row is read up close and deliberately, so it does not
 * need — or want — that size: at 28 the dot is furniture the callsign has
 * to work around. Smaller lets the dot and the name sit together as one
 * mark. Mirrors `--gsi-row-dot-size`, which the overhang math reads.
 */
const GSI_ROW_DOT_SIZE = 16;

function PhaseDot({
  phase,
  size = TUG_SESSION_ROW_INDICATOR_SIZE,
}: {
  phase: string;
  size?: number;
}): React.ReactElement {
  return (
    <TugProgressIndicator
      variant="pulsing-dot"
      size={size}
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
          <Frame label="presence">
            <CallsignText tag={UNNAMED.tag} context={UNNAMED.project} />
          </Frame>
          <Frame label="presence — a longer callsign">
            <CallsignText tag={BRANCHED.tag} context={BRANCHED.project} />
          </Frame>
          <Frame label="citation — the session atom">
            <SessionAtom tag={UNNAMED.tag} context={UNNAMED.project} />
          </Frame>
          <Frame label="the squared house badge, for contrast — what the atom is NOT">
            <TugBadge
              emphasis="tinted"
              role="data"
              size="sm"
              icon={<MessageSquare />}
            >
              {UNNAMED.project}/{UNNAMED.tag}
            </TugBadge>
          </Frame>
        </div>

        <p className="gsi-blurb">
          The atom across the roster — a treatment is judged on many
          callsigns, not one:
        </p>
        <div className="gsi-chip-row">
          {ROSTER.map((f) => (
            <SessionAtom key={f.tag} tag={f.tag} context={f.project} />
          ))}
        </div>
        <p className="gsi-blurb">
          The session color is one theme-authored value — a role, like
          danger or success, seeded from the <strong>agent</strong> family
          (decided here after an audition against accent, link, and
          success): the model&apos;s color, because a session is an agent
          surface. The shipped token is hand-authored into the six theme
          files and contrast-audited.
        </p>
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
                <SessionAtom
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
            <SessionAtom
              tag={BRANCHED.tag}
              context={BRANCHED.project}
              size="2xs"
            />
          </div>
        </Frame>
      </Section>

      <TugSeparator />

      {/* ================================================================ */}
      <Section
        title="Line tier — tab strip and menus"
        blurb={
          <>
            One line, no chrome: <code>project/callsign</code>, the same
            single run as everywhere else. The &quot;before&quot; is the
            tab strip&apos;s current blind spot — a stacked Session card is
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
          <Frame label="window menu / slot picker">
            <span className="gsi-line">
              {BRANCHED.project}/{BRANCHED.tag}
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
            Today&apos;s picker leads with the incipit and buries the tag in
            the metadata line at the timestamp&apos;s size and color. DECIDED
            in the fifth round: the row is the masthead&apos;s three lines{" "}
            <em>plus</em> the metadata line — <strong>four lines</strong>,{" "}
            <em>Lens-like</em>. The phase dot leads and pulses while the
            session runs; it settles small and quiet when it does not (that
            dot is row furniture, not part of the reference — it never rides
            a citation). The callsign leads the text in the presence register
            without its icon, since the dot is already the row&apos;s leading
            mark. The id is gone from ink — tooltip and trash-button label,
            as today. The leading is the masthead&apos;s, exactly.
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
        <Frame label="three lines — the current TugSessionRow, callsign-first (what the four-line form is judged against)">
          <div className="gsi-list">
            {[LIVE, UNNAMED, BRANCHED].map((f) => (
              <TugSessionRow
                key={f.tag}
                indicator={<PhaseDot phase={f.phase} />}
                name={
                  <CallsignText tag={f.tag} context={f.project} icon={false} />
                }
                intent={f.name ?? "No prompts yet"}
                activity={f.meta}
              />
            ))}
          </div>
        </Frame>
        <Frame label="proposed — four lines: callsign, description, PULSE, metadata (same leading as the masthead)">
          <div className="gsi-list">
            {ROSTER.map((f) => (
              <IdentityStack key={f.tag} f={f} variant="row" />
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
            <code>--tug-chrome-height</code>. The masthead is DECIDED: the
            three-line form — callsign, description, PULSE — at a fixed
            second tier (<code>--tug-masthead-height</code>, one number,
            never content-driven). It renders the callsign in the PRESENCE
            register: the title bar is not a citation; it <em>is</em> the
            session, so there is no chip to click through to anywhere.
            Identity-only chrome, with telemetry one hover away behind the
            wave widget. Overflow truncates; the bar never reflows.
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

        {[LIVE, BRANCHED].map((f) => (
          <Frame
            key={f.tag}
            label={`masthead — callsign, description, PULSE (${f.note})`}
          >
            <div className="gsi-pane-mock">
              <div className="gsi-masthead">
                <IdentityStack
                  f={f}
                  variant="masthead"
                  trailing={
                    <>
                      <span className="gsi-masthead-widget" title="Telemetry">
                        <Waves size={14} aria-hidden />
                      </span>
                      <span className="gsi-masthead-control" title="Move">
                        <ArrowLeftRight size={14} aria-hidden />
                      </span>
                      <span className="gsi-masthead-control" title="Close">
                        <X size={14} aria-hidden />
                      </span>
                    </>
                  }
                />
              </div>
            </div>
          </Frame>
        ))}

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
            {/* Branch lives here, not in the identity: it is workspace
                state that changes under a session, not part of its name. */}
            <div className="gsi-placard-row">
              <span className="gsi-placard-key">BRANCH</span>
              <span className="gsi-placard-value">{BRANCHED.branch}</span>
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
            <SessionAtom tag={LIVE.tag} context={LIVE.project} size="2xs" />
          </div>
        </Frame>
        <Frame label="History identity line — session unknown to this ledger: the slashed atom, inert">
          <div className="gsi-history-line">
            <code className="gsi-history-sha">b8b7f0c1</code>
            <span className="gsi-history-subject">
              tugdeck(content-width): let Settings follow content width
            </span>
            <SessionAtom
              tag={BRANCHED.tag}
              context={BRANCHED.project}
              size="2xs"
              missing
            />
          </div>
        </Frame>
        <p className="gsi-blurb">
          The unresolvable citation, DECIDED in the fifth round. The atom
          keeps its shape — a reader should still know what <em>kind</em> of
          thing is named — and states the failure in the one mark that
          already carries the meaning &quot;session&quot;: the icon gains a
          slash. It is <strong>inert</strong>: no link, no raise, no hover
          placard; the tooltip says <em>Session not found</em> rather than
          repeating the tag. Resolved beside unresolved, at both sizes:
        </p>
        <div className="gsi-chip-row">
          <SessionAtom tag={LIVE.tag} context={LIVE.project} />
          <SessionAtom tag={LIVE.tag} context={LIVE.project} missing />
          <SessionAtom tag={LIVE.tag} context={LIVE.project} size="2xs" />
          <SessionAtom
            tag={LIVE.tag}
            context={LIVE.project}
            size="2xs"
            missing
          />
        </div>
      </Section>

      <TugSeparator />

      {/* ================================================================ */}
      <Section
        title="The atom on the clipboard — copy a session, paste a session"
        blurb={
          <>
            A session atom is a real Tug <strong>atom</strong>, so copying
            one and pasting it into a Tug surface pastes the{" "}
            <em>atom</em>, not a string. Tug already has the machinery: the
            native clipboard writes three flavors at once (
            <code>lib/tug-native-clipboard.ts</code>), and atoms round-trip
            through prompt text as a wire marker (
            <code>lib/atom-mention-marker.ts</code>). The session atom
            joins that system rather than inventing one — which is also
            what makes the flat-text citation earn its keep: it is the
            plain-text flavor.
          </>
        }
      >
        <div className="gsi-flavors">
          {(
            [
              [
                "dev.tug.prompt-atoms",
                "the Tug-private sidecar",
                `{"kind":"session","tag":"${LIVE.project}/${LIVE.tag}","id":"${LIVE.shortId}"}`,
                "Paste into a Tug composer, a Jot, a Gazette reply → the atom re-materializes as the pill, live and clickable.",
              ],
              [
                "text/plain",
                "the citation — the flat-text form",
                `${LIVE.project}/${LIVE.tag} (${LIVE.shortId})`,
                "Paste into a terminal, a commit message, another app → the citation, which is exactly the trailer grammar.",
              ],
              [
                "text/html",
                "the styled fallback",
                `<span data-tug-session="${LIVE.shortId}">${LIVE.project}/${LIVE.tag}</span>`,
                "Paste into a rich-text surface that is not Tug → the callsign, styled, carrying its id in a data attribute.",
              ],
              [
                "wire marker",
                "what the model reads, and what replay re-mints",
                `\`@${LIVE.project}/${LIVE.tag}\``,
                "Submitted prompt text keeps the mention's structural identity, so a replayed transcript shows a chip and not prose.",
              ],
            ] as const
          ).map(([flavor, role, payload, effect]) => (
            <div className="gsi-flavor" key={flavor}>
              <span className="gsi-flavor-name">{flavor}</span>
              <span className="gsi-flavor-role">{role}</span>
              <code className="gsi-flavor-payload">{payload}</code>
              <span className="gsi-flavor-effect">{effect}</span>
            </div>
          ))}
        </div>

        <Frame label="the round trip — copied from a Gazette post, pasted into a composer">
          <div className="gsi-roundtrip">
            <SessionAtom tag={LIVE.tag} context={LIVE.project} />
            <span className="gsi-roundtrip-arrow" aria-hidden="true">
              →
            </span>
            <span className="gsi-roundtrip-composer">
              Pick up where <SessionAtom tag={LIVE.tag} context={LIVE.project} />{" "}
              left off
            </span>
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
            <SessionAtom key={tag} tag={tag} context="tugtool" />
          ))}
        </div>
        <Frame label="a deep chain under a narrow budget (prototype ellipsizes at the end; production middle-truncates so root and leaf survive)">
          <span className="gsi-chip-narrow">
            <SessionAtom tag="stocky-pixie-A1-B2-C1" context="tugtool" />
          </span>
        </Frame>
      </Section>
    </div>
  );
}
