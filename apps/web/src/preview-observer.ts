type PreviewCallback = () => void;

const callbacks = new Map<Element, PreviewCallback>();
let observer: IntersectionObserver | undefined;

const sharedObserver = (): IntersectionObserver => {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        const callback = callbacks.get(entry.target);
        observer?.unobserve(entry.target);
        callbacks.delete(entry.target);
        callback?.();
      }
      if (callbacks.size === 0) {
        observer?.disconnect();
        observer = undefined;
      }
    },
    { rootMargin: "240px" },
  );
  return observer;
};

export const observePreview = (element: Element, callback: PreviewCallback): (() => void) => {
  callbacks.set(element, callback);
  sharedObserver().observe(element);
  return () => {
    callbacks.delete(element);
    observer?.unobserve(element);
    if (callbacks.size === 0) {
      observer?.disconnect();
      observer = undefined;
    }
  };
};
