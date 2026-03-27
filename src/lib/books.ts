import readingTracker from '@/data/reading-tracker.json'
import upcomingReleasesData from '@/data/upcoming-releases.json'

export interface Book {
  title: string
  authors: string[]
  series: string | null
  series_num: string | null
  audible_purchased: string | null
  gr_shelf: string | null
  gr_date_read: string | null
  gr_rating: number | null
  status: string
  sources: string[]
  cover_url?: string | null
  narrator?: string | null
  runtime_length_min?: number | null
  asin?: string | null
}

export interface UpcomingRelease {
  series: string
  seriesNumber: number | null
  title: string
  author: string
  releaseDate: string | null
  status: string
  preorderUrl: string | null
  notes: string | null
}

export interface SeriesInfo {
  name: string
  author: string
  books: Book[]
  readCount: number
  totalCount: number
  nextToRead: Book | null
  upcomingRelease: UpcomingRelease | null
  lastReadDate: string | null
}

export function getAllBooks(): Book[] {
  return readingTracker.books as Book[]
}

export function getStats() {
  const books = getAllBooks()
  const thisYear = new Date().getFullYear()
  
  // Books read this year
  const booksThisYear = books.filter(b => {
    if (b.audible_purchased) {
      return new Date(b.audible_purchased).getFullYear() === thisYear && b.status === 'read'
    }
    if (b.gr_date_read) {
      return new Date(b.gr_date_read).getFullYear() === thisYear
    }
    return false
  }).length

  return {
    totalBooks: readingTracker.stats.total_unique,
    confirmedRead: readingTracker.stats.confirmed_read,
    totalSeries: readingTracker.stats.total_series,
    booksThisYear,
    audibleTotal: readingTracker.sources.audible_total,
    goodreadsTotal: readingTracker.sources.goodreads_total,
  }
}

export function getSeriesData(): SeriesInfo[] {
  const books = getAllBooks()
  const seriesMap = new Map<string, Book[]>()

  books.forEach(book => {
    if (book.series) {
      const existing = seriesMap.get(book.series) || []
      existing.push(book)
      seriesMap.set(book.series, existing)
    }
  })

  const upcomingReleases = upcomingReleasesData.confirmedReleases as UpcomingRelease[]

  const seriesList: SeriesInfo[] = []

  seriesMap.forEach((books, seriesName) => {
    const sorted = [...books].sort((a, b) => {
      const numA = parseFloat(a.series_num || '0')
      const numB = parseFloat(b.series_num || '0')
      return numA - numB
    })

    const readBooks = sorted.filter(b => b.status === 'read' || b.status === 'read_no_date')
    const maxReadNum = readBooks.length > 0
      ? Math.max(...readBooks.map(b => parseFloat(b.series_num || '0')))
      : 0

    // Next to read = first book in series with num > maxReadNum, not yet read
    const nextToRead = sorted.find(b => {
      const num = parseFloat(b.series_num || '0')
      return num > maxReadNum && b.status !== 'read' && b.status !== 'read_no_date'
    }) || null

    // Find upcoming release for this series
    const upcoming = upcomingReleases.find(r =>
      r.series.toLowerCase().includes(seriesName.toLowerCase()) ||
      seriesName.toLowerCase().includes(r.series.toLowerCase())
    ) || null

    // Last read date
    const datesRead = sorted
      .filter(b => b.audible_purchased)
      .map(b => b.audible_purchased as string)
      .sort()
    const lastReadDate = datesRead.length > 0 ? datesRead[datesRead.length - 1] : null

    // Primary author
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

  // Sort by most recently read
  return seriesList.sort((a, b) => {
    if (!a.lastReadDate) return 1
    if (!b.lastReadDate) return -1
    return new Date(b.lastReadDate).getTime() - new Date(a.lastReadDate).getTime()
  })
}

export function getWhatToReadNext(): Book[] {
  const series = getSeriesData()
  
  // Get series with momentum (recently read, has next book)
  const withNext = series
    .filter(s => s.nextToRead !== null && s.lastReadDate !== null)
    .sort((a, b) => {
      if (!a.lastReadDate || !b.lastReadDate) return 0
      return new Date(b.lastReadDate).getTime() - new Date(a.lastReadDate).getTime()
    })
    .slice(0, 3)
    .map(s => s.nextToRead as Book)

  return withNext
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

export function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    read: 'Read',
    read_no_date: 'Read',
    to_read: 'Want to Read',
    reading: 'Reading',
    'currently-reading': 'Reading',
  }
  return map[status] || status
}

export function getStatusColor(status: string): string {
  if (status === 'read' || status === 'read_no_date') return 'text-emerald-400 bg-emerald-400/10'
  if (status === 'to_read') return 'text-amber-400 bg-amber-400/10'
  if (status === 'reading' || status === 'currently-reading') return 'text-blue-400 bg-blue-400/10'
  return 'text-slate-400 bg-slate-400/10'
}

export function formatDate(dateStr: string | null): string {
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
  const thrillerSeries = ['Terminal List', 'Gray Man', 'Mitch Rapp', 'Scot Harvath', 'Pike Logan', 'Orphan X', 'Jonathan Grave', 'Jack Reacher', 'Jason Trapp', 'Cotton Malone', 'Lincoln Rhyme', 'Cormoran Strike', 'Harry Bosch', 'Alex Cross', 'Will Robie', 'Camel Club', 'Travis Devine', 'Joshua Duffy', 'Department Q']
  const fantasySciFi = ['Red Rising', 'The Empyrean', 'Dune', 'The Silo Saga', 'Stormlight Archive', 'Kingkiller Chronicle', 'A Court of Thorns', 'Ender Saga', 'Wayward Pines', 'The Breach', 'The Passage Trilogy']
  const mystery = ['Chief Inspector Gamache', 'Thursday Murder Club', 'Holly Gibney', 'Lincoln Lawyer', 'Inheritance Games', 'Susan Ryeland']
  
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
