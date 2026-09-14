import { redirect } from "next/navigation";

/**
 * Alerts is gone as a destination: thread alerts (mentions, reactions) now
 * show on the Conversations card they belong to, and friend requests were
 * always answered on People. The route stays so old links and emails still
 * land somewhere sensible.
 */
export default function NotificationsRedirect() {
  redirect("/conversations");
}
