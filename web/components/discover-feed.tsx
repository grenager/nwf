"use client";

import { AddStoryModal } from "@/components/add-story-modal";
import { useAuthGate } from "@/components/auth-gate";
import { DiscoverCard } from "@/components/discover-card";
import type { Post, Story } from "@/lib/types";
import { useState } from "react";

interface DiscoverFeedProps {
  stories: Story[];
  isGuest: boolean;
  heading?: string;
  onPostCreated?: (post: Post) => void;
}

export function DiscoverFeed({
  stories,
  isGuest,
  heading = "Articles to discuss with friends",
  onPostCreated,
}: DiscoverFeedProps) {
  const { requireAuth } = useAuthGate();
  const [composeStory, setComposeStory] = useState<Story | null>(null);

  if (stories.length === 0) return null;

  return (
    <>
      <section className="mt-6">
        <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          {heading}
        </h2>
        <p className="mb-2 text-sm text-zinc-500 dark:text-zinc-400">
          Pick an article and start a private conversation with your friends.
        </p>
        <div>
          {stories.map((story) => (
            <DiscoverCard
              key={story.id}
              story={story}
              isGuest={isGuest}
              onSignIn={() => {
                requireAuth("start a private conversation");
              }}
              onStartConversation={setComposeStory}
            />
          ))}
        </div>
      </section>

      {composeStory !== null ? (
        <AddStoryModal
          story={composeStory}
          onClose={() => setComposeStory(null)}
          onAdded={(post) => {
            onPostCreated?.(post);
            setComposeStory(null);
          }}
        />
      ) : null}
    </>
  );
}
