/**
 * The URL admission gate for the annotator's link detection.
 *
 * Detection itself is delegated to `linkify-element` (linkifyjs, MIT),
 * which handles the fiddly edges — trailing punctuation, parenthesised
 * URLs — well enough for transcript content without us owning that
 * surface. What linkify gets wrong for *this* corpus is breadth: it
 * treats any host with a registered TLD as a link, so prose filenames
 * like `tuglaws.md` and `tuglaws/tuglaws.md` become bogus `.md`
 * "domains". Transcript text is full of such filenames and dotted
 * identifiers, so a match must carry an explicit `scheme://` to survive.
 *
 * Email matches keep linkify's own validation — an `@` is unambiguous
 * and never a stray filename.
 *
 * Pure, so the gate is pinned by unit test without a DOM.
 *
 * Laws: [L21] license — linkifyjs / linkify-element are MIT, vendored
 * via the lockfile.
 *
 * @module lib/annotator/url-grammar
 */

/** A bare `scheme://` prefix (RFC 3986 scheme grammar). */
const HAS_URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Whether a candidate URL match carries an explicit `scheme://` and is
 * therefore admissible as a link. A bare host (`tuglaws.md`, `foo.ts`)
 * is not.
 */
export function hasUrlScheme(value: string): boolean {
  return HAS_URL_SCHEME.test(value);
}
