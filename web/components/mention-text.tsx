"use client";

import { userHref } from "@/lib/url";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

// Matches react-mentions markup `@[Display Name](user-uuid)`, or a bare URL.
const TOKEN_RE: RegExp =
  /@\[([^\]]+)\]\(([0-9a-fA-F-]{36})\)|(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g;

// Strips trailing punctuation (and any unbalanced closing bracket) that's
// more likely to be sentence punctuation than part of the URL itself.
function splitTrailingPunctuation(raw: string): { url: string; trailing: string } {
  let url = raw;
  let trailing = "";
  while (url.length > 0) {
    const lastChar = url[url.length - 1];
    if (".,!?;:'\"".includes(lastChar)) {
      trailing = lastChar + trailing;
      url = url.slice(0, -1);
      continue;
    }
    if (lastChar === ")" && !url.slice(0, -1).includes("(")) {
      trailing = lastChar + trailing;
      url = url.slice(0, -1);
      continue;
    }
    if (lastChar === "]" && !url.slice(0, -1).includes("[")) {
      trailing = lastChar + trailing;
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return { url, trailing };
}

/**
 * Render post takes / comment bodies, turning `@[Name](uuid)` mention markup
 * into links to that person's profile and bare URLs into clickable links,
 * while leaving all other text (and newlines) intact.
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
  TOKEN_RE.lastIndex = 0;
  let key = 0;

  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        <Fragment key={`t${key}`}>{text.slice(lastIndex, match.index)}</Fragment>,
      );
      key += 1;
    }

    const mentionDisplay = match[1];
    const mentionUserId = match[2];
    const rawUrl = match[3];

    if (mentionDisplay !== undefined) {
      nodes.push(
        <Link
          key={`m${key}`}
          href={userHref(mentionUserId)}
          scroll={false}
          onClick={(e) => e.stopPropagation()}
          className="font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
        >
          @{mentionDisplay}
        </Link>,
      );
      lastIndex = match.index + match[0].length;
    } else {
      const { url, trailing } = splitTrailingPunctuation(rawUrl);
      const href = url.startsWith("http") ? url : `https://${url}`;
      nodes.push(
        <a
          key={`u${key}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-zinc-900 dark:hover:text-zinc-100"
          onClick={(e) => e.stopPropagation()}
        >
          {url}
        </a>,
      );
      lastIndex = match.index + match[0].length - trailing.length;
    }
    key += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(<Fragment key={`t${key}`}>{text.slice(lastIndex)}</Fragment>);
  }

  return (
    <span className={`[overflow-wrap:anywhere] ${className ?? ""}`}>
      {nodes}
    </span>
  );
}
