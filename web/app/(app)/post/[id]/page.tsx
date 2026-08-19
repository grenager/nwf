import { PostDetail } from "@/components/post-detail";

export default async function PostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { id } = await params;
  const { focus } = await searchParams;
  const focusUnread: boolean = focus === "unread";
  return (
    <div className="mx-auto max-w-2xl py-4">
      <PostDetail postId={id} focusUnread={focusUnread} />
    </div>
  );
}
