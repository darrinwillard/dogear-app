import { getAllBooks } from '@/lib/books'
import type { Book } from '@/lib/books'
import { createClient } from '@/lib/supabase/server'
import LibraryClient from './LibraryClient'

interface PageProps {
  searchParams?: { syncing?: string }
}

export default async function LibraryPage({ searchParams }: PageProps) {
  const syncing = searchParams?.syncing === '1'

  let books: Book[] = []
  let isAuthed = false
  let isNewUser = false

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (user) {
      isAuthed = true
      const { data: userBooks } = await supabase
        .from('user_books')
        .select('*, book:books(*)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (userBooks && userBooks.length > 0) {
        books = userBooks.map((ub: SupabaseUserBook) => mapToBook(ub))
      } else {
        // Authenticated but no synced books — show empty state
        isNewUser = true
      }
    }
  } catch {
    // Supabase unavailable — fall back to static JSON
  }

  if (!isAuthed) {
    books = getAllBooks()
  }

  return (
    <>
      {syncing && (
        <div className="bg-amber-400/10 border-b border-amber-400/30 px-4 py-3 text-center">
          <p className="text-amber-300 text-sm">
            ⏳ Syncing your Audible library… This may take a moment.
          </p>
        </div>
      )}
      <LibraryClient books={books} isAuthed={isAuthed} isNewUser={isNewUser} />
    </>
  )
}

// ---- Types returned by Supabase join ----

interface SupabaseBook {
  id: string
  asin: string
  title: string
  authors: string[] | null
  narrator: string | null
  runtime_minutes: number | null
  cover_url: string | null
  series_name: string | null
  series_position: number | null
  publisher: string | null
  release_date: string | null
  summary: string | null
}

interface SupabaseUserBook {
  id: string
  asin: string
  purchase_date: string | null
  status: 'unstarted' | 'in_progress' | 'completed'
  rating: number | null
  book: SupabaseBook | null
}

function mapStatus(s: SupabaseUserBook['status']): string {
  switch (s) {
    case 'completed':  return 'read'
    case 'in_progress': return 'reading'
    default:           return 'to_read'
  }
}

function mapToBook(ub: SupabaseUserBook): Book {
  const b = ub.book
  return {
    title: b?.title ?? 'Unknown',
    authors: b?.authors ?? [],
    series: b?.series_name ?? null,
    series_num: b?.series_position != null ? String(b.series_position) : null,
    audible_purchased: ub.purchase_date ?? null,
    gr_shelf: null,
    gr_date_read: null,
    gr_rating: ub.rating ?? null,
    status: mapStatus(ub.status),
    sources: ['audible'],
    cover_url: b?.cover_url ?? null,
    narrator: b?.narrator ?? null,
    runtime_length_min: b?.runtime_minutes ?? null,
    asin: ub.asin,
  }
}
