"use client";

import { Avatar } from "@/components/avatar";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { canUseWebShare, shareOrCopyLink } from "@/lib/share";
import type { InvitationCreateResult, PostAudience, UUID } from "@/lib/types";
import { useEffect, useState } from "react";
import { ModalShell } from "@/components/modal-shell";

/** Which thing the viewer just published, for the confirmation copy. */
export type PublishedKind = "post" | "comment";

interface ShareAfterPostModalProps {
  postId: UUID;
  kind: PublishedKind;
  onClose: () => void;
}

const AVATAR_LIMIT: number = 8;

/**
 * Only nudge when the average is enough above the viewer's own circle to read
 * as aspirational rather than as a rounding difference.
 */
const FRIEND_GAP_THRESHOLD: number = 3;

function friendNudge(audience: PostAudience): string | null {
  const average: number = Math.round(audience.average_friend_count);
  if (average < audience.your_friend_count + FRIEND_GAP_THRESHOLD) return null;
  return `The average active NewsWithFriends user has ${average} friends — you have ${audience.your_friend_count}.`;
}

/**
 * "friends" only when everyone listed is a direct friend (or the thread's
 * author); otherwise the reach includes friends-of-friends, so say "people".
 */
function audienceNoun(audience: PostAudience): string {
  const count: number = audience.people.length;
  const allFriends: boolean = audience.people.every(
    (p) => p.relation === "your_friend" || p.relation === "author",
  );
  if (allFriends) return count === 1 ? "friend" : "friends";
  return count === 1 ? "person" : "people";
}

function headlineFor(audience: PostAudience | null, kind: PublishedKind): string {
  const noun: string = kind === "post" ? "post" : "comment";
  if (audience === null) return `Your ${noun} is live`;
  const count: number = audience.people.length;
  if (count === 0) {
    return `Only you can see your ${noun} so far`;
  }
  return `${count} ${audienceNoun(audience)} will see your ${noun}`;
}

export function ShareAfterPostModal({
  postId,
  kind,
  onClose,
}: ShareAfterPostModalProps) {
  const { notify } = useToast();
  const [audience, setAudience] = useState<PostAudience | null>(null);
  const [sharing, setSharing] = useState<boolean>(false);
  const [result, setResult] = useState<InvitationCreateResult | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

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
    let active = true;
    void api
      .getPostAudience(postId)
      .then((data) => {
        if (active) setAudience(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [postId]);

  async function shareLink(): Promise<void> {
    if (sharing) return;
    setSharing(true);
    setCopied(false);
    try {
      const created = await api.createInvitation({
        post_id: postId,
        become_friend: true,
      });
      setResult(created);
      const url: string = created.invite_url ?? "";
      if (!url) {
        notify(created.message, "success");
        return;
      }
      const outcome = await shareOrCopyLink({
        title: "NewsWithFriends",
        text: created.share_message,
        url,
      });
      if (outcome === "copied") {
        setCopied(true);
        notify("Invite link copied", "success");
      }
      if (outcome === "failed") notify("Could not copy the invite link", "error");
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to create invite link",
        "error",
      );
    } finally {
      setSharing(false);
    }
  }

  async function copyAgain(): Promise<void> {
    if (!result?.invite_url) return;
    try {
      await navigator.clipboard.writeText(
        result.share_message || result.invite_url,
      );
      setCopied(true);
      notify("Copied", "success");
    } catch {
      notify("Could not copy", "error");
    }
  }

  const nudge: string | null =
    audience !== null ? friendNudge(audience) : null;
  const shownPeople =
    audience !== null ? audience.people.slice(0, AVATAR_LIMIT) : [];
  const overflow: number =
    audience !== null ? audience.people.length - shownPeople.length : 0;

  return (
    <ModalShell onClose={onClose} label="Shared" padded={false}>
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 p-5 pb-4 dark:border-zinc-800">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-900 dark:text-zinc-100">
            Conversations on NWF are private.
          </p>
          <h2 className="mt-1 font-serif text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            {headlineFor(audience, kind)}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-700"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {shownPeople.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {shownPeople.map((person) => (
              <span
                key={person.user_id}
                className="flex items-center gap-1.5 rounded-full border border-zinc-200 py-0.5 pl-0.5 pr-2.5 dark:border-zinc-800"
                title={person.display_name}
              >
                <Avatar
                  name={person.display_name}
                  imageUrl={person.image_url}
                />
                <span className="max-w-[9rem] truncate text-xs text-zinc-600 dark:text-zinc-300">
                  {person.display_name}
                </span>
              </span>
            ))}
            {overflow > 0 ? (
              <span className="text-xs text-zinc-500">+{overflow} more</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-zinc-200 p-5 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5 dark:border-zinc-800">
        <p className="font-serif text-base font-semibold text-zinc-900 dark:text-zinc-50">
          Anyone else you&apos;d like to share this with?
        </p>
        {nudge !== null ? (
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
            {nudge}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void shareLink()}
          disabled={sharing}
          className="mt-3 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {sharing
            ? "Preparing…"
            : canUseWebShare()
              ? "Share invite link"
              : "Copy invite link"}
        </button>

        {result?.invite_url ? (
          <div className="mt-3">
            <p className="break-all text-xs text-zinc-500">
              {result.invite_url}
            </p>
            <button
              type="button"
              onClick={() => void copyAgain()}
              className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-400"
            >
              {copied ? "Copied!" : "Copy again"}
            </button>
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            Done
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
