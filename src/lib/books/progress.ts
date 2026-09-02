import type { Book } from './types'

/** Audible near-finished threshold — suggest only, never auto-complete. */
export const ALMOST_FINISHED_THRESHOLD = 90

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
