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
): Promise<SeriesGap[]> {
  const ownedAsins = new Set(books.map((b) => b.asin).filter((a): a is string => !!a))
  const candidates = seriesToCheck(books)
  const maxSeries = opts.maxSeries ?? 40
  const gaps: SeriesGap[] = []

  for (const s of candidates.slice(0, maxSeries)) {
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

  return gaps.sort((a, b) => b.missing.length - a.missing.length)
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
): Promise<AuthorGap[]> {
  const ownedAsins = new Set(books.map((b) => b.asin).filter((a): a is string => !!a))
  const candidates = authorsToCheck(books)
  const maxAuthors = opts.maxAuthors ?? 40
  const gaps: AuthorGap[] = []

  // Only bother checking authors with 2+ read books — a single read book
  // from an author isn't a strong enough signal to justify a full catalog
  // scan, and keeps this within Audible rate limits.
  const worthChecking = candidates.filter((a) => a.readCount >= 2).slice(0, maxAuthors)

  for (const a of worthChecking) {
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

  return gaps.sort((a, b) => b.missing.length - a.missing.length)
}
