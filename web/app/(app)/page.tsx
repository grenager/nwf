"use client";

import { useAuth } from "@/components/auth-provider";
import { useAuthGate } from "@/components/auth-gate";
import { EventCard } from "@/components/event-card";
import { EventModal } from "@/components/event-modal";
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
type LaneMode = "inbox" | "archived";

const TAB_ORDER: Tab[] = ["news", "analysis", "friends"];
const AWAY_RELOAD_MS: number = 10 * 60 * 1000;
const EXIT_MS: number = 300;

function sortReadToBottom<T extends { read: boolean }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Number(a.read) - Number(b.read));
}

function partitionByRead<T extends { read: boolean }>(
  items: readonly T[],
): { unread: T[]; read: T[] } {
  const unread: T[] = [];
  const read: T[] = [];
  for (const item of items) {
    if (item.read) read.push(item);
    else unread.push(item);
  }
  return { unread, read };
}

function InboxLaneSection({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(defaultOpen);
  if (count === 0) return null;
  return (
    <div className="mt-5 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-1 flex w-full items-center justify-between text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400"
      >
        <span>
          {title} ({count})
        </span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open ? children : null}
    </div>
  );
}

export default function TodayPage() {
  const { notify } = useToast();
  const { session } = useAuth();
  const { requireAuth } = useAuthGate();
  const isSignedIn: boolean = session !== null;
  const [data, setData] = useState<TodayPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [openStoryId, setOpenStoryId] = useState<UUID | null>(null);
  const [openEventId, setOpenEventId] = useState<UUID | null>(null);
  const [exitingIds, setExitingIds] = useState<ReadonlySet<UUID>>(
    () => new Set<UUID>(),
  );
  const [tab, setTab] = useState<Tab>("news");
  const [laneMode, setLaneMode] = useState<LaneMode>("inbox");
  const [archivedEvents, setArchivedEvents] = useState<EventSummary[]>([]);
  const [archivedAnalysis, setArchivedAnalysis] = useState<Story[]>([]);
  const [archivedLoading, setArchivedLoading] = useState<boolean>(false);
  const [archivedLoaded, setArchivedLoaded] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const exitTimers = useRef<Map<UUID, number>>(new Map());

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const payload: TodayPayload = await api.getToday();
      setData({
        ...payload,
        events: {
          ...payload.events,
          items: sortReadToBottom(payload.events.items),
        },
        analysis: {
          ...payload.analysis,
          items: sortReadToBottom(payload.analysis.items),
        },
      });
      setArchivedLoaded(false);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to load Today", "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const loadArchived = useCallback(async (): Promise<void> => {
    if (!requireAuth("view archived items")) return;
    setArchivedLoading(true);
    try {
      const [eventsRes, analysisRes] = await Promise.all([
        api.getArchivedEvents(),
        api.getArchivedAnalysis(),
      ]);
      setArchivedEvents(eventsRes.items);
      setArchivedAnalysis(analysisRes.items);
      setArchivedLoaded(true);
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to load archived",
        "error",
      );
    } finally {
      setArchivedLoading(false);
    }
  }, [notify, requireAuth]);

  function switchLaneMode(next: LaneMode): void {
    if (next === "archived") {
      if (!requireAuth("view archived items")) return;
      setLaneMode("archived");
      if (!archivedLoaded) void loadArchived();
      return;
    }
    setLaneMode("inbox");
  }

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let hiddenAt: number | null = null;
    function onVisibilityChange(): void {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= AWAY_RELOAD_MS) {
        void load();
      }
      hiddenAt = null;
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [load]);

  useEffect(() => {
    const timers = exitTimers.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  function beginExit(id: UUID, after: () => void): void {
    const existing: number | undefined = exitTimers.current.get(id);
    if (existing !== undefined) window.clearTimeout(existing);
    setExitingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const timer: number = window.setTimeout(() => {
      after();
      exitTimers.current.delete(id);
      setExitingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, EXIT_MS);
    exitTimers.current.set(id, timer);
  }

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

  function restoreEvent(removed: EventSummary): void {
    setData((prev) =>
      prev
        ? {
            ...prev,
            events: {
              ...prev.events,
              items: sortReadToBottom([...prev.events.items, removed]),
              total: prev.events.total + 1,
            },
          }
        : prev,
    );
  }

  function restoreStory(removed: Story): void {
    setData((prev) =>
      prev
        ? {
            ...prev,
            analysis: {
              ...prev.analysis,
              items: sortReadToBottom([...prev.analysis.items, removed]),
              total: prev.analysis.total + 1,
            },
          }
        : prev,
    );
  }

  function markEventAsRead(eventId: UUID): void {
    if (!requireAuth("mark items as read")) return;
    const event: EventSummary | undefined = data?.events.items.find(
      (e) => e.id === eventId,
    );
    if (!event || event.read) return;

    beginExit(eventId, () => {
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          events: {
            ...prev.events,
            items: prev.events.items.map((ev) =>
              ev.id === eventId ? { ...ev, read: true } : ev,
            ),
          },
        };
      });
    });

    void api.markEventRead(eventId).catch(() => undefined);
  }

  function markStoryAsRead(storyId: UUID): void {
    if (!requireAuth("mark items as read")) return;
    const story: Story | undefined = data?.analysis.items.find(
      (s) => s.id === storyId,
    );
    if (!story || story.read) return;

    beginExit(storyId, () => {
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          analysis: {
            ...prev.analysis,
            items: prev.analysis.items.map((s) =>
              s.id === storyId ? { ...s, read: true } : s,
            ),
          },
        };
      });
    });

    void api.markRead(storyId, true).catch(() => undefined);
  }

  function dismissEvent(eventId: UUID): void {
    if (!requireAuth("archive items")) return;
    if (laneMode === "archived") {
      const removed: EventSummary | undefined = archivedEvents.find(
        (e) => e.id === eventId,
      );
      if (!removed) return;
      beginExit(eventId, () => {
        setArchivedEvents((prev) => prev.filter((e) => e.id !== eventId));
        restoreEvent({ ...removed, dismissed: false });
      });
      void api.undismissEvent(eventId).catch(() => {
        setArchivedEvents((prev) => [removed, ...prev]);
        notify("Could not restore event", "error");
      });
      return;
    }

    if (!data) return;
    const removed: EventSummary | undefined = data.events.items.find(
      (e) => e.id === eventId,
    );
    if (!removed) return;

    beginExit(eventId, () => {
      setData((prev) =>
        prev
          ? {
              ...prev,
              events: {
                ...prev.events,
                items: prev.events.items.filter((e) => e.id !== eventId),
                total: Math.max(0, prev.events.total - 1),
              },
            }
          : prev,
      );
      if (archivedLoaded) {
        setArchivedEvents((prev) => [
          { ...removed, dismissed: true },
          ...prev.filter((e) => e.id !== eventId),
        ]);
      }
    });

    void api.dismissEvent(eventId).catch(() => {
      restoreEvent(removed);
      notify("Could not archive event", "error");
    });
    notify("Archived", "info", {
      label: "Undo",
      onClick: () => {
        void api.undismissEvent(eventId).then(() => {
          restoreEvent(removed);
          setArchivedEvents((prev) => prev.filter((e) => e.id !== eventId));
        });
      },
    });
  }

  function dismissStory(storyId: UUID): void {
    if (!requireAuth("archive items")) return;
    if (laneMode === "archived") {
      const removed: Story | undefined = archivedAnalysis.find(
        (s) => s.id === storyId,
      );
      if (!removed) return;
      beginExit(storyId, () => {
        setArchivedAnalysis((prev) => prev.filter((s) => s.id !== storyId));
        restoreStory({ ...removed, dismissed: false });
      });
      void api.undismissStory(storyId).catch(() => {
        setArchivedAnalysis((prev) => [removed, ...prev]);
        notify("Could not restore article", "error");
      });
      return;
    }

    if (!data) return;
    const removed: Story | undefined = data.analysis.items.find(
      (s) => s.id === storyId,
    );
    if (!removed) return;

    beginExit(storyId, () => {
      setData((prev) =>
        prev
          ? {
              ...prev,
              analysis: {
                ...prev.analysis,
                items: prev.analysis.items.filter((s) => s.id !== storyId),
                total: Math.max(0, prev.analysis.total - 1),
              },
            }
          : prev,
      );
      if (archivedLoaded) {
        setArchivedAnalysis((prev) => [
          { ...removed, dismissed: true },
          ...prev.filter((s) => s.id !== storyId),
        ]);
      }
    });

    void api.dismissStory(storyId).catch(() => {
      restoreStory(removed);
      notify("Could not archive article", "error");
    });
    notify("Archived", "info", {
      label: "Undo",
      onClick: () => {
        void api.undismissStory(storyId).then(() => {
          restoreStory(removed);
          setArchivedAnalysis((prev) => prev.filter((s) => s.id !== storyId));
        });
      },
    });
  }

  function handleOpenEvent(eventId: UUID): void {
    setOpenEventId(eventId);
    const event: EventSummary | undefined = data?.events.items.find(
      (e) => e.id === eventId,
    );
    if (!event || event.read) return;

    beginExit(eventId, () => {
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          events: {
            ...prev.events,
            items: prev.events.items.map((ev) =>
              ev.id === eventId ? { ...ev, read: true } : ev,
            ),
          },
        };
      });
    });

    if (isSignedIn) {
      void api.markEventRead(eventId).catch(() => undefined);
    }
  }

  function handleOpenStory(storyId: UUID): void {
    setOpenStoryId(storyId);
    const story: Story | undefined = data?.analysis.items.find(
      (s) => s.id === storyId,
    );
    if (story && !story.read) {
      beginExit(storyId, () => {
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            analysis: {
              ...prev.analysis,
              items: prev.analysis.items.map((s) =>
                s.id === storyId ? { ...s, read: true } : s,
              ),
            },
          };
        });
      });
    }
  }

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

  const events: EventSummary[] =
    laneMode === "archived" ? archivedEvents : data.events.items;
  const analysis: Story[] =
    laneMode === "archived" ? archivedAnalysis : data.analysis.items;
  const newsParts = partitionByRead(data.events.items);
  const analysisParts = partitionByRead(data.analysis.items);
  const unreadTotal: number =
    newsParts.unread.length + analysisParts.unread.length;
  const inboxTotal: number =
    data.events.items.length + data.analysis.items.length;
  const openEventData: EventSummary | undefined = openEventId
    ? [...data.events.items, ...archivedEvents].find((e) => e.id === openEventId)
    : undefined;

  if (inboxTotal === 0 && laneMode === "inbox") {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => switchLaneMode("archived")}
            className="text-[11px] font-medium text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Archived
          </button>
        </div>
        <div className="border border-dashed border-zinc-300 p-10 text-center text-zinc-500">
          No stories in the briefing yet — check back soon as we gather news from
          top sources.
        </div>
      </div>
    );
  }

  function renderNewsList(
    items: EventSummary[],
    archivedView: boolean = false,
  ): React.ReactNode {
    return (
      <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {items.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            exiting={exitingIds.has(event.id)}
            archivedView={archivedView}
            onOpen={handleOpenEvent}
            onRead={archivedView ? undefined : markEventAsRead}
            onDismiss={dismissEvent}
          />
        ))}
      </div>
    );
  }

  function renderAnalysisList(
    items: Story[],
    archivedView: boolean = false,
  ): React.ReactNode {
    return (
      <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {items.map((story) => (
          <StoryCard
            key={story.id}
            story={story}
            exiting={exitingIds.has(story.id)}
            archivedView={archivedView}
            onChange={onStoryChange}
            onOpen={handleOpenStory}
            onRead={archivedView ? undefined : markStoryAsRead}
            onDismiss={dismissStory}
          />
        ))}
      </div>
    );
  }

  function LaneHeader({ title }: { title: string }): React.ReactNode {
    return (
      <div className="mb-1 flex items-end justify-between gap-3 border-b-2 border-zinc-900 pb-2 dark:border-zinc-100">
        <h2 className="font-serif text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {title}
        </h2>
        <button
          type="button"
          onClick={() =>
            switchLaneMode(laneMode === "inbox" ? "archived" : "inbox")
          }
          className="pb-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400 underline-offset-2 hover:text-zinc-800 hover:underline dark:hover:text-zinc-200"
        >
          {laneMode === "inbox" ? "Archived" : "Inbox"}
        </button>
      </div>
    );
  }

  const newsContent =
    laneMode === "archived" ? (
      archivedLoading && !archivedLoaded ? (
        <p className="text-sm text-slate-400">Loading archived…</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-slate-400">No archived news events.</p>
      ) : (
        renderNewsList(events, true)
      )
    ) : events.length === 0 ? (
      <p className="text-sm text-slate-400">
        No news events in your inbox — follow more outlets or wait for broader
        coverage.
      </p>
    ) : (
      <div>
        {newsParts.unread.length > 0 ? (
          renderNewsList(newsParts.unread)
        ) : (
          <p className="text-sm text-slate-400">You&apos;re caught up on the news.</p>
        )}
        <InboxLaneSection title="Already read" count={newsParts.read.length}>
          {renderNewsList(newsParts.read)}
        </InboxLaneSection>
      </div>
    );

  const analysisContent =
    laneMode === "archived" ? (
      archivedLoading && !archivedLoaded ? (
        <p className="text-sm text-slate-400">Loading archived…</p>
      ) : analysis.length === 0 ? (
        <p className="text-sm text-slate-400">No archived analysis.</p>
      ) : (
        renderAnalysisList(analysis, true)
      )
    ) : analysis.length === 0 ? (
      <p className="text-sm text-slate-400">
        No analysis in your inbox — follow outlets/authors or wait for friends to
        engage.
      </p>
    ) : (
      <div>
        {analysisParts.unread.length > 0 ? (
          renderAnalysisList(analysisParts.unread)
        ) : (
          <p className="text-sm text-slate-400">
            You&apos;re caught up on analysis.
          </p>
        )}
        <InboxLaneSection
          title="Already read"
          count={analysisParts.read.length}
        >
          {renderAnalysisList(analysisParts.read)}
        </InboxLaneSection>
      </div>
    );

  function tabClass(active: boolean): string {
    return `flex-1 border-b-2 px-3 py-2 text-sm font-semibold transition ${
      active
        ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
        : "border-transparent text-zinc-400"
    }`;
  }

  const statusFooter = (
    <div className="shrink-0 border-y border-zinc-900 py-4 text-center dark:border-zinc-100">
      <p className="font-serif text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {laneMode === "archived"
          ? "Archived"
          : unreadTotal === 0
            ? "You're caught up"
            : "Inbox"}
      </p>
      <p className="mt-1 text-[12px] uppercase tracking-[0.08em] text-zinc-400">
        {laneMode === "archived"
          ? `${archivedEvents.length} events · ${archivedAnalysis.length} analysis pieces`
          : unreadTotal === 0
            ? `${data.events.items.length} events · ${data.analysis.items.length} analysis pieces`
            : `${newsParts.unread.length} unread events · ${analysisParts.unread.length} unread analysis`}
        {laneMode === "inbox" && data.friend_pick_count > 0
          ? ` · ${data.friend_pick_count} with friend reactions`
          : ""}
      </p>
    </div>
  );

  return (
    <div className="space-y-6 lg:flex lg:h-[calc(100vh-7.5rem)] lg:flex-col lg:space-y-0 lg:overflow-hidden">
      <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-2 lg:gap-0">
        <section className="flex min-h-0 flex-col pr-8">
          <div className="shrink-0 bg-white dark:bg-zinc-950">
            <LaneHeader title="The News" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {newsContent}
          </div>
        </section>
        <section className="flex min-h-0 flex-col border-l border-zinc-200 pl-8 pr-6 dark:border-zinc-800">
          <div className="shrink-0 bg-white dark:bg-zinc-950">
            <LaneHeader title="Analysis" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {analysisContent}
          </div>
        </section>
      </div>

      <div className="lg:hidden">
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={() =>
              switchLaneMode(laneMode === "inbox" ? "archived" : "inbox")
            }
            className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400 underline-offset-2 hover:text-zinc-800 hover:underline dark:hover:text-zinc-200"
          >
            {laneMode === "inbox" ? "Archived" : "Inbox"}
          </button>
        </div>
        <div className="sticky top-14 z-10 mb-3 flex border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
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

      <div className="mt-6 lg:mt-4">{statusFooter}</div>

      {openEventData ? (
        <EventModal
          event={openEventData}
          onClose={() => setOpenEventId(null)}
          onOpenStory={(storyId) => {
            setOpenStoryId(storyId);
          }}
        />
      ) : null}

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
