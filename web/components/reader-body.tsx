"use client";

import { stripHtml } from "@/lib/html";
import { useMemo } from "react";

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

interface ReaderBodyProps {
  sharedText: string;
  articleUrl: string;
  sourceName: string | null;
  authorName: string;
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
}: ReaderBodyProps) {
  const paragraphs: string[] = useMemo(
    () => toParagraphs(sharedText),
    [sharedText],
  );
  const source: string = sourceName ?? hostFromUrl(articleUrl);

  return (
    <div>
      <div className="space-y-4 font-serif text-[1.05rem] leading-8 text-zinc-800 dark:text-zinc-200">
        {paragraphs.map((p, i) => (
          <p key={i}>{stripHtml(p)}</p>
        ))}
      </div>
      <p className="mt-8 border-t border-zinc-200 pt-4 text-xs text-zinc-400 dark:border-zinc-800">
        This text was pasted by {authorName} from a page they have access to. For
        the definitive version, read the original at {source}.
      </p>
    </div>
  );
}
