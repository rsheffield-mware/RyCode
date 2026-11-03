/**
 * Pure pane-layout model for the multi-pane chat view.
 *
 * The layout is a depth-2 grid: a root axis, up to two *groups* running along
 * it, and up to two panes inside each group running across it. That is exactly
 * enough to express every arrangement of four panes up to a 2x2 grid, and not
 * enough to express anything harder to reason about.
 *
 * The first pane is the *primary* one: it is the route's own path params, so
 * every existing `useParams({ strict: false })` consumer keeps seeing exactly
 * what it saw before panes existed. Every other pane is serialized into the
 * `panes` search param on `_chat`, which makes a split layout shareable and
 * reload safe.
 *
 * Sizes are deliberately *not* in the URL: a drag would push a history entry
 * per frame. They persist locally instead (see `paneStore`).
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import type { DraftId } from "../composerDraftStore";
import type { ThreadRouteTarget } from "../threadRoutes";

/** Stable id of the pane that owns the route path params. */
export const PRIMARY_PANE_ID = "pane:primary";

/**
 * Upper bound on simultaneously mounted threads. Each pane carries a live
 * websocket subscription and a full ChatView, so this is a real resource cap
 * rather than a styling one.
 */
export const MAX_PANES = 4;
export const MAX_PANE_GROUPS = 2;
export const MAX_PANES_PER_GROUP = 2;

/** Width a newly split pane is given, mirroring `THREAD_MAIN_CONTENT_MIN_WIDTH`. */
export const PANE_MIN_WIDTH = 30 * 16;
/** Hard floor: below this a horizontal split is refused and a drag stops. */
export const PANE_FLOOR_WIDTH = 15 * 16;
/** Height a newly split pane is given. */
export const PANE_MIN_HEIGHT = 20 * 16;
/** Hard floor for a vertical split. */
export const PANE_FLOOR_HEIGHT = 12 * 16;

/**
 * Direction the root splits in. Groups run along this axis; panes inside a
 * group run across it. `row` renders groups as side-by-side columns whose
 * panes stack vertically; `column` renders groups as stacked rows whose panes
 * sit side by side.
 */
export type PaneAxis = "row" | "column";

/** Which side of a pane a split lands on. */
export type PaneEdge = "left" | "right" | "top" | "bottom";

/** A pane as it exists before sizes are applied. */
export interface PaneTargetEntry {
  /** Stable across reloads: derived from the target, so focus survives a refresh. */
  readonly paneId: string;
  readonly target: ThreadRouteTarget;
}

/**
 * The `panes` search value, decoded. `groups` is in render order and index 0
 * is the *primary pane's* group with the primary itself left out, since the
 * primary lives in the route's path params instead.
 */
export interface SecondaryPaneLayout {
  readonly axis: PaneAxis;
  readonly groups: ReadonlyArray<ReadonlyArray<PaneTargetEntry>>;
}

/** A layout holding nothing but the primary pane. */
export const EMPTY_PANE_LAYOUT: SecondaryPaneLayout = { axis: "row", groups: [[]] };

const GROUP_SEPARATOR = ",";
const PANE_SEPARATOR = "|";
const FIELD_SEPARATOR = ":";
const ESCAPE = "~";
/** Leading flag selecting the `column` root axis. No token may start with it. */
const COLUMN_AXIS_PREFIX = "v";

function isHorizontal(edge: PaneEdge): boolean {
  return edge === "left" || edge === "right";
}

function isBefore(edge: PaneEdge): boolean {
  return edge === "left" || edge === "top";
}

/** The size guards a split along `edge` has to clear. */
function paneEdgeGuards(edge: PaneEdge): { readonly min: number; readonly floor: number } {
  return isHorizontal(edge)
    ? { min: PANE_MIN_WIDTH, floor: PANE_FLOOR_WIDTH }
    : { min: PANE_MIN_HEIGHT, floor: PANE_FLOOR_HEIGHT };
}

