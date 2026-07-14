"use client";

import { EngagementSummary } from "@/components/engagement-summary";
import { FriendStars } from "@/components/friend-stars";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { stripHtml } from "@/lib/html";
import { relativeTime } from "@/lib/time";
import type { EventCoverage, EventSummary, UUID } from "@/lib/types";
import { useEffect, useState } from "react";

interface EventModalProps {
  event: EventSummary;
  onClose: () => void;
  onOpenStory?: (storyId: UUID) => void;
}

function CoverageListItem({
  item,
  onOpen,
}: {
  item: EventCoverage;
  onOpen?: (storyId: UUID) => void;
}) {
  const summary: string = item.summary ? stripHtml(item.summary) : "";
  return (
    <button
      type="button"
      onClick={() => onOpen?.(item.story_id)}
      className={`flex w-full gap-3 border-b border-slate-100 px-5 py-4 text-left transition last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50 ${
        item.read ? "opacity-55" : ""
      }`}
    >
      {item.story_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.story_image_url}
          alt=""
          className="h-16 w-16 shrink-0 rounded-md object-cover"
        />
      ) : item.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image_url}
          alt=""
          className="h-10 w-10 shrink-0 rounded object-contain"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="mb-1">
          <span className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
            {item.source_name}
          </span>
        </div>
        <p
          className={`font-serif text-[15px] font-semibold leading-snug tracking-tight text-slate-900 dark:text-slate-100 ${
            item.read ? "font-normal text-slate-400 dark:text-slate-500" : ""
          }`}
        >
          {item.full_headline}
        </p>
        {summary ? (
          <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
            {summary.slice(0, 220)}
          </p>
        ) : null}
      </div>
    </button>
  );
}

export function EventModal({ event, onClose, onOpenStory }: EventModalProps) {
  const { notify } = useToast();
  const [detail, setDetail] = useState<EventSummary>(event);
  const [loadingCoverage, setLoadingCoverage] = useState<boolean>(
    event.coverage.length <= 1,
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // Today only ships a lead teaser; fetch full coverage when the modal opens.
  useEffect(() => {
    let cancelled = false;
    setDetail(event);
    setLoadingCoverage(true);
    void (async () => {
      try {
        const full: EventSummary = await api.getEvent(event.id);
        if (!cancelled) setDetail(full);
      } catch (err) {
        if (!cancelled) {
          notify(
            err instanceof ApiError ? err.message : "Failed to load coverage",
            "error",
          );
        }
      } finally {
        if (!cancelled) setLoadingCoverage(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [event, notify]);

  const coverage: EventCoverage[] = [...detail.coverage].sort(
    (a, b) => (b.prominence ?? 0) - (a.prominence ?? 0),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="relative my-auto w-full max-w-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center bg-white/80 text-xl text-slate-500 hover:text-slate-900 dark:bg-slate-900/80 dark:hover:text-slate-100"
        >
          ✕
        </button>

        <div className="max-h-[85vh] overflow-y-auto">
          <div className="border-b border-slate-100 p-6 pr-12 dark:border-slate-800">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              {detail.is_scoop ? (
                <span className="bg-slate-100 px-2 py-0.5 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  Original reporting
                </span>
              ) : (
                <span>{detail.outlet_count} outlets covering this</span>
              )}
              <span aria-hidden>·</span>
              <span>{relativeTime(detail.first_seen_at)}</span>
              <FriendStars stars={detail.friend_stars} />
            </div>
            <h2 className="font-serif text-2xl font-semibold leading-tight tracking-tight text-slate-900 dark:text-slate-100">
              {detail.title}
            </h2>
            <div className="mt-4">
              <EngagementSummary engagement={detail.engagement} />
            </div>
          </div>

          <div className="px-1 pb-2 pt-1">
            <p className="px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Coverage
            </p>
            {loadingCoverage && coverage.length <= 1 ? (
              <p className="px-5 py-6 text-sm text-slate-400">Loading coverage…</p>
            ) : (
              coverage.map((item) => (
                <CoverageListItem
                  key={item.story_id}
                  item={item}
                  onOpen={onOpenStory}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
