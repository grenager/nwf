import { InviteLandingClient } from "@/app/invite/[token]/invite-landing";
import type { InvitePreview } from "@/lib/types";
import type { Metadata } from "next";

const API_URL: string = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface PageProps {
  params: Promise<{ token: string }>;
}

async function fetchInvitePreview(token: string): Promise<InvitePreview | null> {
  try {
    const resp: Response = await fetch(
      `${API_URL}/invitations/${encodeURIComponent(token)}`,
      { next: { revalidate: 60 } },
    );
    if (!resp.ok) return null;
    return (await resp.json()) as InvitePreview;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const preview = await fetchInvitePreview(token);

  if (!preview) {
    return {
      title: "Invitation · NewsWithFriends",
      description: "Join a conversation on NewsWithFriends.",
    };
  }

  const title: string =
    preview.headline?.trim() || "A conversation on NewsWithFriends";
  const description: string =
    preview.take?.trim() ||
    preview.message?.trim() ||
    `${preview.inviter_name} wanted to discuss this article with you`;
  const images: string[] = preview.image_url ? [preview.image_url] : [];

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      images,
      siteName: "NewsWithFriends",
    },
    twitter: {
      card: images.length > 0 ? "summary_large_image" : "summary",
      title,
      description,
      images,
    },
  };
}

export default async function InvitePage({ params }: PageProps) {
  const { token } = await params;
  return <InviteLandingClient token={token} />;
}
