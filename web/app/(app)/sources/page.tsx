"use client";

import { useAuthGate } from "@/components/auth-gate";
import { useToast } from "@/components/toast";
import { stripHtml } from "@/lib/html";
import { api, ApiError } from "@/lib/api";
import type { Source, Story } from "@/lib/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export default function SourcesPage() {
  const { notify } = useToast();
  const { requireAuth } = useAuthGate();
  const [sources, setSources] = useState<Source[]>([]);
  const [allSources, setAllSources] = useState<Source[]>([]);
  const [bySource, setBySource] = useState<Record<string, Story[]>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const dragIndex = useRef<number | null>(null);

  useEffect(() => {
    if (!openMenuId) return;
    const close = (): void => setOpenMenuId(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenuId]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [mySources, feed, all] = await Promise.all([
        api.getMySources(),
        api.getRecommended(),
        api.listSources(),
      ]);
      setSources(mySources);
      setAllSources(all);
      const grouped: Record<string, Story[]> = {};
      for (const story of feed.items) {
        if (!story.source_id) continue;
        (grouped[story.source_id] ??= []).push(story);
      }
      setBySource(grouped);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to load sources", "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const followedIds = useMemo<Set<string>>(
    () => new Set(sources.map((s) => s.id)),
    [sources],
  );

  const addableSources = useMemo<Source[]>(() => {
    const q: string = query.trim().toLowerCase();
    const notFollowed = allSources.filter((s) => !followedIds.has(s.id));
    const filtered = q
      ? notFollowed.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.homepage_url.toLowerCase().includes(q),
        )
      : notFollowed;
    return [...filtered].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }, [allSources, followedIds, query]);

  async function persistOrder(next: Source[]): Promise<void> {
    if (!requireAuth("customize your sources")) return;
    setSources(next);
    try {
      await api.setMySources(next.map((s) => s.id));
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to save order", "error");
      void load();
    }
  }

  function onDrop(targetIndex: number): void {
    const from: number | null = dragIndex.current;
    dragIndex.current = null;
    if (from === null || from === targetIndex) return;
    const next: Source[] = [...sources];
    const [moved] = next.splice(from, 1);
    next.splice(targetIndex, 0, moved);
    void persistOrder(next);
  }

  async function toggleFollow(source: Source): Promise<void> {
    if (!requireAuth("customize your sources")) return;
    const isFollowed: boolean = followedIds.has(source.id);
    const nextIds: string[] = isFollowed
      ? sources.filter((s) => s.id !== source.id).map((s) => s.id)
      : [...sources.map((s) => s.id), source.id];
    try {
      const updated = await api.setMySources(nextIds);
      setSources(updated);
      notify(
        isFollowed ? `Unfollowed ${source.name}` : `Following ${source.name}`,
        "success",
      );
      void load();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to update", "error");
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Sources</h1>
        <div className="flex items-center gap-3">
          <p className="hidden text-xs text-slate-400 sm:block">
            Drag headers to reorder
          </p>
          <button
            onClick={() => {
              if (!requireAuth("customize your sources")) return;
              setAddOpen((v) => !v);
            }}
            className="bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            {addOpen ? "Done" : "Add source"}
          </button>
        </div>
      </div>

      {addOpen ? (
        <div className="mb-6 border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300">
              Add a source
            </h2>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sources…"
              className="w-40 border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 sm:w-56"
            />
          </div>
          {addableSources.length === 0 ? (
            <p className="px-1 py-4 text-sm text-slate-400">
              {query.trim()
                ? "No matching sources to add."
                : "You're already following every available source."}
            </p>
          ) : (
            <div className="grid max-h-[50vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {addableSources.map((source) => (
                <div
                  key={source.id}
                  className="flex items-center justify-between gap-3 border border-slate-200 p-3 dark:border-slate-800"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{source.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {source.homepage_url}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleFollow(source)}
                    className="shrink-0 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {loading ? (
        <p className="text-slate-400">Loading sources…</p>
      ) : sources.length === 0 ? (
        <div className="border border-dashed border-slate-300 p-10 text-center text-slate-500 dark:border-slate-700">
          You aren&apos;t following any sources yet.{" "}
          <button
            onClick={() => {
              if (!requireAuth("customize your sources")) return;
              setAddOpen(true);
            }}
            className="font-semibold text-brand-600 underline"
          >
            Add some sources
          </button>
          .
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sources.map((source, index) => (
            <section
              key={source.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(index)}
              className="border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40"
            >
              <header
                draggable
                onDragStart={() => (dragIndex.current = index)}
                className="flex cursor-grab items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800"
              >
                <span className="text-slate-300">⠿</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-slate-800 dark:text-slate-100">
                  {source.name}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <div className="relative">
                    <button
                      type="button"
                      aria-label="Source options"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId((cur) =>
                          cur === source.id ? null : source.id,
                        );
                      }}
                      className="px-1 leading-none text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                      ⋯
                    </button>
                    {openMenuId === source.id ? (
                      <div className="absolute right-0 top-full z-20 mt-1 w-32 border border-slate-200 bg-white py-1 text-sm dark:border-slate-700 dark:bg-slate-900">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                            void toggleFollow(source);
                          }}
                          className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          Remove
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </header>
              <div className="h-56 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                {(bySource[source.id] ?? []).length === 0 ? (
                  <p className="px-3 py-3 text-center text-xs text-slate-400">
                    No recent stories
                  </p>
                ) : (
                  (bySource[source.id] ?? []).map((story) => (
                    <a
                      key={story.id}
                      href={story.article_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex items-center gap-2 px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                    >
                      {story.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={story.image_url}
                          alt=""
                          className="h-9 w-9 shrink-0 object-cover"
                        />
                      ) : (
                        <div className="h-9 w-9 shrink-0 bg-slate-100 dark:bg-slate-800" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {story.full_headline}
                        </p>
                        {story.summary ? (
                          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {stripHtml(story.summary)}
                          </p>
                        ) : null}
                      </div>
                    </a>
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
