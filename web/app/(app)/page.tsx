import { Landing } from "@/components/landing";
import { getServerUser } from "@/lib/supabase/server";

import { FeedClient } from "./feed-client";

export default async function FeedPage() {
  const user = await getServerUser();

  return user ? <FeedClient /> : <Landing />;
}
