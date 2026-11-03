import { create } from "zustand";

import { notifyBrowserSurfaceLayoutChanged } from "./browserSurfaceLayout";
import { browserSurfaceOwnerYields } from "./browserSurfaceRect";

export interface BrowserSurfaceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BrowserSurfacePresentation {
  readonly rect: BrowserSurfaceRect | null;
  readonly visible: boolean;
  readonly zIndex: number;
  readonly content: BrowserSurfaceContentPresentation | null;
  readonly fittedSourceContent: BrowserSurfaceContentPresentation | null;
  readonly fitSourceContent: boolean;
  readonly cornerRadius: number;
  readonly updatedAt: number;
  readonly owner: symbol | null;
}

export interface BrowserSurfaceContentPresentation {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly scrollLeft: number;
  readonly scrollTop: number;
}

interface BrowserSurfaceStoreState {
  readonly activityByTabId: Record<string, number>;
  readonly byTabId: Record<string, BrowserSurfacePresentation>;
  readonly acquireActivity: (tabId: string) => () => void;
  readonly claim: (tabId: string, owner: symbol, fitSourceContent: boolean) => void;
  readonly present: (
    tabId: string,
    owner: symbol,
    fitSourceContent: boolean,
    rect: BrowserSurfaceRect,
    visible: boolean,
    cornerRadius: number,
    zIndex: number,
  ) => void;
  readonly presentContent: (tabId: string, content: BrowserSurfaceContentPresentation) => void;
  readonly release: (tabId: string, owner: symbol) => void;
}

export interface BrowserSurfaceLease {
  readonly present: (
    rect: BrowserSurfaceRect,
    visible: boolean,
    cornerRadius?: number,
    zIndex?: number,
  ) => boolean;
  readonly release: () => void;
}

export function resolveBrowserSurfacePanelRect(
  byTabId: Readonly<Record<string, BrowserSurfacePresentation>>,
  tabId: string,
): BrowserSurfaceRect | null {
  const current = byTabId[tabId];
  return current?.rect ?? null;
}

const rectEquals = (left: BrowserSurfaceRect | null, right: BrowserSurfaceRect): boolean =>
  left !== null &&
  left.x === right.x &&
  left.y === right.y &&
  left.width === right.width &&
  left.height === right.height;