/**
 * Escapes the delimiters inside an id.
 *
 * Percent-encoding cannot do this job: the router percent-decodes the whole
 * search value before `decodeSecondaryPanes` ever sees it, so a `%3A` written
 * here arrives as a bare `:`. Thread ids really do contain colons (provider
 * imports look like `import:claudeAgent:<uuid>`), so the escaping has to live
 * in the plaintext layer, below the URL encoding, where it survives the
 * round trip intact.
 */
function encodeField(value: string): string {
  return value
    .replaceAll(ESCAPE, `${ESCAPE}${ESCAPE}`)
    .replaceAll(FIELD_SEPARATOR, `${ESCAPE}s`)
    .replaceAll(GROUP_SEPARATOR, `${ESCAPE}c`)
    .replaceAll(PANE_SEPARATOR, `${ESCAPE}p`);
}

function decodeField(value: string): string | null {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== ESCAPE) {
      decoded += character;
      continue;
    }
    index += 1;
    const escaped = value[index];
    decoded +=
      escaped === "s"
        ? FIELD_SEPARATOR
        : escaped === "c"
          ? GROUP_SEPARATOR
          : escaped === "p"
            ? PANE_SEPARATOR
            : escaped === ESCAPE
              ? ESCAPE
              : // A lone trailing or unknown escape is a truncated value; keep the
                // characters rather than silently swallowing them.
                `${ESCAPE}${escaped ?? ""}`;
  }
  return decoded.trim().length === 0 ? null : decoded;
}

/** Token identifying a target. Doubles as the pane id, so it is reload stable. */
export function paneTargetToken(target: ThreadRouteTarget): string {
  return target.kind === "server"
    ? `t${FIELD_SEPARATOR}${encodeField(target.threadRef.environmentId)}${FIELD_SEPARATOR}${encodeField(target.threadRef.threadId)}`
    : `d${FIELD_SEPARATOR}${encodeField(target.draftId)}`;
}

/**
 * A token this module wrote always has exactly the expected field count, since
 * `encodeField` escapes the separator. Extra fields only appear in a
 * hand-written URL that left its colons unescaped, so the trailing fields are
 * rejoined rather than rejected: the id carrying colons is always the last one.
 */
function parsePaneToken(token: string): PaneTargetEntry | null {
  const parts = token.split(FIELD_SEPARATOR);
  if (parts[0] === "t" && parts.length >= 3) {
    const environmentId = decodeField(parts[1] ?? "");
    const threadId = decodeField(parts.slice(2).join(FIELD_SEPARATOR));
    if (environmentId === null || threadId === null) return null;
    const target: ThreadRouteTarget = {
      kind: "server",
      threadRef: scopeThreadRef(environmentId as EnvironmentId, threadId as ThreadId),
    };
    return { paneId: paneTargetToken(target), target };
  }
  if (parts[0] === "d" && parts.length >= 2) {
    const draftId = decodeField(parts.slice(1).join(FIELD_SEPARATOR));
    if (draftId === null) return null;
    const target: ThreadRouteTarget = { kind: "draft", draftId: draftId as DraftId };
    return { paneId: paneTargetToken(target), target };
  }
  return null;
}

/**
 * Enforces the layout invariants: at most `MAX_PANE_GROUPS` groups, no empty
 * group other than the primary's, and a meaningless axis reset to `row` once
 * only the primary is left.
 */
function makeLayout(
  axis: PaneAxis,
  groups: ReadonlyArray<ReadonlyArray<PaneTargetEntry>>,
): SecondaryPaneLayout {
  const kept = groups
    .filter((group, index) => index === 0 || group.length > 0)
    .slice(0, MAX_PANE_GROUPS);
  const normalized = kept.length === 0 ? [[]] : kept;
  const lonePane = normalized.length === 1 && normalized[0]!.length === 0;
  return { axis: lonePane ? "row" : axis, groups: normalized };
}

/**
 * True for a value written before the grid existed: a flat comma-separated
 * list meaning one pane per column. The current grammar always shows its hand
 * — a `|` somewhere, or a leading `v` — so this is a check, not a guess.
 */
function isLegacyPaneValue(value: string): boolean {
  return !value.includes(PANE_SEPARATOR) && !value.startsWith(COLUMN_AXIS_PREFIX);
}

