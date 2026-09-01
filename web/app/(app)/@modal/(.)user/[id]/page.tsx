import { UserProfileModal } from "@/components/user-profile-modal";

export default async function InterceptedUserModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <UserProfileModal userId={id} />;
}
