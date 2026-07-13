"use client";

import { useAuth } from "@/components/auth-provider";
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

// Reload the briefing when the user returns after being away at least this long,
// so already-read items get re-sorted to the bottom (see sortReadToBottom).
const AWAY_RELOAD_MS: number = 10 * 60 * 1000;

// Stable partition that keeps unread items on top and moves read items to the
// bottom while preserving the server-provided order within each group. Applied
// only at load time so items never jump around while the user is reading.
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
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-2 flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wide text-slate-400"
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
  const isSignedIn: boolean = session !== null;
  const [data, setData] = useState<TodayPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [openStoryId, setOpenStoryId] = useState<UUID | null>(null);
  const [tab, setTab] = useState<Tab>("news");
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to load Today", "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-reload when the user returns to the tab after being away for a while.
  // Reloading re-sorts read items to the bottom without disorienting mid-session.
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

  function dismissEvent(eventId: UUID): void {
    if (!data) return;
    const removed: EventSummary | undefined = data.events.items.find(
      (e) => e.id === eventId,
    );
    if (!removed) return;
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
    void api.dismissEvent(eventId).catch(() => {
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
      notify("Could not dismiss event", "error");
    });
    notify("Event dismissed", "info", {
      label: "Undo",
      onClick: () => {
        void api.undismissEvent(eventId).then(() => {
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
        });
      },
    });
  }

  function dismissStory(storyId: UUID): void {
    if (!data) return;
    const removed: Story | undefined = data.analysis.items.find(
      (s) => s.id === storyId,
    );
    if (!removed) return;
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
    void api.dismissStory(storyId).catch(() => {
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
      notify("Could not dismiss article", "error");
    });
    notify("Article dismissed", "info", {
      label: "Undo",
      onClick: () => {
        void api.undismissStory(storyId).then(() => {
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
        });
      },
    });
  }

  function openStory(storyId: UUID, eventId?: UUID): void {
    setOpenStoryId(storyId);
    if (!isSignedIn || !eventId) return;
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
    void api.markEventRead(eventId).catch(() => undefined);
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

  const events: EventSummary[] = data.events.items;
  const analysis: Story[] = data.analysis.items;
  const newsParts = partitionByRead(events);
  const analysisParts = partitionByRead(analysis);
  const unreadTotal: number =
    newsParts.unread.length + analysisParts.unread.length;
  const totalItems: number = events.length + analysis.length;

  if (totalItems === 0) {
    return (
      <div className="border border-dashed border-slate-300 p-10 text-center text-slate-500">
        No stories in the briefing yet — check back soon as we gather news from
        top sources.
      </div>
    );
  }

  function renderNewsList(items: EventSummary[]): React.ReactNode {
    return (
      <div className="space-y-3">
        {items.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            onOpen={(storyId) => openStory(storyId, event.id)}
            onDismiss={isSignedIn ? dismissEvent : undefined}
          />
        ))}
      </div>
    );
  }

  function renderAnalysisList(items: Story[]): React.ReactNode {
    return (
      <div className="space-y-3">
        {items.map((story) => (
          <StoryCard
            key={story.id}
            story={story}
            onChange={onStoryChange}
            onOpen={(storyId) => openStory(storyId)}
            onDismiss={isSignedIn ? dismissStory : undefined}
          />
        ))}
      </div>
    );
  }

  const newsContent =
    events.length === 0 ? (
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
    analysis.length === 0 ? (
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
          {unreadTotal === 0 ? "You're caught up" : "Inbox"}
        </p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {unreadTotal === 0
            ? `${events.length} events · ${analysis.length} analysis pieces`
            : `${newsParts.unread.length} unread events · ${analysisParts.unread.length} unread analysis`}
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
