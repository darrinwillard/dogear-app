/**
 * Populate series_releases from Audible catalog for one user.
 *
 * Strategy:
 * 1) Series you actively follow → NextInSameSeries / InTheSameSeries sims
 * 2) Authors you've actually read → catalog products sorted by -ReleaseDate
 *
 * "Actively follow" basis = isInProgressSeries (readCount > 0 && readCount < totalCount)
 * PLUS caught-up series with a recent finish (owned-count catches "all owned are read"
 * even when Audible has a newer unreleased book — the whole point of this feature).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Book, SeriesInfo } from './types'
import { getSeriesDataFromBooks, isInProgressSeries } from './series'
import {
  authorNamesMatch,
  getSeriesSims,
  isRelevantReleaseWindow,
  normalizeCatalogProduct,
  releaseStatusForDate,
  searchCatalogByAuthor,
  seriesNamesMatch,
  type NormalizedCatalogRelease,
} from './audible-catalog'
import {
  encodeInterestNotes,
  getProfileColumns,
  getSeriesReleaseColumns,
  pickReleaseRow,
} from './releases-schema'

const RECENT_FOLLOW_DAYS = 540 // ~18 months — caught-up series still "followed"
const MAX_AUTHOR_SEARCHES = 35
const MAX_SERIES_SIMS = 40
const AUTHOR_PAGE_SIZE = 15

export interface ReleaseRefreshResult {
  success: true
  series_followed: number
  authors_searched: number
  candidates_seen: number
  upserted: number
  skipped_owned: number
  skipped_window: number
  errors: string[]
  sample: { title: string; series: string | null; releaseDate: string | null; kind: string }[]
}

interface WorkingRelease extends NormalizedCatalogRelease {
  interestKind: 'series' | 'author' | 'both'
  matchedSeries: string | null
}

function daysSince(isoDate: string | null): number | null {
  if (!isoDate) return null
  const t = new Date(isoDate).getTime()
  if (Number.isNaN(t)) return null
  return (Date.now() - t) / (1000 * 60 * 60 * 24)
}

/**
 * Series Darrin is actively following for release tracking.
 *
 * Core rule (matches app-wide isInProgressSeries): readCount > 0 && readCount < totalCount.
 * Also include caught-up series (all owned books read) — that's exactly when you care about
 * the *next* unreleased book. totalCount is library-owned count, not publisher total.
 *
 * lastReadDate is best-effort; many completed rows lack finished_at, so missing dates do
 * not disqualify a caught-up series with real read investment (readCount >= 2 or max pos >= 2).
 */
export function getFollowedSeries(series: SeriesInfo[]): SeriesInfo[] {
  return series.filter((s) => {
    if (s.readCount < 1) return false
    if (isInProgressSeries(s)) return true

    // Caught up on everything owned
    if (s.readCount < s.totalCount) return false

    const d = daysSince(s.lastReadDate)
    if (d != null && d > RECENT_FOLLOW_DAYS) return false

    // Substantial investment in the series (not a one-off)
    const maxPos = Math.max(
      0,
      ...s.books.map((b) => parseFloat(b.series_num || '0') || 0)
    )
    if (s.readCount >= 2 || maxPos >= 2 || s.totalCount >= 2) return true
    // Single-book series with a recent finish still counts
    if (d != null && d <= RECENT_FOLLOW_DAYS) return true
    return false
  })
}

function pickSeriesProbeAsin(s: SeriesInfo): string | null {
  // Prefer highest series position with an ASIN (latest owned → next sims)
  const sorted = s.books.slice().sort((a, b) => {
    const na = parseFloat(a.series_num || '0') || 0
    const nb = parseFloat(b.series_num || '0') || 0
    return nb - na
  })
  for (const b of sorted) {
    if (b.asin) return b.asin
  }
  return null
}

