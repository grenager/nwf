"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * How the panel presents itself on a phone. Above the `sm` breakpoint both
 * modes render the same centered card, so this only decides small-screen shape.
 *
 * - `fullscreen` for content the user came to read or work in: the whole
 *   viewport, because a floating card at 390px wastes its edges.
 * - `sheet` for confirmations and pickers: anchored to the bottom edge within
 *   thumb reach, tall enough for its content and no taller.
 */
export type ModalMobileMode = "fullscreen" | "sheet";

export type ModalWidth = "md" | "lg" | "2xl";

const WIDTH_CLASS: Record<ModalWidth, string> = {
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  "2xl": "sm:max-w-2xl",
};

/** Nested modals must not unlock the background when the inner one closes. */
let scrollLocks: number = 0;

function lockBackgroundScroll(): () => void {
  scrollLocks += 1;
  document.body.style.overflow = "hidden";
  return () => {
    scrollLocks -= 1;
    if (scrollLocks === 0) document.body.style.overflow = "";
  };
}

export interface ModalShellProps {
  /** Runs on backdrop click, Escape, and whatever close control the content
   *  renders. Pass null for a modal that only its owner can dismiss. */
  readonly onClose: (() => void) | null;
  readonly children: ReactNode;
  readonly mobile?: ModalMobileMode;
  readonly width?: ModalWidth;
  /** Accessible name for the dialog. */
  readonly label: string;
  /** Stack above other modals (the sign-in prompt opens over them). */
  readonly onTop?: boolean;
  /** Wrap children in the standard padded scroll area. Pass false to lay out
   *  the panel's rows yourself — a pinned header over a scrolling body. */
  readonly padded?: boolean;
}

/**
 * Portal, backdrop, and panel for every modal in the app, so they share one
 * set of answers about mobile shape, safe areas, scroll locking, and Escape.
 */
export function ModalShell({
  onClose,
  children,
  mobile = "sheet",
  width = "md",
  label,
  onTop = false,
  padded = true,
}: ModalShellProps) {
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => lockBackgroundScroll(), []);

  useEffect(() => {
    if (onClose === null) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  const fullscreen: boolean = mobile === "fullscreen";

  const backdropClass: string = [
    "fixed inset-0 flex justify-center bg-black/50",
    onTop ? "z-[200]" : "z-[100]",
    fullscreen ? "items-stretch" : "items-end",
    "sm:items-start sm:p-4",
    fullscreen ? "sm:pt-12" : "sm:pt-16",
  ].join(" ");

  const panelClass: string = [
    "flex w-full flex-col overflow-hidden border-zinc-200 bg-white shadow-xl",
    fullscreen ? "h-dvh" : "max-h-[85dvh]",
    "sm:h-auto sm:max-h-[calc(100dvh-6rem)] sm:border",
    WIDTH_CLASS[width],
    "dark:border-zinc-800 dark:bg-zinc-950",
  ].join(" ");

  return createPortal(
    <div
      className={backdropClass}
      onClick={onClose === null ? undefined : () => onClose()}
    >
      <div
        className={panelClass}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {padded ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5">
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </div>,
    document.body,
  );
}
