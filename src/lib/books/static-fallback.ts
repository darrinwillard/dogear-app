import readingTracker from '@/data/reading-tracker.json'
import upcomingReleasesData from '@/data/upcoming-releases.json'
import type { Book, UpcomingRelease } from './types'
import { getSeriesDataFromBooks, getWhatToReadNextFromSeries } from './series'
import { getStatsFromBooks } from './stats'

export function getAllBooks(): Book[] {
  return readingTracker.books as Book[]
}

export function getStaticStats() {
  const books = getAllBooks()
  const live = getStatsFromBooks(books)
  // Prefer embedded snapshot totals when present (matches historical home cards)
  return {
    ...live,
    totalBooks: readingTracker.stats?.total_unique ?? live.totalBooks,
    confirmedRead: readingTracker.stats?.confirmed_read ?? live.confirmedRead,
    totalSeries: readingTracker.stats?.total_series ?? live.totalSeries,
    audibleTotal: readingTracker.sources?.audible_total ?? live.audibleTotal,
    goodreadsTotal: readingTracker.sources?.goodreads_total ?? live.goodreadsTotal,
  }
}

export function getStaticSeriesData() {
  return getSeriesDataFromBooks(getAllBooks(), getAllUpcoming())
}

export function getStaticWhatToReadNext() {
  return getWhatToReadNextFromSeries(getStaticSeriesData())
}

export function getUpcomingReleases(limit?: number): UpcomingRelease[] {
  const upcoming = (upcomingReleasesData.confirmedReleases as UpcomingRelease[])
    .filter(r => r.status === 'upcoming')
    .sort((a, b) => {
      if (!a.releaseDate) return 1
      if (!b.releaseDate) return -1
      return new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime()
    })

  return limit ? upcoming.slice(0, limit) : upcoming
}

export function getAllUpcoming(): UpcomingRelease[] {
  return upcomingReleasesData.confirmedReleases as UpcomingRelease[]
}

export function getComingSoon(): UpcomingRelease[] {
  return upcomingReleasesData.comingSoonTBA as UpcomingRelease[]
}

export function getStaticLastUpdatedLabel(): string {
  return 'Demo data · snapshot March 9, 2026'
}
