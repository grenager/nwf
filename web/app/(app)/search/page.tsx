"use client";

import { StoryCard } from "@/components/story-card";
import { StoryModal } from "@/components/story-modal";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { Story, UUID } from "@/lib/types";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchInner />
    </Suspense>
  );
}

function SearchInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { notify } = useToast();
  const initialQuery: string = params.get("q") ?? "";

  const [query, setQuery] = useState<string>(initialQuery);
  const [results, setResults] = useState<Story[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [searched, setSearched] = useState<boolean>(false);
  const [openStoryId, setOpenStoryId] = useState<UUID | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(
    async (q: string): Promise<void> => {
      const trimmed: string = q.trim();
      if (!trimmed) {
        setResults([]);
        setTotal(0);
        setSearched(false);
        return;
      }
      setLoading(true);
      try {
        const list = await api.titleSearchStories(trimmed);
        setResults(list.items);
        setTotal(list.total);
        setSearched(true);
      } catch (err) {
        notify(
          err instanceof ApiError ? err.message : "Search failed",
          "error",
        );
      } finally {
        setLoading(false);
      }
    },
    [notify],
  );

  useEffect(() => {
    if (initialQuery.trim()) void runSearch(initialQuery);
    // Run once on mount for a shared/deep-linked query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onChange(value: string): void {
    setQuery(value);
    const url: string = value.trim()
      ? `/search?q=${encodeURIComponent(value.trim())}`
      : "/search";
    router.replace(url);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(value), 300);
  }

  const patchStatus = useCallback(
    (storyId: UUID, patch: { read?: boolean }): void => {
      setResults((prev) =>
        prev.map((s) => (s.id === storyId ? { ...s, ...patch } : s)),
      );
    },
    [],
  );

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold text-slate-900 dark:text-slate-100">
        Search
      </h1>
      <div className="sticky top-0 z-10 bg-white pb-3 dark:bg-slate-950">
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search recent article titles…"
          className="w-full border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-400">Searching…</p>
      ) : searched && results.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">
          No matching titles found.
        </p>
      ) : results.length > 0 ? (
        <>
          <p className="mb-3 text-xs text-slate-400">
            {total} result{total === 1 ? "" : "s"}
          </p>
          <div className="flex flex-col gap-3">
            {results.map((story) => (
              <StoryCard
                key={story.id}
                story={story}
                onOpen={setOpenStoryId}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="py-8 text-center text-sm text-slate-400">
          Type to search recent article titles.
        </p>
      )}

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
