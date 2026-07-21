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
          className="mt-4 inline-block bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <FriendProfileModal
      friendId={me.id}
      variant="page"
      onSignOut={() => {
        void handleSignOut();
      }}
    />
  );
}
