"use client";

import { EngagementSummary } from "@/components/engagement-summary";
import { stripHtml } from "@/lib/html";
import { relativeTime } from "@/lib/time";
import type { EventCoverage, EventSummary, UUID } from "@/lib/types";
import Link from "next/link";

interface EventCardProps {
  event: EventSummary;
  onOpen?: (storyId: UUID) => void;
  onDismiss?: (eventId: UUID) => void;
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

function CoverageRow({
  item,
  onOpen,
}: {
  item: EventCoverage;
  onOpen?: (storyId: UUID) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(item.story_id)}
      className={`flex w-full items-start justify-between gap-3 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
        item.read ? "opacity-50" : ""
      }`}
    >
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-semibold leading-snug text-slate-900 dark:text-slate-100 ${
            item.read ? "font-normal text-slate-400 dark:text-slate-500" : ""
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
    </button>
  );
}

export function EventCard({ event, onOpen, onDismiss }: EventCardProps) {
  const [lead, ...others] = event.coverage;
  if (!lead) return null;

  const heroImage: string | null =
    lead.story_image_url ??
    event.coverage.find((c) => c.story_image_url)?.story_image_url ??
    null;

  return (
    <article
      className={`relative rounded-xl border border-slate-200 bg-white p-4 transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900 ${
        event.read ? "opacity-70" : ""
      }`}
    >
      {onDismiss ? (
        <button
          type="button"
          onClick={() => onDismiss(event.id)}
          aria-label="Dismiss event"
          title="Dismiss"
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          ✕
        </button>
      ) : null}

      <div className={`flex gap-3 ${lead.read ? "opacity-50 grayscale" : ""}`}>
        {heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroImage}
            alt=""
            onClick={() => onOpen?.(lead.story_id)}
            className="h-24 w-24 shrink-0 cursor-pointer rounded-lg object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1 pr-6">
          <button
            type="button"
            onClick={() => onOpen?.(lead.story_id)}
            className="block text-left"
          >
            <h3
              className={`line-clamp-2 text-lg font-bold leading-snug hover:text-brand-600 ${
                lead.read
                  ? "text-slate-400 dark:text-slate-500"
                  : "text-slate-900 dark:text-slate-100"
              }`}
            >
              {lead.full_headline}
            </h3>
          </button>
          {firstLine(lead.summary) ? (
            <div className="mt-1 flex items-center gap-2">
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
            <CoverageRow key={item.story_id} item={item} onOpen={onOpen} />
          ))}
        </div>
      ) : null}

      <div className="mt-3 border-t border-slate-100 pt-2 dark:border-slate-800">
        <EngagementSummary engagement={event.engagement} />
      </div>
    </article>
  );
}
