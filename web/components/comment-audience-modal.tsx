"use client";

import { Avatar } from "@/components/avatar";
import { UserLink } from "@/components/user-link";
import { api, ApiError } from "@/lib/api";
import type { AudienceMember, PostAudience, UUID } from "@/lib/types";
import { useEffect, useState } from "react";
import { ModalShell } from "@/components/modal-shell";

interface CommentAudienceModalProps {
  postId: UUID;
  onClose: () => void;
}

const GROUP_LABELS: Record<AudienceMember["relation"], string> = {
  author: "Started this conversation",
  your_friend: "Your friends",
  author_friend: "Their friends",
  participant: "In this conversation",
  friend_of_participant: "Friends of others in this conversation",
};

const GROUP_ORDER: readonly AudienceMember["relation"][] = [
  "author",
  "your_friend",
  "author_friend",
  "participant",
  "friend_of_participant",
];

function groupPeople(
  people: AudienceMember[],
): Map<AudienceMember["relation"], AudienceMember[]> {
  const groups = new Map<AudienceMember["relation"], AudienceMember[]>();
  for (const relation of GROUP_ORDER) {
    const members: AudienceMember[] = people.filter(
      (p) => p.relation === relation,
    );
    if (members.length > 0) groups.set(relation, members);
  }
  return groups;
}

function summaryLine(audience: PostAudience): string {
  if (audience.viewer_is_author) {
    return "Your comment will be viewable by all of your friends.";
  }
  return `Your comment will be viewable by all of your friends, and all friends of ${audience.author_name} as well.`;
}

function futureNote(audience: PostAudience): string {
  if (audience.viewer_is_author) {
    return "If you add friends in the future, they may be able to see this conversation too.";
  }
  return `If you or ${audience.author_name} add friends in the future, they may be able to see this conversation too.`;
}

/**
 * Explains a thread's reach before someone replies. Aimed at readers who
 * hesitate to comment because the audience is unclear.
 */
export function CommentAudienceModal({
  postId,
  onClose,
}: CommentAudienceModalProps) {
  const [audience, setAudience] = useState<PostAudience | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        if (!active) return;
        setAudience(data);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof ApiError ? err.message : "Could not load the audience",
        );
      });
    return () => {
      active = false;
    };
  }, [postId]);

  const groups =
    audience !== null ? groupPeople(audience.people) : new Map<never, never>();

  return (
    <ModalShell onClose={onClose} label="Who will see this comment" padded={false}>
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 p-5 pb-4 dark:border-zinc-800">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-900 dark:text-zinc-100">
            Conversations on NWF are private.
          </p>
          <h2 className="mt-1 font-serif text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Who will see this?
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

      <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5">
      {error !== null ? (
        <p className="text-sm text-zinc-500">{error}</p>
      ) : audience === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {summaryLine(audience)}
          </p>

          {audience.people.length > 0 ? (
            <div className="mt-4 space-y-4">
              {[...groups.entries()].map(([relation, members]) => (
                <div key={relation}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    {GROUP_LABELS[relation]}
                  </p>
                  <ul className="mt-2 space-y-2">
                    {members.map((person) => (
                      <li
                        key={person.user_id}
                        className="flex items-center gap-2"
                      >
                        <UserLink
                          userId={person.user_id}
                          title={person.display_name}
                          onNavigate={onClose}
                        >
                          <Avatar
                            name={person.display_name}
                            imageUrl={person.image_url}
                          />
                        </UserLink>
                        <UserLink
                          userId={person.user_id}
                          onNavigate={onClose}
                          className="min-w-0 truncate text-sm text-zinc-800 hover:underline dark:text-zinc-200"
                        >
                          {person.display_name}
                        </UserLink>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">
              No one else can see this conversation yet.
            </p>
          )}

          <p className="mt-5 border-t border-zinc-200 pt-4 text-xs leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            {futureNote(audience)}
          </p>
        </>
      )}
      </div>
    </ModalShell>
  );
}
