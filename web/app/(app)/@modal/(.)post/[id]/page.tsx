import { PostDetailModal } from "@/components/post-detail-modal";

export default async function InterceptedPostModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PostDetailModal postId={id} />;
}
