"use client";

import { FriendStars } from "@/components/friend-stars";
import { stripHtml } from "@/lib/html";
import { relativeTime } from "@/lib/time";
import type { EventCoverage, EventSummary } from "@/lib/types";
import Link from "next/link";

interface EventCardProps {
  event: EventSummary;
}

function firstLine(summary: string | null): string {
  if (!summary) return "";
  const clean: string = stripHtml(summary);
  return clean.length > 160 ? `${clean.slice(0, 160)}…` : clean;
}

function SourceName({ name }: { name: string }) {
  return (
    <span className="mt-0.5 shrink-0 whitespace-nowrap text-right text-xs font-medium text-slate-400 dark:text-slate-500">
      {name}
    </span>
  );
}

function CoverageRow({ item }: { item: EventCoverage }) {
  return (
    <a
      href={item.article_url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start justify-between gap-3 py-2.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
    >
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100 ${
            item.read ? "opacity-60" : ""
          }`}
        >
          {item.full_headline}
        </p>
        {firstLine(item.summary) ? (
          <p className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
            {firstLine(item.summary)}
          </p>
        ) : null}
      </div>
      <SourceName name={item.source_name} />
    </a>
  );
}

export function EventCard({ event }: EventCardProps) {
  const [lead, ...others] = event.coverage;
  if (!lead) return null;

  const heroImage: string | null =
    lead.story_image_url ??
    event.coverage.find((c) => c.story_image_url)?.story_image_url ??
    null;

  return (
    <article
      className={`rounded-xl border border-slate-200 bg-white p-4 transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900 ${
        event.read ? "opacity-70" : ""
      }`}
    >
      <div className="flex gap-3">
        {heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroImage}
            alt=""
            className="h-24 w-24 shrink-0 rounded-lg object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <a href={lead.article_url} target="_blank" rel="noopener noreferrer">
            <h3
              className={`line-clamp-2 text-lg font-bold leading-snug text-slate-900 hover:text-brand-600 dark:text-slate-100 ${
                lead.read ? "opacity-60" : ""
              }`}
            >
              {lead.full_headline}
            </h3>
          </a>
          {firstLine(lead.summary) || event.friend_stars.length > 0 ? (
            <div className="mt-1 flex items-center gap-2">
              <FriendStars stars={event.friend_stars} />
              <p className="line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                {firstLine(lead.summary)}
              </p>
            </div>
          ) : null}
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            <span className="font-medium">{lead.source_name}</span>
            <span aria-hidden>·</span>
            <Link
              href={`/events/${event.id}`}
              className="hover:text-brand-600"
            >
              {relativeTime(event.first_seen_at)}
            </Link>
          </div>
        </div>
      </div>

      {others.length > 0 ? (
        <div className="mt-3 max-h-64 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
          {others.map((item) => (
            <CoverageRow key={item.story_id} item={item} />
          ))}
        </div>
      ) : null}
    </article>
  );
}
