"use client";

export type AvatarSize = "sm" | "lg" | "xl";

/** Initials scale with the circle, so a large avatar isn't mostly empty. */
const SIZES: Record<AvatarSize, { dims: string; text: string }> = {
  sm: { dims: "h-7 w-7", text: "text-sm" },
  lg: { dims: "h-10 w-10", text: "text-sm" },
  xl: { dims: "h-16 w-16", text: "text-xl" },
};

export function Avatar({
  name,
  imageUrl,
  size = "sm",
}: {
  name: string;
  imageUrl: string | null;
  size?: AvatarSize;
}) {
  const { dims, text }: { dims: string; text: string } = SIZES[size];
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={imageUrl}
        alt=""
        className={`${dims} shrink-0 rounded-[9999px] object-cover`}
      />
    );
  }
  return (
    <span
      className={`${dims} ${text} flex shrink-0 items-center justify-center rounded-[9999px] bg-zinc-200 font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200`}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
