import type { Book, SeriesInfo, UpcomingRelease } from './types'
import { isReadStatus } from './map'

function seriesPosition(book: Book): number {
  const n = parseFloat(book.series_num || '0')
  return Number.isFinite(n) ? n : 0
}

/**
 * Build series list from a Book[] view-model (static or live).
 * upcomingReleases optional — live path may pass [] until Phase 5.
 */
export function getSeriesDataFromBooks(
  books: Book[],
  upcomingReleases: UpcomingRelease[] = []
): SeriesInfo[] {
  const seriesMap = new Map<string, Book[]>()

  books.forEach(book => {
    if (book.series) {
      const existing = seriesMap.get(book.series) || []
      existing.push(book)
      seriesMap.set(book.series, existing)
    }
  })

  const seriesList: SeriesInfo[] = []

  seriesMap.forEach((seriesBooks, seriesName) => {
    const sorted = [...seriesBooks].sort((a, b) => seriesPosition(a) - seriesPosition(b))

    const readBooks = sorted.filter(b => isReadStatus(b.status))
    const maxReadNum = readBooks.length > 0
      ? Math.max(...readBooks.map(b => seriesPosition(b)))
      : 0

    const nextToRead = sorted.find(b => {
      const num = seriesPosition(b)
      return num > maxReadNum && !isReadStatus(b.status)
    }) || sorted.find(b => !isReadStatus(b.status)) || null

    const upcoming = upcomingReleases.find(r =>
      r.series.toLowerCase().includes(seriesName.toLowerCase()) ||
      seriesName.toLowerCase().includes(r.series.toLowerCase())
    ) || null

    // Prefer progressSyncedAt (real Audible activity signal from the last
    // sync) over finishedAt (user tapped "Read" in the app — may not match
    // when they actually finished listening). Falls back through the old
    // chain for books synced before progress_synced_at existed.
    const datesRead = sorted
      .map(b => b.progressSyncedAt || b.finishedAt || b.gr_date_read || b.audible_purchased)
      .filter((d): d is string => !!d)
      .sort()
    const lastReadDate = datesRead.length > 0 ? datesRead[datesRead.length - 1] : null

    const author = sorted[0]?.authors[0] || 'Unknown'

    seriesList.push({
      name: seriesName,
      author,
      books: sorted,
      readCount: readBooks.length,
      totalCount: sorted.length,
      nextToRead,
      upcomingRelease: upcoming,
      lastReadDate,
    })
  })

  return seriesList.sort((a, b) => {
    if (!a.lastReadDate) return 1
    if (!b.lastReadDate) return -1
    return new Date(b.lastReadDate).getTime() - new Date(a.lastReadDate).getTime()
  })
}

export function getWhatToReadNextFromSeries(series: SeriesInfo[], limit = 3): Book[] {
  return series
    .filter(s => s.nextToRead !== null && (s.lastReadDate !== null || s.readCount > 0))
    .sort((a, b) => {
      if (!a.lastReadDate && !b.lastReadDate) return 0
      if (!a.lastReadDate) return 1
      if (!b.lastReadDate) return -1
      return new Date(b.lastReadDate).getTime() - new Date(a.lastReadDate).getTime()
    })
    .slice(0, limit)
    .map(s => s.nextToRead as Book)
}

/** started-but-incomplete */
export function isInProgressSeries(s: SeriesInfo): boolean {
  return s.readCount >= 1 && s.readCount < s.totalCount
}
