import type { FriendStar } from "@/lib/types";

interface FriendStarsProps {
  stars: FriendStar[];
  className?: string;
}

export function FriendStars({ stars, className = "" }: FriendStarsProps) {
  if (stars.length === 0) return null;

  const label: string =
    stars.length === 1
      ? `♥ ${stars[0].display_name}`
      : `♥ ${stars[0].display_name} +${stars.length - 1}`;

  return (
    <span
      className={`inline-flex items-center gap-1 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200 ${className}`}
    >
      {label}
    </span>
  );
}
