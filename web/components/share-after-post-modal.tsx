"use client";

import { Avatar } from "@/components/avatar";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import {
  invalidEmailEntries,
  parseEmailRecipients,
  type EmailRecipient,
} from "@/lib/email-recipients";
import type { PostAudience, UUID } from "@/lib/types";
import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

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
  if (audience.visibility === "public") {
    return `Your ${noun} is public — anyone on NewsWithFriends can see it`;
  }
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
  const [entry, setEntry] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [sentCount, setSentCount] = useState<number>(0);

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

  const recipients: EmailRecipient[] = parseEmailRecipients(entry);
  const invalid: string[] = invalidEmailEntries(entry);
  const canSend: boolean = recipients.length > 0 && !sending;

  async function send(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSend) return;
    setSending(true);
    let succeeded: number = 0;
    const failures: string[] = [];
    for (const recipient of recipients) {
      try {
        await api.createInvitation({
          email: recipient.email,
          invitee_name: recipient.name,
          post_id: postId,
          become_friend: true,
        });
        succeeded += 1;
      } catch (err) {
        failures.push(
          `${recipient.email}: ${
            err instanceof ApiError ? err.message : "failed"
          }`,
        );
      }
    }
    setSending(false);
    setSentCount((prev) => prev + succeeded);
    setEntry("");
    if (succeeded > 0) {
      notify(
        `Invited ${succeeded} ${succeeded === 1 ? "person" : "people"}`,
        "success",
      );
    }
    if (failures.length > 0) {
      notify(failures.join("; "), "error");
    }
  }

  const nudge: string | null =
    audience !== null ? friendNudge(audience) : null;
  const shownPeople =
    audience !== null ? audience.people.slice(0, AVATAR_LIMIT) : [];
  const overflow: number =
    audience !== null ? audience.people.length - shownPeople.length : 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-16 sm:pt-20"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Shared"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-600 dark:text-brand-400">
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

        {shownPeople.length > 0 ? (
          <div className="mb-5 flex flex-wrap items-center gap-2">
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

        <form onSubmit={(e) => void send(e)} className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <label className="block">
            <span className="font-serif text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Anyone else you&apos;d like to share this with?
            </span>
            {nudge !== null ? (
              <span className="mt-1 block text-xs text-zinc-600 dark:text-zinc-300">
                {nudge}
              </span>
            ) : null}
            <span className="mt-1 block text-xs text-zinc-500">
              Paste emails separated by commas or spaces. Names are welcome too,
              like Teg Grenager &lt;teg@example.com&gt;.
            </span>
            <input
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder="friend@example.com, Ada Lovelace <ada@example.com>"
              autoFocus
              className="mt-2 w-full rounded-full border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>

          {recipients.length > 0 ? (
            <p className="mt-2 text-xs text-zinc-500">
              Inviting:{" "}
              {recipients
                .map((r) => (r.name !== null ? `${r.name} (${r.email})` : r.email))
                .join(", ")}
            </p>
          ) : null}
          {invalid.length > 0 ? (
            <p className="mt-2 text-xs text-red-600">
              Not a valid email: {invalid.join(", ")}
            </p>
          ) : null}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="submit"
              disabled={!canSend}
              className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
            >
              {sending ? "Sending…" : "Send invites"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              {sentCount > 0 ? "Done" : "No thanks"}
            </button>
          </div>
        </form>

        {sentCount > 0 ? (
          <p className="mt-3 text-xs text-zinc-500">
            {sentCount} {sentCount === 1 ? "invite" : "invites"} sent. They join
            this conversation as your friend.
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
