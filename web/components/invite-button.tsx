"use client";

import { useAuthGate } from "@/components/auth-gate";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { shareInviteLink } from "@/lib/invite-share";
import type { InvitationCreateResult } from "@/lib/types";
import { useState } from "react";

/**
 * The app's front door for growth: one tap mints a standalone invite link and
 * hands it to the OS share tray, so inviting someone costs no typing. Desktop
 * has no tray, so it falls back to the clipboard.
 */
export function InviteButton() {
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const [busy, setBusy] = useState<boolean>(false);

  async function invite(): Promise<void> {
    if (!requireAuth("invite friends")) return;
    if (busy) return;
    setBusy(true);
    try {
      const created: InvitationCreateResult = await api.createInvitation({
        become_friend: true,
      });
      const url: string = created.invite_url ?? "";
      if (!url) {
        notify(created.message, "success");
        return;
      }

      const result = await shareInviteLink(created);
      if (result === "copied") notify("Invite link copied", "success");
      if (result === "failed") notify("Could not copy the invite link", "error");
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Could not create an invite",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void invite()}
      disabled={busy}
      className="flex w-full items-center justify-center gap-2 bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        className="h-4 w-4"
        aria-hidden
      >
        <circle cx="9" cy="8" r="3.25" />
        <path d="M3.5 19c1-2.7 2.9-4.05 5.5-4.05S13.5 16.3 14.5 19" strokeLinecap="round" />
        <path d="M18 8.5v5M15.5 11h5" strokeLinecap="round" />
      </svg>
      {busy ? "Creating invite…" : "Invite friends"}
    </button>
  );
}
