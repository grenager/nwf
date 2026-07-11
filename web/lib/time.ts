/** Compact relative time, e.g. "just now", "5m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string): string {
  const then: number = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const seconds: number = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return "just now";

  const minutes: number = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours: number = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days: number = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;

  const weeks: number = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;

  return new Date(then).toLocaleDateString();
}
