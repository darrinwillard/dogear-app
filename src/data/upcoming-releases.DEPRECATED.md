# upcoming-releases.json — DEPRECATED

**Status:** Deprecated as of 2026-09-01.

This file was a hand-curated March 2026 snapshot used by the original Upcoming
Releases page. It is **no longer the live data source**.

## Live path

1. `POST /api/audible/releases` refreshes Audible catalog data into Supabase
   `series_releases` (series you actively follow + authors you've read).
2. `/upcoming` and the home dashboard read from `series_releases` via
   `src/lib/books/releases.ts`.

## Why this file still exists

Guest/demo mode still imports the JSON through `static-fallback.ts` so
unauthenticated visitors see *something*. Do not add new titles here expecting
them to show for signed-in users — they won't.

## Honest Audible limits

- Only titles Audible has listed (preorder or published) appear.
- Brand-new series announcements with no Audible SKU will not surface.
- Non-English catalog noise is filtered; some edge translations may still slip.
