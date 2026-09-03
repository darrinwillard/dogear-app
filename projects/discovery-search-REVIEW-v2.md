# Discovery Search Plan v2 — Adversarial Review

**Reviewer:** adversarial subagent (round 2) · **Date:** 2026-09-03
**Plan under review:** `projects/discovery-search-PLAN.md` (v2, post-Darrin ratings-hierarchy decision)
**Prior review:** `projects/discovery-search-REVIEW.md` (v1 findings F1–F7)
**Verified against:** `audible-catalog.ts`, `types.ts`, `queries.ts`, `gaps/route.ts`, `gaps.ts`, `want/route.ts`, `releases-refresh.ts`, all 5 migration files (001–005), plus **live HTTP probes against goodreads.com performed by this reviewer, independent of the producer's session.**

---

## Headline finding first

The producer's live-verification claims for Goodreads (200 on first book-detail request, clean JSON-LD `aggregateRating` with the exact numbers `4.51 / 1850217 / 256924`, WAF challenge on repeat/search) are **independently reproducible — I got byte-for-byte identical rating numbers on my own first request.** This is real, not fabricated. That's the good news.

The bad news: **my own probing found the WAF blocking to be meaningfully worse than the plan describes**, in a way that undermines the plan's core mitigation strategy (ISBN-first lookup, spacing, per-run caps). See F1 below — this is the load-bearing finding of this review.

---

## What's genuinely fixed from v1 (no re-flag needed)

- **F3 (token-refresh bugs):** Genuinely fixed. The proposed `refreshAudibleAccessToken` helper in the plan correctly addresses all three bugs I independently confirmed still exist in the live `gaps/route.ts` (no `res.ok` check before `.json()`, unguarded `JSON.parse`, no timeout). The helper code shown is complete, not pseudocode, and handles each failure mode with a distinct typed error. ✅ **But see F4 below — "will be retrofit" ≠ "is retrofit."**
- **F7b (`DiscoveryHit.id` dual namespace):** Genuinely fixed. New `discover-types.ts` design uses a normalized `title|author` key as `id` and carries `asin`/`olid`/`goodreadsId` as separate fields. Clean fix, no residual ambiguity.
- **F7a (Hardcover phase inconsistency):** Moot by removal — Hardcover is dropped entirely. Confirmed no residual references to it in Phase 2/3.
- **F5 (OL User-Agent, rating-count anomaly, subject noise):** Correctly scoped down — OL is no longer a ratings source so most of F5's teeth are gone. The one remaining live risk (User-Agent header) is correctly flagged as a trivial one-line fix if OL is kept at all.
- **F6 (gaps.ts rate-limit maturity):** Correctly reframed — the plan no longer claims Gaps-style sequential loops are real backoff, and explicitly gives Goodreads scraping a stricter, separate limiter. Accurate, not overstated.
- **Schema drift claim on `books.genre` (F7c input):** Independently reconfirmed. `genre` appears nowhere in migrations 001–005 but is selected in `BOOK_EMBED` in `queries.ts`. The plan's description of this is accurate.
- **`gr_rating` vs `goodreads_rating` distinction:** Verified real, not a false claim. `gr_rating` is fed exclusively from `user_books.rating` (a 1-5 star personal rating, seeded from a one-time JSON import — confirmed via `map.ts:152` and the `reading-tracker.json` seed data) and displayed/edited in `LibraryClient.tsx`. It has nothing to do with a live Goodreads scrape. The new `goodreads_rating` column is a distinct, unrelated concept (a public aggregate rating cached from a scrape). No naming collision risk in practice, though see F5 (minor) below for a documentation nit.

---

## Findings

### F1 — CRITICAL: The WAF-blocking mitigation strategy is built on an incomplete read of the actual blocking behavior — independently reproduced and it's worse than described

**Where:** Research Findings §2, Goodreads scrape design (Phase 1.5b), Risks table.

