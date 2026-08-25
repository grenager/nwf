"use client";

import { useAuth } from "@/components/auth-provider";
import { FriendProfileModal } from "@/components/friend-profile-modal";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function ProfilePage() {
  const { session, loading: authLoading, signOut } = useAuth();
  const { notify } = useToast();
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(null);
  const [loadingMe, setLoadingMe] = useState<boolean>(true);
  const [incomingCount, setIncomingCount] = useState<number>(0);

  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      setMe(null);
      setLoadingMe(false);
      return;
    }
    let active = true;
    setLoadingMe(true);
    api
      .getMe()
      .then((profile: Profile) => {
        if (active) setMe(profile);
      })
      .catch(() => {
        if (active) setMe(null);
      })
      .finally(() => {
        if (active) setLoadingMe(false);
      });
    // The People row here is the only mobile signal for pending requests.
    api
      .getConnectionRequests()
      .then((reqs) => {
        if (active) setIncomingCount(reqs.incoming.length);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [authLoading, session]);

  async function handleSignOut(): Promise<void> {
    await signOut();
    notify("Signed out", "info");
    router.push("/");
  }

  if (authLoading || loadingMe) {
    return (
      <div className="py-16 text-center text-slate-400">Loading…</div>
    );
  }

  if (!session || !me) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-slate-600 dark:text-slate-300">
          Sign in to view your profile.
        </p>
        <Link
          href="/signin"
          className="mt-4 inline-block bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      {/* Mobile reaches People through here — the tab bar has no room for it,
          and the desktop header still links to it directly. */}
      <Link
        href="/friends"
        className="flex items-center justify-between gap-3 border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 sm:hidden dark:border-zinc-800 dark:text-zinc-50 dark:hover:bg-zinc-900/50"
      >
        <span className="flex items-center gap-2">
          People
          {incomingCount > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[9999px] bg-emerald-600 px-1.5 text-[10px] font-bold text-white">
              {incomingCount > 99 ? "99+" : incomingCount}
            </span>
          ) : null}
        </span>
        <span aria-hidden className="text-zinc-400">
          ›
        </span>
      </Link>
      <FriendProfileModal
        friendId={me.id}
        variant="page"
        onSignOut={() => {
          void handleSignOut();
        }}
      />
    </div>
  );
}
