import { PostDetail } from "@/components/post-detail";

export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-2xl py-4">
      <PostDetail postId={id} />
    </div>
  );
}