I ran my own live HTTP probes against `goodreads.com` this session, independent of the producer's tool calls (I have no way to verify the producer actually has live HTTP fetch capability — see F1a below — so I treated the underlying factual claims as needing independent verification, not trusted self-report).

**What I found, in order:**

1. `GET /book/show/54493401-project-hail-mary` (fresh session, standard browser UA) → **HTTP 200**, full page, JSON-LD `aggregateRating: {ratingValue: 4.51, ratingCount: 1850217, reviewCount: 256924}` — **exact match to the producer's cited numbers.** This part is real and independently confirmed.
2. `GET /search?q=project+hail+mary` (same session, immediately after) → **HTTP 200** with real search results (title in page: `"Search results for "project hail mary" (showing 1-17 of 98 books)"`) — **this contradicts the plan's claim that search is "the most aggressively gated surface" and gets challenged reliably.** In my probe, search succeeded and the *detail page repeat* is what got blocked.
3. `GET` the **same** book-detail URL again, 2 seconds later → **HTTP 202, `x-amzn-waf-action: challenge`**, empty body. Matches the plan's finding of fast-triggering challenge on repeat access.
4. Waited **15 seconds**, retried the same URL → still 202/challenged.
5. Waited **60 seconds**, retried with a **different User-Agent and no cookie reuse** (simulating a fresh scrape run) → still 202/challenged.
6. Tried the **ISBN-direct-lookup path** the plan explicitly recommends as the safer alternative (`/book/isbn/9780593135204`) → **HTTP 301 redirect to the exact same book-detail URL that is already challenged.** ISBN lookup is not an independent, less-gated code path — it's a redirect wrapper around the same URL. Once that URL is challenged, the "safer" ISBN path inherits the block, it does not avoid it.
7. Tried a **completely different book never touched this session** (`/book/show/18007564-the-martian`) → **HTTP 202/challenged on the very first request.** This is the most important result: the block is not per-URL, it's per-IP/session, and once triggered it appears to blanket-block *all* subsequent Goodreads book-detail requests from that source, not just the specific title that was hit twice.
8. Immediate retry of that same new book → still 202/challenged.

**Why this matters — three concrete gaps in the plan's mitigation design:**

- **The plan's central mitigation ("prefer ISBN-direct lookup over search, since ISBN-keyed lookups are less aggressively gated") does not hold up.** My probe shows ISBN lookup 301-redirects into the *same* `/book/show/{id}-{slug}` URL space that is already blocked once a session is flagged. It is not a distinct, less-defended endpoint — it's the same endpoint with an extra redirect hop. The GitHub issue the plan cites says "lookup via ISBN is still safe" in the context of *avoiding the free-text search endpoint*, which my test confirms is actually the more resilient of the two in practice (my search request succeeded when the detail-page repeat did not) — the plan has this backwards, or at least oversimplified from the source.
- **The block, once triggered, is not scoped to "this book" or "this endpoint" — it appears to flag the requesting IP/session more broadly**, blocking a never-before-requested title on the first try. This means the weekly job's "per-book try/catch, skip and move on" design will not behave as described: once challenged on book #1, the plan's circuit-breaker logic ("stop the whole run early if a WAF challenge is seen") is the *right* call, but the plan frames this as a possible/likely-but-uncertain outcome ("if genuinely unworkable... shrink cap further"). My test suggests it is not an edge case to plan around — it is closer to the default outcome for any sustained sequential run from one IP, even with multi-second spacing, because the block appears to trigger on volume/pattern within a short window rather than purely on request rate to a single URL.
- **60 seconds of cooldown was not enough to un-block** in my test. The plan's "graceful degradation" language implies degradation is per-book and transient; my results suggest a challenged run may realistically get **1 successful book scrape per run** (or per IP-cooldown-period) rather than the 25-40/week the plan's Phase 0 spike section anticipates as the likely conservative-pacing outcome ("this session saw it after ~2-3 rapid requests — establish a real, evidence-based per-run pacing, not a guess"). The plan's own Phase 0 spike design (3-5 titles, spaced several seconds apart) is very likely to reproduce exactly what I found: challenge after the first or second real request, then a sustained block for the rest of that run.

