import { describe, expect, it } from "vite-plus/test";
import { withProjectMemory } from "./projectMemory.ts";

describe("project memory in provider input", () => {
  it("keeps an empty memory and provider commands out of the prompt", () => {
    expect(withProjectMemory("Fix this", "   ")).toBe("Fix this");
    expect(withProjectMemory("/compact", "Use tabs")).toBe("/compact");
  });

  it("gives the provider bounded project context without changing the user request", () => {
    const result = withProjectMemory("Fix this", "  Use tabs  ");
    expect(result).toBe("<rycode_project_memory>\nUse tabs\n</rycode_project_memory>\n\nFix this");
    expect(withProjectMemory("Fix this", "x".repeat(5000)).length).toBeLessThan(4100);
  });
});
