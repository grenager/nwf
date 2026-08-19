"use client";

import { useParams } from "next/navigation";
import { UnsubscribeView } from "../../unsubscribe-view";

export default function UnsubscribeInvitePage() {
  const params = useParams<{ token: string }>();
  const token: string = typeof params.token === "string" ? params.token : "";

  return (
    <UnsubscribeView
      endpoint="unsubscribe/invite"
      token={token}
      fallbackMessage="You will not receive any more email from NewsWithFriends."
    />
  );
}
