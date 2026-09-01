"use client";

import { Avatar } from "@/components/avatar";
import { useToast } from "@/components/toast";
import { UserLink } from "@/components/user-link";
import { api, ApiError } from "@/lib/api";
import {
  dismissRecommendation,
  dismissedRecommendations,
  mutualLabel,
} from "@/lib/people";
import type { RecommendedFriend, UUID } from "@/lib/types";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Friends-of-friends as a horizontally scrolling strip in the feed.
 *
 * This is how the friend graph gets *denser* rather than just wider: the
 * people worth connecting to are already reachable through someone you know,
 * so nobody has to send an invite for the circle to grow. Renders nothing
 * when there is nothing to suggest — including for an account with no
 * friends, since the endpoint returns an empty list without any.
 */
export function PeopleYouMayKnow() {
  const { notify } = useToast();
  const [people, setPeople] = useState<RecommendedFriend[]>([]);
  const [requested, setRequested] = useState<ReadonlySet<UUID>>(
    () => new Set<UUID>(),
  );
  const [pending, setPending] = useState<ReadonlySet<UUID>>(
    () => new Set<UUID>(),
  );

  useEffect(() => {
    let active = true;
    void api
      .getRecommendedFriends()
      .then((recs) => {
        if (!active) return;
        // Dismissals live in localStorage, so they can only be applied on the
        // client — filtering here rather than in an initializer keeps the
        // first client render identical to the server's.
        const hidden: ReadonlySet<UUID> = dismissedRecommendations();
        setPeople(recs.filter((rec) => !hidden.has(rec.user_id)));
      })
      .catch(() => undefined); // A missing suggestion strip is not worth a toast.
    return () => {
      active = false;
    };
  }, []);

  async function addFriend(userId: UUID): Promise<void> {
    if (pending.has(userId) || requested.has(userId)) return;
    setPending((prev) => new Set(prev).add(userId));
    try {
      await api.createConnection(userId);
      // The card stays put, showing "Requested" — removing it here would make
      // the rest of the strip jump out from under the tap that just landed.
      setRequested((prev) => new Set(prev).add(userId));
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Could not send that request",
        "error",
      );
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  function dismiss(userId: UUID): void {
    dismissRecommendation(userId);
    setPeople((prev) => prev.filter((rec) => rec.user_id !== userId));
  }

  if (people.length === 0) return null;

  return (
    <section
      aria-label="People you may know"
      className="border-y border-zinc-200 py-4 dark:border-zinc-800"
    >
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          People you may know
        </h2>
        <Link
          href="/friends"
          className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          See all
        </Link>
      </div>

      {/* Its own scroll container so a long list never scrolls the feed body
          sideways. */}
      <ul className="mt-3 flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {people.map((rec) => {
          const isRequested: boolean = requested.has(rec.user_id);
          const isPending: boolean = pending.has(rec.user_id);
          const mutuals: string = mutualLabel(rec.mutual_count);
          return (
            <li
              key={rec.user_id}
              className="relative flex w-36 shrink-0 flex-col items-center border border-zinc-200 p-3 pt-4 dark:border-zinc-800"
            >
              <button
                type="button"
                onClick={() => dismiss(rec.user_id)}
                aria-label={`Dismiss ${rec.display_name}`}
                className="absolute right-1 top-1 px-1.5 py-0.5 text-xs leading-none text-zinc-300 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-300"
              >
                ✕
              </button>
              <UserLink userId={rec.user_id} title={rec.display_name}>
                <Avatar
                  name={rec.display_name}
                  imageUrl={rec.image_url}
                  size="xl"
                />
              </UserLink>
              <UserLink
                userId={rec.user_id}
                className="mt-2 line-clamp-2 text-center text-sm font-semibold text-zinc-900 hover:underline dark:text-zinc-50"
              >
                {rec.display_name}
              </UserLink>
              <p className="mt-0.5 h-4 text-center text-[11px] text-zinc-400">
                {mutuals}
              </p>
              <button
                type="button"
                onClick={() => void addFriend(rec.user_id)}
                disabled={isPending || isRequested}
                className="mt-2.5 w-full bg-zinc-900 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {isRequested ? "Requested" : isPending ? "Adding…" : "Add friend"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
