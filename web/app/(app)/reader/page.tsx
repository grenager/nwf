"use client";

import { StoryCard } from "@/components/story-card";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { Source, Story } from "@/lib/types";
import { useCallback, useEffect, useRef, useState } from "react";

export default function ReaderPage() {
  const { notify } = useToast();
  const [sources, setSources] = useState<Source[]>([]);
  const [bySource, setBySource] = useState<Record<string, Story[]>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const dragIndex = useRef<number | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [mySources, feed] = await Promise.all([
        api.getMySources(),
        api.getRecommended(),
      ]);
      setSources(mySources);
      const grouped: Record<string, Story[]> = {};
      for (const story of feed.items) {
        if (!story.source_id) continue;
        (grouped[story.source_id] ??= []).push(story);
      }
      setBySource(grouped);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to load reader", "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  async function persistOrder(next: Source[]): Promise<void> {
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

  if (loading) {
    return <p className="text-slate-400">Loading reader…</p>;
  }

  if (sources.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500 dark:border-slate-700">
        You aren&apos;t following any sources yet. Visit{" "}
        <a href="/sources" className="text-brand-600 underline">
          Sources
        </a>
        .
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reader</h1>
        <p className="text-xs text-slate-400">Drag column headers to reorder</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sources.map((source, index) => (
          <section
            key={source.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(index)}
            className="rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40"
          >
            <header
              draggable
              onDragStart={() => (dragIndex.current = index)}
              className="flex cursor-grab items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800"
            >
              <span className="truncate font-semibold text-slate-800 dark:text-slate-100">
                {source.name}
              </span>
              <span className="text-slate-300">⠿</span>
            </header>
            <div className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
              {(bySource[source.id] ?? []).length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-slate-400">
                  No recent stories
                </p>
              ) : (
                (bySource[source.id] ?? []).map((story) => (
                  <StoryCard key={story.id} story={story} dense />
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