/**
 * Folds a flat legacy list into the two-group grid. Rearranging a layout is a
 * far smaller betrayal than closing a thread the user had open, so every pane
 * up to `MAX_PANES` survives: the ordered list splits in half, counting the
 * primary as its first entry even though the string never names it.
 */
function decodeLegacyPanes(value: string): SecondaryPaneLayout {
  const secondaries: PaneTargetEntry[] = [];
  const seen = new Set<string>();
  for (const token of value.split(GROUP_SEPARATOR)) {
    // The primary already occupies one of the four slots.
    if (secondaries.length >= MAX_PANES - 1) break;
    const entry = parsePaneToken(token);
    if (!entry || seen.has(entry.paneId)) continue;
    seen.add(entry.paneId);
    secondaries.push(entry);
  }
  if (secondaries.length === 0) return EMPTY_PANE_LAYOUT;
  const split = Math.floor((secondaries.length + 1) / 2);
  return makeLayout("row", [secondaries.slice(0, split - 1), secondaries.slice(split - 1)]);
}

/**
 * Reads the `panes` search value. Malformed entries are dropped and the caps
 * clamp rather than throw: a hand-edited or truncated URL should degrade to
 * fewer panes, never to a blank app.
 *
 * The grammar is `[v][|]group(,group)*` where a group is `token(|token)*`. A
 * leading `v` selects the `column` axis and a leading `|` says the first group
 * is the primary pane's. A value in neither shape predates the grid and is
 * folded into it; a value in this grammar that still breaks a cap was
 * hand-edited, so the surplus is dropped instead.
 */
export function decodeSecondaryPanes(raw: unknown): SecondaryPaneLayout {
  if (typeof raw !== "string" || raw.length === 0) return EMPTY_PANE_LAYOUT;
  if (isLegacyPaneValue(raw)) return decodeLegacyPanes(raw);
  let value = raw;
  let axis: PaneAxis = "row";
  if (value.startsWith(COLUMN_AXIS_PREFIX)) {
    axis = "column";
    value = value.slice(COLUMN_AXIS_PREFIX.length);
  }
  let groupIndex = 1;
  if (value.startsWith(PANE_SEPARATOR)) {
    groupIndex = 0;
    value = value.slice(PANE_SEPARATOR.length);
  }
  const groups: PaneTargetEntry[][] = [[]];
  const seen = new Set<string>();
  let total = 1;
  for (const segment of value.split(GROUP_SEPARATOR)) {
    if (groupIndex >= MAX_PANE_GROUPS) break;
    const group = groups[groupIndex] ?? [];
    groups[groupIndex] = group;
    // The primary already occupies one slot in its own group.
    const capacity = groupIndex === 0 ? MAX_PANES_PER_GROUP - 1 : MAX_PANES_PER_GROUP;
    for (const token of segment.split(PANE_SEPARATOR)) {
      if (group.length >= capacity || total >= MAX_PANES) break;
      const entry = parsePaneToken(token);
      if (!entry || seen.has(entry.paneId)) continue;
      seen.add(entry.paneId);
      group.push(entry);
      total += 1;
    }
    // A segment that produced nothing was garbage, and must not burn one of
    // the two group slots on its way out.
    if (group.length > 0) groupIndex += 1;
  }
  return makeLayout(axis, groups);
}

/** Serializes a layout back to the search value, or `undefined` when empty. */
export function encodeSecondaryPanes(layout: SecondaryPaneLayout): string | undefined {
  const head = (layout.groups[0] ?? []).map((pane) => pane.paneId).join(PANE_SEPARATOR);
  const tail = layout.groups
    .slice(1)
    .map((group) => group.map((pane) => pane.paneId).join(PANE_SEPARATOR))
    .filter((segment) => segment.length > 0);
  if (head.length === 0 && tail.length === 0) return undefined;
  const body = (head.length === 0 ? tail : [head, ...tail]).join(GROUP_SEPARATOR);
  const axisPrefix = layout.axis === "column" ? COLUMN_AXIS_PREFIX : "";
  return `${axisPrefix}${head.length === 0 ? "" : PANE_SEPARATOR}${body}`;
}

