import { PostDetailModal } from "@/components/post-detail-modal";

export default async function InterceptedPostModal({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { id } = await params;
  const { focus } = await searchParams;
  const focusUnread: boolean = focus === "unread";
  return <PostDetailModal postId={id} focusUnread={focusUnread} />;
}
