import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "@effect/vitest";

import { fromRunner, decodeJsonReply } from "./textGenerationOperations.ts";
import { buildReplySuggestionPrompt } from "./textGenerationPrompts.ts";
import { sanitizeReplySuggestion } from "./textGenerationUtils.ts";

describe("reply suggestion generation", () => {
  it.effect("uses the shared structured runner and returns a normalized user reply", () =>
    Effect.gen(function* () {
      const operations: string[] = [];
      const service = fromRunner("test", (request) => {
        operations.push(request.operation);
        expect(request.prompt).toContain("Predict the next message the USER would send");
        expect(request.prompt).toContain("assistant: Which file should I fix?");
        expect(request.investigate).toBeUndefined();
        return decodeJsonReply(
          request,
          "test",
          JSON.stringify({ suggestion: '  "Fix the login form.\nRun its tests."  ' }),
        );
      });
      const result = yield* service.generateReplySuggestion({
        cwd: "/project",
        transcript: "assistant: Which file should I fix?",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
      });
      expect(operations).toEqual(["generateReplySuggestion"]);
      expect(result.suggestion).toBe("Fix the login form. Run its tests.");
    }),
  );

  it("allows no suggestion and caps runaway model output", () => {
    expect(sanitizeReplySuggestion('  ""  ')).toBe("");
    expect(sanitizeReplySuggestion("x".repeat(600))).toHaveLength(500);
    expect(buildReplySuggestionPrompt({ transcript: "done" }).prompt).toContain(
      "Return an empty string",
    );
  });
});