/** Every secondary pane in render order: groups in order, panes within a group in order. */
export function flattenSecondaryPanes(layout: SecondaryPaneLayout): ReadonlyArray<PaneTargetEntry> {
  return layout.groups.flat();
}

/** Pane ids as rendered, with the primary at group 0, pane 0. */
export function paneIdGrid(layout: SecondaryPaneLayout): ReadonlyArray<ReadonlyArray<string>> {
  return layout.groups.map((group, index) =>
    index === 0
      ? [PRIMARY_PANE_ID, ...group.map((pane) => pane.paneId)]
      : group.map((pane) => pane.paneId),
  );
}

function withoutPane(
  layout: SecondaryPaneLayout,
  matches: (pane: PaneTargetEntry) => boolean,
): SecondaryPaneLayout {
  let changed = false;
  const groups = layout.groups.map((group) => {
    const filtered = group.filter((pane) => !matches(pane));
    if (filtered.length !== group.length) changed = true;
    return filtered;
  });
  return changed ? makeLayout(layout.axis, groups) : layout;
}

/**
 * Drops any secondary pane that duplicates the primary target. The primary
 * pane follows the route, so navigating it onto a thread that is already open
 * beside it would otherwise show the same thread twice.
 */
export function reconcileSecondaryPanes(
  layout: SecondaryPaneLayout,
  primaryTarget: ThreadRouteTarget | null,
): SecondaryPaneLayout {
  if (primaryTarget === null) return layout;
  const primaryToken = paneTargetToken(primaryTarget);
  return withoutPane(layout, (pane) => pane.paneId === primaryToken);
}

export function removeSecondaryPane(
  layout: SecondaryPaneLayout,
  paneId: string,
): SecondaryPaneLayout {
  return withoutPane(layout, (pane) => pane.paneId === paneId);
}

/**
 * Closing the primary pane promotes the next one in render order: the route
 * navigates to the promoted target and that pane leaves the search param.
 */
export function promotePrimaryPane(layout: SecondaryPaneLayout): {
  readonly promoted: ThreadRouteTarget;
  readonly layout: SecondaryPaneLayout;
} | null {
  const next = flattenSecondaryPanes(layout)[0];
  if (next === undefined) return null;
  return { promoted: next.target, layout: removeSecondaryPane(layout, next.paneId) };
}

interface PaneAddress {
  readonly group: number;
  readonly pane: number;
}

function locatePane(
  grid: ReadonlyArray<ReadonlyArray<string>>,
  paneId: string,
): PaneAddress | null {
  for (let group = 0; group < grid.length; group += 1) {
    const pane = grid[group]?.indexOf(paneId) ?? -1;
    if (pane !== -1) return { group, pane };
  }
  return null;
}

function countPanes(grid: ReadonlyArray<ReadonlyArray<unknown>>): number {
  return grid.reduce((total, group) => total + group.length, 0);
}

/** Where a split puts the new pane, once the caps and guards have said yes. */
export type PanePlacement =
  | { readonly kind: "group"; readonly index: number }
  | { readonly kind: "pane"; readonly groupIndex: number; readonly index: number };

export type PaneSplitOutcome =
  | {
      readonly kind: "ok";
      readonly placement: PanePlacement;
      /** The root axis the layout ends up with; a lone pane's split chooses it. */
      readonly axis: PaneAxis;
      /** Share of its container the new pane takes, in `0..1`. */
      readonly newFraction: number;
      readonly before: boolean;
    }
  /** The drop would land the pane back where it already is. */
  | { readonly kind: "noop" }
  /** A cap is in the way: four panes, two groups, or two panes in a group. */
  | { readonly kind: "full" }
  /** Shrinking the existing pane would push it below the floor. */
  | { readonly kind: "no-room" };

