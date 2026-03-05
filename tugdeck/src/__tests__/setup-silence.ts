/**
 * Global test preload: silence console output during tests.
 *
 * Production code uses console.warn/error/log for runtime diagnostics.
 * These are noisy in test output and look like errors. Suppress them all.
 *
 * Tests that need to assert on console calls should spy before the call:
 *   const spy = spyOn(console, "warn");
 * The spy captures the call; the suppressed original never fires.
 */
console.log = () => {};
console.info = () => {};
console.warn = () => {};
console.error = () => {};
