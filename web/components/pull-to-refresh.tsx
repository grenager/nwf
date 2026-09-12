"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Below Tailwind's `sm` the app is in its mobile layout: the bottom tab bar is
 * up, and the window — not <main> — is the scroller. Both are what this gesture
 * assumes, so it stays off everywhere else.
 */
const MOBILE_QUERY: string = "(max-width: 639px)";
/** How far the indicator has to travel before releasing refreshes. */
const THRESHOLD_PX: number = 64;
/** Where the indicator parks while the refresh is in flight. */
const RESTING_PX: number = 52;
/** Pulling further than this does nothing more. */
const MAX_PULL_PX: number = 110;
/** Height of the indicator, so it can be parked just off the top. */
const INDICATOR_PX: number = 40;
/** How far sideways a drag may wander before it counts as a swipe, not a pull. */
const HORIZONTAL_SLOP_PX: number = 12;

/**
 * The pull gets heavier the further it goes, so a flick doesn't drag the whole
 * page down and the threshold takes a deliberate gesture to cross.
 */
function resist(distance: number): number {
  return MAX_PULL_PX * (1 - Math.exp(-distance / MAX_PULL_PX));
}

/**
 * Browsers have their own pull-at-the-top gesture, which reloads the document.
 * Ours would fire alongside it, so it's suppressed for as long as any
 * PullToRefresh is mounted — counted, since a page could mount more than one.
 */
let nativeSuppressors: number = 0;

function suppressNativePullToRefresh(): () => void {
  const root: HTMLElement = document.documentElement;
  if (nativeSuppressors === 0) root.style.overscrollBehaviorY = "contain";
  nativeSuppressors += 1;
  return () => {
    nativeSuppressors -= 1;
    if (nativeSuppressors === 0) root.style.overscrollBehaviorY = "";
  };
}

/**
 * Wraps a page so that, in the mobile layout, dragging down from the very top
 * re-fetches it from the server.
 *
 * `onRefresh` is read through a ref, so an inline callback is fine: the touch
 * listeners are attached once instead of being torn down on every render.
 */
export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const onRefreshRef = useRef<() => Promise<void> | void>(onRefresh);
  onRefreshRef.current = onRefresh;

  const [pull, setPull] = useState<number>(0);
  const [dragging, setDragging] = useState<boolean>(false);
  // A transform — even translateY(0) — makes the wrapper a containing block for
  // fixed descendants and its own stacking context, so the content carries one
  // only while a pull is on screen or settling back out of sight.
  const [offset, setOffset] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  // The touch handlers run outside React's render, so they read the in-flight
  // state from a ref rather than a stale closure over `refreshing`.
  const refreshingRef = useRef<boolean>(false);

  useEffect(() => suppressNativePullToRefresh(), []);

  useEffect(() => {
    const host: HTMLDivElement | null = hostRef.current;
    if (host === null) return;

    const media: MediaQueryList = window.matchMedia(MOBILE_QUERY);
    let enabled: boolean = media.matches;
    let tracking: boolean = false;
    let startX: number = 0;
    let startY: number = 0;
    let distance: number = 0;

    function cancel(): void {
      tracking = false;
      distance = 0;
      setPull(0);
      setDragging(false);
    }

    function onMediaChange(event: MediaQueryListEvent): void {
      enabled = event.matches;
      if (!enabled) cancel();
    }

    function onTouchStart(event: TouchEvent): void {
      tracking = false;
      if (!enabled || refreshingRef.current) return;
      // A second finger means a pinch or a two-finger scroll, not a pull.
      if (event.touches.length !== 1) return;
      // Only from the very top — anywhere else the drag is an ordinary scroll.
      if (window.scrollY > 0) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      tracking = true;
      distance = 0;
    }

    function onTouchMove(event: TouchEvent): void {
      if (!tracking) return;
      const dy: number = event.touches[0].clientY - startY;
      const dx: number = event.touches[0].clientX - startX;
      // Upwards or sideways: an ordinary scroll or a swipe. Bow out for the
      // rest of this gesture rather than fighting it halfway through.
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy) + HORIZONTAL_SLOP_PX) {
        cancel();
        return;
      }
      // The page moved under us (leftover momentum, an anchor jump).
      if (window.scrollY > 0) {
        cancel();
        return;
      }
      if (event.cancelable) event.preventDefault();
      distance = resist(dy);
      setPull(distance);
      setDragging(true);
      setOffset(true);
    }

    async function finish(): Promise<void> {
      if (!tracking) return;
      tracking = false;
      setDragging(false);
      if (distance < THRESHOLD_PX) {
        distance = 0;
        setPull(0);
        return;
      }
      distance = 0;
      refreshingRef.current = true;
      setRefreshing(true);
      setOffset(true);
      setPull(RESTING_PX);
      try {
        await onRefreshRef.current();
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
        setPull(0);
      }
    }

    function onTouchEnd(): void {
      void finish();
    }

    media.addEventListener("change", onMediaChange);
    host.addEventListener("touchstart", onTouchStart, { passive: true });
    // Not passive: crossing the threshold has to stop the page from scrolling.
    host.addEventListener("touchmove", onTouchMove, { passive: false });
    host.addEventListener("touchend", onTouchEnd);
    host.addEventListener("touchcancel", cancel);
    return () => {
      media.removeEventListener("change", onMediaChange);
      host.removeEventListener("touchstart", onTouchStart);
      host.removeEventListener("touchmove", onTouchMove);
      host.removeEventListener("touchend", onTouchEnd);
      host.removeEventListener("touchcancel", cancel);
    };
  }, []);

  const progress: number = Math.min(1, pull / THRESHOLD_PX);
  const settle: string = dragging ? "none" : "transform 220ms ease-out";

  return (
    <div ref={hostRef} className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 flex justify-center"
        style={{
          transform: `translateY(${pull - INDICATOR_PX}px)`,
          opacity: refreshing ? 1 : progress,
          transition: dragging ? "none" : `${settle}, opacity 220ms ease-out`,
        }}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-[9999px] border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          {refreshing ? (
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 animate-spin text-zinc-500 dark:text-zinc-300"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <circle cx="12" cy="12" r="9" className="opacity-20" />
              <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 text-zinc-500 dark:text-zinc-300"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              // Points down while there's further to pull, and has turned all
              // the way up by the time letting go will refresh.
              style={{ transform: `rotate(${progress * 180}deg)` }}
            >
              <path
                d="M12 4v13m0 0 5-5m-5 5-5-5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      </div>
      <p className="sr-only" role="status">
        {refreshing ? "Refreshing" : ""}
      </p>
      <div
        style={
          offset
            ? { transform: `translateY(${pull}px)`, transition: settle }
            : undefined
        }
        onTransitionEnd={(event) => {
          // Transitions inside the page content bubble up here too; only the
          // wrapper settling back to zero means the transform can come off.
          if (event.target !== event.currentTarget) return;
          if (pull === 0 && !refreshing) setOffset(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}
