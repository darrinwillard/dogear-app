import type { Book } from './types'

/** Audible near-finished threshold — suggest only, never auto-complete. */
export const ALMOST_FINISHED_THRESHOLD = 90

/**
 * Derived "currently reading" — the Audible sync never writes status=in_progress
 * (progress fields are advisory-only per that route's hard rule), so real reading
 * state has to be computed from percent_complete rather than the stored status.
 * A book counts as Reading when it has real progress, isn't already marked read,
 * and isn't sitting at/above the almost-finished threshold (those still show here
 * too, just further along — no separate tab needed).
 */
export function isCurrentlyReading(book: Book): boolean {
  if (!book) return false
  const status = book.status
  if (status === 'read' || status === 'read_no_date' || status === 'completed') {
    return false
  }
  if (book.notInterested) return false
  const pct = book.percentComplete
  if (pct != null && typeof pct === 'number' && pct > 0 && pct < 100) return true
  if (status === 'reading' || status === 'currently-reading' || status === 'in_progress') {
    return true
  }
  return false
}

/**
 * A book is an almost-finished candidate when:
 * - status is not completed/read
 * - user has not dismissed the prompt
 * - Audible says is_finished OR percent_complete >= threshold
 */
export function isAlmostFinishedCandidate(book: Book): boolean {
  if (!book) return false
  const status = book.status
  if (
    status === 'read' ||
    status === 'read_no_date' ||
    status === 'completed'
  ) {
    return false
  }
  if (book.almostFinishedDismissedAt) return false

  if (book.isFinished === true) return true
  const pct = book.percentComplete
  if (pct != null && typeof pct === 'number' && pct >= ALMOST_FINISHED_THRESHOLD) {
    return true
  }
  return false
}

export function almostFinishedLabel(book: Book): string {
  if (book.isFinished === true && (book.percentComplete == null || book.percentComplete >= 99)) {
    return 'Finished on Audible'
  }
  if (book.percentComplete != null) {
    return `${Math.round(book.percentComplete)}% complete`
  }
  return 'Almost finished'
}
