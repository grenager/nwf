"use client";

import { PostDetail } from "@/components/post-detail";
import type { UUID } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createPortal } from "react-dom";

interface PostDetailModalProps {
  postId: UUID;
}

/**
 * Modal shell for the intercepting `/post/[id]` route. Closing returns to the
 * feed via `router.back()`; a hard load of the same URL renders the full page.
 */
export function PostDetailModal({ postId }: PostDetailModalProps) {
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
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-12"
      onClick={() => router.back()}
    >
      <div
        className="w-full max-w-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-end border-b border-zinc-200 bg-white/90 px-4 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
          <button
            onClick={() => router.back()}
            aria-label="Close"
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-5 sm:px-8 sm:py-6">
          <PostDetail postId={postId} onDeleted={() => router.back()} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
