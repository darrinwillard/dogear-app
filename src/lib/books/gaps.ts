/**
 * Series/author gap detection — "books I've missed."
 *
 * For every series/author the user has read at least one book from, fetch
 * the full Audible catalog list for that series/author and diff against
 * the user's owned ASINs (books table). Anything Audible has cataloged
 * that the user doesn't own is a candidate gap: either a book they read
 * outside Audible (Kindle/physical/library) and never logged, or a book
 * in the series/bibliography they genuinely haven't read yet but that
 * isn't a future release (so it wouldn't show on the Upcoming tab).
 *
 * Deliberately excludes anything already flagged as upcoming/announced —
 * this tab is about the BACK catalog, not future releases (that's the
 * other tab). A book only shows here if Audible's release_date is in the
 * past (or absent) AND the user doesn't already own that ASIN.
 */

import type { Book } from './types'
import { getSeriesDataFromBooks } from './series'
import { createClient } from '@/lib/supabase/server'
import {
  searchCatalogByAuthor,
  getSeriesSims,
  seriesNamesMatch,
  authorNamesMatch,
  type NormalizedCatalogRelease,
} from './audible-catalog'

export interface SeriesGap {
  kind: 'series'
  seriesName: string
  author: string
  readCount: number
  totalKnown: number
  missing: NormalizedCatalogRelease[]
}

export interface AuthorGap {
  kind: 'author'
  author: string
  readCount: number
  missing: NormalizedCatalogRelease[]
}

export type Gap = SeriesGap | AuthorGap

interface GapScanRow {
  kind: 'series' | 'author'
  key: string
  display_author: string | null
  read_count: number
  total_known: number | null
  missing: NormalizedCatalogRelease[]
  last_scanned_at: string
}

/**
 * Load persisted gap-scan results (survives navigation, no re-scan needed
 * just to view what was already found — fixes Darrin's 2026-09-03 report
 * that scan results disappeared when he came back to the app later).
 */
export async function loadPersistedGaps(
  userId: string
): Promise<{ seriesGaps: SeriesGap[]; authorGaps: AuthorGap[]; lastScannedAt: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('gap_scan_results')
    .select('kind, key, display_author, read_count, total_known, missing, last_scanned_at')
    .eq('user_id', userId)
    .order('last_scanned_at', { ascending: false })

  if (error || !data?.length) {
    return { seriesGaps: [], authorGaps: [], lastScannedAt: null }
  }

  const rows = data as GapScanRow[]
  const seriesGaps: SeriesGap[] = rows
    .filter((r) => r.kind === 'series' && Array.isArray(r.missing) && r.missing.length > 0)
    .map((r) => ({
      kind: 'series' as const,
      seriesName: r.key,
      author: r.display_author || 'Unknown',
      readCount: r.read_count,
      totalKnown: r.total_known ?? r.missing.length,
      missing: r.missing,
    }))
    .sort((a, b) => b.missing.length - a.missing.length)

  const authorGaps: AuthorGap[] = rows
    .filter((r) => r.kind === 'author' && Array.isArray(r.missing) && r.missing.length > 0)
    .map((r) => ({
      kind: 'author' as const,
      author: r.key,
      readCount: r.read_count,
      missing: r.missing,
    }))
    .sort((a, b) => b.missing.length - a.missing.length)

  const lastScannedAt = rows.length
    ? rows.reduce((latest, r) => (r.last_scanned_at > latest ? r.last_scanned_at : latest), rows[0].last_scanned_at)
    : null

  return { seriesGaps, authorGaps, lastScannedAt }
}

/**
 * Persist scan results incrementally: upsert one row per series/author
 * checked this run. Rows for series/authors NOT in this run's candidate
 * set are left untouched (not deleted) — e.g. if maxSeries/maxAuthors caps
 * mean only a subset gets rechecked each run, previously-found gaps for
 * series outside this run's cap still show until their own next check.
 */
export async function persistGapResults(
  userId: string,
  seriesGaps: SeriesGap[],
  authorGaps: AuthorGap[],
  checkedSeriesNames: string[],
  checkedAuthorNames: string[]
): Promise<void> {
  const supabase = await createClient()
  const now = new Date().toISOString()

  const seriesByName = new Map(seriesGaps.map((g) => [g.seriesName, g]))
  const authorByName = new Map(authorGaps.map((g) => [g.author, g]))

  const rows: Record<string, unknown>[] = []

  for (const name of checkedSeriesNames) {
    const g = seriesByName.get(name)
    rows.push({
      user_id: userId,
      kind: 'series',
      key: name,
      display_author: g?.author ?? null,
      read_count: g?.readCount ?? 0,
      total_known: g?.totalKnown ?? 0,
      // Empty array when a previously-missing series is now fully owned —
      // this is exactly how a gap clears itself on next scan (F2-style: no
      // separate dismiss logic needed, ownership diff handles it).
      missing: g?.missing ?? [],
      last_scanned_at: now,
    })
  }

  for (const name of checkedAuthorNames) {
    const g = authorByName.get(name)
    rows.push({
      user_id: userId,
      kind: 'author',
      key: name,
      display_author: null,
      read_count: g?.readCount ?? 0,
      total_known: null,
      missing: g?.missing ?? [],
      last_scanned_at: now,
    })
  }

  if (!rows.length) return

  const { error } = await supabase
    .from('gap_scan_results')
    .upsert(rows, { onConflict: 'user_id,kind,key' })

  if (error) {
    console.error('[gaps] failed to persist scan results', error.message)
  }
}

