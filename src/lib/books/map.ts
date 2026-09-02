import type { Book, DbStatus } from './types'

export function mapDbStatusToUi(status: DbStatus | string | null | undefined): string {
  switch (status) {
    case 'completed':
      return 'read'
    case 'in_progress':
      return 'reading'
    case 'unstarted':
    default:
      return 'to_read'
  }
}

export function mapUiStatusToDb(status: string): DbStatus {
  if (status === 'read' || status === 'read_no_date' || status === 'completed') return 'completed'
  if (status === 'reading' || status === 'currently-reading' || status === 'in_progress') return 'in_progress'
  return 'unstarted'
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
  updated_at?: string | null
  book?: SupabaseBookRow | SupabaseBookRow[] | null
}

function unwrapBook(book: SupabaseUserBookRow['book']): SupabaseBookRow | null {
  if (!book) return null
  return Array.isArray(book) ? book[0] ?? null : book
}

export function mapUserBookToBook(ub: SupabaseUserBookRow): Book {
  const b = unwrapBook(ub.book)
  const seriesPos = b?.series_position
  return {
    title: b?.title ?? 'Unknown',
    authors: b?.authors ?? [],
    series: b?.series_name ?? null,
    series_num: seriesPos != null && seriesPos !== '' ? String(seriesPos) : null,
    audible_purchased: ub.purchase_date ?? null,
    gr_shelf: null,
    gr_date_read: ub.finished_at ? ub.finished_at.slice(0, 10) : null,
    gr_rating: ub.rating ?? null,
    status: mapDbStatusToUi(ub.status ?? 'unstarted'),
    sources: ['audible'],
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
    almostFinishedDismissedAt: ub.almost_finished_dismissed_at ?? null,
  }
}

export function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    read: 'Read',
    read_no_date: 'Read',
    to_read: 'Want to Read',
    reading: 'Reading',
    'currently-reading': 'Reading',
    unstarted: 'Want to Read',
    in_progress: 'Reading',
    completed: 'Read',
  }
  return map[status] || status
}

export function getStatusColor(status: string): string {
  if (isReadStatus(status)) return 'text-emerald-400 bg-emerald-400/10'
  if (status === 'to_read' || status === 'unstarted') return 'text-amber-400 bg-amber-400/10'
  if (isReadingStatus(status)) return 'text-blue-400 bg-blue-400/10'
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
