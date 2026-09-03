# Discovery Search — Build Plan (v2)

**Date:** 2026-09-03 (revised from v1 same day, post-review + post-decision)
**App:** DogEar (`dogear-app`, Next.js 14 / Supabase / Audible)
**Mode:** Builder — decision to build is made; this is the implementation plan
**Closest analog:** "Find Your Next Read" gap-detection (`gaps.ts` + `GapsClient` + `/api/books/gaps`)
**Status of this revision:** Incorporates Darrin's explicit ratings-hierarchy decision + all 4 major / 3 minor adversarial review findings. See "What changed from v1" below before reading the rest.

---

## What changed from v1 (read this first)

| # | v1 said | v2 says | Why |
|---|---------|---------|-----|
| 1 | Ratings source = Open Library only; Goodreads excluded (dead API / ToS) | **Ratings hierarchy: Audible `rating` (primary) → Goodreads scrape (secondary, richer) → Open Library dropped as a ratings source entirely.** OL may still be kept as a broad print/ebook discovery catalog if useful, but it no longer supplies ratings. | Darrin's explicit decision. Single-user app; he accepts the ToS/fragility tradeoff for Goodreads scraping at his usage scale, run infrequently. |
| 2 | `RawSimilarities`, `response_groups=rating`, `goodreads_ratings` were all lumped together in an Appendix C "Live verification log" as if verified | **Split into two different confidence tiers.** Audible `rating` response group: well-corroborated (mkb79 docs + working Python/C# client libraries + real user reports), but **still unverified in this repo's client** — verify before claiming done (see Research Findings §1). `RawSimilarities` / `goodreads_ratings`: still **completely unverified**, unchanged confidence, Phase 0 hard-gate still required (F1, unchanged). | Review F1 + Darrin's explicit instruction not to conflate these two claims. |
| 3 | No Goodreads scraping section existed | **New §2 in Research Findings + new Phase 1.5b** covering scrape design: no login required (verified live), search-by-title-then-scrape-detail-page pattern, weekly cadence folded into existing `releases-refresh.ts` resync, new `books` columns, graceful degradation on HTML/WAF failure. | Darrin's decision + explicit design constraints he gave. |
| 4 | Phase 1 shipped a read-only Discover page; Phase 1.5 (Want button / ASIN bridge) was a separate, optional-feeling follow-up | **Phase 1 and 1.5 are merged into one deliverable.** No card ships without a real, complete action — "Open externally" is the day-one CTA for unbridgeable hits, not a disabled/blocked Want button. | Review F2 (major), fixed as required. |
| 5 | Token-refresh pattern from `gaps/route.ts` was to be "copied" into new routes | **Extracted into a shared, hardened helper first** (`refreshAudibleAccessToken`) with `res.ok` check, guarded JSON parsing, typed 401 response, and a fetch timeout added to `audibleGet`. Built once, before Phase 1.5b/2 reuse it. | Review F3 (major), fixed as required. |
| 6 | Ratings-thinness concern (F4) deferred Hardcover to "Phase 3, optional" with no resolution path | **Explicitly re-assessed: F4 is resolved by the new hierarchy, not deferred.** Audible `rating` (dense for audiobooks) + Goodreads (dense for everything, real counts in the hundreds of thousands) replace Open Library's "dozens–low hundreds" problem. Hardcover drops out of the plan entirely — no longer needed as a stopgap. See Research Findings §4. | Darrin's decision + review F4, now addressed by the ratings hierarchy change itself. |
| 7 | Minor findings F5 (OL User-Agent / rating-count anomaly / subject noise), F6 (gaps.ts rate-limit maturity overstated), F7 (Hardcover phase inconsistency, DiscoveryHit.id dual-namespace, `books.genre` reliability) | **Each addressed or explicitly deferred with reasoning** — see "Minor findings disposition" below. | Review requirement: "not optional." |

### Minor findings disposition

- **F5 (OL operational hand-waving):** Partially moot — OL is no longer a ratings source, which removes the rating-count-anomaly and subject-noise concerns from the ratings-critical path. If OL is kept as a broad discovery catalog (Decision #2 below), the User-Agent header requirement still applies — one line in `open-library.ts`. **Addressed** (scope reduced by the hierarchy change; remaining piece is trivial).
- **F6 (gaps.ts rate-limit maturity overstated):** Accepted as accurate. This plan does **not** claim `gaps.ts`'s sequential catch-and-continue loop is real backoff/429 handling. Goodreads scraping (new, higher ToS/fragility risk than Audible) gets its own stricter throttle + circuit breaker, not a copy of the Gaps pattern. **Addressed** with a stronger standard for the new, riskier code path.
- **F7a (Hardcover phase inconsistency):** Moot — Hardcover is dropped from the plan entirely per the new ratings hierarchy (see change #6 above). **Resolved by removal.**
- **F7b (`DiscoveryHit.id` dual namespace):** **Addressed.** `DiscoveryHit.id` is now explicitly the normalized `title+author` dedupe key (a stable derived string), with `asin`, `olid`, and `goodreadsId` carried as separate optional fields. No more silent dupes across sources.
- **F7c (`books.genre` reliability):** **Verified, not resolved by wishful thinking.** Confirmed live in `queries.ts`: `genre` is a real column returned in `BOOK_EMBED`, but it does **not** appear in any of the 5 migration files (001–005) — it was added out-of-band (schema drift) and the `types.ts` comment already flags it as "falls back to series heuristic," i.e., frequently null or guessed. Plan explicitly treats an OL/Goodreads-derived subject/genre lookup as the *primary* signal for the Similar flow's genre leg, `books.genre` as a weak secondary hint only — not the reverse, as v1 implied.

---

## Decisions (top)

| # | Decision | Choice |
|---|----------|--------|
| 1 | **Ratings hierarchy** | **Audible `rating` response group (primary) → Goodreads scrape (secondary, richer counts) → no Open Library ratings.** Order reflects confidence + integration cost: Audible reuses the existing authed client and is well-corroborated externally; Goodreads requires new scrape infra but has much deeper data; a hit shows whichever is available, preferring Audible when both exist for the same title (Audible rating is audiobook-specific and closer to what Darrin listens to) — surfaced together when both exist ("Audible ★4.6 · Goodreads ★4.51 (1.85M)"). |
| 2 | **Open Library** | **Demoted, not deleted.** Kept only as an optional broad print/ebook discovery catalog (title/author/subject search, no ratings) if Phase 1 needs a non-Audible-gated way to browse beyond the library. Not required for ratings; can be cut entirely from v1 scope if Goodreads + Audible together cover discovery adequately (see Phase 1 acceptance check). |
| 3 | **Goodreads scraping** | **In scope.** Single-user app, infrequent (weekly, piggybacking on existing `releases-refresh.ts` cadence), no login/account required (verified live — see Research Findings §2), search-then-scrape-detail-page pattern (not bulk export), must degrade gracefully on structure change or bot-challenge (keep last-known rating, never break the feature). |
| 4 | **"Similar to…" engine (v1)** | **Hybrid, confidence-tiered:** Audible `RawSimilarities` (Phase 0 hard-gated — real spike against a live token before any code depends on it) + author/subject overlap (subject sourced from Goodreads/OL lookup, not `books.genre`) + min-rating filter using the new hierarchy. |
| 5 | **Hardcover.app** | **Dropped from the plan.** Was v1's answer to "OL ratings feel thin" (F4). That problem is now solved by Audible + Goodreads, which have far denser real-world rating counts than OL ever offered. No GraphQL client, no beta-API dependency, no server token to manage. |
| 6 | **Google Books** | **Skip as primary** (unchanged from v1) — ratings sparse/unreliable; needs API key; quota friction. |
| 7 | **StoryGraph** | **Skip** (unchanged from v1) — no public API. |
| 8 | **UI home** | Replace stub `/search` with real Discovery page; keep library-local search as a tab. (unchanged) |
| 9 | **Persistence** | **New:** `books` table gets `goodreads_rating`, `goodreads_ratings_count`, `goodreads_url`, `goodreads_synced_at` columns (weekly-refreshed cache — this is a live requirement now, not "optional cache table only if pain appears" as in v1, because per-page-view scraping is explicitly disallowed by Darrin's design constraints). Discovery *hits* (non-owned books) remain on-demand/no persistence, matching Gaps. |
| 10 | **Token-refresh pattern** | **New:** Extract to a shared, hardened helper (`refreshAudibleAccessToken`) before any new route reuses it. Add fetch timeout to `audibleGet`. Fix once, use everywhere (F3). |
| 11 | **Ship shape** | **Revised:** Phase 1 + 1.5 merge into one deliverable (no half-finished blocked-Want state ships) (F2). Otherwise still incremental, each phase shippable in one sitting like Gaps. |

---

## Research Findings

### 1. Audible `response_groups=rating` — corroborated externally, unverified in this repo (verify, don't assume)

**Checked live in this repo, 2026-09-03:** `AUDIBLE_CATALOG_RESPONSE_GROUPS` in `src/lib/books/audible-catalog.ts` is:

```
contributors, media, product_attrs, product_desc, product_extended_attrs, series, product_details
```

`rating` is **not** in this list, and does not appear anywhere else in `audible-catalog.ts`, `gaps.ts`, or `releases-refresh.ts`. **This confirms the review's F1 finding stands for this specific claim in this specific repo: it is not yet wired in, full stop.**

External corroboration is meaningfully stronger than `RawSimilarities`/`goodreads_ratings`, though:

| Source | Signal |
|--------|--------|
| mkb79/Audible docs (`audible.readthedocs.io`) | Documents `response_groups=rating` returning a `rating` object with `overall_distribution`, `num_ratings`, `display_average_rating` |
| Independent client libraries (Python `audible`, community C# clients) | Multiple unrelated projects implement and use this response group in working code, not just docs-copy |
| Real user reports (Reddit r/audible, r/AudiblePairs threads) | Users report seeing/parsing star ratings pulled via the unofficial API in home-grown scripts |

**This is genuinely more solid evidence than a single docs page** — three independent lines (docs + working code + user reports) rather than one. But "solid evidence it exists as a documented/used field elsewhere" ≠ "wired into this repo." Treat as: **high confidence it will work when added, zero confidence until a real call against a live token in this codebase confirms the shape** (same discipline as everything else — see Phase 0).

**Action:** Add `rating` to `AUDIBLE_CATALOG_RESPONSE_GROUPS` (or a new constant used only where ratings are wanted, to avoid bloating every existing call) and do a real probe in Phase 0 alongside the `RawSimilarities` spike. Confirm the actual response shape (`display_average_rating` vs `overall_distribution.average_rating` — docs are inconsistent on exact field naming across API versions) before wiring `normalizeCatalogProduct`.

### 2. Goodreads scraping — verified live, no login required, but actively rate-limited by AWS WAF

Live verification performed 2026-09-03 (this session, not carried over from v1):

| Check | Result |
|-------|--------|
| Direct book page, first request | `GET https://www.goodreads.com/book/show/54493401-project-hail-mary` → **HTTP 200**, no login wall, full page content including reviews text |
| Ratings data location | Clean **`<script type="application/ld+json">`** block: `{"@type":"Book", ..., "aggregateRating":{"@type":"AggregateRating","ratingValue":4.51,"ratingCount":1850217,"reviewCount":256924}}` — **this is a far more stable scrape target than CSS-class div scraping** (schema.org structured data, less likely to churn than presentational markup) |
| Redundant confirmation | Also present as plain inline JS vars `"ratingValue":4.51` / `"ratingCount":1850217` and a human-readable `RatingStatistics__rating` div — three independent places to extract the same number, giving fallback options if one breaks |
| Search endpoint (`/search?q=...`) | **HTTP 202 with `x-amzn-waf-action: challenge`** on the very next request (same session, same host) — AWS WAF bot-challenge, no page content returned |
| Repeat request to the *same* book-detail URL that worked | Also came back **202/challenged** on retry — confirms this is a live, active anti-bot system that engages quickly under repeated automated access, not a one-off search-only restriction |
| External corroboration | A live GitHub issue (`grimmory-tools/grimmory#1335`, May 2026): *"Goodreads is now more aggressively blocking unauthenticated scraping of their metadata search... search fails with an AWS WAF page"* but **"lookup via ISBN is still safe."** Multiple 2026 scraping-guide sites (dev.to, crawlbase.com) independently confirm Goodreads is a known, actively-scraped, actively-defended target — this is an established cat-and-mouse dynamic, not a hypothetical risk. |

**Verdict: technically real and no-login as Darrin required, but meaningfully more fragile in practice than "occasionally scrape a page" implies.** The plan's original framing ("run infrequently, weekly cadence") is the right mitigation, but this needs to be explicit and load-bearing, not a throwaway line:

- **Avoid the `/search?q=` endpoint pattern entirely if possible** — it appears to be the most aggressively gated surface. Prefer ISBN-based lookup when a `books` row already has (or can derive) an ISBN, since the GitHub issue and general scraper community experience both suggest ID/ISBN-keyed lookups are less aggressively challenged than free-text search.
- When title/author search *is* needed (no ISBN on hand), expect WAF challenges to be common, not edge-case. The scraper **must** treat a 202/challenge response as an expected, handled outcome (skip this book, keep last-known rating, log and move on) — not an exception that aborts the whole weekly job.
- Because repeat requests from the same source triggered the challenge within seconds in this test, the weekly job must space requests out (seconds between requests minimum, likely more) and cap total requests per run — this is not optional politeness, it's a functional requirement or the job will WAF-lock partway through and silently under-deliver.
- A residential/home IP (Darrin's Mac Mini, running the actual cron) may behave differently than this session's IP — but should be assumed to hit the same wall under sustained repeated use and designed for accordingly, not assumed exempt.

**Design constraints (per Darrin, now backed by live evidence above):**
- No account/login — confirmed unnecessary; ratings are in the public page and in structured JSON-LD.
- Not bulk export — search-by-title/author (or ISBN when available) to find one best-matching page, scrape that page's `aggregateRating`, done.
- Weekly-ish cadence — fold into `releases-refresh.ts`'s existing resync (see Architecture below), not per-search-request scraping.
- Graceful degradation — required, not optional, given the WAF finding above. See Phase 1.5b.
- Store scraped rating/count in Supabase — new `books` columns (see Decision #9), so search/browse reads are instant and never trigger a live scrape.

### 3. Open Library — demoted to optional catalog-only role

No new verification needed beyond v1's (still accurate: `search.json` works, no auth, real `ratings_average`/`ratings_count` fields exist). What changed is **role**, not facts: those same `ratings_average`/`ratings_count` fields are no longer the plan's ratings source per Darrin's decision. OL's remaining possible value is purely as a broad discovery catalog (title/author/subject search across a much larger print/ebook universe than Audible alone) — genuinely useful for "what's out there" browsing, genuinely irrelevant to "how good is it" scoring now that Audible + Goodreads cover that. **Recommendation: build Phase 1 without OL first; add it only if Audible-catalog-search + Goodreads-lookup-on-demand together feel too narrow for browse/discovery** (see Phase 1 acceptance criteria).

### 4. Does the new ratings hierarchy resolve F4 ("ratings feel thin")? — Yes, explicitly

F4's concern was quantitative: OL showed "178 ratings" on *Project Hail Mary*, one of the best-selling SF novels of the decade — mid-list and niche audiobooks (Darrin's actual discovery zone) would show **no rating at all** under OL, and the plan's own `minRatingsCount: 5` filter would silently empty results.

The new hierarchy changes this materially:

| Source | Count on *Project Hail Mary* (same book, verified live) |
|--------|----------------------------------------------------------|
| Open Library (v1 plan) | 178 |
| Goodreads (v2, verified live 2026-09-03) | **1,850,217** |

This is not a marginal improvement — it's four orders of magnitude. For mid-list and niche titles the gap will be smaller in absolute terms, but Goodreads' user base is vastly larger than Open Library's ratings-participation base for essentially every English-language book, and Audible's own `rating` field (once wired) covers the audiobook-specific slice directly, which is exactly the catalog Darrin is browsing. **F4 is resolved by the source change itself — this plan does not need a Phase 3 "if ratings feel thin" contingency, because the contingency (denser ratings source) is now the primary path.** No stale "ratings may still feel thin" language should remain anywhere in this plan, and none does as of this revision.

The residual risk is different in kind, not degree: it's not "will there be a number" (yes, almost always, for Goodreads) but "will the scrape successfully retrieve it without getting WAF-challenged" (see Research Findings §2). That's a reliability/engineering risk, tracked in Risks below, not a data-density risk.

---

## Architecture

### What already exists (reuse)

| Piece | Path | Reuse how |
|-------|------|-----------|
| Audible catalog client | `src/lib/books/audible-catalog.ts` | Add `rating` to a response-groups constant (verify shape in Phase 0); extend `getSeriesSims` union with `RawSimilarities` \| `ByTheSameNarrator` (Phase 0 gated); add fetch timeout to `audibleGet` (F3) |
| Gap scan pattern | `gaps.ts` + `GapsClient` + `/api/books/gaps` | Same on-demand client fetch + loading/error/empty UX for the Discover/Similar routes |
| Weekly resync cadence | `releases-refresh.ts` + `last_releases_synced_at` on `user_profiles` | **New:** extend this same job (or a sibling job on the same trigger/cadence) to also run the Goodreads ratings refresh for books lacking a recent `goodreads_synced_at`, capped per run to respect WAF risk |
| Want-to-read | `POST /api/books/want` | Add discovered books to wishlist (needs ASIN — see bridge below); unchanged from v1 |
| Book types | `types.ts` `Book` | Already has `gr_rating` (existing static-import field — **note:** confirm this is distinct from the new live-scraped `goodreads_rating` column; do not silently overload the old field, which is fed by one-time JSON seed data per its comment elsewhere in the codebase), `genre`, `asin`, `wantToRead` |
| Library load | `queries.ts` `getLibraryForCurrentUser`, `BOOK_EMBED` | Owned-ASIN set + high-rated seeds for similar; extend `BOOK_EMBED` to include new goodreads columns |
| Search stub | `src/app/search/page.tsx` | **Replace** — BottomNav already points here |
| UI tokens | amber/slate cards, `GapBookCard`, cover pattern | Mirror phone-friendly cards |
| Schema | `books`, `user_books` (+ want flags) | **New migration required** (006) for Goodreads columns — this is the one piece of "no new tables" from v1 that no longer holds, and that's fine: it's 4 nullable columns on an existing table, not a new table or blast-radius change |

### What's genuinely new

| Piece | Why new |
|-------|---------|
| `src/lib/books/audible-token.ts` | **New shared helper** `refreshAudibleAccessToken(profile)` — hardened token refresh (F3), used by `/api/books/gaps` (retrofit), `/api/books/discover`, `/api/books/similar` |
| `src/lib/books/goodreads-scrape.ts` | **New** — search-by-title/author → best match → scrape `aggregateRating` from JSON-LD; ISBN-direct-lookup path preferred when available; WAF-aware error handling (treat 202/challenge as expected, not exceptional); per-run rate limiting/circuit breaker |
| `src/lib/books/discover.ts` | Normalize + rank + exclude-owned logic; ratings resolution across Audible → Goodreads hierarchy |
| `src/lib/books/similar.ts` | Multi-seed similar orchestration; subject/genre leg sourced from Goodreads/OL lookup primarily, `books.genre` as weak secondary hint only (F7c) |
| `GET /api/books/discover` | Proxy Audible catalog (+ optional OL) server-side; every hit gets a real action (F2) |
| `GET /api/books/similar` | Similar-to flow, Phase 0-gated `RawSimilarities` |
| `src/app/search/*` client UI | Real discovery UI |
| `supabase/migrations/006_goodreads_ratings.sql` | **New** — `books.goodreads_rating numeric`, `books.goodreads_ratings_count integer`, `books.goodreads_url text`, `books.goodreads_synced_at timestamptz` |
| Optional `src/lib/books/open-library.ts` | Only if Phase 1's acceptance check shows browse/discovery feels too narrow without it (Decision #2) |
| **No new npm deps** | Goodreads scrape uses `fetch` + a lightweight HTML/JSON-LD extraction (regex or a tiny DOM-free JSON-LD grab, same spirit as existing code — no cheerio/puppeteer needed since the target is a `<script type="application/ld+json">` block, not rendered DOM) |

### Shared token-refresh helper (F3 — build first, before Phase 1.5b/2 reuse it)

```ts
// src/lib/books/audible-token.ts

export interface AudibleTokenResult {
  accessToken: string | null
  error: { status: number; message: string } | null
}

/**
 * Hardened Audible access-token refresh. Fixes three latent bugs present in
 * the original /api/books/gaps inline implementation:
 *  1. No res.ok check before .json() — a 429/5xx with a non-JSON body threw
 *     an unhandled exception surfaced as a generic 500 instead of a clear
 *     "reconnect Audible" response.
 *  2. Unguarded JSON.parse(profile.audible_refresh_token) — a malformed
 *     stored token crashed the route instead of returning 401.
 *  3. No fetch timeout — a hung Amazon auth call could burn the entire
 *     maxDuration budget.
 */
export async function refreshAudibleAccessToken(
  refreshTokenRaw: string | null | undefined
): Promise<AudibleTokenResult> {
  if (!refreshTokenRaw) {
    return { accessToken: null, error: { status: 400, message: 'Audible not connected — connect Audible in Settings first.' } }
  }

  let tokens: { refresh_token?: string }
  try {
    tokens = JSON.parse(refreshTokenRaw)
  } catch {
    return { accessToken: null, error: { status: 401, message: 'Stored Audible token is corrupted — please reconnect Audible in Settings.' } }
  }
  if (!tokens.refresh_token) {
    return { accessToken: null, error: { status: 401, message: 'Stored Audible token is missing a refresh token — please reconnect Audible in Settings.' } }
  }

  let res: Response
  try {
    res = await fetch('https://api.amazon.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        app_name: 'Audible',
        app_version: '3.56.2',
        source_token: tokens.refresh_token,
        requested_token_type: 'access_token',
        source_token_type: 'refresh_token',
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    return { accessToken: null, error: { status: 504, message: timedOut ? 'Audible token refresh timed out — try again.' : 'Could not reach Audible — try again.' } }
  }

  if (!res.ok) {
    return { accessToken: null, error: { status: 401, message: 'Audible token refresh failed — please reconnect Audible in Settings.' } }
  }

  let data: { access_token?: string }
  try {
    data = await res.json()
  } catch {
    return { accessToken: null, error: { status: 502, message: 'Audible returned an unexpected response — try again shortly.' } }
  }

  if (!data.access_token) {
    return { accessToken: null, error: { status: 401, message: 'Audible token refresh failed — please reconnect Audible in Settings.' } }
  }

  return { accessToken: data.access_token, error: null }
}
```

`audibleGet` in `audible-catalog.ts` also gets `signal: AbortSignal.timeout(10_000)` added to its single `fetch` call — one-line fix, benefits every existing route (`gaps`, `releases-refresh`) as well as new ones.

**Retrofit note:** `/api/books/gaps/route.ts` should be updated to call this helper too (small diff, replaces its inline ~15 lines), so the fix is real everywhere rather than "new code is safe, old code still isn't."

### Goodreads scrape design (Phase 1.5b)

```ts
// src/lib/books/goodreads-scrape.ts

export interface GoodreadsRating {
  rating: number
  ratingsCount: number
  url: string
}

export interface GoodreadsLookupResult {
  status: 'ok' | 'not_found' | 'blocked' | 'error'
  data: GoodreadsRating | null
}

/**
 * Look up a book's Goodreads rating by title + author.
 *
 * WAF-aware by design (see Research Findings §2 — live-confirmed AWS WAF
 * challenge on repeated/search requests):
 *  - Treats HTTP 202 + x-amzn-waf-action header as an EXPECTED outcome
 *    ('blocked'), not a thrown exception. Caller keeps last-known rating.
 *  - Never retries within the same run — a challenge means back off for
 *    this entire weekly cycle, not just this book.
 *  - Prefers ISBN-direct lookup (https://www.goodreads.com/book/isbn/{isbn})
 *    over /search when an ISBN is known — GitHub-issue evidence (May 2026,
 *    grimmory-tools#1335) + general scraper-community experience both
 *    indicate ID/ISBN-keyed lookups are less aggressively gated than
 *    free-text search.
 *  - Falls back to /search?q=title+author only when no ISBN is on hand,
 *    picks the first result whose title+author normKey matches closely
 *    (reuse authorNamesMatch-style fuzzy compare from audible-catalog.ts).
 *  - Extracts rating from the <script type="application/ld+json"> block
 *    (aggregateRating.ratingValue / .ratingCount) as primary target — most
 *    stable, schema.org-typed. Falls back to inline `"ratingValue":` /
 *    `"ratingCount":` JS-var regex extraction if JSON-LD parse fails
 *    (three independent extraction points existed in the live sample,
 *    giving real fallback depth, not just one brittle selector).
 *  - A realistic per-run cap (e.g. 25-40 books) and a fixed delay between
 *    requests (several seconds, not milliseconds) — this is load-bearing,
 *    not politeness, per the live finding that repeat requests within
 *    seconds triggered a challenge.
 *  - On 'blocked' or 'error' for a given book: leave existing
 *    goodreads_rating/goodreads_synced_at untouched (graceful degradation —
 *    stale data beats no data, and never breaks the calling feature).
 */
export async function lookupGoodreadsRating(
  title: string,
  authors: string[],
  isbn?: string | null
): Promise<GoodreadsLookupResult> {
  // implementation per constraints above
}
```

### New migration (006)

```sql
-- 006_goodreads_ratings.sql
alter table public.books
  add column if not exists goodreads_rating numeric,
  add column if not exists goodreads_ratings_count integer,
  add column if not exists goodreads_url text,
  add column if not exists goodreads_synced_at timestamptz;

comment on column public.books.goodreads_rating is
  'Weekly-scraped Goodreads average rating (0-5). Secondary to Audible rating when both present. Null until first successful scrape; stale-but-present values are kept on scrape failure (graceful degradation).';
comment on column public.books.goodreads_ratings_count is
  'Weekly-scraped Goodreads rating count. Typically far denser than Open Library — this is the whole point of the source change (see PLAN.md Research Findings §4).';
comment on column public.books.goodreads_synced_at is
  'Last successful (non-blocked, non-error) Goodreads scrape for this book. Used to prioritize stalest rows on the next weekly run and to skip rows synced recently.';
```

Note: this is 4 nullable columns on an existing table, following the exact pattern of migrations 002/003/004/005 (`add column if not exists`). No new table, no RLS changes needed (existing `books` policies already allow read-all/service-write).

### Normalized hit type (revised — fixes F7b)

```ts
// src/lib/books/discover-types.ts
export interface DiscoveryHit {
  /** STABLE DEDUPE KEY, not a raw source id — normalized "title|author" key
   *  (reuses normKey-style fuzzy normalization from audible-catalog.ts).
   *  Fixes v1's ambiguity where `id` was "olid or asin" and the same book
   *  from two sources could appear twice with different ids. */
  id: string
  sources: ('audible_catalog' | 'audible_sims' | 'goodreads' | 'open_library')[]
  title: string
  authors: string[]
  year: number | null
  subjects: string[]              // genre-ish, sourced from Goodreads/OL lookup primarily
  audibleRating: number | null    // 0–5, from Audible `rating` response group (Phase 0 verified)
  audibleRatingCount: number | null
  goodreadsRating: number | null  // 0–5, from books.goodreads_rating cache (weekly scrape)
  goodreadsRatingCount: number | null
  coverUrl: string | null
  asin: string | null
  olid: string | null             // only if Open Library kept (Decision #2)
  isbn13: string | null
  goodreadsUrl: string | null
  audibleUrl: string | null       // https://www.audible.com/pd/{asin}
  openLibraryUrl: string | null
  alreadyOwned: boolean
  alreadyWanted: boolean
  actionable: boolean             // true if a real primary action exists (F2)
  primaryAction: 'want' | 'open_audible' | 'open_goodreads' | 'open_open_library'
  similarityReason?: string       // "Raw similar to X" | "Same subject: …" | "Same author"
}
```

### Data flow (v2)

```
┌─────────────┐     GET /api/books/discover?q=&author=&subject=&minRating=
│ Search UI   │ ──────────────────────────────────────────────────────────►
│ /search     │                                                            │
└──────┬──────┘                                                            │
       │                                                                   ▼
       │ similar                                                    audible-catalog.ts
       │ GET /api/books/similar { seedAsins[] }                     (rating + RawSimilarities,
       │                                                             Phase 0 gated)
       │                    ┌──────────────────────────────────────────────┤
       │                    ▼                                              ▼
       │            books.goodreads_* cache                         audible-catalog.ts
       │            (weekly-refreshed, instant read)                 catalog/sims
       │                    │                                              │
       │                    └──────────► discover.ts merge/rank ◄──────────┘
       │                                      │  (Audible rating → Goodreads rating
       │                                      │   → no OL ratings, per hierarchy)
       │                                      │ exclude owned ASINs + titles
       │                                      ▼
       │                               DiscoveryHit[] — every hit has
       │                               a real primaryAction (F2)
       │                                      │
       └──── Want ──► need ASIN? ──► bridge via Audible keywords search
                                      found → POST /api/books/want
                                      not found → primaryAction = open_goodreads /
                                                  open_open_library (real CTA, not dead button)

┌──────────────────────────────────────────────────────────────┐
│ Weekly resync (extends releases-refresh.ts cadence)           │
│  1. Existing series/author release refresh (unchanged)        │
│  2. NEW: pick up to N books.* rows with stalest/null           │
│     goodreads_synced_at, run lookupGoodreadsRating() with      │
│     rate limit + WAF-aware handling, upsert                    │
│     goodreads_rating/count/url/synced_at                       │
│  3. Failures/blocks logged, do NOT fail the whole job          │
└──────────────────────────────────────────────────────────────┘
```

### API shapes

#### `GET /api/books/discover`

**Query:**
```
q?: string
author?: string
subject?: string          // genre proxy; sourced from Goodreads/OL, not books.genre
minRating?: number         // applies to whichever rating source is available per hit
minRatingsCount?: number   // default 5 — much less likely to empty results now (§4)
sort?: 'rating' | 'relevance' | 'new'
page?: number
limit?: number             // default 20, max 40
```

**Response:**
```json
{
  "hits": [ /* DiscoveryHit — every hit has actionable: true and a real primaryAction */ ],
  "page": 1,
  "scannedAt": "2026-09-03T21:00:00.000Z",
  "sourcesUsed": ["audible_catalog", "goodreads_cache"]
}
```

#### `GET /api/books/similar`

Same shape as v1, with two changes:
1. Ratings/sort use the new hierarchy (Audible → Goodreads).
2. Subject/genre leg for OL-style overlap is sourced from a Goodreads/OL subject lookup on the seed book, with `books.genre` used only as a fallback hint if that lookup fails — not the reverse (F7c).

#### ASIN bridge (Want / Buy without leaving DogEar) — merged into Phase 1 (F2)

When hit has `asin: null` and user taps the primary action:
1. `searchCatalogByAuthor`/keywords Audible match, take best title/author fuzzy match (`normKey`).
2. If match → proceed with existing want route, `primaryAction` becomes `want`.
3. **If no match → the card's primary action is `open_goodreads` or `open_open_library` from the moment it renders** — never a disabled/blocked "Want" button. This is the F2 fix: no card ever presents an action that doesn't work.

### UI structure (`/search`) — phone-first

Unchanged shape from v1, with copy updates:

```
┌──────────────────────────────────────┐
│ Discover                             │
│ Find books beyond your library       │
├──────────────────────────────────────┤
│ [ Library | Discover | Similar ]     │
├──────────────────────────────────────┤
│ 🔍 Search title, author, genre…      │
│ Genre chips: SF · Fantasy · Mystery  │
│        Thriller · Romance · Nonfic   │
│ Min rating  ★★★★☆  [====·] 4.0+     │
│ [ Search ]                           │
├──────────────────────────────────────┤
│ results grid (1 col phone / 2–3 sm+) │
│ cover | title | author               │
│ ★ Audible 4.6 · GR 4.51 (1.85M)      │  ← both shown when both exist
│ owned badge | [Want] or [Open ↗]     │  ← always a real, tappable action
└──────────────────────────────────────┘
```

**Similar tab / Library tab:** unchanged from v1.

### Nav / Env / Caching

Unchanged from v1 except: no `HARDCOVER_API_TOKEN` env var (Hardcover dropped). No `GOOGLE_BOOKS_API_KEY` unless GB fallback added later (unchanged, still not in v1 scope).

---

## Phased Implementation

Each phase is a shippable vertical slice. **Phase 1 and 1.5 are now one deliverable per F2** — see below.

### Phase 0 — Spike (45–60 min, no UI) — HARD GATE, documented fallback required

This phase does not "inform" later phases — it **gates** them. Do not scope Phase 2 (Similar) until this reports back with a pass/fail per claim.

1. **`RawSimilarities`:** call `getSeriesSims(token, knownAsin, 'RawSimilarities', 10)` against a real ASIN in Darrin's library with a live token. Record: does it 200? What shape comes back (`similar_products`? `products`?)? Compare to `InTheSameSeries`'s already-proven shape.
   - **Pass →** proceed to wire it as documented in v1's original Architecture section.
   - **Fail (400/404/empty) →** documented fallback: Similar ships on author + subject overlap only for v1; `RawSimilarities` becomes a Phase 3+ retry-later item, not a blocker. **This must be written into the Phase 2 acceptance criteria as an either/or, decided by this spike's actual result — not assumed to pass.**
2. **Audible `rating` response group:** add `rating` to a request's `response_groups` param on a real catalog-by-ASIN call. Record actual field names returned (`display_average_rating`? `num_ratings`? something else — docs are inconsistent across API versions per Research Findings §1). This is lower-risk than `RawSimilarities` (three independent external corroborating sources vs. docs-only) but still genuinely unverified in this repo until this call succeeds.
   - **Pass →** wire into `normalizeCatalogProduct` / a ratings-specific normalizer.
   - **Fail →** Audible drops out of the ratings hierarchy for v1; Goodreads becomes sole rating source; re-attempt later.
3. **Goodreads scrape spike (new — replaces v1's implicit assumption):** run `lookupGoodreadsRating()` against 3-5 real titles from Darrin's library, spaced several seconds apart. Confirm: JSON-LD extraction works on a fresh IP/session; observe how many requests it takes before a WAF challenge appears (this session saw it after ~2-3 rapid requests — establish a real, evidence-based per-run pacing, not a guess).
   - **Pass (workable pacing found) →** proceed to Phase 1.5b as designed.
   - **Fail (challenged even at conservative pacing) →** documented fallback: reduce to an even smaller per-run cap (e.g. 10-15/week) and/or add longer delays; if genuinely unworkable, degrade to "Goodreads link only, no cached rating" — still useful (user can tap through), just not pre-fetched. **Do not silently drop the entire Goodreads feature** — the review's F2 spirit (no half-finished dead ends) applies here too: worst case is an external link, not nothing.
4. Kill criteria overall: if 1 and 2 both fail, Similar ships as author+subject-only and ratings ship as Goodreads-only — still a complete, honest feature, just leaner than the ideal. Report actual results in the codebase (comment in `audible-catalog.ts` header, matching its existing "Proven endpoints" convention) before continuing.

### Phase 1 (merged with former 1.5) — Discover page, ratings hierarchy, real actions on every card

**Ship:** `/search` Discover tab works on phone, end-to-end, no dead buttons.

| Task | Files |
|------|-------|
| `audible-token.ts` shared helper (F3) — build first | new file |
| Retrofit `/api/books/gaps/route.ts` to use the shared helper | existing file, small diff |
| Add fetch timeout to `audibleGet` | `audible-catalog.ts` |
| Wire Audible `rating` response group (if Phase 0 passed) | `audible-catalog.ts` |
| `006_goodreads_ratings.sql` migration | new |
| `goodreads-scrape.ts` — search/ISBN lookup, JSON-LD extraction, WAF-aware handling | new file |
| Extend `releases-refresh.ts` (or a sibling function called from the same cron/trigger) to run the weekly Goodreads refresh, capped + rate-limited | `releases-refresh.ts` or new `goodreads-refresh.ts` alongside it |
| `discover.ts` — merge Audible catalog + `books.goodreads_*` cache, apply ratings hierarchy, mark owned/wanted, **assign `primaryAction` to every hit (F2)** | new file |
| `GET /api/books/discover` | new route |
| ASIN bridge (`bridgeToAsin`) — merged in, not deferred | `discover.ts` |
| Want button wired on every actionable card; `Open ↗` (Audible/Goodreads/OL) wired on every non-bridgeable card | `SearchClient.tsx` + `DiscoverCard.tsx` |
| `SearchClient.tsx` + page | tabs, chips, slider, results, loading/error |
| Library tab local filter | pure client |
| Nav link | `Nav.tsx` |

**Acceptance:**
- Search "Project Hail Mary" (or a real title in Darrin's library) returns a hit with a rating from at least one source.
- Every rendered card has a working tap action — Want (if bridged) or an external open link (if not). **Zero cards with a disabled/dead button.**
- Owned books badged; no crash if Audible or Goodreads is slow/unavailable (timeout + friendly error per source).
- **Ratings-density acceptance check (replaces v1's absent one, addresses F4's original spirit even though F4 itself is resolved by the hierarchy change):** run 5 realistic Darrin-style searches (a mix of well-known and mid-list/niche titles) — confirm most top-10 hits carry a rating from Audible and/or Goodreads. If the weekly scrape hasn't run yet for a fresh book, its Goodreads fields are legitimately null until the next cycle — that's expected first-run behavior, not a bug, and should be understood as such before treating any gap as a regression.

**Out of scope this phase:** Similar tab, Open Library catalog browsing (only added if this phase's browse/discovery feels too narrow — Decision #2).

### Phase 2 — Similar-to-these

| Task | Files |
|------|-------|
| `similar.ts` orchestration — `RawSimilarities` only if Phase 0 passed, else author+subject fallback | new file |
| `GET /api/books/similar` | `maxDuration = 60–120` like Gaps |
| Similar tab UI | multi-select from high-rated completed books |
| Subject leg sourced from Goodreads/OL lookup on seed book, `books.genre` as fallback hint only (F7c) | `similar.ts` |
| Reasons on cards | "Because you liked X" |

**Acceptance:** Pick 2–3 loved books → get 10+ suggestions not already owned, mostly rated ≥4.0 when a rating exists (Audible or Goodreads).

### Phase 3 — Polish (optional)

- Genre chips derived from Goodreads/OL subject lookups on user's top-rated books (not `books.genre`, per F7c).
- Open Library catalog-browse tab, only if Phase 1's acceptance check flagged browse as too narrow (Decision #2).
- "Hide"/not_interested on discovery hits (reuse flag if ASIN bridged).
- Expand weekly Goodreads refresh cap if the pacing established in Phase 0 proves comfortably under WAF thresholds in real weekly runs.

---

## Implementation notes (conventions to match)

- **Server routes** refresh Audible via the new shared `refreshAudibleAccessToken` helper (F3) — never re-inline the token dance.
- **`export const maxDuration = 60`** (or 120) on the similar route; the weekly Goodreads refresh runs as part of the existing releases-refresh job's duration budget, not a new always-on process.
- **Rate discipline — two tiers now, not one:** Audible calls follow the existing Gaps-style sequential/lightly-pooled pattern (accurate but not sophisticated, per F6 — acceptable for an API DogEar already depends on app-wide). Goodreads scraping gets a **stricter, purpose-built limiter**: fixed multi-second delay between requests, hard per-run cap, and a circuit breaker that stops the whole run early if a WAF challenge is seen (don't burn through the rest of the cap hitting more challenges — evidence from this session shows once challenged, immediate retries stay challenged).
- **No new npm deps.**
- **Phone:** single-column cards, sticky search bar, large tap targets (mirror `GapsClient` CTA).
- **Copy:** honest about rating source — "Audible rating" / "Goodreads rating (weekly sync)" — never implies live/real-time Goodreads data.
- **Images:** existing Audible covers; Goodreads/OL cover hotlinking avoided unless specifically needed (ratings are the target, not cover art, for the new source).

---

## Risks / Kill Criteria

| Risk | Mitigation | Kill / pivot |
|------|------------|--------------|
| **Goodreads AWS WAF challenges (live-confirmed this session — not hypothetical)** | ISBN-direct lookup preferred over search; multi-second spacing; hard per-run cap; circuit breaker on first challenge; graceful degradation (keep stale rating, never crash the feature) | If even conservative pacing gets challenged reliably (Phase 0 spike result), shrink cap further or ship "link-only, no cached rating" for that run — never silently disable Goodreads entirely without telling Darrin |
| Goodreads HTML/JSON-LD structure changes over time | JSON-LD primary extraction (schema.org-typed, more stable than CSS classes) + inline-JS-var fallback — two independent extraction paths from the live sample | Log extraction failures distinctly from WAF blocks; if JSON-LD disappears entirely, fall back to the `RatingStatistics__rating` div text as a third option before treating the book as unscored |
| Audible `rating` response group shape differs from docs, or doesn't exist for this API version | Phase 0 spike confirms actual shape before wiring | Ratings ship Goodreads-only; retry Audible rating later |
| `RawSimilarities` missing/empty/400s | Phase 0 hard gate; author+subject fallback documented up front, not discovered mid-build | Similar ships without it — still a complete feature, not blocked |
| ASIN bridge false positives | Strict `normKey` title equality + author match; else don't Want | Real `Open ↗` CTA always available (F2) — no dead ends either way |
| `books.asin NOT NULL` blocks non-Audible wants | Bridge required for Want; non-bridged hits get `open_goodreads`/`open_open_library` as their real primary action from day one | No schema change needed for v1 — F2's fix is a UI/routing fix, not a migration |
| Weekly scrape job silently fails / partial completion | Per-book try/catch, errors logged not thrown, circuit breaker on WAF (see above), stamps `goodreads_synced_at` only on real success | Manual re-run trigger (mirrors existing "Refresh Releases" pattern in Settings) |
| `genre`/subject signal is often null/guessed (`books.genre`, F7c) | Similar's subject leg uses Goodreads/OL lookup as primary, `books.genre` as fallback hint only | If lookup also fails, that seed simply contributes less to Similar's ranking — not a crash |
| next/image host config for any new external covers | Add relevant host to `next.config` only if Phase 3 OL covers are added | Use plain `<img>` like some existing cards |
| Audible ToS (unofficial API) | Same posture as entire DogEar Audible integration — already accepted | N/A |
| Goodreads ToS (scraping) | Darrin's explicit, informed decision (single-user, infrequent, low-volume) — documented here as the record of that decision | N/A — accepted risk, not a build blocker |

**Kill the whole feature only if:** Phase 0 shows both Audible catalog search AND Goodreads scraping are unusable in practice (very unlikely — Audible catalog search is already proven elsewhere in this app, and Goodreads book-detail pages loaded cleanly on first request in this session; the risk is pacing/volume, not fundamental access).

---

## Recommendation

**Build Phase 0 spike first (hard gate), then Phase 1 as one merged deliverable. Do not chase Hardcover — the ratings hierarchy change already solves what Hardcover would have solved.**

### Why this path

1. **Darrin's constraint changed the foundation, not the shape.** The architecture (on-demand API routes + client tabs, reuse of `audible-catalog.ts` and the Gaps pattern) is unchanged and still sound. What changed is *where ratings come from* and *how thorough the engineering needs to be* before shipping.
2. **The new ratings hierarchy is a strict upgrade over v1's Open Library-only plan** — Audible ratings reuse existing auth infrastructure; Goodreads, once live-verified this session (no login, real structured data, but real WAF friction), brings orders-of-magnitude denser rating counts than OL ever offered. F4's original worry (ratings will feel thin) is resolved by this change, not deferred to a "maybe Phase 3" enricher that never gets built.
3. **Every review finding has a concrete fix baked into this plan, not a promise to address it later:** Phase 0 is a real hard gate with a documented per-claim fallback (F1); Phase 1 ships with zero dead-end cards (F2); the token-refresh pattern is fixed once in a shared helper before it's reused twice more (F3); the ratings-thinness concern is resolved by source change, stated explicitly, not left stale (F4).
4. **The Goodreads scrape design is evidence-based, not aspirational** — this session's live probes found both the good news (no login wall, clean JSON-LD structured data with three redundant extraction points) and the real news (an active AWS WAF challenge that engages within seconds of repeated access, corroborated by a live May-2026 GitHub issue reporting the identical pattern). The plan's pacing/circuit-breaker/graceful-degradation requirements are sized to that real evidence, not a generic "scraping is risky" hand-wave.
5. **Scope stays one-sitting shippable per phase**, same as Gaps — Phase 0 is a short spike, Phase 1 is now the "make Discover real and fully actionable" sitting (bigger than v1's Phase 1 alone, but that's the point — no half-finished state ships), Phase 2 is Similar.

### What to tell Darrin in product language

> Ratings now come primarily from your own Audible data, backed up by Goodreads (scraped, not API — Goodreads killed their public API years ago, but their book pages are public and don't need a login). That combo gives us real, dense rating counts instead of Open Library's thin numbers. The tradeoff: Goodreads actively rate-limits automated access, so we pull ratings in a weekly background pass (like the existing Refresh Releases job), not live per-search — a search might occasionally show "rating syncing" for a brand-new book until the next weekly pass. Every book you find gets a real action — add to Want if we can match it on Audible, or a direct link to Goodreads/Audible if we can't — nothing dead-ends.

### Suggested build order (concrete)

1. Phase 0 spike (`RawSimilarities`, Audible `rating`, Goodreads scrape pacing) — 45–60 min, hard gate, report results before continuing
2. Shared `refreshAudibleAccessToken` helper + `audibleGet` timeout + retrofit `gaps/route.ts` — small, do this before touching Phase 1's new routes
3. `006_goodreads_ratings.sql` + `goodreads-scrape.ts` + weekly refresh extension
4. Phase 1 (merged) — Discover page, ratings hierarchy, every card actionable — main sitting
5. Phase 2 — Similar tab — next sitting
6. Phase 3 — polish, only if Phase 1's acceptance check flags a real gap

---

## Appendix A — Key URLs

| Resource | URL |
|----------|-----|
| Audible external API (mkb79) | https://audible.readthedocs.io/en/latest/misc/external_api.html |
| Goodreads API deprecation | https://www.goodreads.com/api |
| Live evidence: Goodreads WAF blocking search, ISBN lookup still safe (May 2026) | https://github.com/grimmory-tools/grimmory/issues/1335 |
| Open Library Search API docs (if kept per Decision #2) | https://openlibrary.org/dev/docs/api/search |
| StoryGraph API roadmap (still unshipped) | https://roadmap.thestorygraph.com/features/posts/an-api |

## Appendix B — File checklist (v2)

```
src/lib/books/audible-token.ts             NEW — shared hardened token refresh (F3)
src/lib/books/goodreads-scrape.ts          NEW — search/ISBN lookup + JSON-LD extraction, WAF-aware
src/lib/books/discover-types.ts            NEW — DiscoveryHit with stable dedupe id (F7b fix)
src/lib/books/discover.ts                  NEW — ratings hierarchy merge, primaryAction on every hit (F2)
src/lib/books/similar.ts                   NEW (Phase 2) — Phase-0-gated RawSimilarities, subject leg from GR/OL lookup (F7c)
src/lib/books/audible-catalog.ts           EXTEND — rating response group (Phase 0 gated), fetch timeout on audibleGet
src/lib/books/releases-refresh.ts          EXTEND (or sibling file) — weekly Goodreads ratings refresh, rate-limited
src/app/api/books/gaps/route.ts            RETROFIT — use shared refreshAudibleAccessToken helper (F3)
src/app/api/books/discover/route.ts        NEW
src/app/api/books/similar/route.ts         NEW (Phase 2)
src/app/search/page.tsx                    REPLACE stub
src/app/search/SearchClient.tsx            NEW
src/app/search/DiscoverCard.tsx            NEW — every card has a real primaryAction (F2)
src/components/Nav.tsx                     ADD Discover link
supabase/migrations/006_goodreads_ratings.sql   NEW — 4 nullable columns on books
src/lib/books/open-library.ts              OPTIONAL (Phase 3, Decision #2) — only if browse feels narrow
projects/discovery-search-PLAN.md          THIS FILE
projects/discovery-search-REVIEW.md        adversarial review this revision responds to
```

## Appendix C — Live verification log (2026-09-03, this session)

Distinguishing **live probe** (this session, real HTTP calls) from **docs/external corroboration only** (not independently called), per F1's fix:

**Live probe, this session:**
- Goodreads book-detail page (`/book/show/54493401-project-hail-mary`) → **HTTP 200**, first request. Full HTML including reviews returned.
- JSON-LD `aggregateRating` extracted: `ratingValue: 4.51`, `ratingCount: 1850217`, `reviewCount: 256924`.
- Inline JS var fallback confirmed present in the same page: `"ratingValue":4.51`, `"ratingCount":1850217` — independent second extraction path.
- Human-readable div fallback confirmed present: `RatingStatistics__rating` → `4.51` — independent third extraction path.
- Goodreads search page (`/search?q=...`) → **HTTP 202**, `x-amzn-waf-action: challenge`, empty body. Confirmed on two different queries.
- Repeat request to the *same* book-detail URL that returned 200 moments earlier → also **202/challenged** on retry (with and without a 5s delay, with a different User-Agent string) — confirms an active, fast-triggering anti-bot system, not a search-only restriction.
- Repo file `src/lib/books/audible-catalog.ts` inspected directly: confirmed `rating` is **not** present in `AUDIBLE_CATALOG_RESPONSE_GROUPS`, and no `rating`/`goodreads_ratings` response group appears anywhere in the file. F1's original finding independently reconfirmed.
- Repo file `src/app/api/books/gaps/route.ts` inspected directly: confirmed no `res.ok` check before `refreshResponse.json()`, unguarded `JSON.parse(profile.audible_refresh_token)`, and no fetch timeout anywhere in the token-refresh flow. F3's findings independently reconfirmed line-for-line.
- Repo migrations 001–005 inspected directly: confirmed `books.genre` does not appear in any migration file, yet is selected live in `queries.ts`'s `BOOK_EMBED` — confirms F7c's schema-drift concern is real, not speculative.

**Docs/external corroboration only (not independently called by this session):**
- Audible `response_groups=rating` field existence and rough shape — from mkb79 docs + community client-library source + Reddit user reports (three independent non-live sources, stronger than a single docs page, but still not a live call against this repo's token — Phase 0 must confirm).
- `RawSimilarities` and `goodreads_ratings` similarity/response-group names — mkb79 docs only, unchanged confidence from v1, Phase 0 hard gate unchanged.
- Goodreads WAF-blocking-search-but-not-ISBN pattern corroborated externally by a live, dated GitHub issue (`grimmory-tools/grimmory#1335`, May 2026) reporting the identical symptom independently of this session's own probe — genuinely strong corroboration since it's an independent party hitting the same wall around the same period, not just a scraping-guide marketing page.

---

_End of plan (v2)._
