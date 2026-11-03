"use client";

import { useLayoutEffect, useRef } from "react";

import { subscribeBrowserSurfaceLayout } from "./browserSurfaceLayout";
import { browserSurfaceBoxIsPresentable, measureBrowserSurfaceRect } from "./browserSurfaceRect";
import { acquireBrowserSurface } from "./browserSurfaceStore";

export function BrowserSurfaceSlot(props: {
  readonly tabId: string;
  readonly visible: boolean;
  readonly cornerRadius?: number;
  readonly zIndex?: number;
  readonly layoutVersion?: string | number;
  readonly className?: string;
  readonly fitSourceContent?: boolean;
}) {
  const {
    tabId,
    visible,
    cornerRadius = 0,
    zIndex = 30,
    layoutVersion,
    className,
    fitSourceContent = false,
  } = props;
  const elementRef = useRef<HTMLDivElement | null>(null);
  const presentationRef = useRef({ visible, cornerRadius, zIndex });
  const updateRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    // One lease for the slot's lifetime. While another slot holds this tab's
    // guest the lease keeps re-offering on every layout pass and the store
    // decides between the two; re-acquiring here would make the winner depend
    // on which slot measured first.
    const lease = acquireBrowserSurface(tabId, fitSourceContent);
    const update = () => {
      const presentation = presentationRef.current;
      const box = element.getBoundingClientRect();
      lease.present(
        measureBrowserSurfaceRect(box),
        presentation.visible && browserSurfaceBoxIsPresentable(box),
        presentation.cornerRadius,
        presentation.zIndex,
      );
    };
    updateRef.current = update;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    // Inline panels animate their outer width while keeping the content at
    // full width. The slot moves without resizing, so measure on shell resizes too.
    const panel = element.closest('[data-preview-panel-mode="inline"]');
    if (panel) observer.observe(panel);
    // A pane splitter drag can move this slot sideways without resizing it,
    // which no observer here would see.
    const unsubscribeLayout = subscribeBrowserSurfaceLayout(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      unsubscribeLayout();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      if (updateRef.current === update) updateRef.current = null;
      lease.release();
    };
  }, [fitSourceContent, tabId]);

  useLayoutEffect(() => {
    presentationRef.current = { visible, cornerRadius, zIndex };
    updateRef.current?.();
  }, [cornerRadius, layoutVersion, visible, zIndex]);

  return <div ref={elementRef} className={className} data-browser-surface-slot={tabId} />;
}
