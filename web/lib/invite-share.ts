"use client";

import { api } from "@/lib/api";
import { reportableShareOutcome, shareOrCopyLink, type ShareResult } from "@/lib/share";
import type { InvitationCreateResult } from "@/lib/types";

/**
 * Hand a freshly minted invite link to the OS share tray (or the clipboard),
 * and record what the inviter did with it.
 *
 * Every invite path goes through here so the outcome is captured in one
 * place. It matters because a share-tray link is otherwise invisible after
 * it leaves the page: we never learn who received it, how many people, or
 * through which app. Whether the inviter completed the share sheet, fell
 * back to copying, or backed out is the only part we can observe, and
 * without it a link that was never sent looks exactly like one that was sent
 * and ignored.
 *
 * Reporting is fire-and-forget: failing to record a metric must never cost
 * the user the share they just performed.
 */
export async function shareInviteLink(
  created: InvitationCreateResult,
  /**
   * Overrides for what lands in the share sheet. The post-sharing modal
   * leads with the article's headline and keeps the URL out of the body
   * (the sheet shows it separately), so it passes its own.
   */
  payload?: { title?: string; text?: string },
): Promise<ShareResult> {
  const url: string = created.invite_url ?? "";
  if (!url) return "failed";

  const result: ShareResult = await shareOrCopyLink({
    title: payload?.title ?? "NewsWithFriends",
    text: payload?.text ?? created.share_message,
    url,
  });

  const outcome = reportableShareOutcome(result);
  if (outcome !== null && created.invitation_id) {
    void api.recordShareOutcome(created.invitation_id, outcome).catch(() => undefined);
  }
  return result;
}
