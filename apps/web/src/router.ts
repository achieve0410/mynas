import { useSyncExternalStore } from "react";

const subscribe = (listener: () => void): (() => void) => {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
};

export const usePathname = (): string =>
  useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => "/",
  );

export const navigate = (path: string): void => {
  if (window.location.pathname === path) {
    return;
  }
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
};