/**
 * Decides what splitting `anchorPaneId` along `edge` does, without touching
 * any targets. Shared by the drop overlay (which only needs to know whether
 * the split is legal) and `planPaneDrop` (which then applies it).
 *
 * `anchorExtent` is the anchor pane's size along `edge` in px. Since a split
 * only ever happens into a container holding one child, that extent *is* the
 * container's, which is why no other measurement is needed. Zero means the
 * caller could not measure, and an even split is assumed rather than refused.
 *
 * Returns null when the anchor is not on screen.
 */
export function resolvePaneSplit(input: {
  readonly grid: ReadonlyArray<ReadonlyArray<string>>;
  readonly axis: PaneAxis;
  readonly anchorPaneId: string;
  readonly edge: PaneEdge;
  readonly anchorExtent: number;
  /** Set when the pane is already on screen and is being moved rather than opened. */
  readonly movingPaneId?: string | null;
}): PaneSplitOutcome | null {
  const { anchorExtent, anchorPaneId, axis, edge, grid } = input;
  const moving = input.movingPaneId ?? null;
  const anchor = locatePane(grid, anchorPaneId);
  if (anchor === null) return null;
  if (moving === anchorPaneId) return { kind: "noop" };

  const before = isBefore(edge);
  const lonePane = countPanes(grid) === 1;
  const splitsIntoGroup = lonePane || (isHorizontal(edge) ? axis === "row" : axis === "column");
  // A lone pane's axis is free, so the edge picks it.
  const nextAxis = lonePane ? (isHorizontal(edge) ? "row" : "column") : axis;

  const from = moving === null ? null : locatePane(grid, moving);
  if (from !== null) {
    // Either boundary of a slot resolves to the slot itself, so both edges
    // around the pane's current home are a no-op rather than a reshuffle.
    const slot = splitsIntoGroup
      ? before
        ? anchor.group
        : anchor.group + 1
      : before
        ? anchor.pane
        : anchor.pane + 1;
    const home = splitsIntoGroup
      ? (grid[from.group]?.length ?? 0) === 1
        ? from.group
        : -1
      : from.group === anchor.group
        ? from.pane
        : -1;
    if (home !== -1 && (slot === home || slot === home + 1)) return { kind: "noop" };
  }

  // Indices are resolved against the grid the pane will actually be inserted
  // into, so a move out of a group that empties does not shift the landing.
  const reduced =
    from === null
      ? grid
      : grid
          .map((group) => group.filter((paneId) => paneId !== moving))
          .filter((group) => group.length > 0);
  const landing = from === null ? anchor : locatePane(reduced, anchorPaneId);
  if (landing === null) return null;

  if (countPanes(reduced) >= MAX_PANES) return { kind: "full" };
  const placement: PanePlacement = splitsIntoGroup
    ? { kind: "group", index: before ? landing.group : landing.group + 1 }
    : { kind: "pane", groupIndex: landing.group, index: before ? landing.pane : landing.pane + 1 };
  if (placement.kind === "group") {
    if (reduced.length >= MAX_PANE_GROUPS) return { kind: "full" };
  } else if ((reduced[placement.groupIndex]?.length ?? 0) >= MAX_PANES_PER_GROUP) {
    return { kind: "full" };
  }

  const { floor, min } = paneEdgeGuards(edge);
  if (anchorExtent > 0 && anchorExtent < min + floor) return { kind: "no-room" };
  // An even split is the default; the new pane only claims the minimum when an
  // even one would leave it too narrow to use.
  const newFraction =
    anchorExtent <= 0 || anchorExtent / 2 >= min ? 0.5 : Math.min(min / anchorExtent, 1);
  return { kind: "ok", placement, axis: nextAxis, newFraction, before };
}

/** What a split wants persisted, so the computed fraction survives the render. */
export interface PaneSplitSizing {
  readonly axis: PaneAxis;
  /** The group whose panes were split, or null when the groups themselves were. */
  readonly groupIndex: number | null;
  readonly fractions: readonly [number, number];
}

