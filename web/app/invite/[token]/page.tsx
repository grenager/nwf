"use client";

import { useAuth } from "@/components/auth-provider";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { InvitePreview } from "@/lib/types";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export default function InviteLandingPage() {
  const params = useParams<{ token: string }>();
  const token: string = typeof params.token === "string" ? params.token : "";
  const { session, user } = useAuth();
  const { notify } = useToast();
  const router = useRouter();
  const autoAcceptStarted = useRef<boolean>(false);

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<boolean>(false);
  const [otpSent, setOtpSent] = useState<boolean>(false);
  const [first, setFirst] = useState<string>("");
  const [last, setLast] = useState<string>("");
  const [busyOtp, setBusyOtp] = useState<boolean>(false);

  const load = useCallback(async (): Promise<void> => {
    if (!token) {
      setError("Invalid invitation link");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setPreview(await api.getInvitePreview(token));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Invitation not found",
      );
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = useCallback(async (): Promise<void> => {
    if (!token || accepting) return;
    setAccepting(true);
    try {
      // Ensure profile exists + redeem any matching email invites.
      await api.getMe().catch(() => undefined);
      const result = await api.acceptInvite(token);
      notify(result.message, "success");
      router.replace("/");
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Could not accept invite",
        "error",
      );
      autoAcceptStarted.current = false;
    } finally {
      setAccepting(false);
    }
  }, [accepting, notify, router, token]);

  useEffect(() => {
    if (!session || !preview || preview.status !== "pending") return;
    if (autoAcceptStarted.current) return;
    autoAcceptStarted.current = true;
    void accept();
  }, [session, preview, accept]);

  async function sendMagicLink(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!preview || busyOtp) return;
    const trimmedFirst: string = first.trim();
    const trimmedLast: string = last.trim();
    if (!trimmedFirst || !trimmedLast) return;
    setBusyOtp(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const redirectTo: string =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback?next=/invite/${token}`
          : "";
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: preview.invitee_email,
        options: {
          emailRedirectTo: redirectTo,
          data: { first: trimmedFirst, last: trimmedLast },
        },
      });
      if (otpError) throw otpError;
      setOtpSent(true);
      notify("Magic link sent — check your email", "success");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to send link", "error");
    } finally {
      setBusyOtp(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
        <p className="text-sm text-zinc-500">Loading invitation…</p>
      </main>
    );
  }

  if (error || !preview) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
        <h1 className="font-serif text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Invitation unavailable
        </h1>
        <p className="mt-2 text-sm text-zinc-500">{error ?? "Not found"}</p>
        <Link
          href="/signin"
          className="mt-6 text-sm font-semibold text-zinc-900 underline dark:text-zinc-100"
        >
          Sign in
        </Link>
      </main>
    );
  }

  const alreadyHandled: boolean =
    preview.status === "accepted" ||
    preview.status === "revoked" ||
    preview.status === "expired";

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <Link
        href="/"
        className="mb-8 text-center font-serif text-2xl font-semibold text-zinc-900 dark:text-zinc-50"
      >
        NewsWithFriends
      </Link>

      <div className="border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          Private invitation
        </p>
        <h1 className="mt-2 font-serif text-2xl font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
          {preview.inviter_name} invited you to join a conversation
        </h1>

        {preview.headline ? (
          <div className="mt-5 overflow-hidden border border-zinc-200 dark:border-zinc-800">
            {preview.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.image_url}
                alt=""
                className="h-40 w-full object-cover"
              />
            ) : null}
            <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
              {preview.publisher ? (
                <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-400">
                  {preview.publisher}
                </p>
              ) : null}
              <p className="mt-0.5 font-serif text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {preview.headline}
              </p>
            </div>
          </div>
        ) : null}

        {preview.take ? (
          <p className="mt-4 border-l-2 border-zinc-900 pl-3 text-sm text-zinc-700 dark:border-zinc-100 dark:text-zinc-300">
            <strong>{preview.inviter_name}</strong>: “{preview.take}”
          </p>
        ) : null}

        {preview.message ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-300">
            {preview.message}
          </p>
        ) : null}

        {alreadyHandled ? (
          <p className="mt-6 text-sm text-zinc-500">
            This invitation is {preview.status}.{" "}
            <Link href="/" className="underline">
              Go to the feed
            </Link>
          </p>
        ) : session ? (
          <button
            type="button"
            onClick={() => void accept()}
            disabled={accepting}
            className="mt-6 w-full bg-zinc-900 py-2.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {accepting ? "Joining…" : "Join the conversation"}
          </button>
        ) : otpSent ? (
          <div className="mt-6 border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
            Check <strong>{preview.invitee_email}</strong> for your magic link.
            Clicking it signs you in and takes you into this conversation.
          </div>
        ) : (
          <form onSubmit={sendMagicLink} className="mt-6 space-y-3">
            <p className="text-sm text-zinc-500">
              We&apos;ll send a magic link to{" "}
              <strong className="text-zinc-800 dark:text-zinc-100">
                {preview.invitee_email}
              </strong>{" "}
              so you can join {preview.inviter_name}.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                required
                value={first}
                onChange={(e) => setFirst(e.target.value)}
                placeholder="First name"
                autoComplete="given-name"
                className="w-full border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700"
              />
              <input
                type="text"
                required
                value={last}
                onChange={(e) => setLast(e.target.value)}
                placeholder="Last name"
                autoComplete="family-name"
                className="w-full border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700"
              />
            </div>
            <button
              type="submit"
              disabled={busyOtp}
              className="w-full bg-zinc-900 py-2.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {busyOtp ? "Sending…" : "Send magic link"}
            </button>
            <p className="text-center text-xs text-zinc-400">
              Signed in as someone else?{" "}
              <Link
                href={`/signin?next=${encodeURIComponent(`/invite/${token}`)}&email=${encodeURIComponent(preview.invitee_email)}`}
                className="underline"
              >
                Use a different account
              </Link>
            </p>
          </form>
        )}
      </div>

      {user ? null : (
        <p className="mt-4 text-center text-xs text-zinc-400">
          Already on NewsWithFriends?{" "}
          <Link
            href={`/signin?next=${encodeURIComponent(`/invite/${token}`)}&email=${encodeURIComponent(preview.invitee_email)}`}
            className="underline"
          >
            Sign in
          </Link>
        </p>
      )}
    </main>
  );
}
