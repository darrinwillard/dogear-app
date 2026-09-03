/**
 * Live series_releases loaders + mappers.
 * Static JSON path is demo/fallback only (see static-fallback.ts).
 */

import { createClient } from '@/lib/supabase/server'
import type { Book, ReleaseInterestKind, SeriesInfo, UpcomingRelease } from './types'
import { getSeriesDataFromBooks, isInProgressSeries } from './series'
import { seriesNamesMatch } from './audible-catalog'
import {
  parseInterestFromNotes,
  stripInterestTag,
} from './releases-schema'
import {
  getAllUpcoming as getStaticAllUpcoming,
  getComingSoon as getStaticComingSoon,
  getUpcomingReleases as getStaticUpcomingReleases,
} from './static-fallback'

export interface SeriesReleaseRow {
  id?: string
  series_name: string
  series_position?: number | string | null
  title: string
  authors?: string[] | null
  asin?: string | null
  release_date?: string | null
  status: string
  source?: string | null
  preorder_url?: string | null
  notes?: string | null
  interest_kind?: string | null
  matched_series?: string | null
  cover_url?: string | null
  updated_at?: string | null
  detected_at?: string | null
  /** Joined from books.genre by asin, when the caller attaches it. */
  genre?: string | null
}

export function mapSeriesReleaseRow(row: SeriesReleaseRow): UpcomingRelease {
  const authors = row.authors || []
  const pos =
    row.series_position == null || row.series_position === ''
      ? null
      : Number(row.series_position)
  const interestKind =
    (row.interest_kind as ReleaseInterestKind) ||
    parseInterestFromNotes(row.notes) ||
    null
  return {
    series: row.matched_series || row.series_name || 'Standalone',
    seriesNumber: Number.isFinite(pos as number) ? (pos as number) : null,
    title: row.title,
    author: authors[0] || 'Unknown',
    authors,
    releaseDate: row.release_date ?? null,
    status: row.status,
    preorderUrl: row.preorder_url ?? null,
    notes: stripInterestTag(row.notes),
    interestKind,
    asin: row.asin ?? null,
    coverUrl: row.cover_url ?? null,
    source: row.source ?? null,
  }
}

export interface UpcomingPageData {
  source: 'live' | 'demo' | 'empty'
  isAuthed: boolean
  lastRefreshedAt: string | null
  seriesUpcoming: UpcomingRelease[]
  authorUpcoming: UpcomingRelease[]
  releasedRecently: UpcomingRelease[]
  announcedNoDate: UpcomingRelease[]
  all: UpcomingRelease[]
  emptyReason: string | null
}

function sortByDateAsc(a: UpcomingRelease, b: UpcomingRelease): number {
  if (!a.releaseDate) return 1
  if (!b.releaseDate) return -1
  return a.releaseDate.localeCompare(b.releaseDate)
}

function sortByDateDesc(a: UpcomingRelease, b: UpcomingRelease): number {
  return sortByDateAsc(b, a)
}

/** Classify a live release against the user's followed series list */
export function classifyReleaseForUser(
  release: UpcomingRelease,
  followedSeries: SeriesInfo[]
): ReleaseInterestKind {
  if (release.interestKind === 'series' || release.interestKind === 'both') {
    return release.interestKind
  }
  if (release.interestKind === 'author') {
    // May still match a followed series by name even if stored as author
    const hit = followedSeries.some((s) => seriesNamesMatch(s.name, release.series))
    return hit ? 'both' : 'author'
  }
  const hit = followedSeries.some((s) => seriesNamesMatch(s.name, release.series))
  return hit ? 'series' : 'author'
}

export function getFollowedSeriesNames(books: Book[]): SeriesInfo[] {
  const series = getSeriesDataFromBooks(books, [])
  const RECENT_FOLLOW_DAYS = 540
  return series.filter((s) => {
    if (s.readCount < 1) return false
    if (isInProgressSeries(s)) return true
    if (s.readCount < s.totalCount) return false
    const days = s.lastReadDate
      ? (Date.now() - new Date(s.lastReadDate).getTime()) / (1000 * 60 * 60 * 24)
      : null
    if (days != null && days > RECENT_FOLLOW_DAYS) return false
    const maxPos = Math.max(
      0,
      ...s.books.map((b) => parseFloat(b.series_num || '0') || 0)
    )
    if (s.readCount >= 2 || maxPos >= 2 || s.totalCount >= 2) return true
    if (days != null && days <= RECENT_FOLLOW_DAYS) return true
    return false
  })
}

/**
 * Fill missing series_releases.cover_url from books.cover_url by ASIN.
 * Needed until migration 003 is applied (and as a permanent fallback for
 * preorders that already have a books row from mirrorReleaseCoversToBooks).
 */
async function attachCoversFromBooks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: SeriesReleaseRow[]
): Promise<SeriesReleaseRow[]> {
  const need = rows.filter((r) => r.asin && !r.cover_url)
  if (!need.length) return rows

  const asins = Array.from(new Set(need.map((r) => r.asin as string)))
  const coverByAsin = new Map<string, string>()
  for (let i = 0; i < asins.length; i += 200) {
    const chunk = asins.slice(i, i + 200)
    const { data } = await supabase
      .from('books')
      .select('asin, cover_url')
      .in('asin', chunk)
      .not('cover_url', 'is', null)
    for (const b of data || []) {
      if (b.asin && b.cover_url) coverByAsin.set(b.asin, b.cover_url)
    }
  }
  if (!coverByAsin.size) return rows

  return rows.map((r) => {
    if (r.cover_url || !r.asin) return r
    const cover = coverByAsin.get(r.asin)
    return cover ? { ...r, cover_url: cover } : r
  })
}

