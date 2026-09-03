import type { Book, DbStatus } from './types'

export function mapDbStatusToUi(status: DbStatus | string | null | undefined): string {
  switch (status) {
    case 'completed':
      return 'read'
    case 'in_progress':
      return 'reading'
    case 'unstarted':
    default:
      // 'unstarted' is owned-but-unread for Audible-synced titles.
      // Explicit wishlist uses wantToRead flag, not this status label.
      return 'owned_unread'
  }
}

export function mapUiStatusToDb(status: string): DbStatus {
  if (status === 'read' || status === 'read_no_date' || status === 'completed') return 'completed'
  if (status === 'reading' || status === 'currently-reading' || status === 'in_progress') return 'in_progress'
  // owned_unread / to_read / want_to_read all map to unstarted progress
  return 'unstarted'
}

/** True when the book is on the explicit Want to Read list. */
export function isWantToRead(book: {
  wantToRead?: boolean | null
  notInterested?: boolean | null
}): boolean {
  return book.wantToRead === true && book.notInterested !== true
}

/** Owned library title not yet started (Audible sync default). */
export function isOwnedUnread(book: {
  status?: string | null
  audible_purchased?: string | null
  wantToRead?: boolean | null
  notInterested?: boolean | null
}): boolean {
  const s = book.status
  const unstarted =
    s === 'owned_unread' ||
    s === 'unstarted' ||
    s === 'to_read' // legacy UI value before owned_unread split
  if (!unstarted) return false
  if (book.notInterested) return false
  // Wishlist-only rows (no purchase) are Want to Read, not Owned-Unread
  if (isWantToRead(book) && !book.audible_purchased) return false
  return true
}

/** Build Audible product URL from ASIN. */
export function audibleUrlForAsin(asin: string | null | undefined): string | null {
  if (!asin) return null
  return `https://www.audible.com/pd/${encodeURIComponent(asin)}`
}

/** Prefer release preorder URL, else construct from ASIN. */
export function buyOrPreorderUrl(book: {
  preorderUrl?: string | null
  asin?: string | null
}): string | null {
  if (book.preorderUrl) return book.preorderUrl
  return audibleUrlForAsin(book.asin)
}

/** True when release_date is strictly after today (local calendar day). */
export function isFutureRelease(releaseDate: string | null | undefined): boolean {
  if (!releaseDate) return false
  const d = releaseDate.slice(0, 10)
  const today = new Date()
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  const todayStr = `${y}-${m}-${day}`
  return d > todayStr
}

export function isReadStatus(status: string | null | undefined): boolean {
  return status === 'read' || status === 'read_no_date' || status === 'completed'
}

export function isReadingStatus(status: string | null | undefined): boolean {
  return status === 'reading' || status === 'currently-reading' || status === 'in_progress'
}

export interface SupabaseBookRow {
  id?: string
  asin?: string
  title?: string | null
  authors?: string[] | null
  narrator?: string | null
  runtime_minutes?: number | null
  cover_url?: string | null
  series_name?: string | null
  series_position?: number | string | null
  publisher?: string | null
  release_date?: string | null
  summary?: string | null
  genre?: string | null
}

export interface SupabaseUserBookRow {
  id: string
  asin: string
  purchase_date?: string | null
  status?: DbStatus | string | null
  rating?: number | null
  notes?: string | null
  started_at?: string | null
  finished_at?: string | null
  percent_complete?: number | null
  is_finished?: boolean | null
  almost_finished_dismissed_at?: string | null
  status_source?: string | null
  want_to_read?: boolean | null
  not_interested?: boolean | null
  progress_synced_at?: string | null
  updated_at?: string | null
  book?: SupabaseBookRow | SupabaseBookRow[] | null
  /** Joined from series_releases when available (client may attach). */
  preorder_url?: string | null
}

function unwrapBook(book: SupabaseUserBookRow['book']): SupabaseBookRow | null {
  if (!book) return null
  return Array.isArray(book) ? book[0] ?? null : book
}

