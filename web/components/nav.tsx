"use client";

import { AddStoryModal } from "@/components/add-story-modal";
import { BrandLink } from "@/components/brand-mark";
import { SearchIcon } from "@/components/search-icon";
import { useAuth } from "@/components/auth-provider";
import { useAuthGate } from "@/components/auth-gate";
import { ShareAfterPostModal } from "@/components/share-after-post-modal";
import { api } from "@/lib/api";
import type { Profile, UUID } from "@/lib/types";
import { useAwayRefresh } from "@/lib/use-away-refresh";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

const BADGE_POLL_MS: number = 60_000;

const DESKTOP_LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Discover" },
  { href: "/conversations", label: "Conversations" },
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

function IconDiscover({
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
        {/* The needle is knocked out of the disc (hence evenodd) as a rhombus
            whose four points average to exactly (12,12), so it sits centred
            however the icon is scaled. The earlier path was hand-drawn and
            averaged to (12.7, 10.7), which read as a needle pushed up and to
            the right. */}
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 2.25a9.75 9.75 0 1 0 0 19.5 9.75 9.75 0 0 0 0-19.5ZM16 8l-2.3 5.7L8 16l2.3-5.7L16 8Z"
        />
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
      <circle cx="12" cy="12" r="9" />
      <path
        d="M15.8 8.2 13.6 13.6 8.2 15.8l2.2-5.4 5.4-2.2Z"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconConversations({
  className,
  filled = false,
}: {
  className?: string;
  filled?: boolean;
}) {
  // Two overlapping speech bubbles: the back one offset up-right, the front
  // one carrying the tail. Both states use the same geometry so the icon does
  // not shift when the tab becomes active.
  const back: string =
    "M9 3.5h9A2.5 2.5 0 0 1 20.5 6v3A2.5 2.5 0 0 1 18 11.5H9A2.5 2.5 0 0 1 6.5 9V6A2.5 2.5 0 0 1 9 3.5Z";
  // Stroked, a closed back bubble draws its edges straight through the front
  // one and the pair reads as a grid. Open it where the front bubble covers
  // it, and it reads as one bubble sitting behind another.
  const backOpen: string =
    "M8.2 9V6A2.5 2.5 0 0 1 10.7 3.5H18A2.5 2.5 0 0 1 20.5 6v3A2.5 2.5 0 0 1 18 11.5h-.6";
  const front: string =
    "M6 9h9a2.5 2.5 0 0 1 2.5 2.5V15a2.5 2.5 0 0 1-2.5 2.5H9.6l-3 2.9v-2.9H6A2.5 2.5 0 0 1 3.5 15v-3.5A2.5 2.5 0 0 1 6 9Z";

  if (filled) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        aria-hidden
      >
        {/* evenodd leaves the overlap unfilled, which is what separates the
            two bubbles without needing a background-coloured stroke — the tab
            bar sits on both light and dark grounds. */}
        <path fillRule="evenodd" clipRule="evenodd" d={`${back} ${front}`} />
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
      <path d={backOpen} strokeLinejoin="round" strokeLinecap="round" />
      <path d={front} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function IconFriends({
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
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 18.5c1.1-2.9 3.3-4.35 6.5-4.35s5.4 1.45 6.5 4.35a.75.75 0 0 1-.7 1.02H3.2a.75.75 0 0 1-.7-1.02Z" />
        <circle cx="17" cy="9" r="2.75" />
        <path d="M17 13.4c2.2 0 3.75 1.05 4.65 3.15a.75.75 0 0 1-.69 1.04h-3.4c-.16-1.6-.75-2.99-1.75-4.16.39-.02.79-.03 1.19-.03Z" />
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
      <circle cx="9" cy="8" r="3.25" />
      <path
        d="M3.5 18.5c1-2.5 2.9-3.75 5.5-3.75s4.5 1.25 5.5 3.75"
        strokeLinecap="round"
      />
      <circle cx="17.25" cy="9.25" r="2.25" />
      <path d="M17 14.75c2 0 3.4.9 4.25 2.75" strokeLinecap="round" />
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
  const { session, user } = useAuth();
  const { requireAuth } = useAuthGate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [sharePostId, setSharePostId] = useState<UUID | null>(null);
  const [incomingCount, setIncomingCount] = useState<number>(0);
  const [convosUnread, setConvosUnread] = useState<number>(0);
  const [threadAlerts, setThreadAlerts] = useState<number>(0);

  const isGuest: boolean = !session;

  const refreshBadges = useCallback(async (): Promise<void> => {
    if (!user?.id) {
      setIncomingCount(0);
      setConvosUnread(0);
      setThreadAlerts(0);
      return;
    }
    const [reqs, convos, alerts] = await Promise.all([
      api.getConnectionRequests().catch(() => null),
      api.getConversations().catch(() => null),
      api.getNotifications().catch(() => null),
    ]);
    if (reqs) setIncomingCount(reqs.incoming.length);
    if (convos) setConvosUnread(convos.threads_with_unread);
    // Mentions and reactions are counted on Conversations, where they are now
    // shown, so they must not also be counted here.
    if (alerts) setThreadAlerts(alerts.unread_thread_count);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      setProfile(null);
      setIncomingCount(0);
      setConvosUnread(0);
      setThreadAlerts(0);
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

  // Background tabs throttle the poll above, so the badges the user sees on
  // returning can be minutes old.
  useAwayRefresh(() => {
    void refreshBadges();
  });

  // Replying in the feed stamps the read cursor and answering a friend
  // request settles one, both without a route change, so the badge needs
  // telling directly instead of waiting for the next poll or pathname
  // change.
  useEffect(() => {
    function onStale(): void {
      void refreshBadges();
    }
    window.addEventListener("nwf:thread-seen", onStale);
    window.addEventListener("nwf:connections-changed", onStale);
    return () => {
      window.removeEventListener("nwf:thread-seen", onStale);
      window.removeEventListener("nwf:connections-changed", onStale);
    };
  }, [refreshBadges]);

  const links: { href: string; label: string }[] = profile?.is_admin
    ? [...DESKTOP_LINKS, { href: "/admin", label: "Admin" }]
    : DESKTOP_LINKS;
  const displayName: string =
    [profile?.first, profile?.last].filter(Boolean).join(" ") ||
    user?.email ||
    "You";
  const avatarInitial: string = (displayName.charAt(0) || "?").toUpperCase();

  function openAddStory(): void {
    if (!requireAuth("add stories")) return;
    setAddOpen(true);
  }

  function linkClass(active: boolean): string {
    return `px-2.5 py-1 text-sm font-medium transition ${
      active
        ? "text-zinc-900 underline decoration-2 underline-offset-4 dark:text-zinc-50"
        : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
    }`;
  }

  function badgeFor(href: string): number {
    // One number, one meaning: everything that happened in a thread counts on
    // Conversations, and friend requests count on People.
    if (href === "/conversations") return convosUnread + threadAlerts;
    if (href === "/friends") return incomingCount;
    return 0;
  }

  const tabActive = (href: string): boolean => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <>
      <header className="sticky top-0 z-40 hidden border-b border-zinc-200 bg-white/95 backdrop-blur sm:block dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <BrandLink
            className="text-zinc-900 dark:text-zinc-50"
            markClassName="h-6 w-6"
            showWordmark={false}
          />

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
                className="bg-zinc-900 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
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
                  <SearchIcon className="h-5 w-5" />
                </Link>
                <Link
                  href="/profile"
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
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar */}
      <nav
        className="edge-safe-x fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 backdrop-blur sm:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
        style={{
          paddingBottom:
            "calc(env(safe-area-inset-bottom) + var(--tabbar-inset))",
        }}
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
              <IconDiscover className="h-5 w-5" filled={tabActive("/")} />
            </TabIcon>
            Discover
          </Link>
          <Link
            href="/conversations"
            className={`relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] ${
              tabActive("/conversations")
                ? "font-semibold text-zinc-900 dark:text-zinc-50"
                : "font-medium text-zinc-500"
            }`}
          >
            <TabIcon badge={convosUnread + threadAlerts}>
              <IconConversations
                className="h-5 w-5"
                filled={tabActive("/conversations")}
              />
            </TabIcon>
            Conversations
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
            href="/friends"
            className={`relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] ${
              tabActive("/friends")
                ? "font-semibold text-zinc-900 dark:text-zinc-50"
                : "font-medium text-zinc-500"
            }`}
          >
            <TabIcon badge={incomingCount}>
              <IconFriends className="h-5 w-5" filled={tabActive("/friends")} />
            </TabIcon>
            People
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
            <Link
              href="/profile"
              className={`flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] ${
                tabActive("/profile")
                  ? "font-semibold text-zinc-900 dark:text-zinc-50"
                  : "font-medium text-zinc-500"
              }`}
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
            </Link>
          )}
        </div>
      </nav>

      {addOpen ? (
        <AddStoryModal
          allowEmptyComment={profile?.is_editorial ?? false}
          onClose={() => setAddOpen(false)}
          onAdded={(post) => {
            window.dispatchEvent(
              new CustomEvent("nwf:post-created", { detail: post }),
            );
            setSharePostId(post.id);
          }}
        />
      ) : null}

      {sharePostId !== null ? (
        <ShareAfterPostModal
          postId={sharePostId}
          kind="post"
          onClose={() => setSharePostId(null)}
        />
      ) : null}
    </>
  );
}
