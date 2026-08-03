/**
 * preload.ts — wired into `bunfig.toml` as the app-test suite's preload.
 *
 * Its only job is to give the harness an end-of-run hook that the bun
 * test runner actually calls. See `test-cleanup.ts` for why
 * `process.on("exit")` is not that hook.
 */
import { afterAll } from "bun:test";

import { runTestRunEndTasks } from "./test-cleanup";

afterAll(runTestRunEndTasks);
