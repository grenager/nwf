"use client";

import { Fragment, type ReactNode } from "react";

// Matches react-mentions markup: `@[Display Name](user-uuid)`.
const MENTION_RE: RegExp =
  /@\[([^\]]+)\]\(([0-9a-fA-F-]{36})\)/g;

/**
 * Render post takes / comment bodies, turning `@[Name](uuid)` mention markup
 * into styled labels while leaving all other text (and newlines) intact.
 */
export function MentionText({
  text,
  className,
}: {
  text: string | null;
  className?: string;
}) {
  if (!text) return null;

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  MENTION_RE.lastIndex = 0;
  let key = 0;

  while ((match = MENTION_RE.exec(text)) !== null) {
    const display: string = match[1];
    if (match.index > lastIndex) {
      nodes.push(
        <Fragment key={`t${key}`}>{text.slice(lastIndex, match.index)}</Fragment>,
      );
      key += 1;
    }
    nodes.push(
      <span
        key={`m${key}`}
        className="font-semibold text-brand-600 dark:text-brand-400"
      >
        @{display}
      </span>,
    );
    key += 1;
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(<Fragment key={`t${key}`}>{text.slice(lastIndex)}</Fragment>);
  }

  return <span className={className}>{nodes}</span>;
}
