"use client";

import { AddStoryModal } from "@/components/add-story-modal";
import { useAuthGate } from "@/components/auth-gate";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { shareInviteLink } from "@/lib/invite-share";
import { dismissStandard, isStandardDismissed } from "@/lib/standards";
import type { InvitationCreateResult, StandardsNudge } from "@/lib/types";
import { useEffect, useState } from "react";

/**
 * A standing expectation, stated once above the feed.
 *
 * The app has never said what it wants from people, which leaves everyone
 * guessing whether a week of silence is normal. This says it plainly and then
 * gets out of the way: one ask, and absent entirely for anyone already doing
 * it.
 *
 * Two things it deliberately never does. It quotes no statistic about other
 * members — with a circle this size any average would be invented, and a norm
 * pitched above what someone is managing tends to read as disqualification
 * rather than encouragement. And it names a friend rather than a population,
 * because "Sarah hasn't seen anything from you in nine days" is a cost a
 * person can feel, and it holds up when someone has only one friend, which is
 * exactly when an average would say nothing at all.
 *
 * The one ask that cannot be dismissed is the first post. Everything else is
 * a nudge about a habit; that one is about whether the habit ever starts, and
 * someone who reads for a month without sharing has learned the app is a
 * place you only consume — which is very hard to unlearn later.
 */
export function StandardsRibbon({
  nudge,
  onPosted,
}: {
  nudge: StandardsNudge | null;
  onPosted?: () => void;
}) {
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  // Dismissals live in localStorage, so they can only be applied on the
  // client — resolving in an effect keeps the first client render identical
  // to the server's.
  const [hidden, setHidden] = useState<boolean>(true);
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [inviting, setInviting] = useState<boolean>(false);
  const [acted, setActed] = useState<boolean>(false);

  useEffect(() => {
    setHidden(nudge === null || isStandardDismissed(nudge.kind));
  }, [nudge]);

  if (nudge === null || hidden || acted) return null;

  function dismiss(): void {
    if (nudge === null) return;
    dismissStandard(nudge.kind);
    setHidden(true);
  }

  async function invite(): Promise<void> {
    if (!requireAuth("invite friends")) return;
    if (inviting) return;
    setInviting(true);
    try {
      const created: InvitationCreateResult = await api.createInvitation({
        become_friend: true,
      });
      if (!created.invite_url) {
        notify(created.message, "success");
        return;
      }
      const result = await shareInviteLink(created);
      if (result === "copied") notify("Invite link copied", "success");
      if (result === "failed") notify("Could not copy the invite link", "error");
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Could not create an invite",
        "error",
      );
    } finally {
      setInviting(false);
    }
  }

  function openAddStory(): void {
    if (!requireAuth("add stories")) return;
    setAddOpen(true);
  }

  const isInvite: boolean = nudge.kind === "invite";
  const isFirstPost: boolean = nudge.kind === "first_post";
  const standard: string = isInvite
    ? "NewsWithFriends works best with a few friends."
    : isFirstPost
      ? "On NewsWithFriends, everyone shares what they're reading."
      : "NewsWithFriends works best when everyone shares something most days.";
  const consequence: string = isInvite
    ? friendConsequence(nudge.value)
    : isFirstPost
      ? firstPostConsequence(nudge.friend_name)
      : shareConsequence(nudge.value, nudge.friend_name);
  const action: string = isInvite
    ? inviting
      ? "Creating invite…"
      : "Invite a friend"
    : isFirstPost
      ? "Post your first article"
      : "Share an article";

  return (
    <>
      <section
        aria-label="Getting the most from NewsWithFriends"
        className={
          isFirstPost
            ? "mb-4 flex items-start gap-3 border border-zinc-900 bg-white px-4 py-3 dark:border-zinc-100 dark:bg-zinc-950"
            : "mb-4 flex items-start gap-3 border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
        }
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm text-zinc-800 dark:text-zinc-100">{standard}</p>
          <p className="mt-0.5 text-sm text-zinc-500">{consequence}</p>
          <button
            type="button"
            onClick={isInvite ? () => void invite() : openAddStory}
            disabled={inviting}
            className="mt-2.5 bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {action}
          </button>
        </div>
        {/* No dismiss on the first-post ask. It comes back every visit until
            they post, because that is the whole point of it. */}
        {isFirstPost ? null : (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 px-1 text-xs leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            ✕
          </button>
        )}
      </section>

      {addOpen ? (
        <AddStoryModal
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            // They just did the thing being asked for; the ribbon has no
            // business still being there while the feed catches up.
            setActed(true);
            setAddOpen(false);
            onPosted?.();
          }}
        />
      ) : null}
    </>
  );
}

/** Why a thin circle matters, in terms of what they'll actually experience. */
function friendConsequence(friends: number): string {
  if (friends <= 0) return "With nobody added yet, there's nothing to read.";
  if (friends === 1) {
    return "With one friend, your feed only moves when they post.";
  }
  return `With ${friends} friends, your feed only moves when they post.`;
}

/**
 * The first ask, stated as what a friend is missing rather than what the
 * member has failed to do. There is no day count to quote here — they have
 * never posted — so the copy says it in words instead of inventing a number.
 */
function firstPostConsequence(friendName: string | null): string {
  return friendName
    ? `${friendName} hasn't seen an article from you yet. It takes a link and a sentence.`
    : "You haven't shared an article yet. It takes a link and a sentence.";
}

/** The cost of silence, as a person where possible. */
function shareConsequence(days: number, friendName: string | null): string {
  const span: string = days <= 1 ? "a day" : `${days} days`;
  return friendName
    ? `${friendName} hasn't seen anything from you in ${span}.`
    : `You haven't shared anything in ${span}.`;
}