/** Series with at least one read book — candidates for gap-checking. */
function seriesToCheck(books: Book[]): { name: string; author: string; readCount: number }[] {
  const series = getSeriesDataFromBooks(books, [])
  return series
    .filter((s) => s.readCount >= 1)
    .map((s) => ({ name: s.name, author: s.author, readCount: s.readCount }))
}

/** Authors with at least one read book, deduped, excluding "Unknown". */
function authorsToCheck(books: Book[]): { name: string; readCount: number }[] {
  const counts = new Map<string, number>()
  for (const b of books) {
    if (b.status !== 'completed' && b.status !== 'read') continue
    for (const a of b.authors || []) {
      const name = a.trim()
      if (!name || name === 'Unknown') continue
      counts.set(name, (counts.get(name) || 0) + 1)
    }
  }
  return Array.from(counts.entries()).map(([name, readCount]) => ({ name, readCount }))
}

/** true if release_date is unset or in the past — i.e. NOT an upcoming release. */
function isBackCatalog(r: NormalizedCatalogRelease, now = new Date()): boolean {
  if (!r.releaseDate) return true
  const d = new Date(r.releaseDate + 'T12:00:00Z')
  if (Number.isNaN(d.getTime())) return true
  return d.getTime() < now.getTime()
}

/**
 * Find series gaps: for each series with a read book, pull the full series
 * list via the sims API (seeded from a representative owned ASIN in that
 * series) and diff against owned ASINs.
 *
 * Requires at least one owned book in the series to have an ASIN to seed
 * the sims lookup from — books without an Audible purchase (Goodreads-only
 * imports) can't seed this; those show up via the author-gap path instead
 * if the author is known.
 */
export async function findSeriesGaps(
  accessToken: string,
  books: Book[],
  opts: { maxSeries?: number } = {}
): Promise<{ gaps: SeriesGap[]; checkedNames: string[] }> {
  const ownedAsins = new Set(books.map((b) => b.asin).filter((a): a is string => !!a))
  const candidates = seriesToCheck(books)
  const maxSeries = opts.maxSeries ?? 40
  const gaps: SeriesGap[] = []
  const checkedNames: string[] = []

  for (const s of candidates.slice(0, maxSeries)) {
    checkedNames.push(s.name)
    // Seed ASIN: prefer a book in this series that has one.
    const seed = books.find(
      (b) => b.series === s.name && b.asin && (b.status === 'completed' || b.status === 'read')
    )
    if (!seed?.asin) continue

    let sims: NormalizedCatalogRelease[] = []
    try {
      sims = await getSeriesSims(accessToken, seed.asin, 'InTheSameSeries', 30)
    } catch (e) {
      console.warn('[gaps] series sims failed for', s.name, e)
      continue
    }

    const relevant = sims.filter(
      (r) => r.seriesName && seriesNamesMatch(r.seriesName, s.name) && isBackCatalog(r)
    )
    const missing = relevant.filter((r) => !ownedAsins.has(r.asin))
    if (missing.length > 0) {
      gaps.push({
        kind: 'series',
        seriesName: s.name,
        author: s.author,
        readCount: s.readCount,
        totalKnown: relevant.length,
        missing: missing.sort((a, b) => (a.seriesPosition ?? 999) - (b.seriesPosition ?? 999)),
      })
    }
  }

  return { gaps: gaps.sort((a, b) => b.missing.length - a.missing.length), checkedNames }
}

/**
 * Find author gaps: for each author with a read book, search Audible's
 * catalog by author name and diff against owned ASINs. Excludes anything
 * already surfaced as a series gap (avoid double-listing the same title).
 */
export async function findAuthorGaps(
  accessToken: string,
  books: Book[],
  seriesGapAsins: Set<string>,
  opts: { maxAuthors?: number } = {}
): Promise<{ gaps: AuthorGap[]; checkedNames: string[] }> {
  const ownedAsins = new Set(books.map((b) => b.asin).filter((a): a is string => !!a))
  const candidates = authorsToCheck(books)
  const maxAuthors = opts.maxAuthors ?? 40
  const gaps: AuthorGap[] = []
  const checkedNames: string[] = []

  // Only bother checking authors with 2+ read books — a single read book
  // from an author isn't a strong enough signal to justify a full catalog
  // scan, and keeps this within Audible rate limits.
  const worthChecking = candidates.filter((a) => a.readCount >= 2).slice(0, maxAuthors)

  for (const a of worthChecking) {
    checkedNames.push(a.name)
    let results: NormalizedCatalogRelease[] = []
    try {
      results = await searchCatalogByAuthor(accessToken, a.name, { numResults: 40 })
    } catch (e) {
      console.warn('[gaps] author search failed for', a.name, e)
      continue
    }

    const relevant = results.filter(
      (r) =>
        isBackCatalog(r) &&
        r.authors.some((auth) => authorNamesMatch(auth, a.name)) &&
        !seriesGapAsins.has(r.asin)
    )
    const missing = relevant.filter((r) => !ownedAsins.has(r.asin))
    if (missing.length > 0) {
      gaps.push({
        kind: 'author',
        author: a.name,
        readCount: a.readCount,
        missing: missing.sort((x, y) => (y.releaseDate || '').localeCompare(x.releaseDate || '')),
      })
    }
  }

  return { gaps: gaps.sort((a, b) => b.missing.length - a.missing.length), checkedNames }
}
