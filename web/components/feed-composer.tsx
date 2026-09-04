"use client";

import { AddStoryModal } from "@/components/add-story-modal";
import { useAuthGate } from "@/components/auth-gate";
import { Avatar } from "@/components/avatar";
import { useStandards } from "@/lib/use-standards";
import type { Profile, StandardsNudge } from "@/lib/types";
import { useState } from "react";

/**
 * The place a member starts a post, at the top of their own feed.
 *
 * This replaced a notice that said the same thing in prose. The notice sat
 * where a post goes, competed with the articles someone came to read, and
 * offered nothing to do but scroll past it — so it read as an obstacle and
 * got tuned out. A composer is a *control*: the ask and the means of
 * answering it are the same object, which is why it can sit here on every
 * visit without ever being a nag, and why it needs no dismiss button.
 *
 * The expectation itself survives as one quiet line underneath, and only for
 * the people it applies to. Someone who posts regularly sees a composer and
 * nothing else.
 */
export function FeedComposer({
  me,
  nudge,
  onPosted,
}: {
  me: Profile | null;
  nudge: StandardsNudge | null;
  onPosted?: () => void;
}) {
  const { requireAuth } = useAuthGate();
  const [open, setOpen] = useState<boolean>(false);
  const { kind, nudge: shown } = useStandards(nudge, me?.is_admin === true);

  // Only the two asks about posting belong here; a thin circle or an unpinned
  // home screen is not something this control can answer.
  const expectation: string | null =
    kind === "first_post"
      ? firstPostLine(shown?.friend_name ?? null)
      : kind === "share"
        ? shareLine(shown?.value ?? 0, shown?.friend_name ?? null)
        : null;

  const firstName: string = (me?.first ?? "").trim();
  const placeholder: string = firstName
    ? `Share what you're reading, ${firstName}.`
    : "Share what you're reading.";

  function openComposer(): void {
    if (!requireAuth("add stories")) return;
    setOpen(true);
  }

  return (
    <>
      <section
        aria-label="Share an article"
        className="border-b border-zinc-200 pb-3 dark:border-zinc-800"
      >
        <div className="flex items-center gap-3">
          <Avatar
            name={firstName || "You"}
            imageUrl={me?.image_url ?? null}
            size="lg"
          />
          <button
            type="button"
            onClick={openComposer}
            className="min-w-0 flex-1 border border-zinc-300 px-3 py-2.5 text-left text-sm text-zinc-500 transition hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
          >
            {placeholder}
          </button>
        </div>
        {expectation !== null ? (
          <p className="mt-2 pl-[3.25rem] text-xs text-zinc-500">
            {expectation}
          </p>
        ) : null}
      </section>

      {open ? (
        <AddStoryModal
          onClose={() => setOpen(false)}
          onAdded={() => {
            setOpen(false);
            onPosted?.();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The first ask, put as what a friend is missing rather than what the member
 * has failed to do. There is no day count to quote — they have never posted —
 * so it says so in words instead of inventing a number.
 *
 * The norm itself ("everyone shares what they're reading") is deliberately
 * absent: the placeholder above states it on every visit, for everyone, and
 * repeating it here only pushed this line onto a second wrapped row. What is
 * left is the part that is true of this person alone.
 */
function firstPostLine(friendName: string | null): string {
  return friendName
    ? `${friendName} hasn't seen an article from you yet.`
    : "You haven't shared an article yet.";
}

/** The cost of a quiet spell, as a person where there is one to name. */
function shareLine(days: number, friendName: string | null): string {
  const span: string = days <= 1 ? "a day" : `${days} days`;
  return friendName
    ? `${friendName} hasn't seen anything from you in ${span}.`
    : `You haven't shared anything in ${span}.`;
}
