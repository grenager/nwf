"use client";

import { FriendProfileModal } from "@/components/friend-profile-modal";
import type { UUID } from "@/lib/types";
import { useRouter } from "next/navigation";

/**
 * Modal shell for the intercepting `/user/[id]` route, mirroring
 * `PostDetailModal`: closing returns to wherever the avatar was clicked, and a
 * hard load of the same URL renders the full page instead.
 */
export function UserProfileModal({ userId }: { userId: UUID }) {
  const router = useRouter();
  return <FriendProfileModal friendId={userId} onClose={() => router.back()} />;
}