**Fix required before greenlighting:**
1. Correct the plan's characterization: search may be *more* resilient than detail-page-repeat in practice, not less — Phase 0's actual spike needs to test both orderings (search-first vs detail-first) rather than assuming detail/ISBN is the safe path.
2. Explicitly test — as part of Phase 0, not assumed — whether the block is IP-session-scoped (as my results suggest) or narrowly per-URL. If IP-session-scoped, the realistic weekly yield may be 1 book per run, which changes the feature's value proposition materially (Darrin should know this before greenlighting, not discover it after ship).
3. Do not present the ISBN-lookup path as a distinct mitigation from detail-page scraping in the code/design — it is the same page behind a redirect. Remove or correct this specific claim in `goodreads-scrape.ts`'s design comments and the Risks table.
4. Given how easily and broadly the block triggered in my test (within 3 total requests across 2 different titles, from a source that had never touched Goodreads before this session), Darrin should be told plainly: **the realistic near-term outcome of the weekly Goodreads refresh job may be "scrapes 0-1 books, then blocks itself for the rest of the run, every single week,"** not "conservatively scrapes 25-40 books/week." That's a materially different feature than what's being sold to him in the "What to tell Darrin" section.

### F1a — MAJOR: The plan's "live verification" framing overstates independent confidence, even though the underlying facts check out

**Where:** Appendix C, "Live verification log."

To be fair to the producer: every specific number and behavior cited in Appendix C (the 200, the JSON-LD block, the exact rating/count/review numbers, the 202+WAF-challenge on repeat, the GitHub issue citation) reproduced in my independent test. This is **not a fabricated claim** — score this well above what I'd expect from an LLM stating something without live tool access, since the specific numbers (`1850217`, `256924`) are exactly right and would be a wild coincidence to guess.

However, the plan's Appendix C entry "Repeat request to the *same* book-detail URL... also came back 202/challenged on retry (with and without a 5s delay, with a different User-Agent string)" reads as if the producer tested the **scope** of the block (same-URL-only vs broader) and found it narrow. My test found the opposite — the block generalized to an untouched second title within the same session. The plan's evidence log doesn't claim to have tested a second, different book; it only re-hit the same URL. That's a real gap between "verified" and "verified only the narrowest version of the claim, then generalized the mitigation design as if the broader case had also been tested."

**Fix:** Don't remove or distrust the existing verification — it's solid. But don't let Phase 0's Goodreads spike stop at "does this exact behavior reproduce" — it must test cross-title blocking, which is the piece that actually determines whether the weekly-job design is viable at all.

### F2 — RESOLVED (with one residual gap): Phase 1+1.5 merge genuinely fixes the "dead button" problem, but the fallback ordering has an unaddressed edge case

**Where:** Decision #11, ASIN bridge section, Phase 1 acceptance criteria.

The merge is real, not cosmetic — Phase 1's task list now includes the ASIN bridge, and the primary-action design (`want` / `open_audible` / `open_goodreads` / `open_open_library`) genuinely assigns an action to every hit rather than shipping a read-only demo. This is a correct, complete fix for v1's F2. ✅

**Residual gap the plan doesn't address:** What happens to a hit that (a) has no Audible ASIN match (bridge fails) **and** (b) has no Goodreads URL either, because the Goodreads *lookup itself* never found a matching page (title/author fuzzy match failed, or — per F1 above — the scrape was WAF-blocked for that run)? The plan's `primaryAction` type includes `open_goodreads`, but that field is only populatable if a `goodreadsUrl` was actually resolved. Given F1's finding that Goodreads lookups may fail far more often than assumed, this "no bridge, no Goodreads URL" case is not a rare edge case — it may be the **common** case for any hit whose Goodreads sync hasn't run yet or got WAF-blocked. The plan's data flow diagram shows the fallback chain ending at `open_open_library`, but Open Library is explicitly optional/deferred (Decision #2) and may not be built in Phase 1 at all. If OL isn't built and Goodreads didn't resolve, **there is no card action** — this is the exact class of bug F2 was supposed to eliminate, just moved one layer down.

