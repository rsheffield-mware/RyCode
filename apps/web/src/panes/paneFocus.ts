/**
 * Focus arbitration for the pane row.
 *
 * Exactly one pane is focused at a time. Every app-wide singleton listener
 * (the window keydown handlers, the global paste, the timeline scroll
 * anchoring, the preview action bus) consults this so a shortcut lands in the
 * pane the user is working in instead of firing once per mounted ChatView.
 */

export interface PaneFocusInput {
  /** The currently focused pane, or null on first render. */
  readonly current: string | null;
  /** Pane ids in layout order. */
  readonly paneIds: ReadonlyArray<string>;
  /** A pane the user just interacted with, if any. */
  readonly requested?: string | null;
}

/**
 * Resolves which pane holds focus. An explicit request wins when that pane is
 * still on screen; otherwise focus stays put, and only falls back to the first
 * pane when its previous owner is gone (closed, or promoted away).
 */
export function resolveFocusedPaneId(input: PaneFocusInput): string | null {
  const { current, paneIds, requested } = input;
  if (paneIds.length === 0) return null;
  if (requested != null && paneIds.includes(requested)) return requested;
  if (current != null && paneIds.includes(current)) return current;
  return paneIds[0] ?? null;
}

/**
 * True when a pane may run app-wide singleton behaviour. A lone pane always
 * qualifies, which keeps the single-pane path byte-for-byte the old one even
 * before any focus event has been recorded.
 */
export function paneOwnsGlobalHandlers(input: {
  readonly paneId: string;
  readonly paneCount: number;
  readonly focusedPaneId: string | null;
}): boolean {
  if (input.paneCount <= 1) return true;
  return input.focusedPaneId === input.paneId;
}
