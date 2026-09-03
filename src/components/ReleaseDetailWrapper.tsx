'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Book, UpcomingRelease } from '@/lib/books'
import BookDetailModal from './BookDetailModal'

/**
 * Upcoming releases are catalog items, not owned books — UpcomingRelease
 * has no runtime/narrator/percentComplete/etc, so the modal renders with
 * whatever it has (title, author, series, release date, cover) and no
 * Read/Unread/Want/Not-Interested status selector (that flow already exists
 * on this page via WantButton — the modal here is detail-only + Want action).
 */
function releaseToPartialBook(release: UpcomingRelease): Book {
  return {
    title: release.title,
    authors: [release.author],
    series: release.series || null,
    series_num: release.seriesNumber != null ? String(release.seriesNumber) : null,
    audible_purchased: null,
    gr_shelf: null,
    gr_date_read: null,
    gr_rating: null,
    status: 'unstarted',
    sources: [],
    cover_url: release.coverUrl ?? null,
    asin: release.asin ?? null,
    releaseDate: release.releaseDate,
    preorderUrl: release.preorderUrl,
    wantToRead: false,
    notInterested: false,
  }
}

interface ReleaseDetailContextValue {
  openRelease: (release: UpcomingRelease) => void
}

const ReleaseDetailContext = createContext<ReleaseDetailContextValue | null>(null)

/** Wrap the Upcoming page content in this once; any descendant can call
 *  useReleaseDetail().openRelease(release) to open the shared modal. */
export function ReleaseDetailProvider({
  children,
  isAuthed,
}: {
  children: React.ReactNode
  isAuthed: boolean
}) {
  const router = useRouter()
  const [release, setRelease] = useState<UpcomingRelease | null>(null)
  const [pending, setPending] = useState(false)

  const openRelease = useCallback((r: UpcomingRelease) => setRelease(r), [])

  const handleWant = useCallback(
    async (asin: string, action: 'add' | 'not_interested') => {
      if (!isAuthed) return
      setPending(true)
      try {
        await fetch('/api/books/want', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asin, action }),
        })
        setRelease(null)
        router.refresh()
      } finally {
        setPending(false)
      }
    },
    [isAuthed, router]
  )

  const book = release ? releaseToPartialBook(release) : null

  return (
    <ReleaseDetailContext.Provider value={{ openRelease }}>
      {children}
      {book && (
        <BookDetailModal
          book={book}
          isPending={pending}
          onClose={() => setRelease(null)}
          extraActions={
            isAuthed && book.asin ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => book.asin && handleWant(book.asin, 'add')}
                  className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-violet-500/15 text-violet-300 border border-violet-500/30 hover:bg-violet-500/25 disabled:opacity-50"
                >
                  + Want to Read
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => book.asin && handleWant(book.asin, 'not_interested')}
                  className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                >
                  Not interested
                </button>
              </div>
            ) : undefined
          }
        />
      )}
    </ReleaseDetailContext.Provider>
  )
}

export function useReleaseDetail() {
  const ctx = useContext(ReleaseDetailContext)
  if (!ctx) {
    throw new Error('useReleaseDetail must be used within a ReleaseDetailProvider')
  }
  return ctx
}
