"use client";

import { EventCard } from "@/components/event-card";
import { FriendsSidebar } from "@/components/friends-sidebar";
import { StoryCard } from "@/components/story-card";
import { StoryModal } from "@/components/story-modal";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type {
  EventSummary,
  ReactionKind,
  Story,
  TodayPayload,
  UUID,
} from "@/lib/types";
import { useCallback, useEffect, useRef, useState } from "react";

type Tab = "news" | "analysis" | "friends";

const TAB_ORDER: Tab[] = ["news", "analysis", "friends"];

export default function TodayPage() {
  const { notify } = useToast();
  const [data, setData] = useState<TodayPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [openStoryId, setOpenStoryId] = useState<UUID | null>(null);
  const [tab, setTab] = useState<Tab>("news");
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
    setData((prev) =>
      prev
        ? {
            ...prev,
            analysis: {
              ...prev.analysis,
              items: prev.analysis.items.map((s) =>
                s.id === updated.id ? { ...s, ...updated } : s,
              ),
            },
          }
        : prev,
    );
  }

  const patchStatus = useCallback(
    (
      storyId: UUID,
      patch: { read?: boolean; my_reaction?: ReactionKind | null },
    ): void => {
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

  function selectTab(next: Tab): void {
    setTab(next);
    const el = scrollRef.current;
    if (!el) return;
    const child = el.children[TAB_ORDER.indexOf(next)] as
      | HTMLElement
      | undefined;
    if (child) el.scrollTo({ left: child.offsetLeft, behavior: "smooth" });
  }

  function onScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    const idx: number = Math.round(el.scrollLeft / el.clientWidth);
    const next: Tab = TAB_ORDER[Math.min(idx, TAB_ORDER.length - 1)] ?? "news";
    setTab((prev) => (prev === next ? prev : next));
  }

  if (loading) {
    return <p className="text-slate-400">Loading Today…</p>;
  }

  if (!data) {
    return (
      <div className="border border-dashed border-slate-300 p-10 text-center text-slate-500">
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
      <div className="border border-dashed border-slate-300 p-10 text-center text-slate-500">
        No stories in the briefing yet — check back soon as we gather news from
        top sources.
      </div>
    );
  }

  const newsContent =
    events.length === 0 ? (
      <p className="text-sm text-slate-400">
        No clustered events yet — follow more outlets or wait for the scraper to
        cluster stories.
      </p>
    ) : (
      <div className="space-y-3">
        {events.map((event) => (
          <EventCard key={event.id} event={event} onOpen={setOpenStoryId} />
        ))}
      </div>
    );

  const analysisContent =
    analysis.length === 0 ? (
      <p className="text-sm text-slate-400">No analysis from your sources yet.</p>
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
    );

  function tabClass(active: boolean): string {
    return `flex-1 border-b-2 px-3 py-2 text-sm font-semibold transition ${
      active
        ? "border-slate-900 text-slate-900 dark:border-slate-100 dark:text-slate-100"
        : "border-transparent text-slate-400"
    }`;
  }

  return (
    <div className="space-y-8">
      {/* Desktop: two columns side by side */}
      <div className="hidden gap-8 lg:grid lg:grid-cols-2">
        <section>
          <h2 className="mb-3 border-b border-slate-200 pb-2 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800">
            The News
          </h2>
          {newsContent}
        </section>
        <section>
          <h2 className="mb-3 border-b border-slate-200 pb-2 text-sm font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800">
            Analysis
          </h2>
          {analysisContent}
        </section>
      </div>

      {/* Mobile: swipeable tabs */}
      <div className="lg:hidden">
        <div className="sticky top-14 z-10 mb-3 flex border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
          <button onClick={() => selectTab("news")} className={tabClass(tab === "news")}>
            The News
          </button>
          <button
            onClick={() => selectTab("analysis")}
            className={tabClass(tab === "analysis")}
          >
            Analysis
          </button>
          <button
            onClick={() => selectTab("friends")}
            className={tabClass(tab === "friends")}
          >
            Friends
          </button>
        </div>
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="w-full shrink-0 snap-start">{newsContent}</div>
          <div className="w-full shrink-0 snap-start">{analysisContent}</div>
          <div className="w-full shrink-0 snap-start">
            <FriendsSidebar />
          </div>
        </div>
      </div>

      <div className="border border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-800 dark:bg-slate-900">
        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          You&apos;re caught up
        </p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {events.length} events · {analysis.length} analysis pieces
          {data.friend_pick_count > 0
            ? ` · ${data.friend_pick_count} with friend reactions`
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
