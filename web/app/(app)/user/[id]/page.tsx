import { FriendProfileModal } from "@/components/friend-profile-modal";

export default async function UserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="mx-auto w-full max-w-lg py-2">
      <FriendProfileModal friendId={id} variant="page" />
    </div>
  );
}
