"use client";

import { Avatar } from "@/components/avatar";
import { FriendProfileModal } from "@/components/friend-profile-modal";
import { ModalShell } from "@/components/modal-shell";
import type { UUID } from "@/lib/types";
import { useState } from "react";

export interface PersonRow {
  user_id: UUID;
  display_name: string;
  image_url: string | null;
  /** Pre-formatted by the caller, e.g. "3h ago" or "❤️ Love · 3h ago". */
  subtitle: string;
}

interface PeopleListModalProps {
  label: string;
  title: string;
  loading: boolean;
  error: string | null;
  people: PersonRow[];
  emptyMessage: string;
  onClose: () => void;
}

/**
 * Flat list of people (readers, reactors, ...) in a modal; tapping a row
 * opens their profile on top. Presentational only — callers own fetching.
 */
export function PeopleListModal({
  label,
  title,
  loading,
  error,
  people,
  emptyMessage,
  onClose,
}: PeopleListModalProps) {
  const [openProfileId, setOpenProfileId] = useState<UUID | null>(null);

  return (
    <ModalShell onClose={onClose} label={label}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="font-serif text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-700"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {error !== null ? (
        <p className="text-sm text-zinc-500">{error}</p>
      ) : loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : people.length === 0 ? (
        <p className="text-sm text-zinc-500">{emptyMessage}</p>
      ) : (
        <ul className="space-y-3">
          {people.map((person) => (
            <li key={person.user_id}>
              <button
                type="button"
                onClick={() => setOpenProfileId(person.user_id)}
                className="flex w-full items-center gap-2 text-left"
              >
                <Avatar name={person.display_name} imageUrl={person.image_url} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {person.display_name}
                  </span>
                  <span className="block truncate text-xs text-zinc-400">
                    {person.subtitle}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {openProfileId ? (
        <FriendProfileModal
          friendId={openProfileId}
          onClose={() => setOpenProfileId(null)}
        />
      ) : null}
    </ModalShell>
  );
}
