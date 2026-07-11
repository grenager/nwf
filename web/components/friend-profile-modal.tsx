"use client";

import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import type { FriendActivityItem, FriendProfile, UUID } from "@/lib/types";
import { useEffect, useState } from "react";

interface FriendProfileModalProps {
  friendId: UUID;
  onClose: () => void;
}

const KIND_LABEL: Record<FriendActivityItem["kind"], string> = {
  read: "Read",
  hearted: "Hearted",
  commented: "Commented on",
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 border border-slate-200 p-3 text-center dark:border-slate-800">
      <div className="text-xl font-bold text-slate-900 dark:text-slate-100">
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
    </div>
  );
}

export function FriendProfileModal({ friendId, onClose }: FriendProfileModalProps) {
  const { notify } = useToast();
  const [profile, setProfile] = useState<FriendProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const data: FriendProfile = await api.getFriendProfile(friendId);
        if (!cancelled) setProfile(data);
      } catch (err) {
        if (!cancelled) {
          notify(
            err instanceof ApiError ? err.message : "Failed to load profile",
            "error",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [friendId, notify]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="relative my-auto w-full max-w-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center text-xl text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
        >
          ✕
        </button>

        {loading || !profile ? (
          <div className="p-10 text-center text-slate-400">Loading…</div>
        ) : (
          <div className="max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-center gap-4">
              {profile.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.image_url}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded-[9999px] object-cover"
                />
              ) : (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[9999px] bg-slate-200 text-2xl font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                  {profile.display_name.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  {profile.display_name}
                </h2>
                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                  {profile.online ? (
                    <>
                      <span className="h-2 w-2 rounded-[9999px] bg-emerald-500" />
                      Online now
                    </>
                  ) : profile.last_active_at ? (
                    <>Active {relativeTime(profile.last_active_at)}</>
                  ) : (
                    <>No activity yet</>
                  )}
                </p>
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <Stat label="Read" value={profile.reads} />
              <Stat label="Hearted" value={profile.hearts} />
              <Stat label="Comments" value={profile.comments} />
            </div>

            <div className="mt-6">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Recent activity
              </h3>
              {profile.recent.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">Nothing yet.</p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                  {profile.recent.map((item, idx) => (
                    <li key={`${item.story_id}-${item.kind}-${idx}`} className="py-3">
                      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-400">
                        <span className="font-semibold">
                          {KIND_LABEL[item.kind]}
                        </span>
                        {item.source_name ? <span>· {item.source_name}</span> : null}
                        <span className="ml-auto normal-case tracking-normal">
                          {relativeTime(item.at)}
                        </span>
                      </div>
                      <a
                        href={item.article_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block text-sm font-semibold leading-snug text-slate-900 hover:text-brand-600 dark:text-slate-100"
                      >
                        {item.headline}
                      </a>
                      {item.comment_text ? (
                        <p className="mt-1 border-l-2 border-slate-200 pl-2 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">
                          {item.comment_text}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
