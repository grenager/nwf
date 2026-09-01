"use client";

import { Avatar } from "@/components/avatar";
import { userHref } from "@/lib/url";
import type { UUID } from "@/lib/types";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Wraps anything that identifies a person — an avatar, a name, both — in a
 * link to their profile. `scroll={false}` because the target is usually the
 * intercepting modal, which shouldn't jump the page behind it.
 *
 * Nothing here is a button, so it nests safely inside a row that is itself
 * clickable *only* if that row isn't an anchor. Where the whole row is a
 * link, keep the person's avatar as a sibling of it, not a child.
 */
export function UserLink({
  userId,
  className = "",
  title,
  onNavigate,
  children,
}: {
  userId: UUID;
  className?: string;
  title?: string;
  /** Fired on click, e.g. to close the modal this link lives inside. */
  onNavigate?: () => void;
  children: ReactNode;
}) {
  return (
    <Link
      href={userHref(userId)}
      scroll={false}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onNavigate?.();
      }}
      className={className}
    >
      {children}
    </Link>
  );
}

/** The common case: a linked avatar next to a linked name. */
export function UserChip({
  userId,
  name,
  imageUrl,
  size = "sm",
  nameClassName = "font-semibold text-zinc-900 dark:text-zinc-100",
  onNavigate,
}: {
  userId: UUID;
  name: string;
  imageUrl: string | null;
  size?: "sm" | "lg";
  nameClassName?: string;
  onNavigate?: () => void;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <UserLink userId={userId} title={name} onNavigate={onNavigate}>
        <Avatar name={name} imageUrl={imageUrl} size={size} />
      </UserLink>
      <UserLink
        userId={userId}
        onNavigate={onNavigate}
        className={`min-w-0 truncate hover:underline ${nameClassName}`}
      >
        {name}
      </UserLink>
    </span>
  );
}
