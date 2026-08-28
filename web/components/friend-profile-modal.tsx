"use client";

import { StarsDisplay } from "@/components/star-rating";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import type { FriendActivityItem, FriendProfile, Profile, UUID } from "@/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { InviteButton } from "@/components/invite-button";
import { ModalShell } from "@/components/modal-shell";
import { ProfileMenu, type ProfileMenuItem } from "@/components/profile-menu";
import { SettingsModal } from "@/components/settings-modal";

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

/**
 * Where an activity row goes: the post detail page, anchored at the comment
 * that produced the row when there is one.
 */
function activityHref(item: FriendActivityItem): string {
  const base: string = `/post/${item.post_id}`;
  return item.comment_id ? `${base}?comment=${item.comment_id}` : base;
}

function Stat({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href?: string;
}) {
  const inner: ReactNode = (
    <>
      <div className="text-xl font-bold text-slate-900 dark:text-slate-100">
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
    </>
  );
  const className: string =
    "block border border-slate-200 p-3 text-center dark:border-slate-800";
  if (href === undefined) return <div className={className}>{inner}</div>;
  return (
    <Link
      href={href}
      className={`${className} transition hover:border-slate-400 hover:bg-slate-50 dark:hover:border-slate-600 dark:hover:bg-slate-900/50`}
    >
      {inner}
    </Link>
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
  const [loading, setLoading] = useState<boolean>(true);
  const [editing, setEditing] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [form, setForm] = useState<EditForm>({ first: "", last: "", image_url: "" });
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [friendCount, setFriendCount] = useState<number | null>(null);
  const isPage: boolean = variant === "page";

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

  useEffect(() => {
    if (!isSelf) return;
    let cancelled = false;
    void api
      .getFriends()
      .then((overview) => {
        if (!cancelled) setFriendCount(overview.total);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isSelf]);

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

  async function addFriend(): Promise<void> {
    try {
      await api.createConnection(friendId);
      notify("Friend request sent", "success");
      await load();
      onUpdated?.();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to add friend", "error");
    }
  }

  async function removeFriend(): Promise<void> {
    try {
      await api.deleteConnection(friendId);
      notify("Friend removed", "info");
      await load();
      onUpdated?.();
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to remove friend",
        "error",
      );
    }
  }

  const menuItems: ProfileMenuItem[] = profile
    ? [
        ...(profile.can_edit ? [{ label: "Edit profile", onSelect: startEdit }] : []),
        ...(!isSelf
          ? [
              {
                label: profile.is_friend ? "Remove friend" : "Add friend",
                onSelect: () => void (profile.is_friend ? removeFriend() : addFriend()),
              },
            ]
          : []),
        ...(isSelf
          ? [{ label: "Settings", onSelect: () => setSettingsOpen(true) }]
          : []),
        ...(onSignOut ? [{ label: "Sign out", onSelect: onSignOut }] : []),
      ]
    : [];

  const body: ReactNode =
    loading || !profile ? (
      <div className={isPage ? "py-16 text-center text-slate-400" : "p-10 text-center text-slate-400"}>
        Loading…
      </div>
    ) : (
      <div className={isPage ? "py-4 sm:py-6" : "p-6"}>
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
          {/* In the modal variant this lives in the header bar instead, next
              to the close button, so the two controls don't collide. */}
          {!editing && isPage ? <ProfileMenu items={menuItems} /> : null}
        </div>

        {isSelf && !editing ? (
          <div className="mt-4">
            <InviteButton />
          </div>
        ) : null}

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

        <div
          className={`mt-5 grid gap-2 ${
            isSelf ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"
          }`}
        >
          {isSelf ? (
            <Stat label="Friends" value={friendCount ?? 0} href="/friends" />
          ) : null}
          <Stat label="Read" value={profile.reads} />
          <Stat label="Rated" value={profile.ratings} />
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
                  {item.post_id ? (
                    <Link
                      href={activityHref(item)}
                      onClick={onClose}
                      className="mt-1 block font-serif text-[15px] font-semibold leading-snug tracking-tight text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {item.headline}
                    </Link>
                  ) : (
                    <a
                      href={item.article_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block font-serif text-[15px] font-semibold leading-snug tracking-tight text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {item.headline}
                    </a>
                  )}
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

  const settings: ReactNode = settingsOpen ? (
    <SettingsModal onClose={() => setSettingsOpen(false)} />
  ) : null;

  if (isPage) {
    return (
      <div className="mx-auto w-full max-w-lg">
        {body}
        {settings}
      </div>
    );
  }

  return (
    <ModalShell
      onClose={onClose ?? null}
      mobile="fullscreen"
      width="lg"
      label="Profile"
      padded={false}
    >
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-slate-200 px-1 pb-1 pt-[calc(0.25rem+env(safe-area-inset-top))] sm:px-3 sm:py-1.5 dark:border-slate-800">
        {!editing && !loading && profile ? <ProfileMenu items={menuItems} /> : null}
        {onClose ? (
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center text-xl text-slate-500 hover:text-slate-900 sm:h-9 sm:w-9 sm:text-lg dark:hover:text-slate-100"
          >
            ✕
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {body}
      </div>
      {settings}
    </ModalShell>
  );
}
