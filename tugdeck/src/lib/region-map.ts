/**
 * RegionMap — ordered, keyed content container for TugMarkdownView.
 *
 * Manages an ordered list of content regions, each identified by a string key.
 * The full document text is the concatenation of all regions in display order,
 * separated by double newlines (\n\n) between regions.
 *
 * Used by TugMarkdownView's imperative handle to support addressable content
 * regions (e.g., conversation messages keyed by message ID).
 *
 * @module lib/region-map
 */

/**
 * A char range [start, end) within the concatenated document text.
 */
export interface RegionRange {
  start: number;
  end: number;
}

export class RegionMap {
  private _order: string[] = [];
  private _content = new Map<string, string>();
  private _text = "";
  private _regionOffsets: number[] = [];

  /** Insert or update a region. If key exists, update text in place (order unchanged). If new, append at end. */
  setRegion(key: string, text: string): void {
    if (!this._content.has(key)) {
      this._order.push(key);
    }
    this._content.set(key, text);
    this._rebuild();
  }

  /** Remove a region by key. No-op if key doesn't exist. */
  removeRegion(key: string): void {
    if (!this._content.has(key)) return;
    this._content.delete(key);
    const idx = this._order.indexOf(key);
    if (idx >= 0) this._order.splice(idx, 1);
    this._rebuild();
  }

  /** Clear all regions. */
  clear(): void {
    this._order = [];
    this._content.clear();
    this._text = "";
    this._regionOffsets = [];
  }

  /** The full concatenated text of all regions (separated by \n\n). */
  get text(): string { return this._text; }

  /** Number of regions. */
  get regionCount(): number { return this._order.length; }

  /** Get the ordered list of region keys (read-only). */
  get keys(): readonly string[] { return this._order; }

  /** Get the text content of a region by key. */
  getRegionText(key: string): string | undefined {
    return this._content.get(key);
  }

  /** Check if a region exists. */
  hasRegion(key: string): boolean {
    return this._content.has(key);
  }

  /** Given a char offset in the concatenated text, return which region key owns it. */
  regionKeyAtOffset(offset: number): string | undefined {
    if (this._order.length === 0) return undefined;
    for (let i = this._regionOffsets.length - 1; i >= 0; i--) {
      if (offset >= this._regionOffsets[i]) {
        return this._order[i];
      }
    }
    return this._order[0];
  }

  /** Get the char range [start, end) for a region's text within the concatenated string. */
  regionRange(key: string): RegionRange | undefined {
    const idx = this._order.indexOf(key);
    if (idx < 0) return undefined;
    const start = this._regionOffsets[idx];
    const regionText = this._content.get(key) ?? "";
    return { start, end: start + regionText.length };
  }

  /** Rebuild concatenated text and offset cache. */
  private _rebuild(): void {
    const parts: string[] = [];
    const offsets: number[] = [];
    let pos = 0;
    for (const key of this._order) {
      offsets.push(pos);
      const text = this._content.get(key) ?? "";
      parts.push(text);
      pos += text.length + 2; // +2 for the \n\n separator
    }
    this._text = parts.join("\n\n");
    this._regionOffsets = offsets;
  }
}
