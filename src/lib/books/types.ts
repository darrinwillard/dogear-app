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
  /** Last time Audible sync recorded any progress/listening activity on this
   *  book — the closest real signal to "last read on Audible" available from
   *  their API. Distinct from finishedAt, which is when the user manually
   *  marked the book Read in the app (may not match actual listening date). */
  progressSyncedAt?: string | null
  almostFinishedDismissedAt?: string | null
  /** Explicit wishlist (Upcoming add / manual). Independent of status. */
  wantToRead?: boolean | null
  /** Dismissed from Want to Read — not shown on want list. */
  notInterested?: boolean | null
  /** books.release_date when known (Upcoming / catalog). */
  releaseDate?: string | null
  /** Preferred buy/preorder URL (from series_releases.preorder_url when available). */
  preorderUrl?: string | null
  /** books.summary — synopsis text from Audible catalog, when available. */
  summary?: string | null
  /** books.publisher, when available. */
  publisher?: string | null
  /** books.genre — from Audible's category_ladders, when available. */
  genre?: string | null
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
  /** Genre, joined from books.genre by asin when the release is already
   *  synced into the books table (catalog-only releases without a books
   *  row yet won't have this). */
  genre?: string | null
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
