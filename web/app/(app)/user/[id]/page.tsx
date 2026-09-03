"use client";

import { FriendProfileModal } from "@/components/friend-profile-modal";
import { useParams } from "next/navigation";
import type { UUID } from "@/lib/types";

/**
 * A person's profile as a page, so any name in the app — post author,
 * commenter, the friend named in a feed card's reason line — is a link
 * somewhere rather than a dead string. Reuses the profile component in its
 * `page` variant; it renders its own message when the viewer isn't connected
 * to this person.
 */
export default function UserProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  if (typeof id !== "string" || id === "") {
    return <div className="py-16 text-center text-slate-400">Not found.</div>;
  }
  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      <FriendProfileModal friendId={id as UUID} variant="page" />
    </div>
  );
}
