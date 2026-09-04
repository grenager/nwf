"use client";

import type { Profile, StandardsNudge } from "@/lib/types";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface StandardsValue {
  nudge: StandardsNudge | null;
  me: Profile | null;
}

interface StandardsStore {
  value: StandardsValue | null;
  publish: (value: StandardsValue | null) => void;
}

const StandardsContext = createContext<StandardsStore>({
  value: null,
  publish: () => undefined,
});

/**
 * Carries the feed's nudge up to the app shell.
 *
 * The strip is drawn outside the feed column so it can span the full window,
 * which puts it above the component that knows what to ask for. Rather than
 * have the shell fetch the feed a second time, the feed publishes what it
 * already has and the shell reads it. Nothing publishes on other pages, so
 * the strip is absent there — which is right: the ask belongs where a member
 * is reading, not on their profile form.
 */
export function StandardsProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<StandardsValue | null>(null);
  const store: StandardsStore = useMemo(
    () => ({ value, publish: setValue }),
    [value],
  );
  return (
    <StandardsContext.Provider value={store}>
      {children}
    </StandardsContext.Provider>
  );
}

/** Read the current ask, for whoever is drawing it. */
export function useStandardsValue(): StandardsValue | null {
  return useContext(StandardsContext).value;
}

/**
 * Publish this page's ask, and withdraw it on the way out so it cannot
 * outlive the feed and strand a strip on an unrelated page.
 *
 * ``ready`` is what separates "the server has no ask for you" from "the
 * server has not answered yet". Both are a null nudge, and a null nudge is
 * exactly the condition under which the client-only home-screen ask applies
 * — so without this an unanswered feed looks like permission to guess, and
 * on iOS the pin strip appeared during every load and on every page that
 * publishes nothing at all.
 */
export function usePublishStandards(
  nudge: StandardsNudge | null,
  me: Profile | null,
  ready: boolean,
): void {
  const { publish } = useContext(StandardsContext);
  useEffect(() => {
    if (!ready) return;
    publish({ nudge, me });
    return () => publish(null);
  }, [nudge, me, ready, publish]);
}
