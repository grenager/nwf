"use client";

import { Avatar } from "@/components/avatar";
import { SourceLogo } from "@/components/source-logo";
import { UserLink } from "@/components/user-link";
import { api, ApiError } from "@/lib/api";
import { stripHtml } from "@/lib/html";
import { relativeTime } from "@/lib/time";
import type { SourceDetail, SourcePost } from "@/lib/types";
import Link from "next/link";
import { useEffect, useState } from "react";

function replyLabel(count: number): string {
  if (count === 0) return "no replies yet";
  return `${count} ${count === 1 ? "reply" : "replies"}`;
}

/** One conversation about an article from this source. */
function SourcePostRow({ post }: { post: SourcePost }) {
  return (
    <article className="flex gap-3 py-4">
      {post.image_url ? (
        <Link href={`/post/${post.post_id}`} scroll={false} className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.image_url}
            alt=""
            className="h-20 w-20 object-cover"
          />
        </Link>
      ) : null}
      <div className="min-w-0 flex-1">
        <Link
          href={`/post/${post.post_id}`}
          scroll={false}
          className="font-serif text-[1.05rem] font-semibold leading-snug tracking-tight text-zinc-900 hover:underline dark:text-zinc-50"
        >
          {post.full_headline}
        </Link>
        {post.take || post.summary ? (
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            {post.take ? post.take : stripHtml(post.summary ?? "").slice(0, 280)}
          </p>
        ) : null}
        <div className="mt-1.5 flex items-center gap-2 text-[12px]">
          <span className="flex min-w-0 items-center gap-1.5">
            <UserLink userId={post.author_id} title={post.author_name}>
              <Avatar name={post.author_name} imageUrl={post.author_image_url} />
            </UserLink>
            <UserLink
              userId={post.author_id}
              className="min-w-0 truncate font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
            >
              {post.author_name}
            </UserLink>
          </span>
          <Link
            href={`/post/${post.post_id}`}
            scroll={false}
            className="shrink-0 whitespace-nowrap text-zinc-500 hover:underline"
          >
            {replyLabel(post.reply_count)}
          </Link>
          <span className="ml-auto shrink-0 whitespace-nowrap text-zinc-500">
            {relativeTime(post.created_at)}
          </span>
        </div>
      </div>
    </article>
  );
}

/**
 * Everything the viewer can see about one publication: who it is, and every
 * conversation their circle has had about its articles. Reached by clicking
 * the source line on any article card.
 */
export function SourceView({ host }: { host: string }) {
  const [source, setSource] = useState<SourceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSource(null);
    setError(null);
    void api
      .getSource(host)
      .then((data) => {
        if (active) setSource(data);
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof ApiError ? err.message : "Could not load this source",
        );
      });
    return () => {
      active = false;
    };
  }, [host]);

  if (error) {
    return <p className="py-10 text-sm text-zinc-500">{error}</p>;
  }

  if (!source) {
    return <p className="py-10 text-sm text-zinc-500">Loading…</p>;
  }

  return (
    <>
      <header className="border-b border-zinc-200 pb-5 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <SourceLogo
            src={source.image_url}
            name={source.name}
            imgClassName="h-8 w-auto max-w-[200px] shrink-0 object-contain"
          />
          <div className="min-w-0">
            <h1 className="truncate font-serif text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              {source.name}
            </h1>
            <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
              <a
                href={source.homepage_url ?? `https://${source.host}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {source.host}
              </a>
              {source.post_count > 0
                ? ` · ${source.post_count} ${
                    source.post_count === 1 ? "conversation" : "conversations"
                  }`
                : null}
            </p>
          </div>
        </div>
      </header>

      {source.posts.length === 0 ? (
        <p className="py-10 text-sm text-zinc-500">
          No conversations about {source.name} yet — you and your friends
          haven&apos;t posted anything from here.
        </p>
      ) : (
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {source.posts.map((post) => (
            <SourcePostRow key={post.post_id} post={post} />
          ))}
        </div>
      )}
    </>
  );
}
