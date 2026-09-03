# Discovery Search — Build Plan

**Date:** 2026-09-03  
**App:** DogEar (`dogear-app`, Next.js 14 / Supabase / Audible)  
**Mode:** Builder — decision to build is made; this is the implementation plan  
**Closest analog:** "Find Your Next Read" gap-detection (`gaps.ts` + `GapsClient` + `/api/books/gaps`)

---

## Decisions (top)

| # | Decision | Choice |
|---|----------|--------|
| 1 | **Primary discovery catalog** | **Open Library Search API** (free, no key, real ratings, subject/author/title filters) |
| 2 | **Ratings source (no OAuth)** | **Open Library `ratings_average` / `ratings_count`** — not Goodreads |
| 3 | **Goodreads** | **Do not use** — public API is dead; scraping is ToS-prohibited |
| 4 | **"Similar to…" engine (v1)** | **Hybrid:** Audible `RawSimilarities` (when ASIN known) + Open Library subject/author overlap + min-rating filter |
| 5 | **Hardcover.app** | **Phase 2 optional enricher only** — better ratings density, but needs server token + beta flux |
| 6 | **Google Books** | **Skip as primary** — ratings sparse/unreliable; needs API key; quota friction |
| 7 | **StoryGraph** | **Skip** — no public API (roadmap item only; community scrapers only) |
| 8 | **UI home** | Replace stub `/search` with real Discovery page; keep library-local search as a tab |
| 9 | **Persistence** | No new tables for v1 results (on-demand like Gaps). Reuse `POST /api/books/want` for wishlist. Optional tiny cache table only if rate-limit pain appears |
| 10 | **Ship shape** | Three incremental phases, each shippable in one sitting like Gaps |

---

## Ratings Source Research Findings

Verified Sept 2026 via live docs + live API probes.

### 1. Goodreads — dead for legitimate integration

| Fact | Evidence |
|------|----------|
| Stopped issuing new API keys | Dec 8, 2020 official notice on goodreads.com/api |
| Existing keys largely deactivated | Community reports of 403s; Dec 2025 "API down?" thread still treating it as dead |
| No public revival as of 2026 | Search turns up only deprecation history + third-party "I built a scraper" posts |
| Scraping | Goodreads Terms prohibit unpermitted copying/use of Content. Law.SE consensus: scraping reviews/ratings for an app is a ToS violation. Fragile (HTML churn, bot blocks). **Not viable for DogEar even at personal scale if we care about ToS.** |

**Verdict:** Cannot deliver "Goodreads ratings without an account" via Goodreads. Label UI as community ratings from Open Library (and optionally Hardcover later). Users who want GR numbers still have GR itself.

### 2. Open Library — **recommended primary**

