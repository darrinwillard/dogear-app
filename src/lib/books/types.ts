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
  /** Supabase user_books.id when live */
  userBookId?: string | null
  percentComplete?: number | null
  isFinished?: boolean | null
  statusSource?: string | null
  finishedAt?: string | null
  startedAt?: string | null
}

export type ReleaseInterestKind = 'series' | 'author' | 'both'

export interface UpcomingRelease {
  series: string
  seriesNumber: number | null
  title: string
  author: string
  authors?: string[]
  releaseDate: string | null
  status: string
  preorderUrl: string | null
  notes: string | null
  /** series = actively followed series; author = new from read authors; both */
  interestKind?: ReleaseInterestKind | null
  asin?: string | null
  coverUrl?: string | null
  source?: string | null
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

export interface LibraryStats {
  totalBooks: number
  confirmedRead: number
  totalSeries: number
  booksThisYear: number
  audibleTotal: number
  goodreadsTotal: number
  reading?: number
  wantToRead?: number
  avgRating?: number | null
  hoursListened?: number | null
}

export type DbStatus = 'unstarted' | 'in_progress' | 'completed'
