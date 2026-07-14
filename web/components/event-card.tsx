"use client";

import { EngagementSummary } from "@/components/engagement-summary";
import { InboxCardActions } from "@/components/inbox-card-actions";
import { ReadBadge } from "@/components/read-badge";
import { stripHtml } from "@/lib/html";
import { relativeTime } from "@/lib/time";
import type { EventSummary, UUID } from "@/lib/types";

interface EventCardProps {
  event: EventSummary;
  exiting?: boolean;
  archivedView?: boolean;
  onOpen?: (eventId: UUID) => void;
  onRead?: (eventId: UUID) => void;
  onDismiss?: (eventId: UUID) => void;
}

function firstLine(summary: string | null): string {
  if (!summary) return "";
  const clean: string = stripHtml(summary);
  return clean.length > 160 ? `${clean.slice(0, 160)}…` : clean;
}

function formatSourceLine(
  event: EventSummary,
  maxShown: number = 4,
): string {
  const names: string[] =
    (event.source_names?.length ?? 0) > 0
      ? event.source_names
      : (() => {
          const seen: Set<string> = new Set();
          const fromCoverage: string[] = [];
          for (const item of event.coverage) {
            const name: string = item.source_name.trim();
            if (!name || seen.has(name)) continue;
            seen.add(name);
            fromCoverage.push(name);
          }
          return fromCoverage;
        })();
  if (names.length === 0) return "";
  if (names.length <= maxShown) return names.join(" · ");
  const shown: string[] = names.slice(0, maxShown);
  const remaining: number = names.length - maxShown;
  return `${shown.join(" · ")} · ${remaining} more`;
}

export function EventCard({
  event,
  exiting = false,
  archivedView = false,
  onOpen,
  onRead,
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
      className={`relative py-4 transition-opacity duration-300 ease-out ${
        exiting
          ? "pointer-events-none opacity-0"
          : event.read
            ? "opacity-55"
            : "opacity-100"
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen?.(event.id)}
        className="flex w-full gap-3 text-left"
      >
        {heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroImage}
            alt=""
            className="h-20 w-20 shrink-0 object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <h3
            className={`font-serif text-[1.05rem] font-semibold leading-snug tracking-tight ${
              event.read
                ? "text-zinc-400 dark:text-zinc-500"
                : "text-zinc-900 dark:text-zinc-50"
            }`}
          >
            {lead.full_headline}
          </h3>
          {firstLine(lead.summary) ? (
            <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              {firstLine(lead.summary)}
            </p>
          ) : null}
          <div className="mt-1.5 text-[12px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            <span>{formatSourceLine(event)}</span>
            <span className="mx-1.5 font-normal text-zinc-400" aria-hidden>
              ·
            </span>
            <span className="font-normal text-zinc-500">
              {relativeTime(event.first_seen_at)}
            </span>
          </div>
        </div>
      </button>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 overflow-hidden">
          <EngagementSummary engagement={event.engagement} variant="inline" />
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {archivedView ? <ReadBadge read={event.read} /> : null}
          <InboxCardActions
            read={event.read}
            onRead={
              archivedView || !onRead ? undefined : () => onRead(event.id)
            }
            onArchive={onDismiss ? () => onDismiss(event.id) : undefined}
            archiveLabel={archivedView ? "Restore" : "Archive"}
          />
        </div>
      </div>
    </article>
  );
}
