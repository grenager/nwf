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
