"use client";

import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { Source } from "@/lib/types";
import { useCallback, useEffect, useMemo, useState } from "react";

export default function SourcesPage() {
  const { notify } = useToast();
  const [all, setAll] = useState<Source[]>([]);
  const [followed, setFollowed] = useState<Source[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [query, setQuery] = useState<string>("");

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [sources, mine] = await Promise.all([
        api.listSources(),
        api.getMySources(),
      ]);
      setAll(sources);
      setFollowed(mine);
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
    () => new Set(followed.map((s) => s.id)),
    [followed],
  );

  const visible = useMemo<Source[]>(() => {
    const q: string = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.homepage_url.toLowerCase().includes(q),
    );
  }, [all, query]);

  async function toggleFollow(source: Source): Promise<void> {
    const isFollowed: boolean = followedIds.has(source.id);
    const nextIds: string[] = isFollowed
      ? followed.filter((s) => s.id !== source.id).map((s) => s.id)
      : [...followed.map((s) => s.id), source.id];
    try {
      const updated = await api.setMySources(nextIds);
      setFollowed(updated);
      notify(isFollowed ? `Unfollowed ${source.name}` : `Following ${source.name}`, "success");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to update", "error");
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Sources</h1>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter sources…"
          className="w-48 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
        />
      </div>

      {loading ? (
        <p className="text-slate-400">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((source) => {
            const isFollowed: boolean = followedIds.has(source.id);
            return (
              <div
                key={source.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">{source.name}</p>
                  <p className="truncate text-xs text-slate-400">
                    {source.homepage_url}
                  </p>
                  {source.tags.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {source.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  onClick={() => toggleFollow(source)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                    isFollowed
                      ? "border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                      : "bg-brand-600 text-white hover:bg-brand-700"
                  }`}
                >
                  {isFollowed ? "Following" : "Follow"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
