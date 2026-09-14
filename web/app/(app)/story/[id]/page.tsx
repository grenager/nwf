import { StoryDetail } from "@/components/story-detail";

export default async function StoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StoryDetail storyId={id} />;
}
