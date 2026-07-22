"use client";

import { StarsDisplay } from "@/components/star-rating";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import type { FriendActivityItem, FriendProfile, Profile, UUID } from "@/lib/types";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface FriendProfileModalProps {
  friendId: UUID;
  /** Default `"modal"`. Use `"page"` for a full-page profile (no overlay). */
  variant?: "modal" | "page";
  onClose?: () => void;
  onSignOut?: () => void;
  /** Called after a successful profile save (e.g. refresh an admin list). */
  onUpdated?: () => void;
}

interface EditForm {
  first: string;
  last: string;
  image_url: string;
}

function KindLabel({ kind }: { kind: FriendActivityItem["kind"] }) {
  if (kind === "read") return <>Read</>;
  if (kind === "commented") return <>Commented on</>;
  if (kind === "rated") return <>Rated</>;
  return <>{kind}</>;
}

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

export function FriendProfileModal({
  friendId,
  variant = "modal",
  onClose,
  onSignOut,
  onUpdated,
}: FriendProfileModalProps) {
  const { notify } = useToast();
  const [profile, setProfile] = useState<FriendProfile | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [savingDigest, setSavingDigest] = useState<boolean>(false);
  const [savingInstant, setSavingInstant] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [editing, setEditing] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [form, setForm] = useState<EditForm>({ first: "", last: "", image_url: "" });
  const [mounted, setMounted] = useState<boolean>(false);
  const isPage: boolean = variant === "page";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isPage || onClose == null) return;
    const close: () => void = onClose;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [isPage, onClose]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const data: FriendProfile = await api.getFriendProfile(friendId);
      setProfile(data);
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to load profile",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [friendId, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mine: Profile = await api.getMe();
        if (!cancelled) setMe(mine);
      } catch {
        // Not signed in / unavailable — the toggle just won't render.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isSelf: boolean = me != null && me.id === friendId;

  async function toggleDigest(): Promise<void> {
    if (!me) return;
    const next: boolean = !me.digest_opt_out;
    setSavingDigest(true);
    // Optimistic update; revert on failure.
    setMe({ ...me, digest_opt_out: next });
    try {
      const updated: Profile = await api.updatePreferences({
        digest_opt_out: next,
      });
      setMe(updated);
      notify(
        next
          ? "Daily digest emails turned off"
          : "Daily digest emails turned on",
        "success",
      );
    } catch (err) {
      setMe({ ...me, digest_opt_out: !next });
      notify(
        err instanceof ApiError ? err.message : "Could not update preference",
        "error",
      );
    } finally {
      setSavingDigest(false);
    }
  }

  async function toggleInstantEmails(): Promise<void> {
    if (!me) return;
    const next: boolean = !me.instant_email_opt_out;
    setSavingInstant(true);
    setMe({ ...me, instant_email_opt_out: next });
    try {
      const updated: Profile = await api.updatePreferences({
        instant_email_opt_out: next,
      });
      setMe(updated);
      notify(
        next
          ? "Instant activity emails turned off"
          : "Instant activity emails turned on",
        "success",
      );
    } catch (err) {
      setMe({ ...me, instant_email_opt_out: !next });
      notify(
        err instanceof ApiError ? err.message : "Could not update preference",
        "error",
      );
    } finally {
      setSavingInstant(false);
    }
  }

  function startEdit(): void {
    if (!profile) return;
    setForm({
      first: profile.first ?? "",
      last: profile.last ?? "",
      image_url: profile.image_url ?? "",
    });
    setEditing(true);
  }

  async function saveEdit(): Promise<void> {
    setSaving(true);
    try {
      await api.updateProfile(friendId, {
        first: form.first.trim() || null,
        last: form.last.trim() || null,
        image_url: form.image_url.trim() || null,
        phone: null,
      });
      notify("Profile updated", "success");
      setEditing(false);
      await load();
      onUpdated?.();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Save failed", "error");
    } finally {
      setSaving(false);
    }
  }

  const body: ReactNode =
    loading || !profile ? (
      <div className={isPage ? "py-16 text-center text-slate-400" : "p-10 text-center text-slate-400"}>
        Loading…
      </div>
    ) : (
      <div className={isPage ? "py-4 sm:py-6" : "max-h-[85vh] overflow-y-auto p-6"}>
        <div className="flex items-center gap-4">
          {(editing ? form.image_url : profile.image_url) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={editing ? form.image_url : (profile.image_url ?? "")}
              alt=""
              className="h-16 w-16 shrink-0 rounded-[9999px] object-cover"
            />
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[9999px] bg-slate-200 text-2xl font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
              {profile.display_name.charAt(0).toUpperCase()}
            </span>
          )}
          {editing ? (
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex gap-2">
                <input
                  value={form.first}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, first: e.target.value }))
                  }
                  placeholder="First"
                  className="w-full border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <input
                  value={form.last}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, last: e.target.value }))
                  }
                  placeholder="Last"
                  className="w-full border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <input
                value={form.image_url}
                onChange={(e) =>
                  setForm((f) => ({ ...f, image_url: e.target.value }))
                }
                placeholder="Avatar image URL"
                className="w-full border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          ) : (
            <div className="min-w-0 flex-1">
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
          )}
          {!editing && (profile.can_edit || onSignOut) ? (
            <div className="mt-8 flex shrink-0 items-center gap-2 self-start">
              {profile.can_edit ? (
                <button
                  onClick={startEdit}
                  className="border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Edit
                </button>
              ) : null}
              {onSignOut ? (
                <button
                  onClick={onSignOut}
                  className="border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Sign out
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {editing ? (
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setEditing(false)}
              className="border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              onClick={() => void saveEdit()}
              disabled={saving}
              className="bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        ) : null}

        <div className="mt-5 flex gap-2">
          <Stat label="Read" value={profile.reads} />
          <Stat label="Rated" value={profile.ratings} />
          <Stat label="Comments" value={profile.comments} />
        </div>

        {isSelf && me ? (
          <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
              Email notifications
            </h3>
            <div className="mt-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Daily digest
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  A once-daily email with new posts and activity from your
                  friends.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!me.digest_opt_out}
                aria-label="Toggle daily digest emails"
                disabled={savingDigest}
                onClick={() => void toggleDigest()}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-[9999px] transition-colors disabled:opacity-60 ${
                  me.digest_opt_out
                    ? "bg-slate-300 dark:bg-slate-700"
                    : "bg-emerald-500"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-[9999px] bg-white shadow transition-transform ${
                    me.digest_opt_out ? "translate-x-0.5" : "translate-x-[22px]"
                  }`}
                />
              </button>
            </div>
            <div className="mt-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  Instant activity emails
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Get an email right away when a friend posts, comments on your
                  article, or replies to you.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!me.instant_email_opt_out}
                aria-label="Toggle instant activity emails"
                disabled={savingInstant}
                onClick={() => void toggleInstantEmails()}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-[9999px] transition-colors disabled:opacity-60 ${
                  me.instant_email_opt_out
                    ? "bg-slate-300 dark:bg-slate-700"
                    : "bg-emerald-500"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-[9999px] bg-white shadow transition-transform ${
                    me.instant_email_opt_out
                      ? "translate-x-0.5"
                      : "translate-x-[22px]"
                  }`}
                />
              </button>
            </div>
          </div>
        ) : null}

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
                      <KindLabel kind={item.kind} />
                    </span>
                    {item.kind === "rated" && item.rating != null ? (
                      <StarsDisplay value={item.rating} size="xs" />
                    ) : null}
                    {item.source_name ? <span>· {item.source_name}</span> : null}
                    <span className="ml-auto normal-case tracking-normal">
                      {relativeTime(item.at)}
                    </span>
                  </div>
                  <a
                    href={item.article_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block font-serif text-[15px] font-semibold leading-snug tracking-tight text-slate-900 hover:text-brand-600 dark:text-slate-100"
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
    );

  if (isPage) {
    return <div className="mx-auto w-full max-w-lg">{body}</div>;
  }

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="relative my-auto w-full max-w-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {onClose ? (
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center text-xl text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
          >
            ✕
          </button>
        ) : null}
        {body}
      </div>
    </div>,
    document.body,
  );
}
