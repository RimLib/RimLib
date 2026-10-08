import { type UIEvent, useCallback, useEffect, useRef, useState } from "react";

export const virtualModHeight = 89;
const defaultViewportHeight = 720;
const overscanRows = 8;

export function useVirtualMods<T>(items: T[], resetKey: string) {
  const ref = useRef<HTMLDivElement>(null);
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
