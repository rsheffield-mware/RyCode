import type { UsageProviderKind } from "@t3tools/contracts";
import type { DailyTotals, ModelTotals } from "@t3tools/shared/usageMerge";

import { PROVIDER_ORDER } from "./usageProviders";

export interface UsageHeatmapCell {
  readonly day: string;
  readonly totalTokens: number;
  /** The provider that spent the most tokens that day, which colors the cell. */
  readonly provider: UsageProviderKind | null;
  /** 0 for an idle day, then 1-4 by intensity relative to the busiest day. */
  readonly level: 0 | 1 | 2 | 3 | 4;
}

function dominantProvider(totals: DailyTotals | undefined): UsageProviderKind | null {
  if (totals === undefined) return null;
  let best: UsageProviderKind | null = null;
  let bestTokens = 0;
  for (const provider of PROVIDER_ORDER) {
    const tokens = totals.byProvider.get(provider)?.totalTokens ?? 0;
    if (tokens > bestTokens) {
      best = provider;
      bestTokens = tokens;
    }
  }
  return best;
}

/**
 * Lays days out as week columns (Sunday first), padding the first column so
 * each row is one weekday. `null` marks padding before the window starts.
 */
export function buildUsageHeatmap(
  days: readonly string[],
  daily: readonly DailyTotals[],
): readonly (readonly (UsageHeatmapCell | null)[])[] {
  const totalsByDay = new Map(daily.map((entry) => [entry.day, entry] as const));
  const peak = Math.max(0, ...daily.map((entry) => entry.totalTokens));
  const cells: (UsageHeatmapCell | null)[] = [];
  const firstDay = days[0];
  if (firstDay !== undefined) {
    const leadingPadding = new Date(`${firstDay}T00:00:00Z`).getUTCDay();
    for (let index = 0; index < leadingPadding; index += 1) cells.push(null);
  }
  for (const day of days) {
    const totals = totalsByDay.get(day);
    const totalTokens = totals?.totalTokens ?? 0;
    // Square-root scaling keeps one huge day from flattening the rest to level 1.
    const level =
      totalTokens <= 0 || peak <= 0
        ? 0
        : (Math.min(4, Math.max(1, Math.ceil(Math.sqrt(totalTokens / peak) * 4))) as 1 | 2 | 3 | 4);
    cells.push({ day, totalTokens, provider: dominantProvider(totals), level });
  }
  const weeks: (UsageHeatmapCell | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

export function countActiveDays(daily: readonly DailyTotals[]): number {
  return daily.filter((entry) => entry.totalTokens > 0).length;
}

export function favoriteModel(models: readonly ModelTotals[]): ModelTotals | null {
  let favorite: ModelTotals | null = null;
  for (const model of models) {
    if (model.totalTokens > 0 && (favorite === null || model.totalTokens > favorite.totalTokens)) {
      favorite = model;
    }
  }
  return favorite;
}
