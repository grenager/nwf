"use client";

import { EngagementSummary } from "@/components/engagement-summary";
import { stripHtml } from "@/lib/html";
import { relativeTime } from "@/lib/time";
import type { EventSummary, UUID } from "@/lib/types";

interface EventCardProps {
  event: EventSummary;
  exiting?: boolean;
  onOpen?: (eventId: UUID) => void;
  onDismiss?: (eventId: UUID) => void;
}

function firstLine(summary: string | null): string {
  if (!summary) return "";
  const clean: string = stripHtml(summary);
  return clean.length > 160 ? `${clean.slice(0, 160)}…` : clean;
}

function formatSourceLine(
  coverage: EventSummary["coverage"],
  maxShown: number = 4,
): string {
  const names: string[] = [];
  const seen: Set<string> = new Set();
  for (const item of coverage) {
    const name: string = item.source_name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  if (names.length === 0) return "";
  if (names.length <= maxShown) return names.join(" | ");
  const shown: string[] = names.slice(0, maxShown);
  const remaining: number = names.length - maxShown;
  return `${shown.join(" | ")} | ${remaining} more`;
}

export function EventCard({
  event,
  exiting = false,
  onOpen,
  onDismiss,
}: EventCardProps) {
  const lead = event.coverage[0];
  if (!lead) return null;

  const heroImage: string | null =
    lead.story_image_url ??
    event.coverage.find((c) => c.story_image_url)?.story_image_url ??
    null;

  return (
    <article
      className={`relative overflow-hidden rounded-xl border border-slate-200 bg-white transition-all duration-300 ease-out dark:border-slate-800 dark:bg-slate-900 ${
        exiting
          ? "pointer-events-none -translate-y-1 scale-[0.98] opacity-0"
          : "opacity-100 hover:shadow-md"
      } ${event.read && !exiting ? "opacity-70" : ""}`}
    >
      {onDismiss ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(event.id);
          }}
          aria-label="Archive event"
          title="Archive"
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          ✕
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => onOpen?.(event.id)}
        className="flex w-full gap-3 p-4 pr-10 text-left"
      >
        {heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroImage}
            alt=""
            className="h-24 w-24 shrink-0 rounded-lg object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <h3
            className={`line-clamp-2 text-lg font-bold leading-snug ${
              event.read
                ? "text-slate-400 dark:text-slate-500"
                : "text-slate-900 dark:text-slate-100"
            }`}
          >
            {lead.full_headline}
          </h3>
          {firstLine(lead.summary) ? (
            <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
              {firstLine(lead.summary)}
            </p>
          ) : null}
          <div className="mt-1.5 text-[11px] leading-snug text-slate-400 dark:text-slate-500">
            <span className="font-medium text-slate-500 dark:text-slate-400">
              {formatSourceLine(event.coverage)}
            </span>
            <span className="mx-1.5" aria-hidden>
              ·
            </span>
            <span>{relativeTime(event.first_seen_at)}</span>
          </div>
          <div className="mt-2">
            <EngagementSummary engagement={event.engagement} />
          </div>
        </div>
      </button>
    </article>
  );
}
