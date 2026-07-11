"use client";

import { useToast } from "@/components/toast";
import { StoryCard } from "@/components/story-card";
import { api, ApiError } from "@/lib/api";
import type { Story } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";

export default function FeedPage() {
  const { notify } = useToast();
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [query, setQuery] = useState<string>("");

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const list = query.trim()
        ? await api.searchStories(query.trim())
        : await api.getRecommended();
      setStories(list.items);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to load feed", "error");
    } finally {
      setLoading(false);
    }
  }, [query, notify]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onStoryChange(updated: Story): void {
    setStories((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Your feed</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
          className="flex gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stories…"
            className="w-48 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
          />
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Search
          </button>
        </form>
      </div>

      {loading ? (
        <p className="text-slate-400">Loading stories…</p>
      ) : stories.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500 dark:border-slate-700">
          No stories yet. Add sources on the{" "}
          <a href="/sources" className="text-brand-600 underline">
            Sources
          </a>{" "}
          page.
        </div>
      ) : (
        <div className="space-y-3">
          {stories.map((story) => (
            <StoryCard key={story.id} story={story} onChange={onStoryChange} />
          ))}
        </div>
      )}
    </div>
  );
}
