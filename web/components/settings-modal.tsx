"use client";

import { ModalShell } from "@/components/modal-shell";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { Profile } from "@/lib/types";
import { useEffect, useState } from "react";

function Toggle({
  on,
  disabled,
  label,
  onChange,
}: {
  on: boolean;
  disabled: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-[9999px] transition-colors disabled:opacity-60 ${
        on ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-[9999px] bg-white shadow transition-transform ${
          on ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {title}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
      </div>
      {children}
    </div>
  );
}

/**
 * Account settings, lifted off the profile so the profile can be about the
 * person. Two email switches do not earn a route of their own — a sheet keeps
 * the viewer where they were.
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { notify } = useToast();
  const [me, setMe] = useState<Profile | null>(null);
  const [savingDigest, setSavingDigest] = useState<boolean>(false);
  const [savingInstant, setSavingInstant] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getMe()
      .then((mine) => {
        if (!cancelled) setMe(mine);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleDigest(): Promise<void> {
    if (!me) return;
    const next: boolean = !me.digest_opt_out;
    setSavingDigest(true);
    // Optimistic update; revert on failure.
    setMe({ ...me, digest_opt_out: next });
    try {
      const updated: Profile = await api.updatePreferences({
        digest_opt_out: next,
      });
      setMe(updated);
      notify(
        next
          ? "Daily digest emails turned off"
          : "Daily digest emails turned on",
        "success",
      );
    } catch (err) {
      setMe({ ...me, digest_opt_out: !next });
      notify(
        err instanceof ApiError ? err.message : "Could not update preference",
        "error",
      );
    } finally {
      setSavingDigest(false);
    }
  }

  async function toggleInstant(): Promise<void> {
    if (!me) return;
    const next: boolean = !me.instant_email_opt_out;
    setSavingInstant(true);
    setMe({ ...me, instant_email_opt_out: next });
    try {
      const updated: Profile = await api.updatePreferences({
        instant_email_opt_out: next,
      });
      setMe(updated);
      notify(
        next
          ? "Instant activity emails turned off"
          : "Instant activity emails turned on",
        "success",
      );
    } catch (err) {
      setMe({ ...me, instant_email_opt_out: !next });
      notify(
        err instanceof ApiError ? err.message : "Could not update preference",
        "error",
      );
    } finally {
      setSavingInstant(false);
    }
  }

  return (
    <ModalShell onClose={onClose} label="Settings" padded={false}>
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 p-5 pb-4 dark:border-zinc-800">
        <h2 className="font-serif text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Settings
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

      <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          Email notifications
        </h3>

        {me === null ? (
          <p className="mt-4 text-sm text-zinc-400">Loading…</p>
        ) : (
          <div className="mt-4 space-y-5">
            <Row
              title="Daily digest"
              description="A once-daily email with new posts and activity from your friends."
            >
              <Toggle
                on={!me.digest_opt_out}
                disabled={savingDigest}
                label="Toggle daily digest emails"
                onChange={() => void toggleDigest()}
              />
            </Row>
            <Row
              title="Instant activity emails"
              description="Get an email right away when a friend posts, comments on your article, or replies to you."
            >
              <Toggle
                on={!me.instant_email_opt_out}
                disabled={savingInstant}
                label="Toggle instant activity emails"
                onChange={() => void toggleInstant()}
              />
            </Row>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
