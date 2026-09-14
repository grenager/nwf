import { FeedClient } from "./feed-client";

/**
 * Conversations: what the viewer's friends (and friends of friends) are
 * talking about. The private half of the app — Discover at "/" is the
 * platform-wide half.
 */
export default function ConversationsPage() {
  return <FeedClient />;
}
