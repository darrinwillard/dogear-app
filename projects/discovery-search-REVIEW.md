# Discovery Search Plan — Adversarial Review

**Reviewer:** adversarial subagent · **Date:** 2026-09-03
**Plan under review:** `projects/discovery-search-PLAN.md`
**Verified against:** `audible-catalog.ts`, `types.ts`, `001_initial_schema.sql`, `api/books/gaps/route.ts`, `gaps.ts`, `api/books/want/route.ts`, plus one live Open Library API probe.

---

## What checks out (verified, no criticism warranted)

- **Open Library claims are real, not fabricated.** I independently hit `search.json?subject=science+fiction&sort=rating&fields=...ratings_average,ratings_count` live (2026-09-03): HTTP 200, `numFound: 91287`, Hitchhiker's Guide `4.511/178` and Project Hail Mary `4.5/178` — exactly matching the plan's Appendix C. `sort=rating` and the ratings fields work as claimed. ✅
- **Goodreads/StoryGraph verdicts** are accurate and honest. ✅
- **Schema reading is correct:** `books.asin text unique not null` and `user_books.asin text not null` + `unique(user_id, asin)` per `001_initial_schema.sql` — the plan's own constraint summary matches the actual migration. `POST /api/books/want` does hard-require an `asin` (400 without one), so the plan's "bridge required, don't invent ASINs" logic is consistent with reality. ✅
- **"No new tables/migrations for v1"** holds up *for the data layer as scoped* (on-demand, no persistence, want-via-existing-route). ✅
- **Rate/timing math for Similar is actually fine, not optimistic:** Gaps today runs up to 40 series sims + 40 author searches *sequentially* inside `maxDuration = 120` and ships. Similar's 3 seeds × 1 sims call + a few parallel OL fetches is an order of magnitude lighter. ✅

---

## Findings

### F1 — MAJOR: `RawSimilarities` and `goodreads_ratings` are **documented, not verified** — but parts of the plan already treat them as fact

**Where:** Ratings Research §6 ("Newly relevant (documented, not yet in our client)"), Recommendation #3, Appendix C.

The repo's own `audible-catalog.ts` header lists the **only live-probed** endpoints: author search and sims types `NextInSameSeries | InTheSameSeries | ByTheSameAuthor` (probe 2026-09-01). `RawSimilarities`, `ByTheSameNarrator`, `response_groups=rating`, and `goodreads_ratings` appear **nowhere** in the codebase — they come solely from the mkb79 docs, which document a reverse-engineered API and are frequently stale. Appendix C's "Live verification log" lists "Audible docs → similarity_type includes RawSimilarities" — that's a *docs read*, not a live call, sitting in a section titled "Live verification." Recommendation #3 then asserts "Audible already exposes RawSimilarities… That is the real 'customers also liked' signal" as settled fact.

**Mitigation exists:** Phase 0 spike + kill criteria ("if RawSimilarities 400s, fall back to author+subject") is the right design. The problem is framing, not architecture — if the spike fails, the Similar feature's headline mechanism degrades to subject/author overlap, which is a materially weaker feature than what the Recommendation sells.

**Fix:** Relabel Appendix C entries to distinguish "live probe" vs "docs only." Make Phase 0 a **hard gate** with an explicit report-back before Phase 2 is scoped, and rewrite Recommendation #3 as conditional. Also note: `goodreads_ratings` on an Amazon-internal response group is exactly the kind of field Amazon quietly strips; treat any spike success as fragile and never build UI that *depends* on it (plan says "optional badge" — keep it that way).

### F2 — MAJOR: The ASIN bridge leaves Phase 1's flagship UX half-broken by design

**Where:** "ASIN bridge" section; Phase 1 "Out of scope: Want button on OL-only hits"; Risks table row 5.

The pitch is "discover books beyond your library, tap Want." But: Open Library's universe is print/ebook-heavy; a large fraction of hits (especially with `subject=` browsing) will have **no Audible edition** or a fuzzy-match failure. For every such hit, the Want button is "blocked with message." Worse, in **Phase 1 the Want button doesn't exist at all** — Phase 1 ships a search page where you can look at books and… open an external OL link. That is a read-only demo, not the feature. Day-one experience: Darrin searches, finds something good, and can't act on it inside the app.

Additionally, the bridge's failure mode compounds F5: OL-only hits are precisely the ones most likely to *also* have thin/no ratings, so the weakest results are also the ones with no action.

**Fix:** Don't ship Phase 1 to Darrin as "done" without 1.5 — treat Phase 1+1.5 as one deliverable (the plan's own build order hints at this; make it explicit). For unbridgeable hits, don't show a dead "blocked" Want — render the card's action as "Open Library ↗" from the start so nothing looks broken. And honestly re-cost the "nullable asin + olid" migration: it's ~1 migration + touching want route + queries, not a huge blast radius; if real usage shows >30% unbridgeable hits, it should be Phase 2, not a hypothetical Phase 3.

### F3 — MAJOR: The token-refresh pattern the plan says to copy has real latent bugs

**Where:** Architecture table "Auth token refresh — copy for any Audible-backed discovery routes."

