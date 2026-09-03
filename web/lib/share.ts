import type { ShareOutcome } from "@/lib/types";

/** Prefer the OS share tray on coarse pointers (phones/tablets). */
export function canUseWebShare(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    (typeof window === "undefined" ||
      window.matchMedia("(pointer: coarse)").matches ||
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent))
  );
}

export type ShareResult = "shared" | "cancelled" | "copied" | "failed";

/**
 * The share results worth recording against an invitation.
 *
 * "failed" is dropped deliberately: the clipboard threw, which says something
 * about the browser and nothing about whether the inviter meant to send the
 * link. Recording it as an outcome would put a technical error in the same
 * column as a human decision.
 */
export function reportableShareOutcome(
  result: ShareResult,
): ShareOutcome | null {
  return result === "failed" ? null : result;
}

/**
 * Hand a link to the OS share tray, falling back to the clipboard when the
 * tray is unavailable or the user backs out of it without picking anything.
 *
 * The tray never reveals where the link went, so the return value is the only
 * signal we get about whether an invite was actually sent — see
 * `reportableShareOutcome`.
 */
export async function shareOrCopyLink(payload: {
  title: string;
  text: string;
  url: string;
}): Promise<ShareResult> {
  if (canUseWebShare()) {
    try {
      // What reaches the recipient has to end with the link, or the messaging
      // app renders no preview. An invite's text already ends with it, so
      // passing `url` as well would append a second copy and bury the first.
      //
      // With no note there is nothing but the link, and a link is better
      // shared as one: `{title, url}` lets the OS hand the target a real URL
      // rather than a string that happens to contain one.
      const linkOnly: boolean = payload.text.trim() === payload.url;
      const endsWithLink: boolean = payload.text.trimEnd().endsWith(payload.url);
      await navigator.share(
        linkOnly
          ? { title: payload.title, url: payload.url }
          : endsWithLink
            ? { title: payload.title, text: payload.text }
            : payload,
      );
      return "shared";
    } catch (err) {
      // Dismissing the tray is a deliberate no-op, not a failure.
      if (err instanceof DOMException && err.name === "AbortError") {
        return "cancelled";
      }
    }
  }
  try {
    await navigator.clipboard.writeText(payload.text || payload.url);
    return "copied";
  } catch {
    return "failed";
  }
}
