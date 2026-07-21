"use client";

import { AddStoryModal } from "@/components/add-story-modal";
import { BrandLink } from "@/components/brand-mark";
import { useAuth } from "@/components/auth-provider";
import { useAuthGate } from "@/components/auth-gate";
import { FriendProfileModal } from "@/components/friend-profile-modal";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/types";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

const BADGE_POLL_MS: number = 60_000;

const DESKTOP_LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Feed" },
  { href: "/conversations", label: "Convos" },
  { href: "/notifications", label: "Alerts" },
  { href: "/friends", label: "People" },
];

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-[9999px] bg-emerald-600 px-1.5 text-[10px] font-bold text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1.5 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-[9999px] bg-emerald-600 px-1 text-[9px] font-bold text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function TabIcon({
  children,
  badge = 0,
}: {
  children: ReactNode;
  badge?: number;
}) {
  return (
    <span className="relative inline-flex h-5 w-5 items-center justify-center">
      {children}
      <TabBadge count={badge} />
    </span>
  );
}

function IconFeed({
  className,
  filled = false,
}: {
  className?: string;
  filled?: boolean;
}) {
  if (filled) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        aria-hidden
      >
        <path d="M11.47 3.84a.75.75 0 0 1 1.06 0l8.25 7.5a.75.75 0 1 1-1.01 1.11l-.77-.7V19.5A1.5 1.5 0 0 1 17.5 21h-3.75v-5.25a.75.75 0 0 0-.75-.75h-1.5a.75.75 0 0 0-.75.75V21H6.5A1.5 1.5 0 0 1 5 19.5v-7.75l-.77.7a.75.75 0 1 1-1.01-1.11l8.25-7.5Z" />
      </svg>
    );
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className={className}
      aria-hidden
    >
      <path
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconConvos({
  className,
  filled = false,
}: {
  className?: string;
  filled?: boolean;
}) {
  if (filled) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        aria-hidden
      >
        <path d="M6.5 4A2.5 2.5 0 0 0 4 6.5V20.2a.75.75 0 0 0 1.18.62L9.1 18.5H17.5A2.5 2.5 0 0 0 20 16V6.5A2.5 2.5 0 0 0 17.5 4h-11Z" />
      </svg>
    );
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className={className}
      aria-hidden
    >
      <path
        d="M7 18.5 4 21V7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v8.5A2.5 2.5 0 0 1 17.5 18.5H7Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconAlerts({
  className,
  filled = false,
}: {
  className?: string;
  filled?: boolean;
}) {
  if (filled) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        aria-hidden
      >
        <path d="M12 2.5a6.5 6.5 0 0 0-6.5 6.5c0 3.2-1.2 4.85-1.85 5.75A1 1 0 0 0 4.45 16.5h15.1a1 1 0 0 0 .8-1.75C19.7 13.85 18.5 12.2 18.5 9A6.5 6.5 0 0 0 12 2.5Z" />
        <path d="M9.75 18.25a2.25 2.25 0 0 0 4.5 0h-4.5Z" />
      </svg>
    );
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className={className}
      aria-hidden
    >
      <path
        d="M6 9a6 6 0 1 1 12 0c0 3.5 1.5 5 2 6H4c.5-1 2-2.5 2-6Z"
        strokeLinejoin="round"
      />
      <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" />
    </svg>
  );
}