**Fix:** Specify explicitly what `primaryAction` becomes when Audible bridge fails, Goodreads URL is unresolved, AND Open Library is not in scope for this build. A safe, honest fallback (e.g., a disabled state with "not found on Audible or Goodreads yet" is *not* a dead button in the F2 sense if it's explicit and doesn't pretend to be clickable — but the plan needs to say this, not leave `primaryAction` unpopulated for this path).

### F3 — SUPERFICIALLY FIXED: The shared token-refresh helper is real, but the "retrofit gaps/route.ts" claim is a promise, not a verified completion

**Where:** Decision #10, "Shared token-refresh helper" section, Appendix B file checklist.

The helper code itself is complete and correctly designed (verified: addresses all three bugs I confirmed live in `gaps/route.ts`). But the plan states in multiple places — Decision #10 ("Fix once, use everywhere"), the retrofit note ("`/api/books/gaps/route.ts` should be updated to call this helper too"), and Appendix B ("RETROFIT — use shared refreshAudibleAccessToken helper (F3)") — **as if this is a scoped, tracked task, but it is listed as a "should be" / task-list bullet, not gated by an acceptance check the way Phase 0 is.** Nothing in Phase 1's acceptance criteria explicitly requires verifying that `gaps/route.ts` no longer contains the inline duplicate token logic after the build. It would be easy to ship Phase 1 with the new helper used only in the *new* routes (discover/similar) and the old `gaps/route.ts` left untouched — "new code is safe, old code still isn't," which is the exact anti-pattern F3 called out originally.

**Fix:** Add an explicit Phase 1 acceptance line: "`gaps/route.ts` has zero inline token-refresh code; it imports and calls `refreshAudibleAccessToken`." Make it a checked box, not an aspiration buried in a task table.

### F4 — RESOLVED: Ratings-hierarchy change genuinely fixes F4's data-density concern, but introduces the reliability risk F1 identifies

The four-orders-of-magnitude count difference (178 vs 1,850,217) is real and independently reproducible. F4 as originally scoped (worry: OL counts too thin) is legitimately resolved by the source change itself — no argument here.

But this "fix" is coupled to the assumption that the Goodreads scrape reliably delivers that dense count on a meaningful fraction of lookups. Per F1, that assumption needs re-testing. **If F1's finding holds (block generalizes fast, cooldown is long), the ratings-density improvement is theoretical for the "first N weeks after this ships" — Darrin's Discover results may show mostly-null Goodreads fields for a long while**, which is a different failure mode than v1's (universally-thin-but-present OL numbers) but could look similarly unsatisfying in the UI. The plan's Phase 1 acceptance check ("if the weekly scrape hasn't run yet for a fresh book, its Goodreads fields are legitimately null... expected first-run behavior, not a bug") is reasonable framing for week 1, but doesn't address "still null in week 6 because every run gets blocked after book #1."

### F5 — MINOR: Migration 006 lacks the range `check` constraint every other rating-adjacent column in this schema has

**Where:** `supabase/migrations/006_goodreads_ratings.sql` (proposed).

