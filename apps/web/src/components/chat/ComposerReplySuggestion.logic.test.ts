import { describe, expect, it } from "vite-plus/test";

import {
  resolveComposerReplySuggestion,
  shouldAcceptReplySuggestionOnTab,
  type ComposerReplySuggestionInput,
} from "./ComposerReplySuggestion.logic";

const suggestion = {
  text: "Yes, retry on 429 only.",
  turnId: "turn-1",
  generatedAt: "2026-01-01T00:00:00.000Z",
} as ComposerReplySuggestionInput["suggestion"];

const base: ComposerReplySuggestionInput = {
  suggestion,
  supported: true,
  enabled: true,
  consumedTurnId: null,
  phase: "ready",
  composerIsClaimed: false,
  promptLength: 0,
  contextRecordCount: 0,
};

describe("resolveComposerReplySuggestion", () => {
  it("offers the suggestion on a settled thread", () => {
    expect(resolveComposerReplySuggestion(base)).toBe("Yes, retry on 429 only.");
  });

  it("stays quiet while the turn is still in flight or connecting", () => {
    expect(resolveComposerReplySuggestion({ ...base, phase: "running" })).toBeNull();
    expect(resolveComposerReplySuggestion({ ...base, phase: "connecting" })).toBeNull();
  });

  it("stays quiet when an approval or pending question owns the composer", () => {
    expect(resolveComposerReplySuggestion({ ...base, composerIsClaimed: true })).toBeNull();
  });

  it("stays quiet when the server cannot generate suggestions or the setting is off", () => {
    expect(resolveComposerReplySuggestion({ ...base, supported: false })).toBeNull();
    expect(resolveComposerReplySuggestion({ ...base, enabled: false })).toBeNull();
  });

  it("does not re-offer a suggestion the user already took", () => {
    expect(resolveComposerReplySuggestion({ ...base, consumedTurnId: "turn-1" })).toBeNull();
    expect(resolveComposerReplySuggestion({ ...base, consumedTurnId: "turn-0" })).toBe(
      "Yes, retry on 429 only.",
    );
  });

  it("stays quiet once the composer holds the user's own draft", () => {
    expect(resolveComposerReplySuggestion({ ...base, promptLength: 1 })).toBeNull();
    // A pasted screenshot hides the ghost text, so Tab must not be able to
    // accept what the user can no longer see.
    expect(resolveComposerReplySuggestion({ ...base, contextRecordCount: 1 })).toBeNull();
  });

  it("treats a blank suggestion as no suggestion", () => {
    expect(
      resolveComposerReplySuggestion({
        ...base,
        suggestion: { ...suggestion!, text: "   " },
      }),
    ).toBeNull();
    expect(resolveComposerReplySuggestion({ ...base, suggestion: null })).toBeNull();
  });
});

describe("shouldAcceptReplySuggestionOnTab", () => {
  const tab = {
    shiftKey: false,
    isComposing: false,
    livePrompt: "",
    suggestion: "Yes, retry on 429 only.",
  };

  it("accepts on a bare Tab in an empty composer with a live suggestion", () => {
    expect(shouldAcceptReplySuggestionOnTab(tab)).toBe(true);
  });

  it("leaves every other Tab alone", () => {
    expect(shouldAcceptReplySuggestionOnTab({ ...tab, shiftKey: true })).toBe(false);
    expect(shouldAcceptReplySuggestionOnTab({ ...tab, isComposing: true })).toBe(false);
    expect(shouldAcceptReplySuggestionOnTab({ ...tab, suggestion: null })).toBe(false);
    expect(shouldAcceptReplySuggestionOnTab({ ...tab, livePrompt: "- item" })).toBe(false);
    // Whitespace the user typed is still their draft, not an empty composer.
    expect(shouldAcceptReplySuggestionOnTab({ ...tab, livePrompt: "  " })).toBe(false);
  });
});