`api/books/gaps/route.ts` (the template) has known weaknesses beyond the already-fixed nonexistent-column bug:
- **No `res.ok` check and unguarded `refreshResponse.json()`** — if Amazon returns 429/5xx with an HTML or empty body, `.json()` throws and the user gets a generic 500 instead of "reconnect Audible."
- `JSON.parse(profile.audible_refresh_token)` is unguarded — a malformed stored token → 500.
- `audibleGet` in `audible-catalog.ts` has **no fetch timeout** — a hung Audible call burns the whole `maxDuration` and surfaces as a platform timeout, not the plan's promised "friendly error." The plan specifies a 12s timeout for OL but is silent on Audible timeouts.

Copying this verbatim into two new routes triples the surface area of these bugs.

**Fix:** Before or during Phase 1.5, extract a shared `refreshAudibleAccessToken(profile)` helper with `res.ok` check, try/catch on parse, and typed error → 401 "reconnect" response. Add `AbortSignal.timeout(10_000)` (or similar) to `audibleGet`. Small, cheap, and every existing route benefits.

### F4 — MAJOR (product, not code): Deferring Hardcover to Phase 3 risks the feature disappointing on first real use

**Where:** Decisions #5, Phase 3, "Ratings options" table.

The plan's own data: OL counts are "dozens–low hundreds" (verified — 178 ratings on *Project Hail Mary*, one of the most popular SF books of the decade). For mid-list and niche audiobooks — Darrin's actual discovery zone — OL will frequently show **no rating at all**, and the default `minRatingsCount: 5` filter will silently empty results for niche subject queries. The feature's entire value prop is "high ratings without Goodreads"; if the first three searches return unrated or 3-rating books, the feature reads as broken regardless of how correct the plumbing is. The plan's mitigation ("show rating only if count ≥ 5") makes results *sparser*, not better.

Hardcover's stated risks (beta, token reset) are real but modest for a single-operator app behind a feature flag — arguably *lower* operational risk than the unofficial Audible API the app is already built on.

**Fix:** Either (a) pull Hardcover forward to Phase 2 as a flagged enricher, or (b) add an explicit acceptance criterion to Phase 1: run 5 realistic Darrin-style searches and count what % of top-20 hits carry a rating with count ≥ 5. If < ~50%, Hardcover jumps the queue. Don't let "Phase 3, optional" be where the value prop quietly dies. Also: surface Audible's own `rating` response group (Phase 1.5 item E) on every bridged hit, not just as a nice-to-have — Audible rating density is far better than OL for audiobooks.

### F5 — MINOR: Open Library operational details hand-waved

- **No User-Agent policy:** OL's API guidelines request a descriptive `User-Agent` (with contact info) and throttle/block anonymous heavy clients. The plan never mentions request headers. One-line fix in `open-library.ts`.
- **Rating-count anomaly:** both top results in my live probe show `ratings_count: 178` — suspicious uniformity suggesting OL's rating aggregation has quirks. Don't build ranking logic that trusts counts as precise; treat as coarse signal.
- **`subject=` semantics:** OL subject search matches noisy subject tags ("science-fiction" vs "hard science-fiction" vs "Fiction, science fiction, general"). Genre chips will need a small curated mapping; the plan implies chips → `subject=` 1:1.

### F6 — MINOR: `gaps.ts` error-handling maturity is overstated as a pattern

The plan calls the Gaps pattern proven. It works, but its "rate discipline" is just *sequential loops with catch-and-continue* — no backoff, no 429 detection, no partial-result signaling to the client (a series that errors silently disappears). Fine to reuse for Similar's 3 seeds, but don't describe it as rate-limit handling; if Similar later grows past a handful of seeds, add real 429/backoff first.

### F7 — MINOR: Internal inconsistencies in the plan

- Decision #5 says Hardcover is "**Phase 2** optional enricher"; the Phased Implementation puts it in **Phase 3** (Phase 2 = Similar). Pick one.
- `DiscoveryHit.id` is "olid work key **or** asin" — one field, two namespaces; a merged Audible+OL hit for the same book can appear twice with different ids. Specify the dedupe key (the plan's normalized title+author key) as the id, or carry both ids and dedupe explicitly.
- `types.ts` `Book` has `gr_rating`/`genre` as claimed ✅, but `genre` is described as "from Audible's category_ladders, when available (falls back to series heuristic)" — the Similar flow (step 3) leans on `books.genre` as the OL subject seed; for many rows it will be null or a heuristic guess, so the OL-subject leg of Similar will frequently fire on garbage or nothing. Plan should state the fallback (derive subjects from an OL title lookup of the seed) as the *primary* path, not the backup.

---

## Verdict

**Not safe to greenlight as-is — needs targeted revision, not a rewrite.** The research layer is genuinely solid (OL claims independently verified; Goodreads/StoryGraph verdicts correct; schema reading accurate; Similar timing math conservative). The architecture reuse is sensible. Required changes before build:

1. **F1:** Phase 0 spike becomes a hard gate with results reported before Phase 2 scoping; relabel "documented" vs "live verified" honestly.
2. **F2:** Phase 1 and 1.5 merge into one deliverable; unbridgeable hits get a real action (OL link as primary CTA), not a blocked button; re-cost the nullable-asin migration honestly.
3. **F3:** Extract + harden the shared token-refresh helper and add Audible fetch timeouts *before* copying the pattern into two new routes.
4. **F4:** Add the ratings-density acceptance check to Phase 1; pre-commit to promoting Hardcover if OL density fails it.

F5–F7 are fix-in-passing items. With those four changes the plan is buildable and the phasing is realistic.
