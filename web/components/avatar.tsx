"use client";

export function Avatar({
  name,
  imageUrl,
  size = "sm",
}: {
  name: string;
  imageUrl: string | null;
  size?: "sm" | "lg";
}) {
  const dims: string = size === "lg" ? "h-10 w-10" : "h-7 w-7";
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
      className={`${dims} flex shrink-0 items-center justify-center rounded-[9999px] bg-zinc-200 text-sm font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200`}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
