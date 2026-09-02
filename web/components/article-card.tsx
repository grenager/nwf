"use client";

import { stripHtml } from "@/lib/html";

function hostFromUrl(url: string): string {
  try {
    const host: string = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return url;
  }
}

interface ArticleCardProps {
  articleUrl: string;
  headline: string;
  summary?: string | null;
  imageUrl?: string | null;
  sourceName?: string | null;
  sourceImageUrl?: string | null;
  /** Fired when the card link is opened (e.g. to mark the story read). */
  onOpen?: () => void;
  /** Tailwind height class for the hero image. Defaults to a tall feed image. */
  imageHeightClassName?: string;
  /** Tailwind line-clamp class for the summary. Defaults to two lines. */
  summaryClampClassName?: string;
}

/**
 * Substack-style link preview: full-width image, then a bordered footer with the
 * source (logo + name) and the headline. Shared by the feed, the post detail
 * view, and the invite landing so the article always reads the same way.
 */
export function ArticleCard({
  articleUrl,
  headline,
  summary = null,
  imageUrl = null,
  sourceName = null,
  sourceImageUrl = null,
  onOpen,
  imageHeightClassName = "h-56",
  summaryClampClassName = "line-clamp-2",
}: ArticleCardProps) {
  return (
    <a
      href={articleUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpen}
      className="group block border border-zinc-200 dark:border-zinc-800"
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className={`w-full object-cover ${imageHeightClassName}`}
        />
      ) : null}
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          {sourceImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={sourceImageUrl}
              alt=""
              className="h-4 w-4 shrink-0 object-cover"
            />
          ) : null}
          <span className="truncate">
            {sourceName ?? hostFromUrl(articleUrl)}
          </span>
        </div>
        <h3 className="mt-1 font-serif text-lg font-semibold leading-snug tracking-tight text-zinc-900 group-hover:underline dark:text-zinc-50">
          {headline}
        </h3>
        {summary ? (
          <p
            className={`mt-1 text-sm text-zinc-500 dark:text-zinc-400 ${summaryClampClassName}`}
          >
            {stripHtml(summary)}
          </p>
        ) : null}
      </div>
    </a>
  );
}
