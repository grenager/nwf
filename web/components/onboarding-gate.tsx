"use client";

import { useAuth } from "@/components/auth-provider";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { Profile } from "@/lib/types";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

const MIN_NAME_LENGTH = 2;

function isComplete(profile: Profile | null): boolean {
  if (!profile) return false;
  return (
    (profile.first?.trim().length ?? 0) >= MIN_NAME_LENGTH &&
    (profile.last?.trim().length ?? 0) >= MIN_NAME_LENGTH
  );
}

/**
 * Blocks the rest of the app behind a full-screen name form until the
 * signed-in account has a first and last name — sign-in never collects a
 * name itself (email magic links have none to give; invite links create the
 * account before anyone has typed anything), so this is the one place every
 * account is guaranteed to pass through before it can appear to other
 * people as a friend.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { session, loading: authLoading, signOut } = useAuth();
  const { notify } = useToast();
  const [me, setMe] = useState<Profile | null>(null);
  const [gated, setGated] = useState<boolean>(false);
  const [first, setFirst] = useState<string>("");
  const [last, setLast] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (authLoading || !session) return;
    let active = true;
    api
      .getMe()
      .then((profile) => {
        if (!active) return;
        setMe(profile);
        setFirst(profile.first ?? "");
        setLast(profile.last ?? "");
        setGated(!isComplete(profile));
      })
      .catch(() => undefined); // fail open — never hard-lock on a transient fetch error
    return () => {
      active = false;
    };
  }, [authLoading, session]);

  if (!gated) return <>{children}</>;

  const trimmedFirst: string = first.trim();
  const trimmedLast: string = last.trim();
  const valid: boolean =
    trimmedFirst.length >= MIN_NAME_LENGTH && trimmedLast.length >= MIN_NAME_LENGTH;

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!me || !valid || saving) return;
    setSaving(true);
    try {
      const updated = await api.updateProfile(me.id, {
        first: trimmedFirst,
        last: trimmedLast,
        image_url: me.image_url,
        phone: me.phone,
      });
      setMe(updated);
      setGated(!isComplete(updated));
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to save your name",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white px-6 dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          What should friends call you?
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Add your name so the people you connect with know it&apos;s really
          you.
        </p>
        <form onSubmit={(e) => void save(e)} className="mt-6 space-y-3">
          <input
            type="text"
            required
            autoFocus
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            placeholder="First name"
            autoComplete="given-name"
            className="w-full border border-zinc-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <input
            type="text"
            required
            value={last}
            onChange={(e) => setLast(e.target.value)}
            placeholder="Last name"
            autoComplete="family-name"
            className="w-full border border-zinc-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <button
            type="submit"
            disabled={!valid || saving}
            className="w-full bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {saving ? "Saving…" : "Continue"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-4 text-xs font-medium text-zinc-400 underline hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
