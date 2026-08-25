"use client";

import { PostDetail } from "@/components/post-detail";
import type { UUID } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createPortal } from "react-dom";

interface PostDetailModalProps {
  postId: UUID;
  focusUnread?: boolean;
  /** Scroll to and highlight one comment, from ?comment=<id>. */
  focusCommentId?: UUID | null;
}

/**
 * Modal shell for the intercepting `/post/[id]` route. Closing returns to the
 * feed via `router.back()`; a hard load of the same URL renders the full page.
 */
export function PostDetailModal({
  postId,
  focusUnread = false,
  focusCommentId = null,
}: PostDetailModalProps) {
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") router.back();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [router]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/50 sm:items-start sm:p-4 sm:pt-12"
      onClick={() => router.back()}
    >
      {/* A phone gets the whole viewport: reading a post and its thread is a
          page, not a dialog, and a floating card just wastes edges. */}
      <div
        className="flex h-dvh w-full flex-col overflow-hidden border-zinc-200 bg-white shadow-xl sm:h-auto sm:max-h-[calc(100dvh-4rem)] sm:max-w-2xl sm:border dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center border-b border-zinc-200 bg-white px-1 pb-1 pt-[calc(0.25rem+env(safe-area-inset-top))] sm:justify-end sm:px-4 sm:py-2 dark:border-zinc-800 dark:bg-zinc-950">
          <button
            onClick={() => router.back()}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center text-zinc-500 hover:text-zinc-900 sm:h-auto sm:w-auto sm:text-zinc-400 dark:hover:text-zinc-200"
          >
            {/* Full screen reads as a pushed page, so mobile gets a back
                chevron and a thumb-sized target instead of a bare glyph. */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-5 w-5 sm:hidden"
              aria-hidden
            >
              <path d="m14.5 5-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">✕</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-8 sm:py-6 sm:pb-6">
          <PostDetail
            postId={postId}
            onDeleted={() => router.back()}
            focusUnread={focusUnread}
            focusCommentId={focusCommentId}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