export function mapUserBookToBook(ub: SupabaseUserBookRow): Book {
  const b = unwrapBook(ub.book)
  const seriesPos = b?.series_position
  const wantToRead = ub.want_to_read === true
  const notInterested = ub.not_interested === true
  const purchase = ub.purchase_date ?? null
  // Wishlist-only rows (no purchase) show as want_to_read in UI status for badges
  let uiStatus = mapDbStatusToUi(ub.status ?? 'unstarted')
  if (wantToRead && !notInterested && !purchase && uiStatus === 'owned_unread') {
    uiStatus = 'want_to_read'
  }
  const sources: string[] = []
  if (purchase) sources.push('audible')
  if (wantToRead && !purchase) sources.push('want')
  if (!sources.length) sources.push('audible')
  return {
    title: b?.title ?? 'Unknown',
    authors: b?.authors ?? [],
    series: b?.series_name ?? null,
    series_num: seriesPos != null && seriesPos !== '' ? String(seriesPos) : null,
    audible_purchased: purchase,
    gr_shelf: null,
    gr_date_read: ub.finished_at ? ub.finished_at.slice(0, 10) : null,
    gr_rating: ub.rating ?? null,
    status: uiStatus,
    sources,
    cover_url: b?.cover_url ?? null,
    narrator: b?.narrator ?? null,
    runtime_length_min: b?.runtime_minutes ?? null,
    asin: ub.asin ?? b?.asin ?? null,
    userBookId: ub.id,
    percentComplete: ub.percent_complete ?? null,
    isFinished: ub.is_finished ?? null,
    statusSource: ub.status_source ?? null,
    finishedAt: ub.finished_at ?? null,
    startedAt: ub.started_at ?? null,
    progressSyncedAt: ub.progress_synced_at ?? null,
    almostFinishedDismissedAt: ub.almost_finished_dismissed_at ?? null,
    wantToRead,
    notInterested,
    releaseDate: b?.release_date ?? null,
    preorderUrl: ub.preorder_url ?? null,
    summary: b?.summary ?? null,
    publisher: b?.publisher ?? null,
    genre: b?.genre ?? null,
  }
}

export function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    read: 'Read',
    read_no_date: 'Read',
    to_read: 'Owned · Unread',
    owned_unread: 'Owned · Unread',
    want_to_read: 'Want to Read',
    reading: 'Reading',
    'currently-reading': 'Reading',
    unstarted: 'Owned · Unread',
    in_progress: 'Reading',
    completed: 'Read',
    not_interested: 'Not Interested',
  }
  return map[status] || status
}

export function getStatusColor(status: string): string {
  if (isReadStatus(status)) return 'text-emerald-400 bg-emerald-400/10'
  if (status === 'want_to_read') return 'text-violet-400 bg-violet-400/10'
  if (
    status === 'to_read' ||
    status === 'unstarted' ||
    status === 'owned_unread'
  ) {
    return 'text-amber-400 bg-amber-400/10'
  }
  if (isReadingStatus(status)) return 'text-blue-400 bg-blue-400/10'
  if (status === 'not_interested') return 'text-slate-500 bg-slate-500/10'
  return 'text-slate-400 bg-slate-400/10'
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

/** Minutes remaining given total runtime + percent complete (0-100). */
export function timeRemainingMinutes(
  totalMinutes: number | null | undefined,
  percentComplete: number | null | undefined
): number | null {
  if (totalMinutes == null || totalMinutes <= 0) return null
  if (percentComplete == null) return null
  const pct = Math.max(0, Math.min(100, percentComplete))
  return Math.round(totalMinutes * (1 - pct / 100))
}

export function formatRuntime(minutes: number | null | undefined): string {
  if (!minutes) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function getGenreForSeries(seriesName: string): string {
  const thrillerSeries = [
    'Terminal List', 'Gray Man', 'Mitch Rapp', 'Scot Harvath', 'Pike Logan', 'Orphan X',
    'Jonathan Grave', 'Jack Reacher', 'Jason Trapp', 'Cotton Malone', 'Lincoln Rhyme',
    'Cormoran Strike', 'Harry Bosch', 'Alex Cross', 'Will Robie', 'Camel Club',
    'Travis Devine', 'Joshua Duffy', 'Department Q',
  ]
  const fantasySciFi = [
    'Red Rising', 'The Empyrean', 'Dune', 'The Silo Saga', 'Stormlight Archive',
    'Kingkiller Chronicle', 'A Court of Thorns', 'Ender Saga', 'Wayward Pines',
    'The Breach', 'The Passage Trilogy',
  ]
  const mystery = [
    'Chief Inspector Gamache', 'Thursday Murder Club', 'Holly Gibney',
    'Lincoln Lawyer', 'Inheritance Games', 'Susan Ryeland',
  ]

  for (const s of thrillerSeries) {
    if (seriesName.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(seriesName.toLowerCase())) {
      return 'Thriller'
    }
  }
  for (const s of fantasySciFi) {
    if (seriesName.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(seriesName.toLowerCase())) {
      return 'Sci-Fi/Fantasy'
    }
  }
  for (const s of mystery) {
    if (seriesName.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(seriesName.toLowerCase())) {
      return 'Mystery'
    }
  }
  return 'Fiction'
}
