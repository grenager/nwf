"use client";

import { BrandMark } from "@/components/brand-mark";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

const API_URL: string = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Status = "loading" | "ok" | "error";

export default function UnsubscribePage() {
  const params = useParams<{ token: string }>();
  const token: string = typeof params.token === "string" ? params.token : "";
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
        const resp: Response = await fetch(
          `${API_URL}/email/unsubscribe/${encodeURIComponent(token)}`,
          { method: "POST" },
        );
        const body: { ok?: boolean; message?: string; detail?: string } =
          (await resp.json().catch(() => ({}))) as {
            ok?: boolean;
            message?: string;
            detail?: string;
          };
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
        setMessage(
          body.message ??
            "You have been unsubscribed from daily digest emails.",
        );
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
  }, [token]);

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