Verified against every existing migration: `001_initial_schema.sql` constrains `user_books.rating` with `check (rating >= 1 and rating <= 5)`, and `004_half_star_ratings.sql` tightens that to also require half-star granularity (`(rating * 2) = floor(rating * 2)`). The proposed `006` migration adds `goodreads_rating numeric` with **no check constraint at all** — not even a `>= 0 and <= 5` bound, despite the column comment explicitly describing it as a "0-5" scale. This is a real, if minor, deviation from the schema convention the plan itself claims to be following ("following the exact pattern of migrations 002/003/004/005"). A scrape bug that extracts `ratingCount` into the `ratingValue` slot (or a JSON-LD parsing error that grabs the wrong number) would silently write an out-of-range value with nothing in the DB layer to catch it.

**Fix:** Add `check (goodreads_rating is null or (goodreads_rating >= 0 and goodreads_rating <= 5))` and `check (goodreads_ratings_count is null or goodreads_ratings_count >= 0)` to the migration. Trivial, consistent with existing convention, and cheap insurance against a bad scrape silently corrupting displayed ratings.

### F6 — MINOR: "Never tried" vs "tried and failed" is genuinely indistinguishable in the proposed schema — the plan doesn't resolve this despite implying it does

**Where:** Decision #9, migration 006 design, `goodreads_synced_at` column comment.

The plan was specifically asked (by the task brief and implicitly by good design practice) whether a book's *first* scrape attempt, if it fails, is distinguishable from a book that's simply never been scraped yet. Checking the actual proposed schema: `goodreads_rating`, `goodreads_ratings_count`, `goodreads_url` are all nullable, and `goodreads_synced_at` is described as "Last **successful** (non-blocked, non-error) Goodreads scrape... Used to prioritize stalest rows on the next weekly run." 

This means: a book that has never been attempted and a book that has been attempted 20 times and WAF-blocked every time **look identical in the database** — both have `goodreads_synced_at IS NULL` and all rating fields null. The "prioritize stalest rows" logic the comment describes will, in practice, mean **the same handful of unlucky books get retried every single week forever** (they're always "stalest" — infinitely stale — because a failed attempt never updates the timestamp), while a book that succeeded once six months ago is correctly deprioritized. Combined with F1's finding that most runs may end after 1 book, this could produce a worse outcome than random: the job could get stuck making zero net progress across the whole catalog, repeatedly attempting (and failing on) the same never-successfully-synced books while a large fraction of the catalog never gets a first attempt at all.

**Fix:** Add a `goodreads_last_attempted_at` (or similar) column distinct from `goodreads_synced_at`, so "attempted but failed" is a real, trackable state separate from "never tried." Use `last_attempted_at` (not `synced_at`) to pick the next batch, so failed attempts still rotate through the queue instead of being retried forever at the expense of never-attempted rows.

### F7 — MINOR: Ratings hierarchy display logic is well-specified in the data model but the "when only one exists" cases are only implied, not stated

**Where:** Decision #1, `DiscoveryHit` type, UI mockup.

The API shape (`audibleRating`/`audibleRatingCount`/`goodreadsRating`/`goodreadsRatingCount`, all independently nullable) is genuinely well-specified as *data* — no hand-waving there, this is a clean, complete shape that supports every combination (both present, either alone, neither). The UI mockup shows the "both present" case explicitly ("★ Audible 4.6 · GR 4.51 (1.85M)"), but the plan never shows or states what renders when only one exists (does it say "Audible 4.6" with no GR mention, or "Audible 4.6 · GR —"?) or when neither exists (blank rating area? "Not yet rated"? omitted entirely, changing card height inconsistently across a grid?). This is a client-rendering decision, not a backend one, so it's lower severity than F1-F4, but it's the kind of unspecified detail that becomes a real "wait, what should this look like" pause during Phase 1 build, not before.

**Fix:** Add one line to the UI section per rating-availability combination (both / audible-only / goodreads-only / neither) before Phase 1 starts, so `DiscoverCard.tsx` isn't designed ad hoc mid-build.

### F8 — MINOR (framing/product, not code): The ToS/legal risk framing is accurately presented as Darrin's decision, but the plan's own evidence should make the risk read heavier than the current tone

**Where:** Decisions table row 3, Risks table ("Goodreads ToS (scraping)... Darrin's explicit, informed decision... documented here as the record of that decision").

The plan does correctly avoid silently normalizing this as "no big deal" — it's explicitly logged as an accepted, informed risk, which is the right way to handle a user's deliberate risk acceptance. No finding of bad faith here. But given F1's result (the block is broader/faster/stickier than the plan's own Research Findings §2 implies), the "single-user, infrequent, low-volume" framing that made this an easy accept for Darrin may need a second look **specifically because "infrequent, low-volume" may not even be achievable in practice** — if the realistic yield is ~1 book/run, "infrequent" isn't a choice DogEar is making to be polite, it's the ceiling AWS WAF is imposing regardless of intent. That's a materially different risk profile than "we chose to go slow" and worth flagging back to Darrin now that F1 is known, not silently absorbed into "well, we already decided this."

