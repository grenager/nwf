"use client";

import { FriendStars } from "@/components/friend-stars";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { stripHtml } from "@/lib/html";
import type { EventSummary } from "@/lib/types";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function EventCoveragePage() {
  const params = useParams<{ id: string }>();
  const { notify } = useToast();
  const [event, setEvent] = useState<EventSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const load = useCallback(async (): Promise<void> => {
    if (!params.id) return;
    setLoading(true);
    try {
      setEvent(await api.getEvent(params.id));
      void api.markEventRead(params.id).catch(() => undefined);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to load event", "error");
    } finally {
      setLoading(false);
    }
  }, [params.id, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-slate-400">Loading coverage…</p>;
  }

  if (!event) {
    return (
      <div className="text-center">
        <p className="text-slate-500">Event not found.</p>
        <Link href="/" className="mt-4 inline-block text-brand-600 underline">
          Back to Today
        </Link>
      </div>
    );
  }

  const coverage = [...event.coverage].sort(
    (a, b) => (b.prominence ?? 0) - (a.prominence ?? 0),
  );

  return (
    <div>
      <Link href="/" className="text-sm text-brand-600 hover:underline">
        ← Today
      </Link>

      <header className="mt-4 mb-8">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {event.is_scoop ? (
            <span className="bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              Original reporting
            </span>
          ) : (
            <span className="text-xs text-slate-400">
              {event.outlet_count} outlets covering this
            </span>
          )}
          <FriendStars stars={event.friend_stars} />
        </div>
        <h1 className="font-serif text-2xl font-semibold leading-snug tracking-tight">
          {event.title}
        </h1>
      </header>

      <div className="space-y-4">
        {coverage.map((row) => (
          <article
            key={row.story_id}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="mb-2">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {row.source_name}
              </span>
            </div>
            <a
              href={row.article_url}
              target="_blank"
              rel="noreferrer noopener"
              className="block font-serif text-[15px] font-semibold leading-snug tracking-tight text-slate-900 hover:text-brand-600 dark:text-slate-100"
            >
              {row.full_headline}
            </a>
            {row.summary ? (
              <p className="mt-2 line-clamp-3 text-sm text-slate-500">
                {stripHtml(row.summary).slice(0, 400)}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
