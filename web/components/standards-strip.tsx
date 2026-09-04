"use client";

import { useAuthGate } from "@/components/auth-gate";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { shareInviteLink } from "@/lib/invite-share";
import { useStandardsValue } from "@/components/standards-context";
import { useStandards } from "@/lib/use-standards";
import type { InvitationCreateResult } from "@/lib/types";
import { useEffect, useState } from "react";

/**
 * Tells the rest of the top chrome that the strip is there.
 *
 * Below `sm` the strip is fixed, because the search bar above the feed is
 * fixed too and one of them has to win the top of the screen. The offset the
 * search bar needs is declared in globals.css rather than measured here: the
 * strip is one line at every width by design, so its height is a constant,
 * and a ResizeObserver to rediscover that on every render was machinery
 * standing in for a number that does not change.
 */
function useStripPresence(showing: boolean): void {
  useEffect(() => {
    if (!showing) return;
    const root: HTMLElement = document.documentElement;
    root.dataset.strip = "";
    return () => {
      delete root.dataset.strip;
    };
  }, [showing]);
}

/**
 * A single line pinned to the top of the feed, for the two asks a composer
 * cannot answer: too few friends, and an unpinned home screen.
 *
 * This is the one coloured thing in an otherwise monochrome product, and the
 * colour is a warm newspaper red rather than a UI red — the point is to be
 * unmissable, not to imply something has gone wrong. Because it is the only
 * accent, it stays loud; spend the same colour on a second element and this
 * one goes quiet.
 *
 * It runs the full width of the window and stays one line at every size.
 * Anything taller stops being a rule across the top of the page and becomes
 * another box to scroll past, which is the thing this replaced.
 */
export function StandardsStrip() {
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const [inviting, setInviting] = useState<boolean>(false);
  const published = useStandardsValue();
  const {
    kind,
    nudge: shown,
    dismiss,
  } = useStandards(published?.nudge ?? null, published?.me?.is_admin === true);
  const showing: boolean = kind === "invite" || kind === "pin";
  useStripPresence(showing);

  if (!showing) return null;

  async function invite(): Promise<void> {
    if (!requireAuth("invite friends")) return;
    if (inviting) return;
    setInviting(true);
    try {
      const created: InvitationCreateResult = await api.createInvitation({
        become_friend: true,
      });
      if (!created.invite_url) {
        notify(created.message, "success");
        return;
      }
      const result = await shareInviteLink(created);
      if (result === "copied") notify("Invite link copied", "success");
      if (result === "failed")
        notify("Could not copy the invite link", "error");
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Could not create an invite",
        "error",
      );
    } finally {
      setInviting(false);
    }
  }

  return (
    <>
      {/* Below `sm` the strip is fixed, so the flow needs its height handed
          back or the feed starts underneath it. */}
      <div className="h-[var(--strip-h)] sm:hidden" aria-hidden />
      <div
        // Below `sm` the nav is a bottom bar and the feed's search bar is
        // itself fixed to the top, so the strip is fixed too and sits a layer
        // above it — sharing `top-0` at the same z-index just hid the strip.
        // From `sm` a sticky header occupies the top; at `lg` the main column
        // becomes its own scroll container and the offset resets to zero.
        className="fixed inset-x-0 top-0 z-40 bg-masthead text-white sm:sticky sm:top-[var(--nav-h)] sm:z-30 lg:top-0 dark:bg-masthead-dark"
        // The strip is the topmost thing on a phone, so it is the thing that
        // has to clear the notch.
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 lg:px-8">
          {/* Only the message may be clipped. The action sits outside it as its
            own flex child, because a strip that truncates away the one thing
            it is asking you to do is worse than no strip. */}
          {/* No `flex-1`: the sentence takes its natural width so the action
            sits right beside it instead of drifting to the far edge of a wide
            window, and `min-w-0` still lets it shrink and clip once the row
            actually overflows on a phone. */}
          <p className="min-w-0 truncate text-xs sm:text-sm">
            {kind === "invite" ? (
              <>
                {/* The reason a thin circle matters does not fit beside the
                  action on a phone, and half a sentence followed by an
                  ellipsis reads worse than a short one that finishes. */}
                <span className="sm:hidden">
                  {shortInviteLine(shown?.value ?? 0)}
                </span>
                <span className="hidden sm:inline">
                  {inviteLine(shown?.value ?? 0)}
                </span>
              </>
            ) : (
              <>
                Tap <ShareGlyph /> then{" "}
                <span className="font-semibold">Add to Home Screen</span>.
              </>
            )}
          </p>
          {kind === "invite" ? (
            <button
              type="button"
              onClick={() => void invite()}
              disabled={inviting}
              className="shrink-0 text-xs font-semibold underline underline-offset-2 disabled:opacity-60 sm:text-sm"
            >
              {inviting ? "Creating…" : "Invite someone"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="ml-auto shrink-0 px-1 text-xs leading-none opacity-70 transition hover:opacity-100"
          >
            ✕
          </button>
        </div>
      </div>
    </>
  );
}

/** Why a thin circle matters, in terms of what they'll actually experience. */
function shortInviteLine(friends: number): string {
  if (friends <= 0) return "No friends yet.";
  if (friends === 1) return "Only 1 friend so far.";
  return `Only ${friends} friends so far.`;
}

function inviteLine(friends: number): string {
  if (friends <= 0) return "No friends yet, so there's nothing to read.";
  if (friends === 1) return "Only 1 friend, so your feed stays quiet.";
  return `Only ${friends} friends, so your feed stays quiet.`;
}

/** iOS's share control: a box with an arrow leaving the top of it. */
function ShareGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-label="the Share button"
      role="img"
      className="inline-block h-[1.05em] w-[1.05em] -translate-y-px align-text-bottom"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="M8.5 6.5 12 3l3.5 3.5" />
      <path d="M7 10H5.5A1.5 1.5 0 0 0 4 11.5v8A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 10H17" />
    </svg>
  );
}
