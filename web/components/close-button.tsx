"use client";

/**
 * The standard close control for modals and dismissible bars.
 *
 * Most of these were a bare ✕ glyph with no box, so the tap target was the
 * glyph itself — around 14px, a third of what a thumb needs. Apple's HIG asks
 * for 44pt minimum, Material for 48dp, and WCAG 2.2's enhanced target-size
 * criterion for 44 CSS px; 44 satisfies all three, so that is the floor here.
 *
 * A mouse is precise, so the box shrinks to 36px when the primary pointer is
 * fine, rather than leaving a thumb-sized square next to a title on a desktop
 * dialog. That is keyed on the pointer rather than a width breakpoint: a
 * tablet in landscape is wide but still a thumb. The glyph does not change
 * size either way, only the hit area around it.
 */
export function CloseButton({
  onClose,
  label = "Close",
  className = "",
}: {
  onClose: () => void;
  /** Override for a control that dismisses something specific. */
  label?: string;
  /** Colour and placement for the surface this sits on. */
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={label}
      className={`flex h-11 w-11 shrink-0 items-center justify-center text-base leading-none transition [@media(pointer:fine)]:h-9 [@media(pointer:fine)]:w-9 ${className}`}
    >
      {/* aria-hidden: the accessible name comes from aria-label, so the glyph
          must not be read out as "multiplication x" on top of it. */}
      <span aria-hidden>✕</span>
    </button>
  );
}