function authorReadCounts(books: Book[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const b of books) {
    const read =
      b.status === 'read' ||
      b.status === 'read_no_date' ||
      b.status === 'completed'
    if (!read) continue
    for (const raw of b.authors || []) {
      const name = raw.trim()
      if (!name) continue
      // skip empty / generic
      if (/^various$/i.test(name)) continue
      map.set(name, (map.get(name) || 0) + 1)
    }
  }
  return map
}

/** Deduplicate authors that are clearly the same person (Tolkien variants etc.) */
function pickAuthorSearchList(readCounts: Map<string, number>, limit: number): string[] {
  const entries = Array.from(readCounts.entries()).sort((a, b) => b[1] - a[1])
  const chosen: string[] = []
  for (const [name] of entries) {
    if (chosen.some((c) => authorNamesMatch(c, name))) continue
    chosen.push(name)
    if (chosen.length >= limit) break
  }
  return chosen
}

function mergeCandidate(
  byAsin: Map<string, WorkingRelease>,
  rel: NormalizedCatalogRelease,
  patch: { interestKind: 'series' | 'author'; matchedSeries: string | null }
) {
  const existing = byAsin.get(rel.asin)
  if (!existing) {
    byAsin.set(rel.asin, {
      ...rel,
      interestKind: patch.interestKind,
      matchedSeries: patch.matchedSeries,
    })
    return
  }
  // Upgrade author → both if series also matches
  let kind = existing.interestKind
  if (kind !== patch.interestKind) kind = 'both'
  if (existing.interestKind === 'both' || patch.interestKind === 'series') {
    // prefer keeping series classification visible
    if (existing.interestKind === 'series' && patch.interestKind === 'author') kind = 'both'
    if (existing.interestKind === 'author' && patch.interestKind === 'series') kind = 'both'
  }
  byAsin.set(rel.asin, {
    ...existing,
    ...rel,
    interestKind: kind,
    matchedSeries: patch.matchedSeries || existing.matchedSeries,
    // Prefer sims-derived series position when catalog left it empty
    seriesPosition: rel.seriesPosition ?? existing.seriesPosition,
    seriesName: rel.seriesName || existing.seriesName,
  })
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function refreshReleasesForUser(opts: {
  supabase: SupabaseClient
  userId: string
  accessToken: string
  books: Book[]
}): Promise<ReleaseRefreshResult> {
  const { supabase, userId, accessToken, books } = opts
  const errors: string[] = []
  const series = getSeriesDataFromBooks(books, [])
  const followed = getFollowedSeries(series)
  const ownedAsins = new Set(
    books.map((b) => b.asin).filter((a): a is string => Boolean(a))
  )

  const byAsin = new Map<string, WorkingRelease>()
  let candidatesSeen = 0
  let skippedOwned = 0
  let skippedWindow = 0

  // --- 1) Series sims for followed series ---
  let seriesSimsTried = 0
  for (const s of followed) {
    if (seriesSimsTried >= MAX_SERIES_SIMS) break
    const probe = pickSeriesProbeAsin(s)
    if (!probe) continue
    seriesSimsTried++
    try {
      const next = await getSeriesSims(accessToken, probe, 'NextInSameSeries', 10)
      const same = await getSeriesSims(accessToken, probe, 'InTheSameSeries', 20)
      const nextAsins = new Set(next.map((n) => n.asin))
      for (const rel of next.concat(same)) {
        candidatesSeen++
        if (ownedAsins.has(rel.asin)) {
          skippedOwned++
          continue
        }
        const isNext = nextAsins.has(rel.asin)
        const seriesOk =
          isNext ||
          (rel.seriesName ? seriesNamesMatch(rel.seriesName, s.name) : false)
        if (!seriesOk) continue
        if (!isRelevantReleaseWindow(rel.releaseDate)) {
          skippedWindow++
          continue
        }
        // Drop already-released earlier positions the user already owns past
        const maxOwnedPos = Math.max(
          0,
          ...s.books.map((b) => parseFloat(b.series_num || '0') || 0)
        )
        if (
          !isNext &&
          rel.seriesPosition != null &&
          maxOwnedPos > 0 &&
          rel.seriesPosition <= maxOwnedPos &&
          releaseStatusForDate(rel.releaseDate) === 'released'
        ) {
          skippedWindow++
          continue
        }
        mergeCandidate(byAsin, rel, {
          interestKind: 'series',
          matchedSeries: s.name,
        })
      }
      await sleep(120)
    } catch (e) {
      errors.push(
        `series sims ${s.name}: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  // --- 2) Author catalog searches ---
  const readCounts = authorReadCounts(books)
  // Prefer authors tied to followed series first, then top read authors
  const followedAuthors: string[] = []
  for (const s of followed) {
    if (s.author && !followedAuthors.some((a) => authorNamesMatch(a, s.author))) {
      followedAuthors.push(s.author)
    }
  }
  const topAuthors = pickAuthorSearchList(readCounts, MAX_AUTHOR_SEARCHES)
  const authorsToSearch: string[] = []
  for (const a of followedAuthors.concat(topAuthors)) {
    if (!authorsToSearch.some((x) => authorNamesMatch(x, a))) {
      authorsToSearch.push(a)
    }
    if (authorsToSearch.length >= MAX_AUTHOR_SEARCHES) break
  }

  let authorsSearched = 0
  for (const author of authorsToSearch) {
    authorsSearched++
    try {
      const products = await searchCatalogByAuthor(accessToken, author, {
        numResults: AUTHOR_PAGE_SIZE,
      })
      for (const rel of products) {
        candidatesSeen++
        if (ownedAsins.has(rel.asin)) {
          skippedOwned++
          continue
        }
        // Author must actually match (catalog author= is fuzzy)
        const authorHit = rel.authors.some((a) => authorNamesMatch(a, author))
        if (!authorHit) continue
        if (!isRelevantReleaseWindow(rel.releaseDate)) {
          skippedWindow++
          continue
        }

        // Classify series vs author-only
        const matchedSeries =
          followed.find(
            (s) =>
              rel.seriesName &&
              seriesNamesMatch(rel.seriesName, s.name)
          )?.name || null

        if (matchedSeries) {
          mergeCandidate(byAsin, rel, {
            interestKind: 'series',
            matchedSeries,
          })
        } else {
          // New from authors you've read — including new series / standalones
          // Skip pure deep back-catalog already released long ago (window handles)
          mergeCandidate(byAsin, rel, {
            interestKind: 'author',
            matchedSeries: null,
          })
        }
      }
      await sleep(150)
    } catch (e) {
      errors.push(
        `author ${author}: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  // --- Upsert ---
  const now = new Date().toISOString()
  const releaseCols = await getSeriesReleaseColumns(supabase)
  const profileCols = await getProfileColumns(supabase)

  const rows = Array.from(byAsin.values()).map((r) => {
    const seriesName = r.matchedSeries || r.seriesName || 'Standalone'
    const status = releaseStatusForDate(r.releaseDate)
    const full = {
      series_name: seriesName,
      series_position: r.seriesPosition,
      title: r.title,
      authors: r.authors,
      asin: r.asin,
      release_date: r.releaseDate,
      status,
      source: r.source,
      preorder_url: r.preorderUrl,
      notes: encodeInterestNotes(r.interestKind),
      interest_kind: r.interestKind,
      matched_series: r.matchedSeries,
      language: r.language,
      cover_url: r.coverUrl,
      content_type: r.contentType,
      updated_at: now,
      detected_at: now,
    }
    return pickReleaseRow(full, releaseCols)
  })

  let upserted = 0
  // Reliable merge by ASIN (preferred) or series_name+title.
  // Avoid depending on partial unique-index onConflict support in PostgREST.
  for (const row of rows) {
    try {
      if (row.asin) {
        const { data: existing } = await supabase
          .from('series_releases')
          .select('id')
          .eq('asin', row.asin)
          .maybeSingle()
        if (existing?.id) {
          const { error } = await supabase
            .from('series_releases')
            .update(row)
            .eq('id', existing.id)
          if (error) throw error
          upserted++
          continue
        }
      }

      const { data: byTitle } = await supabase
        .from('series_releases')
        .select('id')
        .eq('series_name', row.series_name)
        .eq('title', row.title)
        .maybeSingle()

      if (byTitle?.id) {
        const { error } = await supabase
          .from('series_releases')
          .update(row)
          .eq('id', byTitle.id)
        if (error) throw error
        upserted++
        continue
      }

      const { error } = await supabase.from('series_releases').insert(row)
      if (error) throw error
      upserted++
    } catch (e) {
      errors.push(
        `upsert ${row.asin || row.title}: ${e instanceof Error ? e.message : String(e)}`
      )
    }
  }

  // Always mirror covers onto books by ASIN so Upcoming can join them even when
  // migration 003 (series_releases.cover_url) has not been applied yet.
  // books.cover_url has existed since migration 001.
  try {
    await mirrorReleaseCoversToBooks(supabase, Array.from(byAsin.values()))
  } catch (e) {
    errors.push(
      `mirror covers to books: ${e instanceof Error ? e.message : String(e)}`
    )
  }

  // Stamp user profile when migration 003 column exists
  if (profileCols.has('last_releases_synced_at')) {
    await supabase
      .from('user_profiles')
      .update({ last_releases_synced_at: now })
      .eq('id', userId)
  }

  const sample = Array.from(byAsin.values())
    .sort((a, b) => {
      const da = a.releaseDate || '9999'
      const db = b.releaseDate || '9999'
      return da.localeCompare(db)
    })
    .slice(0, 8)
    .map((r) => ({
      title: r.title,
      series: r.matchedSeries || r.seriesName,
      releaseDate: r.releaseDate,
      kind: r.interestKind,
    }))

  return {
    success: true,
    series_followed: followed.length,
    authors_searched: authorsSearched,
    candidates_seen: candidatesSeen,
    upserted,
    skipped_owned: skippedOwned,
    skipped_window: skippedWindow,
    errors: errors.slice(0, 12),
    sample,
  }
}

/**
 * Mirror catalog cover URLs onto books.cover_url by ASIN.
 * Creates a lightweight books row when the ASIN is not already in the library,
 * so Upcoming can join covers without requiring series_releases.cover_url.
 */
export async function mirrorReleaseCoversToBooks(
  supabase: SupabaseClient,
  releases: Array<{ asin: string; title: string; authors: string[]; coverUrl: string | null; releaseDate: string | null }>
): Promise<{ mirrored: number; inserted: number }> {
  const withCover = releases.filter((r) => r.asin && r.coverUrl)
  if (!withCover.length) return { mirrored: 0, inserted: 0 }

  const asins = withCover.map((r) => r.asin)
  const existingByAsin = new Map<string, { id: string; cover_url: string | null }>()
  for (let i = 0; i < asins.length; i += 200) {
    const chunk = asins.slice(i, i + 200)
    const { data } = await supabase
      .from('books')
      .select('id, asin, cover_url')
      .in('asin', chunk)
    for (const row of data || []) {
      existingByAsin.set(row.asin, { id: row.id, cover_url: row.cover_url })
    }
  }

  let mirrored = 0
  let inserted = 0
  const nowIso = new Date().toISOString()

  for (const r of withCover) {
    const existing = existingByAsin.get(r.asin)
    if (existing?.id) {
      if (existing.cover_url === r.coverUrl) continue
      const { error } = await supabase
        .from('books')
        .update({ cover_url: r.coverUrl, updated_at: nowIso })
        .eq('id', existing.id)
      if (!error) mirrored++
      continue
    }

    const { error } = await supabase.from('books').insert({
      asin: r.asin,
      title: r.title || r.asin,
      authors: r.authors || [],
      cover_url: r.coverUrl,
      release_date: r.releaseDate,
      updated_at: nowIso,
    })
    if (!error) {
      inserted++
      existingByAsin.set(r.asin, { id: 'new', cover_url: r.coverUrl })
    }
  }

  return { mirrored, inserted }
}

// Re-export for tests / scripts
export { normalizeCatalogProduct }
