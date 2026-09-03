"use client";

import { useAuthGate } from "@/components/auth-gate";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { InvitationCreateResult, UUID } from "@/lib/types";
import { useEffect, useState } from "react";
import { ModalShell } from "@/components/modal-shell";
import { shareInviteLink } from "@/lib/invite-share";
import { canUseWebShare } from "@/lib/share";

interface SharePostModalProps {
  postId: UUID;
  headline: string;
  articleUrl: string;
  imageUrl: string | null;
  sourceName: string | null;
  take: string | null;
  onClose: () => void;
}

export function SharePostModal({
  postId,
  headline,
  articleUrl,
  imageUrl,
  sourceName,
  take,
  onClose,
}: SharePostModalProps) {
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const [becomeFriend, setBecomeFriend] = useState<boolean>(true);
  // Deliberately empty. This box used to be prefilled with a pitch for the
  // app, and a default nobody edits is what actually gets sent — so the
  // typical share read as an ad rather than as a friend passing on a story.
  // Left blank, the server falls back to the headline and the poster's take.
  const [shareNote, setShareNote] = useState<string>("");
  const [sharing, setSharing] = useState<boolean>(false);
  const [result, setResult] = useState<InvitationCreateResult | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const trimmedNote: string = shareNote.trim();

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function mintLink(): Promise<InvitationCreateResult> {
    return api.createInvitation({
      post_id: postId,
      become_friend: becomeFriend,
      message: trimmedNote || null,
      email: null,
    });
  }

  async function share(): Promise<void> {
    if (!requireAuth("share this conversation")) return;
    if (sharing) return;
    setSharing(true);
    setCopied(false);
    try {
      const created = await mintLink();
      setResult(created);
      const url: string = created.invite_url ?? "";
      if (!url) {
        notify(created.message, "success");
        return;
      }

      // The server composes the message — headline, then the note or the
      // poster's take, then the link — so every share path produces the same
      // text. It carries the URL because it is also what lands on the
      // clipboard when the share sheet isn't available.
      const shareResult = await shareInviteLink(created, { title: headline });

      if (shareResult === "shared") {
        notify("Shared", "success");
        onClose();
        return;
      }
      // Cancelled — stay on the modal with the link still available.
      if (shareResult === "cancelled") return;
      if (shareResult === "failed") {
        notify("Could not copy the link", "error");
        return;
      }
      setCopied(true);
      notify("Link copied — paste it anywhere", "success");
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to create share link",
        "error",
      );
    } finally {
      setSharing(false);
    }
  }

  async function copyAgain(): Promise<void> {
    if (!result?.invite_url) return;
    try {
      await navigator.clipboard.writeText(
        result.share_message || result.invite_url,
      );
      setCopied(true);
      notify("Copied", "success");
    } catch {
      notify("Could not copy", "error");
    }
  }

  return (
    <ModalShell onClose={onClose} label="Share" padded={false}>
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 p-5 pb-4 dark:border-zinc-800">
        <div>
          <h2 className="font-serif text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Share
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Send this conversation to a friend.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-700"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mb-4 overflow-hidden border border-zinc-200 dark:border-zinc-800">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="" className="h-32 w-full object-cover" />
          ) : null}
          <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
            {sourceName ? (
              <p className="text-[11px] uppercase tracking-[0.08em] text-zinc-400">
                {sourceName}
              </p>
            ) : null}
            <a
              href={articleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 block font-serif text-base font-semibold leading-snug text-zinc-900 hover:underline dark:text-zinc-50"
            >
              {headline}
            </a>
            {take ? (
              <p className="mt-2 border-l-2 border-zinc-900 pl-3 text-sm text-zinc-600 dark:border-zinc-100 dark:text-zinc-300">
                {take}
              </p>
            ) : null}
          </div>
        </div>

        <label className="mb-4 block">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Add a note
          </span>
          <textarea
            value={shareNote}
            onChange={(e) => setShareNote(e.target.value)}
            rows={3}
            placeholder="Optional — the link goes underneath"
            className="mt-2 w-full resize-none border border-zinc-200 bg-transparent px-3 py-2 text-sm text-zinc-800 outline-none focus:border-zinc-900 dark:border-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-100"
          />
        </label>

        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={becomeFriend}
            onChange={(e) => setBecomeFriend(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-zinc-900 dark:accent-zinc-100"
          />
          <span>
            Make the recipient a friend so they can join the discussion
          </span>
        </label>
      </div>

      <div className="shrink-0 border-t border-zinc-200 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => void share()}
          disabled={sharing}
          className="w-full bg-zinc-900 py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {sharing
            ? "Preparing…"
            : canUseWebShare()
              ? "Share…"
              : "Copy share link"}
        </button>

        {result?.invite_url ? (
          <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <p className="break-all text-xs text-zinc-500">{result.invite_url}</p>
            <button
              type="button"
              onClick={() => void copyAgain()}
              className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700 disabled:opacity-40 dark:text-emerald-400"
            >
              {copied ? "Copied!" : "Copy again"}
            </button>
          </div>
        ) : null}
      </div>
    </ModalShell>
  );
}
