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

/**
 * Hand a link to the OS share tray, falling back to the clipboard when the
 * tray is unavailable or the user backs out of it without picking anything.
 */
export async function shareOrCopyLink(payload: {
  title: string;
  text: string;
  url: string;
}): Promise<"shared" | "cancelled" | "copied" | "failed"> {
  if (canUseWebShare()) {
    try {
      await navigator.share(payload);
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
