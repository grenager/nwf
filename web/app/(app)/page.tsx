import { Landing } from "@/components/landing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { FeedClient } from "./feed-client";

export default async function FeedPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ? <FeedClient /> : <Landing />;
}
