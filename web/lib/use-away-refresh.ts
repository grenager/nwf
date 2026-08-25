"use client";

import { useEffect, useRef } from "react";

/** How long the user must be away before returning triggers a refresh. */
export const AWAY_REFRESH_MS: number = 10 * 60 * 1000;

/**
 * Run `onReturn` when the user comes back to the app after being away for at
 * least `awayMs`.
 *
 * "Away" covers backgrounding the tab, switching to another app or window, and
 * the page being frozen into the back/forward cache — polling timers are
 * throttled or suspended in all of those, so whatever is on screen when the
 * user looks again can be arbitrarily stale.
 *
 * `onReturn` is read through a ref, so an inline callback is fine: the
 * listeners are attached once instead of being torn down on every render.
 */
export function useAwayRefresh(
  onReturn: () => void,
  awayMs: number = AWAY_REFRESH_MS,
): void {
  const callbackRef = useRef<() => void>(onReturn);
  callbackRef.current = onReturn;

  useEffect(() => {
    // Set on the first signal that the user left, so a blur followed by a tab
    // switch still measures from when they actually walked away.
    let awaySince: number | null = null;

    function leave(): void {
      if (awaySince === null) awaySince = Date.now();
    }

    function returned(): void {
      if (document.visibilityState === "hidden") return;
      const since: number | null = awaySince;
      awaySince = null;
      if (since === null || Date.now() - since < awayMs) return;
      callbackRef.current();
    }

    function onVisibilityChange(): void {
      if (document.visibilityState === "hidden") leave();
      else returned();
    }

    function onPageShow(event: PageTransitionEvent): void {
      // A bfcache restore resumes a page whose timers were frozen while away.
      if (event.persisted) returned();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    // Desktop browsers keep an unfocused window "visible", so blur/focus is the
    // only signal when the user switches to another app.
    window.addEventListener("blur", leave);
    window.addEventListener("focus", returned);
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", returned);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [awayMs]);
}
