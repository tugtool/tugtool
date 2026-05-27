import AppKit
import Foundation
import UniformTypeIdentifiers

/// A snapshot of the file URLs currently sitting on an `NSPasteboard` during
/// a drag operation, resolved to enough metadata that the JavaScript side
/// can decide whether the editor should accept or reject the drop.
///
/// This type exists to close the gap left by WebKit bug #223517: in
/// WKWebView, the JS-side `DataTransferItemList` is empty during
/// `dragenter` / `dragover` events for cross-origin file drags (the
/// Finder case), so the JS side has no way to inspect MIME types until
/// `drop` fires. The native host of Tug.app sits outside the WebContent
/// sandbox, can read `NSPasteboard` freely, and posts the resolved file
/// info into JS via `evaluateJavaScript("window.__tugActiveDrag = …")`.
/// The drop extension reads from that global at `dragenter` / `dragover`
/// time and drives the three-state `setDropActive` reject ring + OS
/// no-drop cursor.
///
/// The struct is `Codable` so the snapshot serializes cleanly to JSON for
/// embedding into an `evaluateJavaScript` literal.
struct PasteboardSnapshot: Codable {
    /// One entry per file URL on the pasteboard. Order matches the
    /// pasteboard's `readObjects` ordering (the order the source dragged
    /// the files in). May be empty when the snapshot was captured but
    /// the pasteboard held no file URLs (a text-only drag, for example).
    let files: [FileEntry]

    /// A single dragged file's metadata, resolved enough for the JS-side
    /// classifier (`classifySourceMime`, `isTextMimeType`) to decide
    /// supportedness.
    struct FileEntry: Codable {
        /// The file's last path component (e.g. `"screenshot.png"`).
        let name: String

        /// The resolved MIME type, e.g. `"image/png"` or `"text/plain"`.
        /// Absent when no UTI was registered for the URL's extension or
        /// when `UTType` could not derive a preferred MIME. The JS side
        /// treats missing `mimeType` the same way the WebKit `drop`
        /// path treats empty `File.type`: optimistic accept, with the
        /// final classification deferred to drop time.
        let mimeType: String?

        /// The file's size in bytes, derived from
        /// `URLResourceKey.fileSizeKey`. Absent when the resource value
        /// could not be read (the file vanished between the drag start
        /// and the snapshot, or the URL is not a regular file). The JS
        /// side treats absence as "size unknown" — supportedness is
        /// decided by MIME, not by size at this stage.
        let size: Int?
    }
}

extension PasteboardSnapshot {
    /// Capture the file URLs currently on `pasteboard` and resolve each
    /// to its MIME + size. Returns `nil` when the pasteboard holds no
    /// file URLs at all (the snapshot would be meaningless to the JS
    /// side — `dragenter` / `dragover` should fall through to the
    /// JS-only `types.includes("Files")` path).
    ///
    /// MIME resolution prefers UTI-via-URL (`URLResourceKey.typeIdentifierKey`,
    /// then `UTType(_:)`'s `preferredMIMEType`) so files without a
    /// MIME-registered extension (e.g. `.heic` on older systems) still
    /// resolve through the system's UTI database. When no UTI exists
    /// at all (a brand-new extension that's never been seen), the
    /// `mimeType` lands as `nil` and the JS side falls back to its
    /// extension-allowlist logic.
    static func capture(from pasteboard: NSPasteboard) -> PasteboardSnapshot? {
        let options: [NSPasteboard.ReadingOptionKey: Any] = [
            // Filter to file URLs only — http(s) URLs on the pasteboard
            // (e.g. dragged Safari links) are not attachments and should
            // not appear in the snapshot.
            .urlReadingFileURLsOnly: true
        ]
        guard let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: options) as? [URL],
              !urls.isEmpty else {
            return nil
        }
        let entries = urls.map(FileEntry.init(fromFileURL:))
        return PasteboardSnapshot(files: entries)
    }

    /// JSON-encode the snapshot to a string suitable for embedding in a
    /// JavaScript literal (the encoded value is itself a valid JS
    /// expression). Returns `nil` if encoding fails — practically
    /// unreachable since the struct is pure value-type Codable, but
    /// surfacing the optional keeps the call site honest.
    func jsonString() -> String? {
        let encoder = JSONEncoder()
        // Sorted keys produce deterministic output that's easier to
        // verify in dev-panel logs and harness assertions.
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(self),
              let string = String(data: data, encoding: .utf8) else {
            return nil
        }
        return string
    }
}

extension PasteboardSnapshot.FileEntry {
    /// Resolve a file URL to a `FileEntry`. UTI lookup falls back from
    /// the URL's `typeIdentifierKey` (the system's authoritative answer
    /// for a real on-disk file) to `UTType(filenameExtension:)` (works
    /// even when the file is gone — the extension still maps via the
    /// UTI database).
    init(fromFileURL url: URL) {
        let name = url.lastPathComponent
        let mime = Self.resolveMIMEType(url: url)
        let size = Self.resolveSize(url: url)
        self.init(name: name, mimeType: mime, size: size)
    }

    private static func resolveMIMEType(url: URL) -> String? {
        // First-choice: the resource value carries the authoritative UTI
        // from launch services for the actual file on disk.
        if let resourceValues = try? url.resourceValues(forKeys: [.typeIdentifierKey]),
           let typeIdentifier = resourceValues.typeIdentifier,
           let utType = UTType(typeIdentifier),
           let mime = utType.preferredMIMEType {
            return mime
        }
        // Fallback: derive the UTI from the filename extension. Useful
        // for cases where the file is unreadable (permissions, vanished)
        // but the extension is still a valid hint.
        let ext = url.pathExtension
        if !ext.isEmpty,
           let utType = UTType(filenameExtension: ext),
           let mime = utType.preferredMIMEType {
            return mime
        }
        return nil
    }

    private static func resolveSize(url: URL) -> Int? {
        guard let resourceValues = try? url.resourceValues(forKeys: [.fileSizeKey]),
              let bytes = resourceValues.fileSize else {
            return nil
        }
        return bytes
    }
}