export const useBrowserSurfaceStore = create<BrowserSurfaceStoreState>()((set) => ({
  activityByTabId: {},
  byTabId: {},
  acquireActivity: (tabId) => {
    let released = false;
    set((state) => ({
      activityByTabId: {
        ...state.activityByTabId,
        [tabId]: (state.activityByTabId[tabId] ?? 0) + 1,
      },
    }));
    return () => {
      if (released) return;
      released = true;
      set((state) => {
        const count = state.activityByTabId[tabId] ?? 0;
        const activityByTabId = { ...state.activityByTabId };
        if (count <= 1) delete activityByTabId[tabId];
        else activityByTabId[tabId] = count - 1;
        return { activityByTabId };
      });
    };
  },
  claim: (tabId, owner, fitSourceContent) =>
    set((state) => {
      const current = state.byTabId[tabId];
      if (current?.owner === owner) return state;
      // Mounting takes a free or idle surface. A slot that arrives while
      // another one is showing the guest waits, and wins it through `present`,
      // which arbitrates on what the two slots ask to show rather than on
      // which of them mounted or measured first.
      if (current && current.owner !== null && current.visible) return state;
      return {
        byTabId: {
          ...state.byTabId,
          [tabId]: {
            rect: current?.rect ?? null,
            visible: false,
            zIndex: current?.zIndex ?? 30,
            content: current?.content ?? null,
            fittedSourceContent: fitSourceContent ? (current?.content ?? null) : null,
            fitSourceContent,
            cornerRadius: current?.cornerRadius ?? 0,
            updatedAt: Date.now(),
            owner,
          },
        },
      };
    }),
  present: (tabId, owner, fitSourceContent, rect, visible, cornerRadius, zIndex) =>
    set((state) => {
      const current = state.byTabId[tabId];
      if (!current) return state;
      const takingOver = current.owner !== owner;
      if (
        takingOver &&
        current.owner !== null &&
        !browserSurfaceOwnerYields({
          owner: { visible: current.visible, zIndex: current.zIndex },
          challenger: { visible, zIndex },
        })
      ) {
        return state;
      }
      if (
        !takingOver &&
        current.visible === visible &&
        current.cornerRadius === cornerRadius &&
        current.zIndex === zIndex &&
        rectEquals(current.rect, rect)
      ) {
        return state;
      }
      return {
        byTabId: {
          ...state.byTabId,
          [tabId]: {
            ...current,
            rect,
            visible,
            cornerRadius,
            zIndex,
            updatedAt: Date.now(),
            ...(takingOver
              ? {
                  owner,
                  fitSourceContent,
                  fittedSourceContent: fitSourceContent ? current.content : null,
                }
              : {}),
          },
        },
      };
    }),
  presentContent: (tabId, content) =>
    set((state) => {
      const current = state.byTabId[tabId];
      if (!current) {
        return {
          byTabId: {
            ...state.byTabId,
            [tabId]: {
              rect: null,
              visible: false,
              zIndex: 30,
              content,
              fittedSourceContent: null,
              fitSourceContent: false,
              cornerRadius: 0,
              updatedAt: Date.now(),
              owner: null,
            },
          },
        };
      }
      const previous = current.content;
      if (
        previous &&
        previous.x === content.x &&
        previous.y === content.y &&
        previous.width === content.width &&
        previous.height === content.height &&
        previous.scale === content.scale &&
        previous.scrollLeft === content.scrollLeft &&
        previous.scrollTop === content.scrollTop
      ) {
        return state;
      }
      return {
        byTabId: {
          ...state.byTabId,
          [tabId]: {
            ...current,
            content,
            fittedSourceContent:
              current.fitSourceContent && current.fittedSourceContent === null
                ? content
                : current.fittedSourceContent,
            updatedAt: Date.now(),
          },
        },
      };
    }),
  release: (tabId, owner) =>
    set((state) => {
      const current = state.byTabId[tabId];
      if (current?.owner !== owner) return state;
      return {
        byTabId: {
          ...state.byTabId,
          [tabId]: {
            ...current,
            visible: false,
            fittedSourceContent: null,
            fitSourceContent: false,
            updatedAt: Date.now(),
            owner: null,
          },
        },
      };
    }),
}));

export const acquireBrowserSurfaceActivity = (tabId: string): (() => void) =>
  useBrowserSurfaceStore.getState().acquireActivity(tabId);

export function acquireBrowserSurface(
  tabId: string,
  fitSourceContent = false,
): BrowserSurfaceLease {
  const owner = Symbol(`browser-surface:${tabId}`);
  let released = false;
  useBrowserSurfaceStore.getState().claim(tabId, owner, fitSourceContent);

  const isOwner = () =>
    !released && useBrowserSurfaceStore.getState().byTabId[tabId]?.owner === owner;

  return {
    present: (rect, visible, cornerRadius = 0, zIndex = 30) => {
      if (released) return false;
      const before = useBrowserSurfaceStore.getState().byTabId[tabId];
      useBrowserSurfaceStore
        .getState()
        .present(tabId, owner, fitSourceContent, rect, visible, cornerRadius, zIndex);
      if (!isOwner()) return false;
      // A slot that stops showing the guest, or that has just taken it from
      // another slot, leaves the loser measuring a surface it no longer owns.
      // Nudge every slot rather than leave one waiting for its own observer to
      // happen to fire.
      if ((before?.visible === true && !visible) || before?.owner !== owner) {
        notifyBrowserSurfaceLayoutChanged();
      }
      return true;
    },
    release: () => {
      if (released) return;
      const wasOwner = isOwner();
      released = true;
      useBrowserSurfaceStore.getState().release(tabId, owner);
      if (wasOwner) notifyBrowserSurfaceLayoutChanged();
    },
  };
}
