/**
 * pdf-runtime.ts — the deck's single entry point to pdf.js.
 *
 * pdf.js is loaded lazily: the library and its worker are reached through
 * dynamic `import()` so a deck that never opens a PDF never pays for them.
 * The module is cached after the first load, so a second PDF card resolves
 * without a second fetch.
 *
 * The worker is spawned here rather than left to pdf.js, and handed over as
 * `GlobalWorkerOptions.workerPort`. `GlobalWorkerOptions.workerSrc` would
 * need a URL string the bundler had rewritten, which is the part that breaks
 * in a production build; a `new Worker(new URL(…), { type: "module" })` call
 * is a form Vite understands, so it emits the worker as its own chunk and
 * rewrites the reference to the built asset. This is the same wiring the
 * deck's other workers use.
 *
 * Both halves come from pdf.js's `legacy` build, not its modern one. The
 * modern build calls `Map.prototype.getOrInsertComputed`, which the WebKit
 * shipping in the app's macOS floor does not have; a document load fails on
 * it with `getOrInsertComputed is not a function` before a page is ever
 * rendered. The legacy build carries the polyfill. The main module and the
 * worker must come from the same build.
 *
 * pdf.js shares one worker port across documents, keying messages by
 * document id, so a single port serves every open PDF card.
 *
 * @module lib/pdf-runtime
 */

/** The subset of pdf.js the deck uses, inferred from the library's own types. */
export type PdfRuntime = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

/** The loaded document handle. */
export type PdfDocument = Awaited<
  ReturnType<PdfRuntime["getDocument"]>["promise"]
>;

/** One page of a loaded document. */
export type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;

let runtime: Promise<PdfRuntime> | null = null;

async function initRuntime(): Promise<PdfRuntime> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerPort = new Worker(
    new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url),
    { type: "module" },
  );
  return pdfjs;
}

/**
 * Resolve pdf.js, loading it and starting its worker on first call.
 *
 * A failed load leaves the cache empty so a later open can retry rather than
 * inheriting the rejection forever.
 */
export function loadPdfRuntime(): Promise<PdfRuntime> {
  if (runtime === null) {
    runtime = initRuntime().catch((error: unknown) => {
      runtime = null;
      throw error;
    });
  }
  return runtime;
}

/** Load the document at `url` through the blob route. */
export async function loadPdfDocument(url: string): Promise<PdfDocument> {
  const pdfjs = await loadPdfRuntime();
  return await pdfjs.getDocument({ url }).promise;
}

/**
 * Release a document's transport and in-flight requests. Teardown hangs off
 * the loading task rather than the document proxy, which is easy to get
 * wrong at the call site, so it lives here.
 */
export function destroyPdfDocument(document: PdfDocument): void {
  void document.loadingTask.destroy();
}
