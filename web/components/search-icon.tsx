"use client";

/**
 * The magnifier, in the one shape it should be everywhere.
 *
 * It appears in the nav header, at the end of the feed composer and inside
 * the search field, and until this existed those were three inline copies —
 * two of them drawn on different viewBoxes, so the glyph was subtly a
 * different shape depending on where you found it.
 */
export function SearchIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className={className}
      aria-hidden
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" strokeLinecap="round" />
    </svg>
  );
}