---

## Verdict

**Not safe to greenlight as-is. This is closer to buildable than v1 was, but F1 is a load-bearing factual correction that changes the Goodreads feature's realistic shape, and it must be resolved — via Phase 0's actual spike, run and reported, not via plan edits — before Phase 1 is scoped as "the Discover page with a working weekly ratings pipeline."**

**What must change before Darrin greenlights implementation:**

1. **Run Phase 0's Goodreads spike for real, before writing any more plan text, and specifically test what my probe tested:** (a) does hitting a second, never-touched book right after a first hit also get challenged (block scope), (b) does the ISBN path actually behave differently from the detail-page path (I found it doesn't — same URL via redirect), (c) how long is the actual cooldown (I found 60s insufficient; the plan should test 5, 15, 60 minutes and next-day). Report the real numbers, not the "~2-3 rapid requests" estimate currently in the plan, which was derived from a narrower test than the situation warrants.
2. **Tell Darrin the honest range of outcomes before he commits**, given F1: best case matches the plan as written (conservative pacing works, ~25-40 books/week); realistic-per-my-probe case is closer to 0-1 successful new scrapes per weekly run indefinitely, which would make "Goodreads secondary ratings" a rarely-populated field rather than the dense-data win the plan sells. Both are honest possibilities; the plan currently reads as if the first is the likely outcome and the second is a tail-risk contingency, when my independent test suggests the reverse may be true.
3. **Fix the ISBN-lookup mitigation claim** — it is not a separately-gated, safer endpoint; it 301-redirects into the same detail-page URL space. Remove this as a stated mitigation until re-verified, or verify it behaves differently at scale (e.g., maybe the redirect itself is what's cheap/safe and the WAF only engages on the *final* page render regardless of entry path — but that means ISBN lookup offers zero protection over direct detail-page hits, which is the opposite of what the plan claims).
4. **Add the `check` constraints to migration 006** (F5) and **the never-tried vs. tried-and-failed distinction** (F6) — both are cheap, mechanical fixes that prevent real future bugs and take minutes to add.
5. **Close the "no bridge + no Goodreads URL + OL not built" dead-end** (F2 residual) explicitly in `primaryAction` logic before claiming F2 is fully resolved.
6. **Retrofit `gaps/route.ts` to actually call the new helper** (F3) needs to be a checked Phase 1 acceptance item, not a task-list bullet that's easy to skip under time pressure.

None of these require a rewrite — the architecture, the merged Phase 1+1.5 shape, the shared token helper, and the dedupe-key fix are all sound and should stay as designed. But F1 specifically means **the Phase 0 spike's Goodreads portion needs to be re-run with a wider test (cross-title, longer cooldowns, both entry paths) and its actual results — not the plan's current estimate — need to drive the pacing/cap numbers in Phase 1.5b before that code is written.** Ship Phase 0 first, look at the real numbers, then decide whether Phase 1's Goodreads scope is "weekly background job as designed" or "manual/rare fallback link only" — that's a fork in the plan that today's version resolves optimistically rather than by evidence.
