import { StoryDetailModal } from "@/components/story-detail-modal";

export default async function InterceptedStoryModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StoryDetailModal storyId={id} />;
}
