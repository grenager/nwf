"use client";

import { ArticleCard } from "@/components/article-card";
import type { DiscoverCard as DiscoverCardData } from "@/lib/types";
import Link from "next/link";

interface DiscoverCardProps {
  card: DiscoverCardData;
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
 * One trending story. The tile opens the story page (intercepted into a
 * modal over the list), where the viewer's own and their friends'
 * conversations live and the article itself is one click further — Discover
 * is the doorway into the private half of the app, not a link farm. Marking
 * read happens there, when the article is actually opened.
 *
 * A read story is labelled, never faded. Dimming belongs to an inbox you are
 * clearing; Discover is a list of what the platform is discussing, where the
 * most active story is often one you have already read — fading it makes the
 * top of the page look dead, and takes the photo's colour with it.
 */
export function DiscoverCard({ card }: DiscoverCardProps) {
  const line: string | null = activityLine(card);

  return (
    <article>
      <ArticleCard
        href={`/story/${card.story_id}`}
        articleUrl={card.article_url}
        headline={card.full_headline}
        summary={card.summary}
        imageUrl={card.image_url}
        sourceName={card.source_name}
        sourceImageUrl={card.source_image_url}
        imageHeightClassName="h-44"
      />
      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400">
          {card.read ? (
            <span className="font-medium text-zinc-400 dark:text-zinc-500">
              Read{line ? " · " : ""}
            </span>
          ) : null}
          {line}
        </p>
        {/* Same destination as the tile, kept as a labelled affordance:
            tapping either opens the story modal, where the viewer's own and
            their friends' threads live and a new conversation can be
            started. */}
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