export type PaneDropPlan =
  /** Nothing to do: the drop would land the thread back where it already is. */
  | { readonly kind: "noop" }
  | { readonly kind: "full" }
  | { readonly kind: "no-room" }
  /** The route keeps its thread; only the `panes` search value changes. */
  | {
      readonly kind: "secondary";
      readonly layout: SecondaryPaneLayout;
      readonly sizing: PaneSplitSizing | null;
    }
  /**
   * The grid's first slot changed, so the route has to navigate: the primary
   * pane *is* the path params.
   */
  | {
      readonly kind: "promote";
      readonly primary: ThreadRouteTarget;
      readonly layout: SecondaryPaneLayout;
      readonly sizing: PaneSplitSizing | null;
    };

/** A split outcome worth retrying on the perpendicular edge. */
export function isPaneSplitRefusal(kind: PaneDropPlan["kind"]): kind is "full" | "no-room" {
  return kind === "full" || kind === "no-room";
}

/**
 * Names the reason a split was refused on *both* edges, or null while either
 * one still landed. A cap and a window too small to divide need different
 * wording, and only a cap refuses every edge: once four panes are open the
 * pane count is checked before any size guard, so a mixed pair of refusals
 * means there was room in the grid but not on the screen.
 */
export function resolvePaneSplitRefusal(
  attempted: PaneDropPlan["kind"],
  fallback: PaneDropPlan["kind"],
): "full" | "no-room" | null {
  if (!isPaneSplitRefusal(attempted) || !isPaneSplitRefusal(fallback)) return null;
  return attempted === "full" && fallback === "full" ? "full" : "no-room";
}

/**
 * Places a target beside `anchorPaneId`, on the given edge. A thread already
 * on screen is *moved* to the new slot rather than opened twice, which keeps
 * the one-pane-per-thread rule without making a drop onto an already-open
 * thread do nothing.
 */
export function planPaneDrop(input: {
  readonly primaryTarget: ThreadRouteTarget | null;
  readonly layout: SecondaryPaneLayout;
  readonly target: ThreadRouteTarget;
  /** `PRIMARY_PANE_ID` for the route's own pane, a target token otherwise. */
  readonly anchorPaneId: string;
  readonly edge: PaneEdge;
  readonly anchorExtent: number;
}): PaneDropPlan {
  const { anchorExtent, edge, primaryTarget, target } = input;
  if (primaryTarget === null) return { kind: "noop" };
  const primaryToken = paneTargetToken(primaryTarget);
  const layout = reconcileSecondaryPanes(input.layout, primaryTarget);
  // One id space for the whole grid: the route's pane answers to its token
  // here, and only becomes `PRIMARY_PANE_ID` again once it is rendered.
  const entries: PaneTargetEntry[][] = layout.groups.map((group, index) =>
    index === 0 ? [{ paneId: primaryToken, target: primaryTarget }, ...group] : [...group],
  );
  const anchorPaneId = input.anchorPaneId === PRIMARY_PANE_ID ? primaryToken : input.anchorPaneId;
  const token = paneTargetToken(target);
  const grid = entries.map((group) => group.map((pane) => pane.paneId));
  const outcome = resolvePaneSplit({
    grid,
    axis: layout.axis,
    anchorPaneId,
    edge,
    anchorExtent,
    movingPaneId: locatePane(grid, token) === null ? null : token,
  });
  if (outcome === null) return { kind: "noop" };
  if (outcome.kind !== "ok") return { kind: outcome.kind };

  const entry: PaneTargetEntry = { paneId: token, target };
  const next = entries
    .map((group) => group.filter((pane) => pane.paneId !== token))
    .filter((group) => group.length > 0);
  if (outcome.placement.kind === "group") {
    next.splice(outcome.placement.index, 0, [entry]);
  } else {
    next[outcome.placement.groupIndex]?.splice(outcome.placement.index, 0, entry);
  }

  const head = next[0]?.[0];
  if (head === undefined) return { kind: "noop" };
  const sizing: PaneSplitSizing = {
    axis: outcome.axis,
    groupIndex: outcome.placement.kind === "group" ? null : outcome.placement.groupIndex,
    fractions: outcome.before
      ? [outcome.newFraction, 1 - outcome.newFraction]
      : [1 - outcome.newFraction, outcome.newFraction],
  };
  const nextLayout = makeLayout(
    outcome.axis,
    next.map((group, index) => (index === 0 ? group.slice(1) : group)),
  );
  return head.paneId === primaryToken
    ? { kind: "secondary", layout: nextLayout, sizing }
    : { kind: "promote", primary: head.target, layout: nextLayout, sizing };
}

