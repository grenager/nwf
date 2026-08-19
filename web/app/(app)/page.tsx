import type { StoryList } from "@/lib/types";
import { FeedClient } from "./feed-client";

const API_URL: string =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Revalidate the shared guest discover feed at the edge so repeat anonymous
// loads are served instantly from cache instead of hitting the API each time.
export const revalidate: number = 30;

async function getGuestDiscover(): Promise<StoryList | null> {
  try {
    const resp: Response = await fetch(`${API_URL}/stories/discover`, {
      next: { revalidate },
    });
    if (!resp.ok) return null;
    return (await resp.json()) as StoryList;
  } catch {
    return null;
  }
}

export default async function FeedPage() {
  const initialGuestStories: StoryList | null = await getGuestDiscover();
  return <FeedClient initialGuestStories={initialGuestStories} />;
}
