/**
 * asset-links — the one parser, encoder, and resolver for markdown links to
 * attached files.
 *
 * Four surfaces ask the same questions about a document's links: the strip that
 * projects tiles from the buffer, the drop path that writes a link, the
 * ⌘-click path that opens one, and the clipboard interop that carries one
 * between surfaces. The first round grew two partial answers in two files and
 * they drifted; this module is the single answer all four call.
 *
 * ## Destinations are readable, not percent-encoded
 *
 * A destination that would break CommonMark parsing is wrapped in angle
 * brackets — `![Screenshot](<assets/Screenshot 2026-08-14 at 6.54.47 AM.png>)`
 * — rather than percent-escaped. Angle-bracket destinations are standard
 * CommonMark and render identically on GitHub, pandoc, and Obsidian, and the
 * user sees the filename they actually have. `%20` soup was the single most
 * visible defect of the shipped drop.
 *
 * The parser still accepts percent-encoded destinations, because documents
 * written by the shipped version contain them and must keep working. It just
 * never writes one again — except for the two characters that genuinely cannot
 * appear inside an angle-bracket destination, `<` and `>`.
 *
 * ## Two resolvers, deliberately
 *
 * {@link resolveRelativePath} accepts any plain relative destination inside the
 * document's own tree; it is what ⌘-click uses, so a hand-written
 * `images/diagram.png` link still opens. {@link resolveAssetPath} is that plus
 * the `assets/`-first-segment requirement, and it is what the strip uses, so a
 * roadmap document full of relative links to other documents does not project
 * a strip of dozens of tiles that are not attachments.
 *
 * Collapsing them would silently narrow ⌘-click, which is why they are separate
 * functions with separate names rather than a boolean parameter.
 *
 * Nothing assembled here is persisted or compared — every resolved path is
 * handed to a route that re-guards it ([L29]).
 *
 * @module lib/asset-links
 */

/** One markdown link found in a document. */
export interface AssetLinkRef {
  /** Document offset of the link's first character (the `!` or `[`). */
  from: number;
  /** Document offset just past the closing `)`. */
  to: number;
  /** The link's visible half, verbatim. */
  label: string;
  /** The destination, decoded — angle brackets stripped, escapes resolved. */
  destination: string;
  /** True for `![…](…)`, an image embed rather than a plain link. */
  isImage: boolean;
}

/**
 * Markdown links and image embeds. The label stops at the first `]`, and the
 * destination is either angle-bracketed or a run with no whitespace or
 * parentheses — which is exactly what {@link encodeLinkDestination} produces
 * and what CommonMark reads back.
 */
const LINK_PATTERN = /(!?)\[([^\]\n]*)\]\(\s*(<[^<>\n]*>|[^()\s]*)\s*\)/g;

/**
 * Percent-decode `text`, or return it unchanged when it is not valid encoding.
 *
 * A destination is user data. `decodeURIComponent` throws on a stray `%` — a
 * filename like `50% off.png` written bare by hand — and throwing there would
 * mean the whole strip disappears because of one link.
 */
function decodePercent(text: string): string {
  if (!text.includes("%")) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The real destination behind a parsed one: angle brackets stripped, escapes
 * resolved. Accepts all three forms a Tug document can contain — bare,
 * angle-bracketed, and (from the shipped version) percent-encoded.
 */
export function decodeLinkDestination(raw: string): string {
  const inner = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
  return decodePercent(inner);
}

/**
 * Every markdown link and image embed in `text`, with decoded destinations.
 *
 * Parsing is parsing: this returns *all* links, and the `assets/` scoping that
 * decides what becomes a strip tile is {@link resolveAssetPath}'s job ([P12]).
 * Keeping the two apart is what lets the ⌘-click path and the strip share one
 * pass over the buffer without sharing one policy.
 */
export function parseAssetLinks(text: string): AssetLinkRef[] {
  const refs: AssetLinkRef[] = [];
  LINK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK_PATTERN.exec(text)) !== null) {
    const [whole, bang, label, rawDestination] = match;
    const destination = decodeLinkDestination(rawDestination);
    if (destination.length === 0) continue;
    refs.push({
      from: match.index,
      to: match.index + whole.length,
      label,
      destination,
      isImage: bang === "!",
    });
  }
  return refs;
}

/**
 * The destination text for `relativePath`, readable wherever readable is
 * possible.
 *
 * Bare when nothing in the name would break CommonMark. Angle-bracketed when it
 * holds a space or a parenthesis. Only `<` and `>` are percent-encoded, because
 * they are the two characters that cannot appear inside an angle-bracket
 * destination at all — and a newline, which cannot appear in a filename.
 */
export function encodeLinkDestination(relativePath: string): string {
  const needsAngles = /[ ()]/.test(relativePath);
  const hasAngles = /[<>]/.test(relativePath);
  if (!needsAngles && !hasAngles) return relativePath;
  const escaped = relativePath.replace(/</g, "%3C").replace(/>/g, "%3E");
  return `<${escaped}>`;
}

/**
 * The absolute path a relative destination names, resolved against the
 * directory `base`, or `null` when it is not a plain path inside that tree.
 *
 * Deliberately narrow, and unchanged from what shipped: an absolute
 * destination, a URL, an anchor, and a `..` escape all answer `null`. A
 * ⌘-click is a reading gesture, and the paths it reaches should be the ones the
 * document itself put there.
 */
export function resolveRelativePath(
  base: string | null,
  destination: string,
): string | null {
  if (base === null || base.length === 0 || destination.length === 0) return null;
  if (destination.startsWith("#") || destination.startsWith("/")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(destination)) return null;
  const segments = destination.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  const dir = base.endsWith("/") ? base.slice(0, -1) : base;
  if (dir.length === 0) return null;
  return `${dir}/${segments.join("/")}`;
}

/**
 * {@link resolveRelativePath} plus [P12]: the destination's first segment must
 * be `assets`, so only a file this feature put there projects into the strip.
 */
export function resolveAssetPath(
  base: string | null,
  destination: string,
): string | null {
  const segments = destination.split("/");
  if (segments.length < 2 || segments[0] !== "assets") return null;
  return resolveRelativePath(base, destination);
}

/** The directory holding `path` — the asset base for a saved document. */
export function directoryOf(path: string): string | null {
  const cut = path.lastIndexOf("/");
  if (cut <= 0) return null;
  return path.slice(0, cut);
}