function IconMe({
  className,
  filled = false,
}: {
  className?: string;
  filled?: boolean;
}) {
  if (filled) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        aria-hidden
      >
        <circle cx="12" cy="8.5" r="3.75" />
        <path d="M4.5 19.75c1.4-3.4 3.9-5 7.5-5s6.1 1.6 7.5 5a.75.75 0 0 1-.7 1.05H5.2a.75.75 0 0 1-.7-1.05Z" />
      </svg>
    );
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="8.5" r="3.5" />
      <path
        d="M5 19.5c1.2-3 3.5-4.5 7-4.5s5.8 1.5 7 4.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Nav() {
  const pathname: string = usePathname();
  const router = useRouter();
  const { session, user, signOut } = useAuth();
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileOpen, setProfileOpen] = useState<boolean>(false);
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [incomingCount, setIncomingCount] = useState<number>(0);
  const [convosUnread, setConvosUnread] = useState<number>(0);
  const [alertsUnread, setAlertsUnread] = useState<number>(0);

  const isGuest: boolean = !session;

  const refreshBadges = useCallback(async (): Promise<void> => {
    if (!user?.id) {
      setIncomingCount(0);
      setConvosUnread(0);
      setAlertsUnread(0);
      return;
    }
    const [reqs, convos, alerts] = await Promise.all([
      api.getConnectionRequests().catch(() => null),
      api.getConversations().catch(() => null),
      api.getNotifications().catch(() => null),
    ]);
    if (reqs) setIncomingCount(reqs.incoming.length);
    if (convos) setConvosUnread(convos.threads_with_unread);
    if (alerts) setAlertsUnread(alerts.unread_count);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setProfile(null);
      setIncomingCount(0);
      setConvosUnread(0);
      setAlertsUnread(0);
      return;
    }
    let active = true;
    api
      .getMe()
      .then((me) => {
        if (active) setProfile(me);
      })
      .catch(() => {
        if (active) setProfile(null);
      });
    void refreshBadges();
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      void refreshBadges();
    }, BADGE_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user?.id, refreshBadges]);

  // Refresh badges when navigating between tabs so counts feel current.
  useEffect(() => {
    if (!user?.id) return;
    void refreshBadges();
  }, [pathname, user?.id, refreshBadges]);

  const links: { href: string; label: string }[] = profile?.is_admin
    ? [...DESKTOP_LINKS, { href: "/admin", label: "Admin" }]
    : DESKTOP_LINKS;
  const displayName: string =
    [profile?.first, profile?.last].filter(Boolean).join(" ") ||
    user?.email ||
    "You";
  const avatarInitial: string = (displayName.charAt(0) || "?").toUpperCase();

  async function handleSignOut(): Promise<void> {
    await signOut();
    notify("Signed out", "info");
    router.push("/");
  }

  function openAddStory(): void {
    if (!requireAuth("add stories")) return;
    setAddOpen(true);
  }

  function openProfile(): void {
    if (!requireAuth("edit your profile")) return;
    setProfileOpen(true);
  }

  function linkClass(active: boolean): string {
    return `px-2.5 py-1 text-sm font-medium transition ${
      active
        ? "text-zinc-900 underline decoration-2 underline-offset-4 dark:text-zinc-50"
        : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
    }`;
  }

  function badgeFor(href: string): number {
    if (href === "/conversations") return convosUnread;
    if (href === "/notifications") return alertsUnread;
    if (href === "/friends") return incomingCount;
    return 0;
  }

  const tabActive = (href: string): boolean => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <BrandLink markClassName="h-6 w-6 text-brand-600" />

          <nav className="hidden items-center gap-1 sm:flex">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={linkClass(pathname === link.href)}
              >
                {link.label}
                <Badge count={badgeFor(link.href)} />
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-2 sm:flex">
            {isGuest ? (
              <Link
                href="/signin"
                className="bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Create free account
              </Link>
            ) : (
              <>
                <button
                  onClick={openAddStory}
                  className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                >
                  <span className="text-base leading-none">+</span>
                  Post
                </button>
                <Link
                  href="/search"
                  aria-label="Search"
                  title="Search"
                  className="flex h-9 w-9 items-center justify-center border border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-4 w-4"
                  >
                    <circle cx="9" cy="9" r="6" />
                    <path d="m14 14 4 4" strokeLinecap="round" />
                  </svg>
                </Link>
                <button
                  onClick={openProfile}
                  aria-label="Open your profile"
                  title={displayName}
                  className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-[9999px] border border-slate-300 bg-slate-100 text-sm font-semibold text-slate-700 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  {profile?.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.image_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    avatarInitial
                  )}
                </button>
              </>
            )}
          </div>

          {/* Mobile: compact top actions; primary tabs live in the bottom bar. */}
          <div className="flex items-center gap-1 sm:hidden">
            {isGuest ? (
              <Link
                href="/signin"
                className="bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                Sign up
              </Link>
            ) : (
              <>
                <Link
                  href="/friends"
                  aria-label="People"
                  title="People"
                  className="relative flex h-9 items-center px-2 text-sm font-medium text-slate-600 dark:text-slate-300"
                >
                  People
                  {incomingCount > 0 ? (
                    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-[9999px] bg-emerald-600 px-1 text-[9px] font-bold text-white">
                      {incomingCount > 99 ? "99+" : incomingCount}
                    </span>
                  ) : null}
                </Link>
                <Link
                  href="/search"
                  aria-label="Search"
                  className="flex h-9 w-9 items-center justify-center text-slate-600 dark:text-slate-300"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-4 w-4"
                  >
                    <circle cx="9" cy="9" r="6" />
                    <path d="m14 14 4 4" strokeLinecap="round" />
                  </svg>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 backdrop-blur sm:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto grid max-w-lg grid-cols-5 items-stretch">
          <Link
            href="/"
            className={`relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] ${
              tabActive("/")
                ? "font-semibold text-zinc-900 dark:text-zinc-50"
                : "font-medium text-zinc-500"
            }`}
          >
            <TabIcon>
              <IconFeed className="h-5 w-5" filled={tabActive("/")} />
            </TabIcon>
            Feed
          </Link>
          <Link
            href="/conversations"
            className={`relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] ${
              tabActive("/conversations")
                ? "font-semibold text-zinc-900 dark:text-zinc-50"
                : "font-medium text-zinc-500"
            }`}
          >
            <TabIcon badge={convosUnread}>
              <IconConvos
                className="h-5 w-5"
                filled={tabActive("/conversations")}
              />
            </TabIcon>
            Convos
          </Link>
          <button
            type="button"
            onClick={openAddStory}
            aria-label="New post"
            className="flex flex-col items-center justify-center py-1"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-[9999px] bg-slate-900 text-xl font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
              +
            </span>
          </button>
          <Link
            href="/notifications"
            className={`relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] ${
              tabActive("/notifications")
                ? "font-semibold text-zinc-900 dark:text-zinc-50"
                : "font-medium text-zinc-500"
            }`}
          >
            <TabIcon badge={alertsUnread}>
              <IconAlerts
                className="h-5 w-5"
                filled={tabActive("/notifications")}
              />
            </TabIcon>
            Alerts
          </Link>
          {isGuest ? (
            <Link
              href="/signin"
              className="flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-zinc-500"
            >
              <TabIcon>
                <IconMe className="h-5 w-5" />
              </TabIcon>
              Sign in
            </Link>
          ) : (
            <button
              type="button"
              onClick={openProfile}
              className="flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-zinc-500"
            >
              <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-[9999px] bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                {profile?.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.image_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  avatarInitial
                )}
              </span>
              Me
            </button>
          )}
        </div>
      </nav>

      {addOpen ? (
        <AddStoryModal
          onClose={() => setAddOpen(false)}
          onAdded={(post) => {
            window.dispatchEvent(
              new CustomEvent("nwf:post-created", { detail: post }),
            );
          }}
        />
      ) : null}

      {profileOpen && profile ? (
        <FriendProfileModal
          friendId={profile.id}
          onClose={() => setProfileOpen(false)}
          onSignOut={() => {
            setProfileOpen(false);
            void handleSignOut();
          }}
        />
      ) : null}
    </>
  );
}
