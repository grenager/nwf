"use client";

import { stripHtml } from "@/lib/html";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function hostFromUrl(url: string): string {
  try {
    const host: string = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return url;
  }
}

/** Split pasted plain text into display paragraphs on blank/newlines. */
function toParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}|\n/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Collapsed height for pasted text. Long articles otherwise push the
 * conversation far below the fold, which buries the point of the post.
 */
const COLLAPSED_MAX_HEIGHT_PX: number = 280;

/** Ignore a few stray pixels of overflow so the toggle only appears when useful. */
const OVERFLOW_SLOP_PX: number = 24;

interface ReaderBodyProps {
  sharedText: string;
  articleUrl: string;
  sourceName: string | null;
  authorName: string;
  /**
   * Clamp the text to a teaser with a "Show all" toggle. Disable to always render
   * the full body (e.g. a dedicated reader view).
   */
  collapsible?: boolean;
}

/**
 * Reader-style rendering of the article text an author pasted from a page they
 * can read. Always closes with attribution + a pointer back to the original.
 */
export function ReaderBody({
  sharedText,
  articleUrl,
  sourceName,
  authorName,
  collapsible = true,
}: ReaderBodyProps) {
  const paragraphs: string[] = useMemo(
    () => toParagraphs(sharedText),
    [sharedText],
  );
  const source: string = sourceName ?? hostFromUrl(articleUrl);

  const [expanded, setExpanded] = useState<boolean>(false);
  const [overflows, setOverflows] = useState<boolean>(false);
  const [measured, setMeasured] = useState<boolean>(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const measure = useCallback((): void => {
    const el: HTMLDivElement | null = bodyRef.current;
    if (el === null) return;
    setOverflows(el.scrollHeight > COLLAPSED_MAX_HEIGHT_PX + OVERFLOW_SLOP_PX);
    setMeasured(true);
  }, []);

  // Re-measure on width changes: reflowed text changes how much is hidden.
  useEffect(() => {
    if (!collapsible) return;
    measure();
    const el: HTMLDivElement | null = bodyRef.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const observer: ResizeObserver = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [collapsible, measure, paragraphs]);

  // Clamp before the first measurement too, so long text never flashes at full
  // height. Short text is under the cap, so the clamp is a no-op there.
  const clamped: boolean = collapsible && !expanded && (overflows || !measured);
  const showToggle: boolean = collapsible && measured && overflows;

  return (
    <div>
      <div className="relative">
        <div
          ref={bodyRef}
          className="space-y-4 font-serif text-[1.05rem] leading-8 text-zinc-800 dark:text-zinc-200"
          style={
            clamped
              ? { maxHeight: COLLAPSED_MAX_HEIGHT_PX, overflow: "hidden" }
              : undefined
          }
        >
          {paragraphs.map((p, i) => (
            <p key={i}>{stripHtml(p)}</p>
          ))}
        </div>
        {clamped ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent dark:from-zinc-950"
          />
        ) : null}
      </div>

      {showToggle ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-2 text-sm font-semibold text-brand-600 transition hover:underline dark:text-brand-400"
        >
          {expanded ? "Show less" : "Show all"}
        </button>
      ) : null}

      <p className="mt-8 border-t border-zinc-200 pt-4 text-xs text-zinc-400 dark:border-zinc-800">
        This text was pasted by {authorName} from a page they have access to. For
        the definitive version, read the original at {source}.
      </p>
    </div>
  );
}
