"use client";

import { EventCard } from "@/components/event-card";
import { StoryCard } from "@/components/story-card";
import { StoryModal } from "@/components/story-modal";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { EventSummary, Story, TodayPayload, UUID } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";

export default function TodayPage() {
  const { notify } = useToast();
  const [data, setData] = useState<TodayPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [openStoryId, setOpenStoryId] = useState<UUID | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setData(await api.getToday());
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to load Today", "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  function onStoryChange(updated: Story): void {
    if (!data) return;
    setData({
      ...data,
      analysis: {
        ...data.analysis,
        items: data.analysis.items.map((s) =>
          s.id === updated.id ? { ...s, ...updated } : s,
        ),
      },
    });
  }

  const patchStatus = useCallback(
    (storyId: UUID, patch: { read?: boolean; starred?: boolean }): void => {
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          events: {
            ...prev.events,
            items: prev.events.items.map((ev) => ({
              ...ev,
              coverage: ev.coverage.map((c) =>
                c.story_id === storyId ? { ...c, ...patch } : c,
              ),
            })),
          },
          analysis: {
            ...prev.analysis,
            items: prev.analysis.items.map((s) =>
              s.id === storyId ? { ...s, ...patch } : s,
            ),
          },
        };
      });
    },
    [],
  );

  if (loading) {
    return <p className="text-slate-400">Loading Today…</p>;
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
        Could not load Today.{" "}
        <button onClick={() => void load()} className="text-brand-600 underline">
          Retry
        </button>
      </div>
    );
  }

  const events: EventSummary[] = data.events.items;
  const analysis: Story[] = data.analysis.items;
  const totalItems: number = events.length + analysis.length;

  if (totalItems === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
        Follow sources on the{" "}
        <a href="/sources" className="text-brand-600 underline">
          Sources
        </a>{" "}
        page to build your briefing.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 border-b border-slate-200 pb-2 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800">
            The News
          </h2>
          {events.length === 0 ? (
            <p className="text-sm text-slate-400">
              No clustered events yet — follow more outlets or wait for the
              scraper to cluster stories.
            </p>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onOpen={setOpenStoryId}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 border-b border-slate-200 pb-2 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800">
            Analysis
          </h2>
          {analysis.length === 0 ? (
            <p className="text-sm text-slate-400">
              No analysis from your sources yet.
            </p>
          ) : (
            <div className="space-y-3">
              {analysis.map((story) => (
                <StoryCard
                  key={story.id}
                  story={story}
                  onChange={onStoryChange}
                  onOpen={setOpenStoryId}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="border border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-800 dark:bg-slate-900">
        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          You&apos;re caught up
        </p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {events.length} events · {analysis.length} analysis pieces
          {data.friend_pick_count > 0
            ? ` · ${data.friend_pick_count} hearted by friends`
            : ""}
        </p>
      </div>

      {openStoryId ? (
        <StoryModal
          storyId={openStoryId}
          onClose={() => setOpenStoryId(null)}
          onStatusChange={patchStatus}
        />
      ) : null}
    </div>
  );
}
