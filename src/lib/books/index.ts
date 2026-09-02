/**
 * Public barrel for @/lib/books — client-safe exports only.
 * Server loaders: import from "@/lib/books/queries" in Server Components / route handlers.
 * Audible parsers: import from "@/lib/books/audible-parse" or "@/lib/books/sync-parse" in API routes.
 */
export type { Book, UpcomingRelease, SeriesInfo, LibraryStats, DbStatus, ReleaseInterestKind } from './types'

export {
  mapDbStatusToUi,
  mapUiStatusToDb,
  isReadStatus,
  isReadingStatus,
  isWantToRead,
  isOwnedUnread,
  audibleUrlForAsin,
  buyOrPreorderUrl,
  isFutureRelease,
  mapUserBookToBook,
  getStatusLabel,
  getStatusColor,
  formatDate,
  formatRuntime,
  getGenreForSeries,
} from './map'

export { getSeriesDataFromBooks, getWhatToReadNextFromSeries, isInProgressSeries } from './series'
export { getStatsFromBooks } from './stats'
export {
  ALMOST_FINISHED_THRESHOLD,
  isAlmostFinishedCandidate,
  almostFinishedLabel,
} from './progress'

export {
  getAllBooks,
  getStaticStats,
  getStaticSeriesData,
  getStaticWhatToReadNext,
  getUpcomingReleases,
  getAllUpcoming,
  getComingSoon,
  getStaticLastUpdatedLabel,
} from './static-fallback'

/** @deprecated Prefer getStaticStats / getStatsFromBooks — kept for guest home */
export { getStaticStats as getStats } from './static-fallback'
/** @deprecated Prefer getSeriesDataFromBooks */
export { getStaticSeriesData as getSeriesData } from './static-fallback'
/** @deprecated Prefer getWhatToReadNextFromSeries */
export { getStaticWhatToReadNext as getWhatToReadNext } from './static-fallback'
