import type { UsageProviderKind } from "@t3tools/contracts";
import type { DailyTotals } from "@t3tools/shared/usageMerge";
import { describe, expect, it } from "vite-plus/test";

import { buildUsageHeatmap, countActiveDays } from "./UsageOverview.logic";

function day(date: string, byProvider: Partial<Record<UsageProviderKind, number>>): DailyTotals {
  const entries = Object.entries(byProvider) as [UsageProviderKind, number][];
  return {
    day: date,
    costUsd: 0,
    totalTokens: entries.reduce((sum, [, tokens]) => sum + tokens, 0),
    byProvider: new Map(
      entries.map(([provider, tokens]) => [provider, { costUsd: 0, totalTokens: tokens }]),
    ),
  };
}

describe("buildUsageHeatmap", () => {
  it("pads the first week so rows line up with weekdays", () => {
    // 2026-09-23 is a Wednesday, so Sunday through Tuesday are padding.
    const weeks = buildUsageHeatmap(["2026-09-23", "2026-09-24"], []);
    expect(weeks).toHaveLength(1);
    expect(weeks[0]?.slice(0, 3)).toEqual([null, null, null]);
    expect(weeks[0]?.[3]?.day).toBe("2026-09-23");
  });

  it("colors each day by its busiest provider and scales against the peak day", () => {
    const weeks = buildUsageHeatmap(
      ["2026-09-20", "2026-09-21", "2026-09-22"],
      [day("2026-09-20", { claude: 900, codex: 100 }), day("2026-09-21", { codex: 10 })],
    );
    const [peak, quiet, idle] = weeks[0] ?? [];
    expect(peak).toMatchObject({ provider: "claude", level: 4 });
    expect(quiet).toMatchObject({ provider: "codex", level: 1 });
    expect(idle).toMatchObject({ provider: null, level: 0 });
  });
});

describe("countActiveDays", () => {
  it("counts only days with tokens", () => {
    expect(countActiveDays([day("2026-09-20", { grok: 5 }), day("2026-09-21", {})])).toBe(1);
  });
});
