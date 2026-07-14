"use client";

import { AddStoryModal } from "@/components/add-story-modal";
import { useAuth } from "@/components/auth-provider";
import { useAuthGate } from "@/components/auth-gate";
import { FriendProfileModal } from "@/components/friend-profile-modal";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/types";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Feed" },
  { href: "/sources", label: "Sources" },
];

export function Nav() {
  const pathname: string = usePathname();
  const router = useRouter();
  const { session, user, signOut } = useAuth();
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [profileOpen, setProfileOpen] = useState<boolean>(false);
  const [addOpen, setAddOpen] = useState<boolean>(false);

  const isGuest: boolean = !session;

  useEffect(() => {
    if (!user?.id) {
      setProfile(null);
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
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const isAdmin: boolean = profile?.is_admin ?? false;
  const links = isGuest
    ? [{ href: "/", label: "Feed" }]
    : isAdmin
      ? [...LINKS, { href: "/admin", label: "Admin" }]
      : LINKS;
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

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link
          href="/"
          className="font-serif text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        >
          NewsWithFriends
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={linkClass(pathname === link.href)}
            >
              {link.label}
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
                Add
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

        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          className="flex h-9 w-9 items-center justify-center text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 sm:hidden"
        >
          <span className="text-xl">{menuOpen ? "✕" : "☰"}</span>
        </button>
      </div>

      {menuOpen ? (
        <nav className="flex flex-col border-t border-slate-200 px-2 py-2 dark:border-slate-800 sm:hidden">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={linkClass(pathname === link.href)}
            >
              {link.label}
            </Link>
          ))}
          {isGuest ? (
            <Link
              href="/signin"
              className="px-3 py-1.5 text-left text-sm font-semibold text-brand-600"
            >
              Create free account
            </Link>
          ) : (
            <>
              <Link
                href="/search"
                className="px-3 py-1.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Search
              </Link>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  openAddStory();
                }}
                className="px-3 py-1.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Add story
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  openProfile();
                }}
                className="px-3 py-1.5 text-left text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                My profile
              </button>
            </>
          )}
        </nav>
      ) : null}

      {addOpen ? (
        <AddStoryModal
          onClose={() => setAddOpen(false)}
          onAdded={() => router.refresh()}
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
    </header>
  );
}
