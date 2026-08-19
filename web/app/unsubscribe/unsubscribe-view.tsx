"use client";

import { BrandMark } from "@/components/brand-mark";
import Link from "next/link";
import { useEffect, useState } from "react";

const API_URL: string = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Status = "loading" | "ok" | "error";

type UnsubscribeBody = {
  ok?: boolean;
  message?: string;
  detail?: string;
};

type Props = {
  /** API path under /email, e.g. "unsubscribe" or "unsubscribe/invite". */
  endpoint: string;
  token: string;
  fallbackMessage: string;
  /** When true, forwards the page's ?scope= query param to the API. */
  forwardScope?: boolean;
};

export function UnsubscribeView({
  endpoint,
  token,
  fallbackMessage,
  forwardScope = false,
}: Props): JSX.Element {
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Invalid unsubscribe link.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Read the scope from location rather than useSearchParams so this page
        // stays statically renderable.
        const scope: string | null = forwardScope
          ? new URLSearchParams(window.location.search).get("scope")
          : null;
        const query: string = scope
          ? `?scope=${encodeURIComponent(scope)}`
          : "";
        const resp: Response = await fetch(
          `${API_URL}/email/${endpoint}/${encodeURIComponent(token)}${query}`,
          { method: "POST" },
        );
        const body: UnsubscribeBody = (await resp
          .json()
          .catch(() => ({}))) as UnsubscribeBody;
        if (cancelled) return;
        if (!resp.ok) {
          setStatus("error");
          setMessage(
            typeof body.detail === "string"
              ? body.detail
              : "This unsubscribe link is invalid or expired.",
          );
          return;
        }
        setStatus("ok");
        setMessage(body.message ?? fallbackMessage);
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("Something went wrong. Please try again later.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint, token, fallbackMessage, forwardScope]);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-6 py-16">
      <p className="flex items-center gap-2 font-serif text-2xl text-zinc-900">
        <BrandMark className="h-7 w-7 text-brand-600" />
        NewsWithFriends
      </p>
      <h1 className="mt-6 font-serif text-3xl text-zinc-900">
        {status === "loading"
          ? "Unsubscribing…"
          : status === "ok"
            ? "Unsubscribed"
            : "Could not unsubscribe"}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-zinc-600">
        {status === "loading" ? "One moment." : message}
      </p>
      <p className="mt-8">
        <Link
          href="/"
          className="text-sm font-semibold uppercase tracking-wider text-zinc-900 underline-offset-4 hover:underline"
        >
          Back to NewsWithFriends
        </Link>
      </p>
    </main>
  );
}
