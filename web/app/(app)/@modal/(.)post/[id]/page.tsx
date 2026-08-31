import { PostDetailModal } from "@/components/post-detail-modal";

export default async function InterceptedPostModal({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ focus?: string; comment?: string; edit?: string }>;
}) {
  const { id } = await params;
  const { focus, comment, edit } = await searchParams;
  const focusUnread: boolean = focus === "unread";
  const startEditing: boolean = edit === "1";
  return (
    <PostDetailModal
      postId={id}
      focusUnread={focusUnread}
      focusCommentId={comment ?? null}
      startEditing={startEditing}
    />
  );
}
