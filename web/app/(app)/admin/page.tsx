"use client";

import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { Profile, SourceStatus } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then: number = new Date(iso).getTime();
  const secs: number = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

export default function AdminPage() {
  const { notify } = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<SourceStatus[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [forbidden, setForbidden] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const me = await api.getMe();
      setProfile(me);
      if (!me.is_admin) {
        setForbidden(true);
        return;
      }
      setRows(await api.getSourcesStatus());
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
      } else {
        notify(err instanceof ApiError ? err.message : "Failed to load", "error");
      }
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  async function scrape(id: string, name: string): Promise<void> {
    setBusyId(id);
    try {
      const res = await api.scrapeSource(id);
      notify(`Scraped ${name}: ${res.ingested} entries`, "success");
      setRows(await api.getSourcesStatus());
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Scrape failed", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function scrapeAll(): Promise<void> {
    setBusyId("all");
    try {
      for (const row of rows) {
        if (row.has_rss) await api.scrapeSource(row.id);
      }
      notify("Scraped all sources", "success");
      setRows(await api.getSourcesStatus());
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Scrape failed", "error");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="text-slate-400">Loading…</p>;
  }

  if (forbidden || !profile?.is_admin) {
    return (
      <div className="border border-slate-300 bg-slate-50 p-6 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
        <h1 className="text-lg font-bold">Admin only</h1>
        <p className="mt-1 text-sm">
          Your account isn&apos;t an admin. Ask an existing admin to set
          <code className="mx-1">profiles.is_admin = true</code> for your user.
        </p>
      </div>
    );
  }

  const totalStories: number = rows.reduce((sum, r) => sum + r.story_count, 0);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin · Scraper status</h1>
          <p className="text-sm text-slate-400">
            {rows.length} sources · {totalStories} stories
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void load()}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Refresh
          </button>
          <button
            onClick={() => void scrapeAll()}
            disabled={busyId !== null}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busyId === "all" ? "Scraping…" : "Scrape all"}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
            <tr>
              <th className="px-4 py-3 font-semibold">Source</th>
              <th className="px-4 py-3 font-semibold">Last scraped</th>
              <th className="px-4 py-3 text-right font-semibold">Stories</th>
              <th className="px-4 py-3 font-semibold">Newest</th>
              <th className="px-4 py-3 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((row) => (
              <tr key={row.id} className="bg-white dark:bg-slate-950">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {row.name}
                  </div>
                  {!row.has_rss ? (
                    <span className="text-xs text-slate-500">no RSS URL</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {relativeTime(row.last_scraped_at)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{row.story_count}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                  {relativeTime(row.newest_story_at)}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => void scrape(row.id, row.name)}
                    disabled={!row.has_rss || busyId !== null}
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {busyId === row.id ? "Scraping…" : "Scrape now"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
