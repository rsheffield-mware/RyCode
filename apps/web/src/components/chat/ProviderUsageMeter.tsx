import type {
  ServerProvider,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { remainingPercent } from "@t3tools/shared/usageLimits";
import { useState } from "react";

import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";

import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { barColor, LimitWindows } from "../usage/UsageLimits";
import { composerFloatingLayerProps } from "./composerEventScope";
import { ContextWindowDetails, formatPercentage } from "./ContextWindowMeter";

/** The window with the least quota left: it is the one that will block a turn first. */
function tightestWindow(
  windows: readonly ServerProviderUsageWindow[],
): ServerProviderUsageWindow | undefined {
  let tightest: ServerProviderUsageWindow | undefined;
  for (const window of windows) {
    if (tightest === undefined || window.usedPercent > tightest.usedPercent) {
      tightest = window;
    }
  }
  return tightest;
}

/**
 * The selected provider's subscription quota as one ring: the window closest
 * to running out. Clicking opens the full per-window bars. A context window,
 * when passed, adds an inner ring and joins the popover.
 */
export function ProviderUsageMeter({
  limits,
  driver,
  contextWindow = null,
  modelDisplayName = null,
}: {
  readonly limits: ServerProviderUsageLimits;
  readonly driver: ServerProvider["driver"];
  readonly contextWindow?: ContextWindowSnapshot | null;
  readonly modelDisplayName?: string | null;
}) {
  // Stamped when the popover opens, so the countdowns are current on each
  // open without a timer repainting the composer.
  const [openedAt, setOpenedAt] = useState(0);
  const tightest = tightestWindow(limits.windows);
  // A failed probe keeps the last good windows; only an account that can never
  // report limits clears the ring.
  if (limits.unavailable?.reason === "unsupported" || tightest === undefined) {
    return null;
  }

  const remaining = remainingPercent(tightest);
  // Fills as quota is spent, like the context meter beside it, so a spent
  // window reads as a full red ring instead of vanishing.
  const used = Math.max(0, Math.min(100, tightest.usedPercent));
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - used / 100);
  const usageColor = remaining <= 10 ? "var(--color-error)" : barColor(driver);
  // usedPercentage is null until the provider reports maxTokens; skip the inner ring then.
  const contextUsed =
    contextWindow !== null && contextWindow.usedPercentage !== null
      ? Math.max(0, Math.min(100, contextWindow.usedPercentage))
      : null;
  // Same scheme as the outer ring: the provider's color until 10% is left.
  const contextColor =
    contextUsed !== null && contextUsed >= 90 ? "var(--color-error)" : barColor(driver);
  // Sits inside the outer ring's inner edge (8.25) with a small gap between them.
  const innerRadius = 5.25;
  const innerCircumference = 2 * Math.PI * innerRadius;
  const contextAriaLabel =
    contextWindow === null
      ? ""
      : `; context window ${
          formatPercentage(contextWindow.usedPercentage) ??
          `${formatContextWindowTokens(contextWindow.usedTokens)} tokens`
        } used`;
  const ariaLabel = `Usage limits: ${remaining}% left on ${tightest.label}${contextAriaLabel}`;

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) setOpenedAt(Date.now());
      }}
    >
      <PopoverTrigger
        render={
          <Button size="icon-sm" variant="ghost-muted" className="size-7" aria-label={ariaLabel}>
            <span className="relative flex size-5 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="-rotate-90 absolute inset-0 size-full transform-gpu mx-0!"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="color-mix(in oklab, var(--color-muted-foreground) 24%, transparent)"
                  strokeWidth="3"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke={usageColor}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none"
                />
                {contextUsed !== null ? (
                  <>
                    <circle
                      cx="12"
                      cy="12"
                      r={innerRadius}
                      fill="none"
                      stroke="color-mix(in oklab, var(--color-muted-foreground) 24%, transparent)"
                      strokeWidth="2.5"
                    />
                    <circle
                      cx="12"
                      cy="12"
                      r={innerRadius}
                      fill="none"
                      stroke={contextColor}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeDasharray={innerCircumference}
                      strokeDashoffset={innerCircumference * (1 - contextUsed / 100)}
                      className="transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none"
                    />
                  </>
                ) : null}
              </svg>
            </span>
          </Button>
        }
      />
      <PopoverPopup
        {...composerFloatingLayerProps}
        tooltipStyle
        side="top"
        align="end"
        className="w-80 max-w-none text-left whitespace-normal"
      >
        <div className="flex flex-col gap-2">
          <div className="font-medium text-muted-foreground text-xs">Usage limits</div>
          <LimitWindows compact driver={driver} windows={limits.windows} now={openedAt} />
          {contextWindow !== null ? (
            <div className="mt-1 flex flex-col gap-2 border-t border-border/60 pt-2">
              <ContextWindowDetails
                usage={contextWindow}
                modelDisplayName={modelDisplayName}
                barColor={contextColor}
              />
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
