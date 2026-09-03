"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * Search lost its spot in the mobile tab bar to Friends, so it lives here
 * instead: a bar pinned above the feed that's there when you land, gets out
 * of the way as you read down, and comes back the moment you scroll up.
 */

/** Ignore the sub-pixel jitter of momentum scrolling and rubber-banding. */
const SCROLL_EPSILON_PX: number = 6;

/** Above this the bar always shows — the top of the feed is the start state. */
const ALWAYS_VISIBLE_ABOVE_PX: number = 48;

export function FeedSearchBar() {
  const [hidden, setHidden] = useState<boolean>(false);
  const lastY = useRef<number>(0);

  useEffect(() => {
    lastY.current = window.scrollY;
    let frame: number | null = null;

    function evaluate(): void {
      frame = null;
      const y: number = window.scrollY;
      const delta: number = y - lastY.current;
      if (Math.abs(delta) < SCROLL_EPSILON_PX) return;
      lastY.current = y;
      setHidden(y > ALWAYS_VISIBLE_ABOVE_PX && delta > 0);
    }

    function onScroll(): void {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(evaluate);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <>
      {/* Keeps the first post clear of the fixed bar above it. */}
      <div className="h-12 sm:hidden" aria-hidden />
      <div
        className={`fixed inset-x-0 top-0 z-30 border-b border-zinc-200 bg-white/95 px-3 pb-2 backdrop-blur transition-transform duration-200 sm:hidden dark:border-zinc-800 dark:bg-zinc-950/95 ${
          hidden ? "-translate-y-full" : "translate-y-0"
        }`}
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
      >
        <Link
          href="/search"
          className="flex w-full items-center gap-2 border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            className="h-4 w-4 shrink-0"
            aria-hidden
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m15.5 15.5 4.5 4.5" strokeLinecap="round" />
          </svg>
          Search posts…
        </Link>
      </div>
    </>
  );
}
