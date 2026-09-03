# Project conventions

## Modals (web/)

Every modal is built on `web/components/modal-shell.tsx` (`ModalShell`). By
default (`padded={true}`) it wraps all children in a single scrolling area,
which means a title, close button, or bottom action button scrolls away with
the rest of the content on small screens — don't use that default for any
modal whose content can grow past the viewport.

Instead, pass `padded={false}` and lay out the panel yourself as siblings:

```tsx
<ModalShell onClose={onClose} label="..." padded={false}>
  <div className="shrink-0 border-b ...">{/* title + close button */}</div>
  <div className="min-h-0 flex-1 overflow-y-auto ...">{/* scrolling content */}</div>
  <div className="shrink-0 border-t ...">{/* primary action button(s), if any */}</div>
</ModalShell>
```

- The header (title/close) is always pinned this way.
- Only add the pinned footer when there's a critical action button (submit,
  primary CTA) — purely informational modals don't need one.
- See `post-detail-modal.tsx`, `friend-profile-modal.tsx`, and
  `add-story-modal.tsx` for worked examples, including the form case where
  the pinned footer's submit button still needs to live inside the `<form>`.

This is the default for every new modal, not just the ones with obviously
long content — short content today can grow later.

## Database migrations (backend/)

Default to expand/contract: a feature migration only adds — new tables,
new columns, new allowed values, widened constraints. It never drops,
narrows, or renames something existing code still depends on. This matters
because migrations and code deploys don't land atomically — a migration
applied ahead of the code that stops depending on the old shape will break
whatever's still running in production against it.

Schema cleanup (dropping an old table/column, narrowing a constraint back
down, a breaking rename) is its own separate migration, not folded into the
feature migration that retires the old code paths. Name it as a cleanup
(e.g. `..._retire_story_ratings.sql`, not bundled into
`..._add_reactions.sql`), call out explicitly that it's destructive/
irreversible, and only apply it once the code that stops depending on the
old shape is confirmed deployed everywhere — not just merged.

## Running backend scripts (backend/)

Run the one-off scripts in `backend/scripts/` with `uv run`, from the
`backend/` directory:

```bash
uv run python -m scripts.seed_pymk_test --list-users
uv run python -m scripts.seed_pymk_test --user-email me@example.com
uv run python -m scripts.seed_pymk_test --clear
```

The working directory matters twice over: it's what makes `core` and
`scripts` importable as modules, and `backend/.env` is read relative to it,
so running from the repo root silently falls back to the default localhost
`DATABASE_URL`.

Note that these scripts are not in the deployed image — the Dockerfile
copies only `core`, `api` and `digest` — so they can't be run inside a
Railway container. They run from a local checkout, pointed at whichever
database `DATABASE_URL` names.

That makes it easy to hit the wrong database, and these scripts write real
rows. Two things worth knowing:

- An exported `DATABASE_URL` in the shell **overrides** `backend/.env`, so a
  leftover local-Supabase value silently wins over the production one (and
  vice versa).
- Start with the script's read-only mode (`--list-users`, `--dry-run`) and
  check the output names accounts you recognise before running anything that
  writes.

Seed scripts create their accounts under the reserved `seed.test` email
domain, each with its own local-part namespace (`pymk.`, `fof.`), so one
script's `--clear` leaves the others alone. `scripts/purge_seed_users.py`
deletes every `seed.test` account outright, and defaults to a dry run.

## Git workflow

- Start each new chat/session's work on a fresh feature branch cut from the
  latest `main` (`git fetch origin main && git checkout -b <branch>
  origin/main`) rather than continuing on whatever branch happens to be
  checked out — unless the session has been handed a specific branch to
  work on, in which case follow that instead.
- Once the bulk of a change is done and ready for the user to try, open a
  PR by default rather than waiting to be asked. That's also the point
  Railway starts a preview deploy the user can actually click into.
- After opening or updating a PR, hand the user its Railway preview URL(s)
  as a convenience — don't make them go dig for them. They're on the PR's
  status checks (the `nwf-api` / `nwf-web` / `nwf-digest` contexts'
  `target_url`/description once each build succeeds).
