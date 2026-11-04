import type { MergedUsage } from "@t3tools/shared/usageMerge";
import { formatCount, formatDayShort, formatTokens } from "@t3tools/shared/usageFormat";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { buildUsageHeatmap, countActiveDays, favoriteModel } from "./UsageOverview.logic";
import { PROVIDER_PRESENTATION } from "./usageProviders";

const LEVEL_STRENGTH = ["0%", "35%", "55%", "78%", "100%"] as const;

/** Headline activity facts and a daily heatmap colored by each day's busiest agent. */
export function UsageOverview({
  days,
  merged,
}: {
  readonly days: readonly string[];
  readonly merged: MergedUsage;
}) {
  const weeks = (() => buildUsageHeatmap(days, merged.daily))();
  const favorite = favoriteModel(merged.models);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-foreground">Overview</h2>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <OverviewTile label="Sessions" value={formatCount(merged.sessions)} />
        <OverviewTile label="Responses" value={formatCount(merged.records)} />
        <OverviewTile
          label="Active days"
          value={`${formatCount(countActiveDays(merged.daily))} / ${formatCount(days.length)}`}
        />
        <OverviewTile label="Favorite model" value={favorite === null ? "None" : favorite.model} />
      </div>
      <div className="flex flex-col gap-2">
        <div
          role="img"
          aria-label="Daily token activity"
          className="grid w-fit grid-flow-col grid-rows-7 gap-1"
        >
          {weeks.flatMap((week, weekIndex) =>
            week.map((cell, dayIndex) => {
              const key = cell === null ? `pad-${weekIndex}-${dayIndex}` : cell.day;
              if (cell === null) return <span key={key} className="size-3.5" />;
              const background =
                cell.provider === null
                  ? undefined
                  : `color-mix(in oklab, ${PROVIDER_PRESENTATION[cell.provider].color} ${LEVEL_STRENGTH[cell.level]}, transparent)`;
              return (
                <Tooltip key={key}>
                  <TooltipTrigger
                    render={
                      <span
                        className="size-3.5 rounded-xs bg-muted"
                        style={
                          background === undefined ? undefined : { backgroundColor: background }
                        }
                      />
                    }
                  />
                  <TooltipPopup side="top">
                    {cell.provider === null
                      ? `${formatDayShort(cell.day)}: no activity`
                      : `${formatDayShort(cell.day)}: ${formatTokens(cell.totalTokens)} tokens, mostly ${PROVIDER_PRESENTATION[cell.provider].label}`}
                  </TooltipPopup>
                </Tooltip>
              );
            }),
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          Each day is colored by the agent that used the most tokens.
        </span>
      </div>
    </section>
  );
}

function OverviewTile({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-muted/50 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-base font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}
