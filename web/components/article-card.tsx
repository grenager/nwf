"use client";

import { stripHtml } from "@/lib/html";
import { articleHost, sourceHref } from "@/lib/url";
import Link from "next/link";

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
  /** Set false where the source page isn't reachable (e.g. the invite landing,
   * which renders for signed-out visitors). */
  linkSource?: boolean;
}

/**
 * Substack-style link preview: full-width image, then a bordered footer with the
 * source (logo + name) and the headline. Shared by the feed, the post detail
 * view, and the invite landing so the article always reads the same way.
 *
 * Two destinations, deliberately: the image, headline and summary open the
 * article itself, while the source line above them opens that publication's
 * page here. They're separate anchors rather than one wrapping link because
 * anchors can't nest.
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
  linkSource = true,
}: ArticleCardProps) {
  const host: string | null = articleHost(articleUrl);
  const href: string | null = linkSource ? sourceHref(articleUrl) : null;
  const sourceLabel: string = sourceName ?? host ?? articleUrl;

  const sourceRow = (
    <>
      {sourceImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sourceImageUrl}
          alt=""
          className="h-4 w-4 shrink-0 object-cover"
        />
      ) : null}
      <span className="truncate">{sourceLabel}</span>
    </>
  );

  return (
    <div className="border border-zinc-200 dark:border-zinc-800">
      {imageUrl ? (
        <a
          href={articleUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onOpen}
          aria-label={headline}
          className="block"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            className={`w-full object-cover ${imageHeightClassName}`}
          />
        </a>
      ) : null}
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        {href ? (
          <Link
            href={href}
            className="flex w-fit max-w-full items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {sourceRow}
          </Link>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            {sourceRow}
          </div>
        )}
        <a
          href={articleUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onOpen}
          className="group block"
        >
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
        </a>
      </div>
    </div>
  );
}
