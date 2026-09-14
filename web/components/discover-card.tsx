"use client";

import { ArticleCard } from "@/components/article-card";
import { api } from "@/lib/api";
import type { DiscoverCard as DiscoverCardData } from "@/lib/types";
import Link from "next/link";
import { useState } from "react";

interface DiscoverCardProps {
  card: DiscoverCardData;
  /** Signed-out visitors have no reading log, so nothing is marked read. */
  canMarkRead?: boolean;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The activity line under a Discover card.
 *
 * Counts, never names: this card is shown to every member, so naming who
 * reacted would leak activity from outside the viewer's own friends. Ordered
 * strongest signal first, and signals with nothing to say are left out
 * rather than printed as zeroes.
 */
function activityLine(card: DiscoverCardData): string | null {
  const parts: string[] = [];
  if (card.commenter_count > 0) {
    parts.push(plural(card.commenter_count, "person talking", "people talking"));
  }
  if (card.reactor_count > 0) {
    parts.push(`${card.reactor_count} reacting`);
  }
  if (card.reader_count > 0) {
    parts.push(`${card.reader_count} reading`);
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

/**
 * One trending story. Opening the article marks it read for signed-in
 * members, which both dims the card and feeds the same read signal the
 * ranking counts.
 */
export function DiscoverCard({ card, canMarkRead = false }: DiscoverCardProps) {
  const [read, setRead] = useState<boolean>(card.read);
  const line: string | null = activityLine(card);

  function handleOpen(): void {
    if (!canMarkRead || read) return;
    setRead(true);
    void api.markRead(card.story_id, true).catch(() => undefined);
  }

  return (
    <article className={read ? "opacity-60 transition-opacity" : undefined}>
      <ArticleCard
        articleUrl={card.article_url}
        headline={card.full_headline}
        summary={card.summary}
        imageUrl={card.image_url}
        sourceName={card.source_name}
        sourceImageUrl={card.source_image_url}
        onOpen={handleOpen}
        imageHeightClassName="h-44"
      />
      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        {line ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{line}</p>
        ) : (
          <span />
        )}
        {/* The card headline opens the article; this opens the story page,
            where the viewer's own and their friends' threads live and a new
            conversation can be started. */}
        <Link
          href={`/story/${card.story_id}`}
          scroll={false}
          className="shrink-0 text-xs font-semibold text-zinc-700 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
        >
          {card.commenter_count > 0 ? "Conversations" : "Talk about it"}
        </Link>
      </div>
    </article>
  );
}
