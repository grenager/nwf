import { PostDetailModal } from "@/components/post-detail-modal";

export default async function InterceptedPostModal({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ focus?: string; comment?: string }>;
}) {
  const { id } = await params;
  const { focus, comment } = await searchParams;
  const focusUnread: boolean = focus === "unread";
  return (
    <PostDetailModal
      postId={id}
      focusUnread={focusUnread}
      focusCommentId={comment ?? null}
    />
  );
}
