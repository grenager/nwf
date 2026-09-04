"use client";

/**
 * Whether to offer the "add to home screen" instructions.
 *
 * iOS has no install prompt a page can trigger and no way to ask whether the
 * site is already pinned — a home screen web app gets its own storage
 * container, so even a flag written while running standalone never reaches
 * Safari. So this is deliberately a *proxy*, not a fact: we know the platform
 * supports pinning, and we know they are not looking at a pinned copy right
 * now. That is the whole of it, which is why dismissing the ask is permanent
 * (see `PERMANENT` in lib/standards.ts) — being told twice to do something
 * you already did is how a prompt loses its credibility.
 */
export function isPinnable(): boolean {
  if (typeof window === "undefined") return false;
  return isIos() && !isStandalone();
}

/**
 * Already launched from the home screen — on iOS via Apple's own flag, and
 * via the standard media query everywhere else.
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  try {
    return window.matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

/**
 * iPhone and iPad, including iPadOS 13+.
 *
 * A modern iPad reports itself as "Macintosh" and is distinguishable only by
 * having a touchscreen, which no real Mac does. Sniffing the user agent is
 * unpleasant, but the alternative here is showing Safari-specific
 * instructions ("tap Share, then Add to Home Screen") to people using a
 * browser where that menu doesn't exist.
 */
function isIos(): boolean {
  const ua: string = window.navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1;
}
