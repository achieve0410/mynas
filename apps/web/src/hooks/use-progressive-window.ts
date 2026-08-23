import { type RefObject, useEffect, useRef, useState } from "react";

const windowSize = 60;

export const useProgressiveWindow = <Item>(
  items: readonly Item[],
  resetKey: string,
): {
  readonly items: readonly Item[];
  readonly sentinelRef: RefObject<HTMLDivElement | null>;
} => {
  const [visibleCount, setVisibleCount] = useState(windowSize);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const previousResetKey = useRef(resetKey);
  const safeVisibleCount = Math.min(visibleCount, items.length);
  const hasNext = safeVisibleCount < items.length;

  useEffect(() => {
    if (previousResetKey.current === resetKey) {
      return;
    }
    previousResetKey.current = resetKey;
    setVisibleCount(windowSize);
  }, [resetKey]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (sentinel === null || !hasNext) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          return;
        }
        observer.disconnect();
        setVisibleCount(Math.min(safeVisibleCount + windowSize, items.length));
      },
      { rootMargin: "320px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNext, items.length, safeVisibleCount]);

  return {
    items: items.slice(0, safeVisibleCount),
    sentinelRef,
  };
};
