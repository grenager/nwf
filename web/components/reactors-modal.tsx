"use client";

import { PeopleListModal, type PersonRow } from "@/components/people-list-modal";
import { ReactionIcon } from "@/components/reaction-icon";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import { REACTIONS, type PostReactor, type UUID } from "@/lib/types";
import { useEffect, useState } from "react";

interface ReactorsModalProps {
  postId: UUID;
  onClose: () => void;
}

function reactionLabel(reaction: string): string {
  const known = REACTIONS.find((r) => r.kind === reaction);
  return known ? known.label : reaction;
}

/** Who reacted to this post, and with what, most recent first. */
export function ReactorsModal({ postId, onClose }: ReactorsModalProps) {
  const [reactors, setReactors] = useState<PostReactor[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .getPostReactors(postId)
      .then((data) => {
        if (!active) return;
        setReactors(data);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof ApiError ? err.message : "Could not load reactions",
        );
      });
    return () => {
      active = false;
    };
  }, [postId]);

  const people: PersonRow[] = (reactors ?? []).map((r) => ({
    user_id: r.user_id,
    display_name: r.display_name,
    image_url: r.image_url,
    icon: <ReactionIcon kind={r.reaction} className="h-3 w-3 shrink-0" />,
    subtitle: `${reactionLabel(r.reaction)} · ${relativeTime(r.reacted_at)}`,
  }));

  return (
    <PeopleListModal
      label="Who reacted to this"
      title="Reactions"
      loading={reactors === null && error === null}
      error={error}
      people={people}
      emptyMessage="No reactions yet."
      onClose={onClose}
    />
  );
}
