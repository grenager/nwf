"use client";

import {
  clearDraft,
  draftsEqual,
  EMPTY_DRAFT,
  peekDraft,
  pruneExpiredDrafts,
  publishDraft,
  readDraft,
  subscribeToDraft,
  writeDraft,
  type DraftValue,
} from "@/lib/drafts";
import type { UUID } from "@/lib/types";
import { useCallback, useEffect, useRef, useState } from "react";

/** Coalesce keystrokes into one write instead of hitting storage per character. */
const WRITE_DEBOUNCE_MS: number = 400;

let prunedThisSession: boolean = false;

export interface UsePersistedDraftResult {
  /** Current draft text. Always defined; empty string when there is no draft. */
  readonly text: string;
  /** The comment this draft replies to, or null for a top-level reply. */
  readonly parentCommentId: UUID | null;
  readonly setText: (text: string) => void;
  readonly setParentCommentId: (parentCommentId: UUID | null) => void;
  /** Drop the draft from state and storage — call after a successful submit. */
  readonly clear: () => void;
}

/**
 * A composer draft that survives navigating away, closing a modal, or a reload.
 *
 * Restore happens in an effect rather than during render so the server and first
 * client render agree. Pass ``key === null`` (e.g. for a guest who cannot post) to
 * disable persistence entirely.
 */
export function usePersistedDraft(key: string | null): UsePersistedDraftResult {
  const [draft, setDraft] = useState<DraftValue>(EMPTY_DRAFT);

  // Mirrors `draft` synchronously so the setters can build the next value without
  // waiting for a re-render.
  const draftRef = useRef<DraftValue>(EMPTY_DRAFT);
  // What we believe is in storage for `key`, so we never write it straight back.
  const syncedRef = useRef<{ key: string; draft: DraftValue } | null>(null);
  const pendingRef = useRef<{ key: string; draft: DraftValue } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback((next: DraftValue): void => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const flush = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending === null) return;
    pendingRef.current = null;
    writeDraft(pending.key, pending.draft);
    syncedRef.current = pending;
  }, []);

  useEffect(() => {
    if (key === null) {
      syncedRef.current = null;
      apply(EMPTY_DRAFT);
      return;
    }
    if (syncedRef.current?.key === key) return;
    if (!prunedThisSession) {
      prunedThisSession = true;
      pruneExpiredDrafts();
    }
    // Prefer the in-memory value: a sibling composer may hold edits that the
    // debounced write has not flushed to storage yet.
    const restored: DraftValue = peekDraft(key) ?? readDraft(key) ?? EMPTY_DRAFT;
    syncedRef.current = { key, draft: restored };
    apply(restored);
  }, [key, apply]);

  // Keep composers for the same scope in step — the feed card and the
  // intercepting `/post/[id]` modal are mounted at the same time.
  useEffect(() => {
    if (key === null) return;
    return subscribeToDraft(key, (next: DraftValue): void => {
      if (draftsEqual(draftRef.current, next)) return;
      apply(next);
    });
  }, [key, apply]);

  useEffect(() => {
    if (key === null) return;
    const synced = syncedRef.current;
    // Restore for this key has not landed yet, or storage already matches.
    if (synced === null || synced.key !== key) return;
    if (draftsEqual(synced.draft, draft)) return;
    pendingRef.current = { key, draft };
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, WRITE_DEBOUNCE_MS);
  }, [key, draft, flush]);

  // A debounced write would otherwise be lost when the tab is hidden, the page
  // unloads, or the composer unmounts mid-sentence.
  useEffect(() => {
    function onHide(): void {
      if (document.visibilityState === "hidden") flush();
    }
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  const setText = useCallback(
    (text: string): void => {
      const prev: DraftValue = draftRef.current;
      if (prev.text === text) return;
      const next: DraftValue = { ...prev, text };
      apply(next);
      if (key !== null) publishDraft(key, next);
    },
    [key, apply],
  );

  const setParentCommentId = useCallback(
    (parentCommentId: UUID | null): void => {
      const prev: DraftValue = draftRef.current;
      if (prev.parentCommentId === parentCommentId) return;
      const next: DraftValue = { ...prev, parentCommentId };
      apply(next);
      if (key !== null) publishDraft(key, next);
    },
    [key, apply],
  );

  const clear = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    apply(EMPTY_DRAFT);
    if (key === null) return;
    clearDraft(key);
    syncedRef.current = { key, draft: EMPTY_DRAFT };
    publishDraft(key, EMPTY_DRAFT);
  }, [key, apply]);

  return {
    text: draft.text,
    parentCommentId: draft.parentCommentId,
    setText,
    setParentCommentId,
    clear,
  };
}
