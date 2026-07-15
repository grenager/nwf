"use client";

import { useAuthGate } from "@/components/auth-gate";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { InvitationCreateResult, UUID } from "@/lib/types";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const SHARE_TEXT = "I wanted to discuss this article with you";

interface SharePostModalProps {
  postId: UUID;
  headline: string;
  articleUrl: string;
  imageUrl: string | null;
  sourceName: string | null;
  take: string | null;
  onClose: () => void;
}

function canUseWebShare(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    // Prefer native share tray on coarse pointers (phones/tablets).
    (typeof window === "undefined" ||
      window.matchMedia("(pointer: coarse)").matches ||
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent))
  );
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
  const [sharing, setSharing] = useState<boolean>(false);
  const [result, setResult] = useState<InvitationCreateResult | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [showEmail, setShowEmail] = useState<boolean>(false);
  const [email, setEmail] = useState<string>("");
  const [emailMessage, setEmailMessage] = useState<string>("");
  const [sendingEmail, setSendingEmail] = useState<boolean>(false);

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

      if (canUseWebShare()) {
        try {
          await navigator.share({
            title: headline,
            text: SHARE_TEXT,
            url,
          });
          notify("Shared", "success");
          onClose();
          return;
        } catch (err) {
          // User cancelled the share sheet — stay on the modal with the link.
          if (err instanceof DOMException && err.name === "AbortError") {
            return;
          }
        }
      }

      await navigator.clipboard.writeText(created.share_message || url);
      setCopied(true);
      notify("Message copied — paste it anywhere", "success");
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
    if (!result?.share_message && !result?.invite_url) return;
    try {
      await navigator.clipboard.writeText(
        result.share_message || result.invite_url || "",
      );
      setCopied(true);
      notify("Copied", "success");
    } catch {
      notify("Could not copy", "error");
    }
  }

  async function sendEmail(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!requireAuth("invite friends")) return;
    const trimmed: string = email.trim();
    if (!trimmed || sendingEmail) return;
    setSendingEmail(true);
    try {
      const created = await api.createInvitation({
        email: trimmed,
        post_id: postId,
        message: emailMessage.trim() || null,
        become_friend: becomeFriend,
      });
      notify(created.message, "success");
      if (created.invite_url) {
        setResult(created);
      }
      setEmail("");
      setEmailMessage("");
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to send invite",
        "error",
      );
    } finally {
      setSendingEmail(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-16 sm:pt-20"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
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

        <div className="mb-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          “{SHARE_TEXT}”
        </div>

        <label className="mb-5 flex cursor-pointer items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
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
              : "Copy share message"}
        </button>

        {result?.invite_url ? (
          <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <p className="break-all text-xs text-zinc-500">{result.invite_url}</p>
            <button
              type="button"
              onClick={() => void copyAgain()}
              className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-400"
            >
              {copied ? "Copied!" : "Copy again"}
            </button>
          </div>
        ) : null}

        <div className="mt-5 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          {showEmail ? (
            <form onSubmit={sendEmail} className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">
                Or invite by email
              </p>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="friend@email.com"
                className="w-full border-b border-zinc-300 bg-transparent px-0 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
              />
              <textarea
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
                placeholder="Add a personal note (optional)"
                rows={2}
                className="w-full resize-none border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-800 dark:focus:border-zinc-100"
              />
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={sendingEmail || email.trim().length === 0}
                  className="bg-zinc-900 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {sendingEmail ? "Sending…" : "Send email"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowEmail(false)}
                  className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowEmail(true)}
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              Invite by email instead
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
