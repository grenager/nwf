"use client";

import { PeopleListModal, type PersonRow } from "@/components/people-list-modal";
import type { LiveStoryReader } from "@/lib/use-story-readers";
import { relativeTime } from "@/lib/time";

interface ReadersModalProps {
  readers: LiveStoryReader[];
  onClose: () => void;
}

/** Who read this story, most recent first — reuses the parent's already-live
 * reader list (from useStoryReaders) rather than fetching a second copy. */
export function ReadersModal({ readers, onClose }: ReadersModalProps) {
  const people: PersonRow[] = readers.map((r) => ({
    user_id: r.user_id,
    display_name: r.display_name,
    image_url: r.image_url,
    subtitle: r.isLive
      ? "reading now"
      : `read ${relativeTime(r.last_read_at)}`,
  }));

  return (
    <PeopleListModal
      label="Who read this"
      title="Readers"
      loading={false}
      error={null}
      people={people}
      emptyMessage="No one has read this yet."
      onClose={onClose}
    />
  );
}
