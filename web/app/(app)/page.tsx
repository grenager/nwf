import { DiscoverList } from "@/components/discover-list";
import { Landing } from "@/components/landing";
import { getServerUser } from "@/lib/supabase/server";

/**
 * Discover is the app's front door: the most active stories platform-wide.
 * Guests see it too, under the marketing hero, so the first thing a visitor
 * reads is actual news rather than a description of a news app.
 */
export default async function DiscoverPage() {
  const user = await getServerUser();

  return user ? <DiscoverList /> : <Landing />;
}
