"use client";

import { api, ApiError } from "@/lib/api";
import type { FunnelStage, InviteFunnel } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";

const WINDOWS: { label: string; days: number | undefined }[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: undefined },
];

function percent(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 100)}%`;
}

function StageTable({
  title,
  subtitle,
  stages,
}: {
  title: string;
  subtitle: string;
  stages: FunnelStage[];
}) {
  const top: number = stages[0]?.count ?? 0;
  return (
    <div>
      <h3 className="font-serif text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {title}
      </h3>
      <p className="mt-1 text-xs text-zinc-500">{subtitle}</p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-[0.08em] text-zinc-400 dark:border-zinc-800">
            <th className="py-1.5 font-semibold">Stage</th>
            <th className="py-1.5 text-right font-semibold">Count</th>
            <th className="py-1.5 text-right font-semibold">From above</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((stage) => (
            <tr
              key={stage.key}
              className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-900"
            >
              <td className="py-2 pr-3">
                <span className="text-zinc-900 dark:text-zinc-100">
                  {stage.label}
                </span>
                {stage.note ? (
                  <span className="mt-0.5 block text-[11px] leading-snug text-zinc-400">
                    {stage.note}
                  </span>
                ) : null}
                {/* A bar makes the drop-off legible at a glance without a chart. */}
                <span
                  aria-hidden
                  className="mt-1.5 block h-1 bg-zinc-900 dark:bg-zinc-100"
                  style={{
                    width: top > 0 ? `${Math.round((stage.count / top) * 100)}%` : "0%",
                  }}
                />
              </td>
              <td className="py-2 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                {stage.count}
              </td>
              <td className="py-2 text-right tabular-nums text-zinc-500">
                {percent(stage.rate_from_previous)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The invite funnel, split in two on purpose.
 *
 * One reusable link is opened and joined by many people, so counting signups
 * per invitation row would understate reach — everything downstream of an
 * open is denominated on opens and redemptions instead.
 */
export function InviteFunnelReport() {
  const [days, setDays] = useState<number | undefined>(30);
  const [data, setData] = useState<InviteFunnel | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setData(await api.getInviteFunnel(days));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not load the funnel",
      );
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b-2 border-zinc-900 pb-2 dark:border-zinc-100">
        <h2 className="font-serif text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Invite funnel
        </h2>
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.label}
              type="button"
              onClick={() => setDays(w.days)}
              className={`px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${
                w.days === days
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {loading && data === null ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : null}

      {data ? (
        <div className="space-y-8">
          <StageTable
            title="Links"
            subtitle="One row per invite link minted."
            stages={data.link_funnel.stages}
          />

          <div className="border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-sm text-zinc-900 dark:text-zinc-100">
              <span className="tabular-nums font-semibold">
                {data.link_funnel.unknown_fate}
              </span>{" "}
              links were minted and never opened.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              We can&apos;t tell whether these were never sent or sent and
              ignored — the OS share tray never reports where a link went, who
              received it, or how many people. Don&apos;t read them as failed
              invites.
            </p>
            {Object.keys(data.link_funnel.share_outcomes).length > 0 ? (
              <p className="mt-2 text-xs text-zinc-500">
                At the moment of minting:{" "}
                {Object.entries(data.link_funnel.share_outcomes)
                  .map(([outcome, n]) => `${n} ${outcome}`)
                  .join(", ")}
                .
              </p>
            ) : null}
          </div>

          <StageTable
            title="People"
            subtitle="Denominated on opens and redemptions, since one link serves many people."
            stages={data.person_funnel.stages}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                Fan-out
              </h3>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                Opened links brought in{" "}
                <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {data.fanout.mean_joiners_per_opened_link}
                </span>{" "}
                people on average.
              </p>
              <ul className="mt-2 space-y-0.5 text-xs text-zinc-500">
                {Object.entries(data.fanout.links_with_joiners).map(
                  ([bucket, n]) => (
                    <li key={bucket} className="tabular-nums">
                      {n} link{n === 1 ? "" : "s"} → {bucket} joined
                    </li>
                  ),
                )}
              </ul>
              <p className="mt-2 text-[11px] leading-snug text-zinc-400">
                The closest thing to &quot;how many people was this sent
                to&quot; — a link that brought in several was plainly
                broadcast.
              </p>
            </div>

            <div className="border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                Does the loop compound?
              </h3>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {data.arrivals_who_invited}
                </span>{" "}
                of{" "}
                <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                  {data.arrivals}
                </span>{" "}
                people who arrived via an invite went on to send one within 14
                days{" "}
                {data.arrivals_who_invited_rate !== null
                  ? `(${percent(data.arrivals_who_invited_rate)})`
                  : ""}
                .
              </p>
              <p className="mt-2 text-[11px] leading-snug text-zinc-400">
                The number that decides whether there&apos;s a third
                generation. Everyone here started with exactly one friend.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
