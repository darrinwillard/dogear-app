import type { Book, LibraryStats, SeriesInfo } from './types'
import { isReadStatus, isReadingStatus, isWantToRead } from './map'

export function getStatsFromBooks(
  books: Book[],
  opts?: { year?: number; series?: SeriesInfo[] }
): LibraryStats {
  const year = opts?.year ?? new Date().getFullYear()
  const seriesCount = opts?.series
    ? opts.series.length
    : new Set(books.map(b => b.series).filter(Boolean)).size

  const confirmedRead = books.filter(b => isReadStatus(b.status)).length
  const reading = books.filter(b => isReadingStatus(b.status)).length
  // Explicit wishlist only — not owned-unread bucket
  const wantToRead = books.filter(b => isWantToRead(b)).length

  const booksThisYear = books.filter(b => {
    if (!isReadStatus(b.status)) return false
    const raw = b.finishedAt || b.gr_date_read || b.audible_purchased
    if (!raw) return false
    try {
      return new Date(raw).getFullYear() === year
    } catch {
      return false
    }
  }).length

  const ratings = books
    .map(b => b.gr_rating)
    .filter((r): r is number => typeof r === 'number' && r >= 1 && r <= 5)
  const avgRating = ratings.length
    ? ratings.reduce((a, b) => a + b, 0) / ratings.length
    : null

  const completedMinutes = books
    .filter(b => isReadStatus(b.status))
    .reduce((sum, b) => sum + (b.runtime_length_min || 0), 0)

  return {
    totalBooks: books.length,
    confirmedRead,
    totalSeries: seriesCount,
    booksThisYear,
    audibleTotal: books.filter(b => b.sources.includes('audible')).length,
    goodreadsTotal: books.filter(b => b.sources.includes('goodreads')).length,
    reading,
    wantToRead,
    avgRating,
    hoursListened: completedMinutes ? Math.round((completedMinutes / 60) * 10) / 10 : 0,
  }
}
