import { type UIEvent, useCallback, useEffect, useRef, useState } from "react";

export const virtualModHeight = 89;
const defaultViewportHeight = 720;
const overscanRows = 8;

export interface VirtualRevealRequest {
  key: number;
  index: number;
}

export function virtualScrollTopForIndex(
  scrollTop: number,
  viewportHeight: number,
  index: number,
): number {
  if (index < 0) {
    return scrollTop;
  }
  const rowTop = index * virtualModHeight;
  const rowBottom = rowTop + virtualModHeight;
  if (rowTop < scrollTop) {
    return rowTop;
  }
  return rowBottom > scrollTop + viewportHeight
    ? Math.max(0, rowBottom - viewportHeight)
    : scrollTop;
}

export function useVirtualMods<T>(
  items: T[],
  resetKey: string,
  revealRequest?: VirtualRevealRequest,
) {
  const ref = useRef<HTMLDivElement>(null);
  const handledRevealKey = useRef<number | undefined>(undefined);
  const revealKey = revealRequest?.key;
  const revealIndex = revealRequest?.index ?? -1;
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(defaultViewportHeight);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const measure = () => {
      setHeight(element.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = 0;
    }
    setScrollTop(0);
  }, [resetKey]);
  useEffect(() => {
    const element = ref.current;
    if (
      !element ||
      revealKey === undefined ||
      handledRevealKey.current === revealKey ||
      revealIndex < 0 ||
      revealIndex >= items.length
    ) {
      return;
    }
    const next = virtualScrollTopForIndex(
      element.scrollTop,
      element.clientHeight || height,
      revealIndex,
    );
    if (next !== element.scrollTop) {
      element.scrollTop = next;
      setScrollTop(next);
    }
    handledRevealKey.current = revealKey;
  }, [height, items.length, revealIndex, revealKey]);
  const start = Math.min(
    Math.max(0, items.length - Math.ceil(height / virtualModHeight)),
    Math.max(0, Math.floor(scrollTop / virtualModHeight) - overscanRows),
  );
  const end = Math.min(
    items.length,
    start + Math.ceil(height / virtualModHeight) + 2 * overscanRows,
  );
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);
  return {
    ref,
    onScroll,
    visible: items.slice(start, end),
    top: start * virtualModHeight,
    bottom: Math.max(0, items.length - end) * virtualModHeight,
  };
}