export async function fetchAllSeriesReleases(): Promise<{
  rows: SeriesReleaseRow[]
  error: string | null
}> {
  try {
    const supabase = await createClient()
    // Prefer extended columns (migration 003); fall back to base schema.
    const extended = await supabase
      .from('series_releases')
      .select(
        'id, series_name, series_position, title, authors, asin, release_date, status, source, preorder_url, notes, interest_kind, matched_series, cover_url, updated_at, detected_at'
      )
      .order('release_date', { ascending: true, nullsFirst: false })

    if (!extended.error) {
      const rows = await attachCoversFromBooks(
        supabase,
        (extended.data || []) as SeriesReleaseRow[]
      )
      return { rows, error: null }
    }

    const base = await supabase
      .from('series_releases')
      .select(
        'id, series_name, series_position, title, authors, asin, release_date, status, source, preorder_url, notes, updated_at, detected_at'
      )
      .order('release_date', { ascending: true, nullsFirst: false })

    if (base.error) {
      return { rows: [], error: base.error.message }
    }
    const rows = await attachCoversFromBooks(
      supabase,
      (base.data || []) as SeriesReleaseRow[]
    )
    return { rows, error: null }
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : 'Failed to load series_releases',
    }
  }
}

/**
 * Live-only upcoming list for signed-in paths.
 * Returns [] when series_releases is empty — never silently reintroduces stale JSON.
 */
export async function getLiveUpcomingReleases(
  limit?: number
): Promise<UpcomingRelease[]> {
  const { rows } = await fetchAllSeriesReleases()
  if (!rows.length) return []
  const upcoming = rows
    .map(mapSeriesReleaseRow)
    .filter((r) => r.status === 'upcoming' || r.status === 'announced')
    .sort(sortByDateAsc)
  return limit ? upcoming.slice(0, limit) : upcoming
}

/** Guest/demo helper — explicit static path */
export function getDemoUpcomingReleases(limit?: number): UpcomingRelease[] {
  return getStaticUpcomingReleases(limit)
}

export async function getUpcomingPageData(opts: {
  books: Book[]
  isAuthed: boolean
  lastRefreshedAt: string | null
}): Promise<UpcomingPageData> {
  const { books, isAuthed, lastRefreshedAt } = opts

  if (!isAuthed) {
    const all = getStaticAllUpcoming()
    const comingSoon = getStaticComingSoon()
    return {
      source: 'demo',
      isAuthed: false,
      lastRefreshedAt: null,
      seriesUpcoming: all.filter((r) => r.status === 'upcoming').sort(sortByDateAsc),
      authorUpcoming: [],
      releasedRecently: all.filter((r) => r.status === 'released').sort(sortByDateDesc),
      announcedNoDate: comingSoon,
      all,
      emptyReason: null,
    }
  }

  const { rows, error } = await fetchAllSeriesReleases()
  if (error) {
    console.warn('[upcoming] series_releases load error', error)
  }

  if (!rows.length) {
    return {
      source: 'empty',
      isAuthed: true,
      lastRefreshedAt,
      seriesUpcoming: [],
      authorUpcoming: [],
      releasedRecently: [],
      announcedNoDate: [],
      all: [],
      emptyReason: lastRefreshedAt
        ? 'No matching upcoming titles right now — try Refresh Releases again later, or after your next library sync.'
        : 'Release catalog not refreshed yet. Open Settings and tap “Refresh Releases” (uses Audible catalog for series you follow and authors you’ve read).',
    }
  }

  const followed = getFollowedSeriesNames(books)
  const followedNames = new Set(followed.map((s) => s.name))
  const all = rows.map(mapSeriesReleaseRow).map((r) => {
    const kind = classifyReleaseForUser(r, followed)
    return { ...r, interestKind: kind }
  })

  // Prefer releases that match followed series OR were tagged series/both.
  // Author section: interest author (and not matching a followed series name).
  const isSeriesInterest = (r: UpcomingRelease) =>
    r.interestKind === 'series' ||
    r.interestKind === 'both' ||
    followedNames.has(r.series) ||
    followed.some((s) => seriesNamesMatch(s.name, r.series))

  const upcomingish = (r: UpcomingRelease) =>
    r.status === 'upcoming' || r.status === 'announced' || !r.releaseDate

  const seriesUpcoming = all
    .filter((r) => upcomingish(r) && isSeriesInterest(r) && r.releaseDate)
    .filter((r) => r.status !== 'released')
    .sort(sortByDateAsc)

  const authorUpcoming = all
    .filter((r) => upcomingish(r) && !isSeriesInterest(r) && r.releaseDate)
    .filter((r) => r.status !== 'released')
    .sort(sortByDateAsc)

  const announcedNoDate = all
    .filter((r) => !r.releaseDate && r.status !== 'released' && r.status !== 'canceled')
    .sort((a, b) => a.title.localeCompare(b.title))

  const releasedRecently = all
    .filter((r) => r.status === 'released')
    .sort(sortByDateDesc)
    .slice(0, 30)

  return {
    source: 'live',
    isAuthed: true,
    lastRefreshedAt,
    seriesUpcoming,
    authorUpcoming,
    releasedRecently,
    announcedNoDate,
    all,
    emptyReason: null,
  }
}
