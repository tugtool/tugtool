import { describe, expect, test } from "bun:test";
import {
  buildSessionCapabilities,
  parseInitializeControlResponse,
} from "./src/capabilities.ts";

// A realistic `initialize` control-response captured from claude 2.1.158
// (trimmed). The nested `response.response` carries the capabilities.
const RAW_INITIALIZE_RESPONSE = {
  type: "control_response",
  response: {
    subtype: "success",
    request_id: "ctrl-init-1",
    response: {
      account: { tokenSource: "claude.ai", apiProvider: "firstParty" },
      agents: ["claude", "Explore", "general-purpose"],
      available_output_styles: ["default", "Proactive", "Explanatory"],
      commands: [
        { name: "deep-research", description: "Deep research", argumentHint: "" },
        { name: "debug", description: "Enable debug logging", argumentHint: "[issue]" },
      ],
      models: [
        {
          value: "default",
          displayName: "Default (recommended)",
          description: "Use the default model (currently Opus 4.8 (1M context)) · $5/$25 per Mtok",
          supportsEffort: true,
          supportedEffortLevels: ["low", "high"],
        },
        { value: "sonnet", displayName: "Sonnet", description: "Sonnet 4.6" },
      ],
      output_style: "default",
      pid: 12345,
    },
  },
};

describe("buildSessionCapabilities", () => {
  test("parses models, commands, agents, styles, output_style, account", () => {
    const caps = buildSessionCapabilities(
      RAW_INITIALIZE_RESPONSE.response.response,
    );
    expect(caps).not.toBeNull();
    expect(caps!.type).toBe("session_capabilities");
    expect(caps!.ipc_version).toBe(2);

    // models keep only value/displayName/description; supports* dropped.
    expect(caps!.models).toEqual([
      {
        value: "default",
        displayName: "Default (recommended)",
        description:
          "Use the default model (currently Opus 4.8 (1M context)) · $5/$25 per Mtok",
      },
      { value: "sonnet", displayName: "Sonnet", description: "Sonnet 4.6" },
    ]);

    expect(caps!.commands).toEqual([
      { name: "deep-research", description: "Deep research", argumentHint: "" },
      { name: "debug", description: "Enable debug logging", argumentHint: "[issue]" },
    ]);

    expect(caps!.agents).toEqual(["claude", "Explore", "general-purpose"]);
    expect(caps!.available_output_styles).toEqual([
      "default",
      "Proactive",
      "Explanatory",
    ]);
    expect(caps!.output_style).toBe("default");
    expect(caps!.account).toEqual({
      tokenSource: "claude.ai",
      apiProvider: "firstParty",
    });
  });

  test("the current model id is NOT present (documents the limitation)", () => {
    const caps = buildSessionCapabilities(
      RAW_INITIALIZE_RESPONSE.response.response,
    );
    // No structured current/default model id — only the value:"default"
    // convention on models[0] and the prose description.
    expect(caps!.models[0].value).toBe("default");
    expect(
      (caps as unknown as Record<string, unknown>).model,
    ).toBeUndefined();
    expect(
      (caps as unknown as Record<string, unknown>).version,
    ).toBeUndefined();
  });

  test("skips malformed model / command entries, never throws", () => {
    const caps = buildSessionCapabilities({
      models: [
        { value: "ok", displayName: "OK" },
        { value: "no-name" }, // missing displayName → skipped
        "not-an-object", // → skipped
        { displayName: "no-value" }, // missing value → skipped
      ],
      commands: [
        { name: "ok" },
        { description: "no name" }, // → skipped
        42, // → skipped
      ],
    });
    expect(caps!.models).toEqual([{ value: "ok", displayName: "OK" }]);
    expect(caps!.commands).toEqual([{ name: "ok" }]);
  });

  test("degrades missing fields to empty arrays / defaults", () => {
    const caps = buildSessionCapabilities({});
    expect(caps!.models).toEqual([]);
    expect(caps!.commands).toEqual([]);
    expect(caps!.agents).toEqual([]);
    expect(caps!.available_output_styles).toEqual([]);
    expect(caps!.output_style).toBe("");
    expect(caps!.account).toBeNull();
  });

  test("returns null for non-object input", () => {
    expect(buildSessionCapabilities(null)).toBeNull();
    expect(buildSessionCapabilities("nope")).toBeNull();
    expect(buildSessionCapabilities([1, 2, 3])).toBeNull();
  });
});

describe("parseInitializeControlResponse", () => {
  test("extracts request_id + capabilities from a success response", () => {
    const parsed = parseInitializeControlResponse(RAW_INITIALIZE_RESPONSE);
    expect(parsed).not.toBeNull();
    expect(parsed!.requestId).toBe("ctrl-init-1");
    expect(parsed!.capabilities.models.length).toBe(2);
    expect(parsed!.capabilities.commands.length).toBe(2);
  });

  test("returns null for non-control_response events", () => {
    expect(
      parseInitializeControlResponse({ type: "system", subtype: "init" }),
    ).toBeNull();
  });

  test("returns null for a non-success control_response", () => {
    expect(
      parseInitializeControlResponse({
        type: "control_response",
        response: { subtype: "error", request_id: "x", error: "boom" },
      }),
    ).toBeNull();
  });

  test("returns null when request_id is missing", () => {
    expect(
      parseInitializeControlResponse({
        type: "control_response",
        response: { subtype: "success", response: {} },
      }),
    ).toBeNull();
  });
});
