"use client";

import type { UUID } from "@/lib/types";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A person's name as a link to their profile. Used everywhere a name is
 * rendered so names behave consistently — the viewer can always tap a name to
 * find out who someone is, which matters most for the people they aren't
 * connected to yet. The profile page itself decides what a non-connection is
 * allowed to see.
 *
 * `className` carries the caller's existing type styling; the link only adds
 * the hover underline, so dropping this in never changes how a name looks at
 * rest.
 */
export function PersonLink({
  userId,
  className = "",
  children,
  onClick,
}: {
  userId: UUID;
  className?: string;
  children: ReactNode;
  /** e.g. close the modal the name was rendered inside. */
  onClick?: () => void;
}) {
  return (
    <Link
      href={`/user/${userId}`}
      onClick={onClick}
      className={`${className} hover:underline`}
    >
      {children}
    </Link>
  );
}
