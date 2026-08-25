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