| Property | State (2026) |
|----------|--------------|
| Auth | **None** — public JSON |
| Search | `GET https://openlibrary.org/search.json` |
| Filters | `q`, `title`, `author`, `subject`, `isbn`, `publisher`, `language`, pagination `page`/`limit` |
| Ratings | **Live confirmed:** `ratings_average` (float), `ratings_count` (int) on search docs |
| Sort by rating | **Live confirmed:** `sort=rating` works (SF subject query returned Hitchhiker's 4.51/178, Hail Mary 4.5/178, Watchmen 4.47/240) |
| Covers | `https://covers.openlibrary.org/b/id/{cover_i}-M.jpg` |
| Subjects/genres | Rich `subject[]` arrays — good enough for genre browse |
| Cost | $0 |
| ToS / license | Open data; designed for this use |
| Weakness | Rating **counts are thin** vs Goodreads (dozens–low hundreds typical, not tens of thousands). Fine for ranking/filtering; not a GR clone. |

**Example (verified):**
```http
GET https://openlibrary.org/search.json?subject=science+fiction&sort=rating&fields=key,title,author_name,ratings_average,ratings_count,subject,first_publish_year,cover_i&limit=3
```

**Example response shape:**
```json
{
  "numFound": 91287,
  "docs": [{
    "key": "/works/OL21745884W",
    "title": "Project Hail Mary",
    "author_name": ["Andy Weir"],
    "ratings_average": 4.5,
    "ratings_count": 178,
    "first_publish_year": 2021,
    "cover_i": 11200092,
    "subject": ["hard science-fiction", "science-fiction", ...]
  }]
}
```

Also: per-work `GET /works/{OLID}/ratings.json` exists for detail pages.

### 3. Hardcover.app — strong secondary (not v1 primary)

| Property | State (docs updated Aug 24 / Jul 17 2026) |
|----------|---------------------------------------------|
| API | GraphQL `https://api.hardcover.app/v1/graphql` |
| Auth | Bearer token from hardcover.app/account/api — **server-side only** |
| Ratings | First-class: `rating`, `ratings_count`, `users_read_count`, genres, moods, tags |
| Search | Typesense-backed `search(query, query_type: "Book", sort, …)` |
| Free tier | **5,000 req/day**, burst 10, 60/min — plenty for personal DogEar |
| Caveats | **Beta** ("may change or break anytime"); tokens can reset; commercial rules around user-owned data; no browser calls; OAuth for multi-user apps is "2026 roadmap" not done |
| Fit | Excellent enrichment for a **single-operator** DogEar (Darrin's token in env). Awkward if DogEar becomes multi-user SaaS without their commercial tier |

**Example search query:**
```graphql
query Discover {
  search(
    query: "project hail mary"
    query_type: "Book"
    per_page: 10
    page: 1
    sort: "rating:desc"
  ) {
    results
  }
}
```

Book result fields of interest: `title`, `author_names`, `rating`, `ratings_count`, `genres`, `moods`, `description`, `isbns`, `slug`, `has_audiobook`, `featured_series`.

### 4. Google Books API — optional last resort

| Property | State |
|----------|-------|
| Auth | API key for public volume search (no user OAuth needed for catalog) |
| Ratings | `volumeInfo.averageRating` + `ratingsCount` **when present** — often missing |
| Search | `GET https://www.googleapis.com/books/v1/volumes?q=intitle:foo+inauthor:bar&key=…` |
| Limits | Project quotas; unauthenticated/shared keys hit 429 easily (live probe returned quota exceeded) |
| Fit | Fine as ISBN/title resolver fallback; **not** a ratings authority |

### 5. StoryGraph — no

Official API is still a **roadmap feature**, not shipped. Only unofficial scrapers exist. Same ToS/fragility problem as GR scraping. Skip.

### 6. Audible (already in repo) — complementary, not discovery-wide

Already used:

- `searchCatalogByAuthor`, `getSeriesSims(…, 'InTheSameSeries' | 'ByTheSameAuthor' | 'NextInSameSeries')`
- Catalog products with `products_sort_by` including **`AvgRating`**, **`BestSellers`**, `keywords`, `category_id`, `title`, `author`

**Newly relevant (documented, not yet in our client):**

| Capability | Detail |
|------------|--------|
| `similarity_type=RawSimilarities` | General "customers also liked" style similar books — **this is the missing "find something similar" sims type** |
| `ByTheSameNarrator` | Nice-to-have for audiobook affinity |
| `response_groups=rating` | Audible star ratings on catalog products |
| `response_groups=goodreads_ratings` | Listed on product-by-ASIN docs — **probe in Phase 1 spike**; may expose GR-derived numbers *through Audible's API* without GR OAuth (Amazon-owned data path). If it works, use as optional badge on Audible-matched results only |
| Catalog `keywords` + `category_id` + sort `AvgRating` | Audible-native discovery for "high-rated sci-fi audiobooks" when user is Audible-connected |

**Honest limit:** Audible-only discovery = audiobook SKUs only. Darrin asked for broader than library/preorder catalog → Open Library stays primary for print/ebook universe; Audible bridges back to buy/listen.

### Ratings options — cost/complexity (honest)

| Option | Complexity | Cost | Data quality | ToS risk | Build? |
|--------|------------|------|--------------|----------|--------|
| **A. Open Library** | Low — one `fetch`, no key | $0 | Medium (thin counts, real averages) | None | **Yes — v1** |
| **B. Hardcover** | Medium — GraphQL client, secret token, beta break risk | $0 free tier | High (reader-community ratings) | Low if server-side + aggregate only | Phase 2 |
| **C. Google Books** | Low-medium — API key in env | Free tier | Low-medium (spotty ratings) | Low | Fallback only |
| **D. Scrape Goodreads** | High maintenance | $0 | High when it works | **High — don't** | No |
| **E. Audible rating / goodreads_ratings groups** | Low — extend existing client | $0 (uses existing token) | Medium; Audible-only | Acceptable (same as rest of app) | Phase 1.5 enrich |

**Pick: A for discovery + ratings filter; E for Audible-path similar; B later if OL ratings feel too thin.**

---

## Architecture

### What already exists (reuse)

| Piece | Path | Reuse how |
|-------|------|-----------|
| Audible catalog client | `src/lib/books/audible-catalog.ts` | Extend `getSeriesSims` union with `RawSimilarities` \| `ByTheSameNarrator`; add `searchCatalog({ keywords, categoryId, sort })`; optional `rating` response group |
| Gap scan pattern | `gaps.ts` + `GapsClient` + `/api/books/gaps` | Same on-demand client fetch + loading/error/empty UX |
| Want-to-read | `POST /api/books/want` | Add discovered books to wishlist (needs ASIN — see bridge below) |
| Book types | `types.ts` `Book` | Already has `gr_rating`, `genre`, `asin`, `wantToRead` |
| Library load | `queries.ts` `getLibraryForCurrentUser` | Owned-ASIN set + high-rated seeds for similar |
| Search stub | `src/app/search/page.tsx` | **Replace** — BottomNav already points here |
| UI tokens | amber/slate cards, `GapBookCard`, cover pattern | Mirror phone-friendly cards |
| Auth token refresh | `/api/books/gaps` Amazon token dance | Copy for any Audible-backed discovery routes |
| Schema | `books`, `user_books` (+ want flags) | No migration required for v1 |

### What's genuinely new

| Piece | Why new |
|-------|---------|
| `src/lib/books/open-library.ts` | External catalog client (none exists) |
| `src/lib/books/discover.ts` | Normalize + rank + exclude-owned logic |
| `src/lib/books/similar.ts` | Multi-seed similar orchestration |
| `GET /api/books/discover` | Proxy OL (+ optional Audible) server-side |
| `GET /api/books/similar` | Similar-to flow |
| `src/app/search/*` client UI | Real discovery UI |
| Optional `GET /api/books/discover/bridge` | Title/author → Audible ASIN for Want/Buy |
| **No new npm deps** for v1 | `package.json` stays lean (fetch only) |

### Data flow (v1)

```
┌─────────────┐     GET /api/books/discover?q=&author=&subject=&minRating=
│ Search UI   │ ──────────────────────────────────────────────────────────►
│ /search     │                                                            │
└──────┬──────┘                                                            │
       │                                                                   ▼
       │ similar                                                    open-library.ts
       │ GET /api/books/similar { seedAsins[] | seedOlids[] }              │
       │                                                                   │
       │                    ┌──────────────────────────────────────────────┤
       │                    ▼                                              ▼
       │            audible-catalog.ts                              OL search.json
       │            RawSimilarities / author / series               ratings + subjects
       │                    │                                              │
       │                    └──────────► discover.ts merge/rank ◄──────────┘
       │                                      │
       │                                      │ exclude owned ASINs + titles
       │                                      ▼
       │                               DiscoveryHit[]
       │                                      │
       └──── Want ──► need ASIN? ──► bridge via Audible keywords search ──► POST /api/books/want
```

### Normalized hit type (new, parallel to `NormalizedCatalogRelease`)

```ts
// src/lib/books/discover-types.ts
export interface DiscoveryHit {
  id: string                    // olid work key or asin
  source: 'open_library' | 'audible_catalog' | 'audible_sims'
  title: string
  authors: string[]
  year: number | null
  subjects: string[]            // genres-ish
  ratingAvg: number | null      // 0–5
  ratingCount: number | null
  ratingSource: 'open_library' | 'audible' | 'hardcover' | null
  coverUrl: string | null
  olid: string | null           // "/works/OL…"
  asin: string | null
  isbn13: string | null
  audibleUrl: string | null     // https://www.audible.com/pd/{asin}
  openLibraryUrl: string | null
  alreadyOwned: boolean
  alreadyWanted: boolean
  similarityReason?: string     // "Raw similar to X" | "Same subject: …" | "Same author"
}
```

### API shapes

#### `GET /api/books/discover`

**Query:**
```
q?: string
author?: string
subject?: string          // genre proxy — "science fiction", "fantasy", "mystery"
minRating?: number        // default 0; UI default 3.5 or 4.0
minRatingsCount?: number  // default 5 — kill 1-person 5.0 noise
sort?: 'rating' | 'relevance' | 'new'
page?: number             // default 1
limit?: number            // default 20, max 40
includeAudible?: '0'|'1'  // if 1 and user has Audible token, also run keywords search
```

**Response:**
```json
{
  "hits": [ /* DiscoveryHit */ ],
  "page": 1,
  "numFound": 91287,
  "scannedAt": "2026-09-03T19:00:00.000Z",
  "provider": "open_library",
  "audibleSupplement": null
}
```

#### `GET /api/books/similar` (or POST with body if many seeds)

**Query/body:**
```
seeds: string[]           // user_books asins and/or olids — max 5
minRating?: number        // default 4.0
limit?: number            // default 24
```

**Server logic:**
1. Resolve seeds → library books (title, authors, genre, asin, series).
2. If Audible token + asin: `getSeriesSims(token, asin, 'RawSimilarities', 20)` per seed (cap 3 seeds to rate-limit).
3. Parallel OL: for each seed, `subject` from `books.genre` or top OL subjects for title match; also `author=` for secondary authors user loved (rating ≥ 4).
4. Merge by normalized title+author key; boost if seen from multiple seeds; filter `ratingAvg >= minRating` when known; drop owned.
5. Return hits with `similarityReason`.

**Response:**
```json
{
  "seeds": [{ "asin": "B08G9PRS1K", "title": "Project Hail Mary" }],
  "hits": [ /* DiscoveryHit */ ],
  "scannedAt": "…",
  "sourcesUsed": ["audible_raw_sims", "open_library_subject"]
}
```

#### ASIN bridge (for Want / Buy without leaving DogEar)

When hit has `asin: null` but user taps Want:
1. `searchCatalog` Audible `keywords=title+author`, take best title/author fuzzy match (`normKey` already in `audible-catalog.ts`).
2. If match → proceed with existing want route.
3. If no match → save want is blocked with message "No Audible edition found — open on Open Library" + external link. (Do **not** invent fake ASINs; `books.asin` is `unique not null`.)

Optional later migration: allow `books` rows with null asin + `olid` unique — **out of scope for v1** (schema blast radius).

### UI structure (`/search`) — phone-first

Replace stub with client page matching Gaps energy:

```
┌──────────────────────────────────────┐
│ Discover                             │
│ Find books beyond your library       │
├──────────────────────────────────────┤
│ [ Library | Discover | Similar ]     │  ← tabs (Library = local filter)
├──────────────────────────────────────┤
│ 🔍 Search title, author, genre…      │
│ Genre chips: SF · Fantasy · Mystery  │
│        Thriller · Romance · Nonfic   │
│ Min rating  ★★★★☆  [====·] 4.0+     │
│ [ Search ]                           │
├──────────────────────────────────────┤
│ results grid (1 col phone / 2–3 sm+) │
│ cover | title | author | ★ 4.5 (178) │
│ owned badge | Want | Audible/OL link │
└──────────────────────────────────────┘
```

**Similar tab:** multi-select from user's completed books with `rating >= 4` (or any completed if few ratings), primary button "Find similar high-rated books" → calls `/api/books/similar` — same loading copy pattern as Gaps ("30–60s…").

**Library tab:** quick win — client filter over `getLibraryForCurrentUser` books by title/author/series (what the stub promised). No external API.

### Nav

- BottomNav already has Search → `/search` ✅  
- Desktop `Nav.tsx` does **not** include Search — add `{ href: '/search', label: 'Discover', emoji: '🔍' }` next to Upcoming (small edit).

### Env / secrets

| Var | Phase |
|-----|-------|
| None for OL | v1 |
| `HARDCOVER_API_TOKEN` | Phase 2 |
| `GOOGLE_BOOKS_API_KEY` | only if we add GB fallback |
| Existing Audible tokens in `user_profiles` | reuse |

### Caching (optional, not blocking)

If OL or Audible rate-limits bite:
```sql
-- 006_discovery_cache.sql (only if needed)
create table discovery_cache (
  cache_key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null
);
```
TTL 24h for subject browses; 6h for similar. **Do not build until measured need.**

---

## Phased Implementation

Each phase is a shippable vertical slice in the spirit of Gaps (one focused sitting).

### Phase 0 — Spike (30–45 min, no UI)

1. Confirm `RawSimilarities` with a real user token + known ASIN (Hail Mary / whatever is in library).
2. Confirm `response_groups=rating,goodreads_ratings` on `GET /1.0/catalog/products/{asin}` — log shape.
3. One OL subject+sort=rating curl already verified in this plan.
4. Kill criteria: if `RawSimilarities` 400s, fall back to author+subject only for similar.

### Phase 1 — Discover page + Open Library (core value)

**Ship:** `/search` Discover tab works on phone.

| Task | Files |
|------|-------|
| `open-library.ts` | searchWorks, getWorkRatings, cover URL helper, normalize → `DiscoveryHit` |
| `discover.ts` | apply minRating/minCount, mark owned/wanted via library |
| `GET /api/books/discover` | auth optional for browse? **Prefer auth required** to match rest of app; demo user can skip |
| `SearchClient.tsx` + page | tabs, chips, slider, results, loading/error |
| Library tab local filter | pure client |
| Nav link | `Nav.tsx` |
| Wire external links | OL work page + cover images (`images.domains` in next.config if needed) |

**Acceptance:**
- Search "Project Hail Mary" returns hit with rating.
- Subject chip "Science Fiction" + min 4.0 returns sensible list.
- Owned books badged; no crash if OL slow (timeout ~12s, friendly error).

**Out of scope this phase:** Want button on OL-only hits, Similar tab, Hardcover.

### Phase 1.5 — Audible bridge + ratings enrich (same day or next)

| Task | Files |
|------|-------|
| Extend `getSeriesSims` types with `RawSimilarities` \| `ByTheSameNarrator` | `audible-catalog.ts` |
| `searchCatalogByKeywords(token, keywords, { sort: 'AvgRating' })` | same |
| `bridgeToAsin(token, title, authors)` using `normKey` / `authorNamesMatch` | `discover.ts` |
| Want button on Discovery cards | reuse `WantButton` patterns / want API |
| Optional: attach Audible `rating` when ASIN known | badge "Audible ★x.x" |

**Acceptance:** From an OL hit that exists on Audible, Want adds wishlist row with real ASIN.

### Phase 2 — Similar-to-these

| Task | Files |
|------|-------|
| `similar.ts` orchestration | multi-seed merge |
| `GET /api/books/similar` | maxDuration 60–120 like gaps |
| Similar tab UI | multi-select from high-rated completed books |
| Reasons on cards | "Because you liked X" |

**Acceptance:** Pick 2–3 loved books → get 10+ suggestions not already owned, mostly ≥ 4.0 when ratings exist.

### Phase 3 — Polish / Hardcover (optional)

- Hardcover enrich: if `HARDCOVER_API_TOKEN` set, overlay `rating`/`ratings_count` when ISBN or title matches.
- Genre chips derived from user's own top `books.genre` values.
- Persist nothing still — or add cache table if latency > 3s p50.
- "Hide" / not_interested on discovery hits (reuse flag if ASIN bridged).

---

## Implementation notes (conventions to match)

- **Server routes** refresh Audible like `/api/books/gaps` — do not put refresh token in client.
- **`export const maxDuration = 60`** (or 120) on similar route.
- **Rate discipline:** sequential or lightly pooled Audible calls (Gaps does per-series loop); OL can parallelize 3–5.
- **No new dependencies** unless Phase 3 wants a GraphQL helper (raw fetch is enough).
- **Phone:** single-column cards, sticky search bar, large tap targets (mirror `GapsClient` CTA).
- **Copy:** honest about rating source — "Community rating (Open Library)" not "Goodreads rating".
- **Images:** OL covers + existing Audible covers; follow `GapBookCard` `unoptimized` Image pattern.

---

## Risks / Kill Criteria

| Risk | Mitigation | Kill / pivot |
|------|------------|--------------|
| OL ratings too sparse / weird for niche books | Show rating only if `ratings_count >= 5`; sort relevance then filter | Add Hardcover Phase 3 |
| OL rate limiting / downtime | Cache; degrade to Audible-only discover when connected | Temporary banner |
| `RawSimilarities` missing/empty | Author + subject fallback | Still ship Similar with OL-only |
| ASIN bridge false positives | Strict `normKey` title equality + author match; else don't Want | Manual "Search Audible" link |
| `books.asin NOT NULL` blocks OL-only wants | Bridge required | Phase 3 schema: nullable asin + olid |
| Hardcover beta breaks | Feature-flag; OL remains primary | Disable enricher |
| Goodreads expectation mismatch | UI copy sets expectation | Don't scrape |
| Audible ToS (unofficial API) | Same posture as entire DogEar Audible integration | N/A — already accepted |
| next/image host config | Add `covers.openlibrary.org` to `next.config` | Use plain `<img>` like some cards |

**Kill the whole feature only if:** both OL search and Audible catalog keyword search are unusable in practice (unlikely — both verified live).

---

## Recommendation

**Build Phase 1 + 1.5 immediately. Do not chase Goodreads.**

### Why this path

1. **Darrin's constraint is explicit:** ratings without tying a Goodreads account. Goodreads cannot legally/practically provide that in 2026. Open Library can, today, with zero keys and verified `ratings_average` + `sort=rating`.
2. **Fits DogEar's architecture:** on-demand API route + client tab, extend `audible-catalog.ts`, reuse want flow — same shape as Gaps, not a parallel platform.
3. **Similar-to is actually stronger here than a pure OL app** because Audible already exposes **`RawSimilarities`** (documented; not yet wired). That is the real "customers also liked" signal; combine with OL subject/author + min rating for the "high ratings" half of the request.
4. **Hardcover is the right long-term ratings upgrade** if OL feels thin — free GraphQL, real community ratings — but beta + server token + multi-user policy make it a **Phase 3 enricher**, not the foundation.
5. **Scope stays one-sitting shippable:** Phase 1 is "make `/search` real with OL." Phase 1.5 is "Want works via ASIN bridge." Phase 2 is "Similar tab." That matches how Find Your Next Read shipped.

### What to tell Darrin in product language

> We can't pull live Goodreads ratings without an account or scraping (API dead since 2020; scraping breaks their terms). We'll use Open Library community ratings for discovery filters — free, no login — and Audible's own similar-books + ratings when you're connected. If we want denser "Goodreads-like" scores later, Hardcover's API is the legitimate upgrade path.

### Suggested build order (concrete)

1. Phase 0 spike (`RawSimilarities` + `goodreads_ratings` probe) — 30 min  
2. Phase 1 OL Discover on `/search` — main sitting  
3. Phase 1.5 ASIN bridge + Want + Audible keyword/AvgRating — same day if energy  
4. Phase 2 Similar tab — next sitting  
5. Phase 3 Hardcover only if ratings feel disappointing in real use  

---

## Appendix A — Key URLs

| Resource | URL |
|----------|-----|
| OL Search API docs | https://openlibrary.org/dev/docs/api/search |
| OL search endpoint | https://openlibrary.org/search.json |
| Hardcover getting started | https://docs.hardcover.app/api/getting-started/ |
| Hardcover search guide | https://docs.hardcover.app/api/guides/searching/ |
| Google Books using guide | https://developers.google.com/books/docs/v1/using |
| Audible external API (mkb79) | https://audible.readthedocs.io/en/latest/misc/external_api.html |
| Goodreads API deprecation | https://www.goodreads.com/api |
| StoryGraph API roadmap | https://roadmap.thestorygraph.com/features/posts/an-api |

## Appendix B — File checklist (v1)

```
src/lib/books/open-library.ts          NEW
src/lib/books/discover-types.ts        NEW
src/lib/books/discover.ts              NEW
src/lib/books/similar.ts               NEW (Phase 2)
src/lib/books/audible-catalog.ts       EXTEND sims types + keywords search
src/app/api/books/discover/route.ts    NEW
src/app/api/books/similar/route.ts     NEW (Phase 2)
src/app/search/page.tsx                REPLACE stub
src/app/search/SearchClient.tsx        NEW
src/app/search/DiscoverCard.tsx        NEW
src/components/Nav.tsx                 ADD Discover link
next.config.js                         ADD OL cover host if needed
projects/discovery-search-PLAN.md      THIS FILE
```

## Appendix C — Live verification log (2026-09-03)

- OL `subject=science+fiction&sort=rating` → 200, ratings present on docs  
- OL LOTR fields query → `ratings_average: 4.449`, `ratings_count: 118`  
- Google Books unauthenticated probe → 429 quota on shared environment (reinforces: needs own key, flaky as freebie)  
- Hardcover docs → free 5k/day, GraphQL search with `rating` field, server-only token, beta  
- Audible docs → `similarity_type` includes **`RawSimilarities`**; catalog sort includes **`AvgRating`**; product response_groups list **`goodreads_ratings`**  
- Goodreads → still deprecated; no new public API  
- StoryGraph → API still roadmap-only  

---

_End of plan._
