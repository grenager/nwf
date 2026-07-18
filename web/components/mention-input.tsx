"use client";

import { api } from "@/lib/api";
import type { FriendSummary } from "@/lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Mention,
  MentionsInput,
  type SuggestionDataItem,
} from "react-mentions";

/**
 * Markup persisted for a mention: `@[Display Name](user-uuid)`.
 * The backend parses the trailing uuid; MentionText renders the display name.
 */
export const MENTION_MARKUP: string = "@[__display__](__id__)";

// Friends are shared across every composer on the page, so load them once.
let friendCache: SuggestionDataItem[] | null = null;
let friendPromise: Promise<SuggestionDataItem[]> | null = null;

async function loadFriendSuggestions(): Promise<SuggestionDataItem[]> {
  if (friendCache !== null) return friendCache;
  if (friendPromise === null) {
    friendPromise = api
      .getFriends()
      .then((overview): SuggestionDataItem[] =>
        overview.friends.map(
          (friend: FriendSummary): SuggestionDataItem => ({
            id: friend.user_id,
            display: friend.display_name,
          }),
        ),
      )
      .catch((): SuggestionDataItem[] => []);
  }
  const loaded: SuggestionDataItem[] = await friendPromise;
  friendCache = loaded;
  return loaded;
}

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  singleLine?: boolean;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  inputRef?: React.Ref<HTMLTextAreaElement> | React.Ref<HTMLInputElement>;
}

// Inline styles: react-mentions positions an overlay highlighter behind the
// input, so the input must stay transparent and share the control's metrics.
const controlStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  lineHeight: "1.375rem",
};

// Sits in the highlighter layer behind the visible input text.
const highlightStyle: React.CSSProperties = {
  backgroundColor: "rgba(37, 99, 235, 0.18)",
  borderRadius: "0.2rem",
};

export function MentionInput({
  value,
  onChange,
  placeholder,
  singleLine = false,
  rows,
  autoFocus,
  disabled,
  className,
  onKeyDown,
  inputRef,
}: MentionInputProps) {
  const [friends, setFriends] = useState<SuggestionDataItem[]>(
    friendCache ?? [],
  );
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;
    void loadFriendSuggestions().then((loaded) => {
      if (mountedRef.current) setFriends(loaded);
    });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const filterFriends = useCallback(
    (
      query: string,
      callback: (data: SuggestionDataItem[]) => void,
    ): void => {
      const q: string = query.trim().toLowerCase();
      const matches: SuggestionDataItem[] = q
        ? friends.filter((f) =>
            String(f.display ?? "")
              .toLowerCase()
              .includes(q),
          )
        : friends;
      callback(matches.slice(0, 8));
    },
    [friends],
  );

  return (
    <MentionsInput
      value={value}
      onChange={(_event, newValue) => onChange(newValue)}
      placeholder={placeholder}
      singleLine={singleLine}
      rows={rows}
      autoFocus={autoFocus}
      disabled={disabled}
      onKeyDown={onKeyDown}
      inputRef={inputRef}
      className={`nwf-mentions ${className ?? ""}`}
      style={controlStyle}
      allowSuggestionsAboveCursor
      a11ySuggestionsListLabel="Suggested friends to mention"
    >
      <Mention
        trigger="@"
        data={filterFriends}
        markup={MENTION_MARKUP}
        displayTransform={(_id, display) => `@${display}`}
        appendSpaceOnAdd
        style={highlightStyle}
      />
    </MentionsInput>
  );
}
