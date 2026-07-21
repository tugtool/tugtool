import { describe, expect, it } from "bun:test";

import { commitDialogAutoMessagePose } from "@/components/tugways/cards/session-commit-dialog";

describe("commitDialogAutoMessagePose", () => {
  it("locks the editor + button and shows the wave only while drafting", () => {
    expect(commitDialogAutoMessagePose("drafting")).toEqual({
      editorDisabled: true,
      waveVisible: true,
      autoMessageDisabled: true,
    });
  });

  it("leaves everything live in every other phase", () => {
    const live = { editorDisabled: false, waveVisible: false, autoMessageDisabled: false };
    expect(commitDialogAutoMessagePose("idle")).toEqual(live);
    expect(commitDialogAutoMessagePose("ready")).toEqual(live);
    expect(commitDialogAutoMessagePose("error")).toEqual(live);
  });
});
