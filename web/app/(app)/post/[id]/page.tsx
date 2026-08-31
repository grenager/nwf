import { PostDetail } from "@/components/post-detail";

export default async function PostPage({
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
    <div className="mx-auto max-w-2xl py-4">
      <PostDetail
        postId={id}
        focusUnread={focusUnread}
        focusCommentId={comment ?? null}
        startEditing={startEditing}
      />
    </div>
  );
}
