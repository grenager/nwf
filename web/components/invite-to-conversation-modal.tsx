"use client";

import { useAuthGate } from "@/components/auth-gate";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { InvitationCreateResult, UUID } from "@/lib/types";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface InviteToConversationModalProps {
  postId: UUID;
  headline: string;
  articleUrl: string;
  imageUrl: string | null;
  sourceName: string | null;
  take: string | null;
  onClose: () => void;
}

export function InviteToConversationModal({
  postId,
  headline,
  articleUrl,
  imageUrl,
  sourceName,
  take,
  onClose,
}: InviteToConversationModalProps) {
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const [email, setEmail] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [result, setResult] = useState<InvitationCreateResult | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

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

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!requireAuth("invite friends")) return;
    const trimmed: string = email.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setCopied(false);
    try {
      const created = await api.createInvitation({
        email: trimmed,
        post_id: postId,
        message: message.trim() || null,
      });
      setResult(created);
      notify(created.message, "success");
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to send invite",
        "error",
      );
    } finally {
      setSending(false);
    }
  }

  async function copyInvite(): Promise<void> {
    if (!result?.invite_url && !result?.share_message) return;
    try {
      await navigator.clipboard.writeText(
        result.share_message || result.invite_url || "",
      );
      setCopied(true);
      notify("Invitation copied", "success");
    } catch {
      notify("Could not copy", "error");
    }
  }

  async function copyOnly(): Promise<void> {
    // Create invite without requiring email send (still needs email for
    // the invitation record, but lets inviter share the message).
    if (!requireAuth("invite friends")) return;
    const trimmed: string = email.trim();
    if (!trimmed) {
      notify("Enter their email so we can create a personal invite", "info");
      return;
    }
    if (sending) return;
    setSending(true);
    try {
      const created = await api.createInvitation({
        email: trimmed,
        post_id: postId,
        message: message.trim() || null,
      });
      setResult(created);
      if (created.invite_url || created.share_message) {
        await navigator.clipboard.writeText(
          created.share_message || created.invite_url || "",
        );
        setCopied(true);
        notify("Invitation copied", "success");
      } else {
        notify(created.message, "success");
      }
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to create invite",
        "error",
      );
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-20"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Invite a friend
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Forward this article and your take — they&apos;ll join the
              conversation with you.
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
            <img
              src={imageUrl}
              alt=""
              className="h-32 w-full object-cover"
            />
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

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="friend@email.com"
            autoFocus
            className="w-full border-b border-zinc-300 bg-transparent px-0 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Add a personal note (optional)"
            rows={3}
            className="w-full resize-none border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-800 dark:focus:border-zinc-100"
          />
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={sending || email.trim().length === 0}
              className="bg-zinc-900 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {sending ? "Sending…" : "Send email"}
            </button>
            <button
              type="button"
              onClick={() => void copyOnly()}
              disabled={sending}
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-600 hover:text-zinc-900 disabled:opacity-40 dark:text-zinc-300"
            >
              {copied ? "Copied!" : "Copy invite link"}
            </button>
          </div>
        </form>

        {result?.invite_url ? (
          <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <p className="text-xs text-zinc-500">
              {result.email_sent
                ? "Email on its way. Share the link anywhere too:"
                : "Share this invitation:"}
            </p>
            <button
              type="button"
              onClick={() => void copyInvite()}
              className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-400"
            >
              {copied ? "Copied!" : "Copy invitation message"}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
