export interface PaneFocusInput {
  /** The currently focused pane, or null on first render. */
  readonly current: string | null;
  /** Pane ids in layout order. */
  readonly paneIds: ReadonlyArray<string>;
  /** A pane the user just interacted with, if any. */
  readonly requested?: string | null;
}

export function resolveFocusedPaneId(input: PaneFocusInput): string | null {
  const { current, paneIds, requested } = input;
  if (paneIds.length === 0) return null;
  if (requested != null && paneIds.includes(requested)) return requested;
  if (current != null && paneIds.includes(current)) return current;
  return paneIds[0] ?? null;
}

export function paneOwnsGlobalHandlers(input: {
  readonly paneId: string;
  readonly paneCount: number;
  readonly focusedPaneId: string | null;
}): boolean {
  if (input.paneCount <= 1) return true;
  return input.focusedPaneId === input.paneId;
}