/**
 * Coerces persisted fractions onto `count` siblings. A stored list of the
 * wrong length, containing a non-finite or non-positive entry, is discarded in
 * favour of an even split rather than partially repaired: a half-repaired
 * layout is harder to reason about than a reset one.
 */
export function normalizePaneFractions(
  stored: ReadonlyArray<number> | null | undefined,
  count: number,
): ReadonlyArray<number> {
  if (count <= 0) return [];
  const even = Array.from({ length: count }, () => 1 / count);
  if (!stored || stored.length !== count) return even;
  let total = 0;
  for (const value of stored) {
    if (!Number.isFinite(value) || value <= 0) return even;
    total += value;
  }
  if (total <= 0) return even;
  return stored.map((value) => value / total);
}

/**
 * Moves the boundary between sibling `index` and `index + 1` by
 * `deltaFraction`, leaving every other sibling untouched. Both neighbours are
 * held at `floorFraction` — the hard floor, not the size a fresh split is
 * given, so a pane that was split narrow can still be dragged.
 */
export function resizePaneFractions(
  fractions: ReadonlyArray<number>,
  index: number,
  deltaFraction: number,
  floorFraction: number,
): ReadonlyArray<number> {
  const before = fractions[index];
  const after = fractions[index + 1];
  if (before === undefined || after === undefined) return fractions;
  const pairTotal = before + after;
  // A pair too small to satisfy both guards has nothing to give; refuse the
  // drag rather than emit sizes that violate the floor.
  if (pairTotal < floorFraction * 2) return fractions;
  const nextBefore = Math.min(
    Math.max(before + deltaFraction, floorFraction),
    pairTotal - floorFraction,
  );
  if (nextBefore === before) return fractions;
  const next = [...fractions];
  next[index] = nextBefore;
  next[index + 1] = pairTotal - nextBefore;
  return next;
}

export interface RenderedPane extends PaneTargetEntry {
  /** Share of the group's cross-axis extent, in `0..1`. Sums to 1 per group. */
  readonly sizeFraction: number;
}

export interface RenderedPaneGroup {
  readonly panes: ReadonlyArray<RenderedPane>;
  /** Share of the root axis extent, in `0..1`. Sums to 1 across groups. */
  readonly sizeFraction: number;
}

export interface RenderedPaneLayout {
  readonly axis: PaneAxis;
  readonly groups: ReadonlyArray<RenderedPaneGroup>;
  readonly paneCount: number;
}

/** Builds the grid the layout renders, sizes included. */
export function buildPaneLayout(input: {
  readonly primaryTarget: ThreadRouteTarget;
  readonly layout: SecondaryPaneLayout;
  readonly groupFractions: ReadonlyArray<number> | null;
  /** Stored pane fractions per group index. */
  readonly paneFractions: ReadonlyArray<ReadonlyArray<number> | null>;
}): RenderedPaneLayout {
  const layout = reconcileSecondaryPanes(input.layout, input.primaryTarget);
  const entries = layout.groups.map((group, index) =>
    index === 0 ? [{ paneId: PRIMARY_PANE_ID, target: input.primaryTarget }, ...group] : [...group],
  );
  const groupSizes = normalizePaneFractions(input.groupFractions, entries.length);
  const groups = entries.map((group, groupIndex) => {
    const paneSizes = normalizePaneFractions(input.paneFractions[groupIndex], group.length);
    return {
      sizeFraction: groupSizes[groupIndex] ?? 1 / entries.length,
      panes: group.map((pane, paneIndex) => ({
        ...pane,
        sizeFraction: paneSizes[paneIndex] ?? 1 / group.length,
      })),
    };
  });
  return { axis: layout.axis, groups, paneCount: countPanes(entries) };
}
