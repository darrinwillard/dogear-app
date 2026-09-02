import { createClient } from '@/lib/supabase/server'
import type { Book, LibraryStats, SeriesInfo } from './types'
import { mapUserBookToBook, type SupabaseUserBookRow } from './map'
import { getSeriesDataFromBooks, getWhatToReadNextFromSeries } from './series'
import { getStatsFromBooks } from './stats'
import {
  getAllBooks,
  getStaticSeriesData,
  getStaticStats,
  getStaticWhatToReadNext,
  getUpcomingReleases,
  getStaticLastUpdatedLabel,
} from './static-fallback'

const BOOK_EMBED = `
    id, asin, title, authors, narrator, runtime_minutes,
    cover_url, series_name, series_position, publisher, release_date
`

/** Includes Phase 0 progress columns when migration 002 is applied. */
const USER_BOOK_SELECT_FULL = `
  id, asin, purchase_date, status, rating, notes,
  started_at, finished_at, percent_complete, is_finished,
  almost_finished_dismissed_at, status_source, updated_at,
  book:books ( ${BOOK_EMBED} )
`

/** Safe on schema 001 only (pre-migration). */
const USER_BOOK_SELECT_BASE = `
  id, asin, purchase_date, status, rating, notes,
  started_at, finished_at, updated_at,
  book:books ( ${BOOK_EMBED} )
`

export interface LibraryLoadResult {
  books: Book[]
  isAuthed: boolean
  isNewUser: boolean
  userId: string | null
  lastSyncedAt: string | null
  source: 'supabase' | 'static' | 'empty'
}

export async function getLibraryForCurrentUser(): Promise<LibraryLoadResult> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return {
        books: getAllBooks(),
        isAuthed: false,
        isNewUser: false,
        userId: null,
        lastSyncedAt: null,
        source: 'static',
      }
    }

    const profilePromise = supabase
      .from('user_profiles')
      .select('last_synced_at')
      .eq('id', user.id)
      .maybeSingle()

    let userBooks: SupabaseUserBookRow[] | null = null
    let errorMessage: string | null = null

    const full = await supabase
      .from('user_books')
      .select(USER_BOOK_SELECT_FULL)
      .eq('user_id', user.id)
      .order('purchase_date', { ascending: false, nullsFirst: false })

    if (full.error) {
      // Migration 002 may not be applied yet — fall back to base columns.
      console.warn('full user_books select failed, trying base columns:', full.error.message)
      const base = await supabase
        .from('user_books')
        .select(USER_BOOK_SELECT_BASE)
        .eq('user_id', user.id)
        .order('purchase_date', { ascending: false, nullsFirst: false })
      if (base.error) {
        errorMessage = base.error.message
        console.error('getLibraryForCurrentUser error', base.error.message)
      } else {
        userBooks = (base.data || []) as SupabaseUserBookRow[]
      }
    } else {
      userBooks = (full.data || []) as SupabaseUserBookRow[]
    }

    const { data: profile } = await profilePromise

    if (errorMessage && !userBooks) {
      console.error('getLibraryForCurrentUser failed entirely', errorMessage)
    }

    const rows = userBooks || []
    if (rows.length === 0) {
      return {
        books: [],
        isAuthed: true,
        isNewUser: true,
        userId: user.id,
        lastSyncedAt: profile?.last_synced_at ?? null,
        source: 'empty',
      }
    }

    return {
      books: rows.map(mapUserBookToBook),
      isAuthed: true,
      isNewUser: false,
      userId: user.id,
      lastSyncedAt: profile?.last_synced_at ?? null,
      source: 'supabase',
    }
  } catch (e) {
    console.error('getLibraryForCurrentUser failed', e)
    return {
      books: getAllBooks(),
      isAuthed: false,
      isNewUser: false,
      userId: null,
      lastSyncedAt: null,
      source: 'static',
    }
  }
}

export async function getDashboardData() {
  const library = await getLibraryForCurrentUser()

  if (!library.isAuthed || library.source === 'static') {
    const series = getStaticSeriesData()
    return {
      ...library,
      stats: getStaticStats() as LibraryStats,
      series,
      whatToReadNext: getStaticWhatToReadNext(),
      upcoming: getUpcomingReleases(3),
      isDemo: true,
      lastUpdatedLabel: getStaticLastUpdatedLabel(),
    }
  }

  const series = getSeriesDataFromBooks(library.books, getUpcomingReleases())
  const stats = getStatsFromBooks(library.books, { series })
  const whatToReadNext = getWhatToReadNextFromSeries(series)

  const lastUpdatedLabel = library.lastSyncedAt
    ? `Live library · last synced ${new Date(library.lastSyncedAt).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
      })}`
    : 'Live library · not yet synced'

  return {
    ...library,
    stats,
    series,
    whatToReadNext,
    upcoming: getUpcomingReleases(3),
    isDemo: false,
    lastUpdatedLabel,
  }
}

export async function getSeriesPageData(): Promise<{
  series: SeriesInfo[]
  isAuthed: boolean
  isDemo: boolean
  emptyReason: string | null
}> {
  const library = await getLibraryForCurrentUser()

  if (!library.isAuthed) {
    return {
      series: getStaticSeriesData(),
      isAuthed: false,
      isDemo: true,
      emptyReason: null,
    }
  }

  if (library.isNewUser || library.books.length === 0) {
    return {
      series: [],
      isAuthed: true,
      isDemo: false,
      emptyReason: 'No series data yet — connect Audible and run Sync to populate your library and series.',
    }
  }

  const series = getSeriesDataFromBooks(library.books, getUpcomingReleases())
  const withSeries = series.length
  if (!withSeries) {
    return {
      series: [],
      isAuthed: true,
      isDemo: false,
      emptyReason:
        'Your library is synced but no series names are populated yet. Run Audible Sync Now (with the series fix) to backfill series from Audible.',
    }
  }

  return {
    series,
    isAuthed: true,
    isDemo: false,
    emptyReason: null,
  }
}


/**
 * Unified bundle for library / series pages (and stats).
 * source: 'live' | 'demo' matches LibraryClient / SeriesClient props.
 */
export async function loadLibraryBundle() {
  const library = await getLibraryForCurrentUser()

  // Authed empty library should not fall back to static demo books
  const books =
    library.isAuthed
      ? library.books
      : getAllBooks()
  const series =
    library.isAuthed
      ? getSeriesDataFromBooks(library.books, getUpcomingReleases())
      : getStaticSeriesData()
  const stats =
    library.isAuthed
      ? getStatsFromBooks(library.books, { series })
      : (getStaticStats() as LibraryStats)
  const whatToReadNext =
    library.isAuthed
      ? getWhatToReadNextFromSeries(series)
      : getStaticWhatToReadNext()

  return {
    books,
    series,
    stats,
    whatToReadNext,
    isAuthed: library.isAuthed,
    isNewUser: library.isNewUser,
    userId: library.userId,
    lastSyncedAt: library.lastSyncedAt,
    source: (library.isAuthed ? 'live' : 'demo') as 'live' | 'demo',
    demoBanner: !library.isAuthed,
    isDemo: !library.isAuthed,
  }
}
