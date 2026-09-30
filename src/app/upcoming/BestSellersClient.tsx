'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import type { Book } from '@/lib/books'
import BookDetailModal from '@/components/BookDetailModal'

interface NytBook {
  rank: number
  rank_last_week: number
  weeks_on_list: number
  title: string
  author: string
  description: string
  publisher: string
  book_image: string | null
  amazon_product_url: string | null
  primary_isbn13: string | null
}

interface ListsResponse {
  list_name: string
  display_name: string
  published_date: string
  bestsellers_date: string
  books: NytBook[]
  error?: string
}

const DEFAULT_LISTS = [
  { value: 'combined-print-and-e-book-fiction', label: 'Fiction' },
  { value: 'combined-print-and-e-book-nonfiction', label: 'Nonfiction' },
  { value: 'hardcover-fiction', label: 'Hardcover Fiction' },
  { value: 'hardcover-nonfiction', label: 'Hardcover Nonfiction' },
]

function Cover({ book }: { book: NytBook }) {
  const [imgError, setImgError] = useState(false)
  if (book.book_image && !imgError) {
    return (
      <div className="w-14 h-20 sm:w-16 sm:h-24 relative shrink-0 rounded-lg overflow-hidden bg-slate-800">
        <Image
          src={book.book_image}
          alt={book.title}
          fill
          className="object-cover"
          onError={() => setImgError(true)}
          sizes="64px"
          unoptimized
        />
      </div>
    )
  }
  return (
    <div className="w-14 h-20 sm:w-16 sm:h-24 relative shrink-0 rounded-lg overflow-hidden bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700/50 flex items-center justify-center">
      <span className="text-amber-700/60 text-2xl">📕</span>
    </div>
  )
}

function nytBookToPartialBook(book: NytBook): Book {
  return {
    title: book.title,
    authors: [book.author],
    series: null,
    series_num: null,
    audible_purchased: null,
    gr_shelf: null,
    gr_date_read: null,
    gr_rating: null,
    status: 'unstarted',
    sources: [],
    cover_url: book.book_image,
    // No ASIN for NYT titles — use the synthetic isbn: key so "Want to Read"
    // (which keys off asin) still works via the isbn13 field on /api/books/want.
    asin: book.primary_isbn13 ? `isbn:${book.primary_isbn13}` : null,
    publisher: book.publisher || null,
    summary: book.description || null,
    wantToRead: false,
    notInterested: false,
  }
}

function WantBestsellerButton({
  book,
  compact = false,
}: {
  book: NytBook
  compact?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!book.primary_isbn13) {
    return <span className="text-[11px] text-slate-600">No ISBN</span>
  }

  async function handleAdd() {
    if (busy || done) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/books/want', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          isbn13: book.primary_isbn13,
          title: book.title,
          authors: [book.author],
          author: book.author,
          cover_url: book.book_image,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Failed to add')
        return
      }
      setDone(true)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <span
        className={`inline-flex items-center gap-1 ${compact ? 'text-[11px]' : 'text-xs'} text-violet-300 border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 rounded-lg`}
      >
        ✓ Want to Read
      </span>
    )
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleAdd()}
        className={`font-medium bg-violet-500/15 text-violet-300 border border-violet-500/30 px-3 py-1.5 rounded-lg hover:bg-violet-500/25 transition-colors disabled:opacity-50 ${compact ? 'text-[11px]' : 'text-xs'}`}
      >
        {busy ? 'Adding…' : '+ Want to Read'}
      </button>
      {error && <span className="text-[10px] text-red-400 max-w-[12rem] text-right">{error}</span>}
    </div>
  )
}

export default function BestSellersClient() {
  const [listKey, setListKey] = useState(DEFAULT_LISTS[0].value)
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading')
  const [data, setData] = useState<ListsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openBook, setOpenBook] = useState<NytBook | null>(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setError(null)
    fetch(`/api/books/bestsellers?list=${encodeURIComponent(listKey)}`)
      .then((res) => res.json())
      .then((json: ListsResponse) => {
        if (cancelled) return
        if (json.error) {
          setError(json.error)
          setState('error')
          return
        }
        setData(json)
        setState('done')
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to load')
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [listKey])

  const publishedLabel = data?.published_date
    ? new Date(data.published_date + 'T12:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-slate-400 text-sm">
            Live from the New York Times Books API — updated weekly.
          </p>
          {publishedLabel && (
            <p className="text-slate-500 text-xs mt-1">List date · {publishedLabel}</p>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {DEFAULT_LISTS.map((l) => (
            <button
              key={l.value}
              type="button"
              onClick={() => setListKey(l.value)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                listKey === l.value
                  ? 'bg-amber-500 text-slate-900 border-amber-500'
                  : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      {state === 'loading' && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center space-y-3">
          <div className="text-3xl animate-pulse">🏆</div>
          <p className="text-slate-400 text-sm">Loading bestsellers…</p>
        </div>
      )}

      {state === 'error' && (
        <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl p-6 text-sm text-amber-100 space-y-3">
          <p>{error || 'Something went wrong loading the NYT list.'}</p>
        </div>
      )}

      {state === 'done' && data && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.books.map((book) => (
            <div
              key={book.primary_isbn13 || book.title}
              role="button"
              tabIndex={0}
              onClick={() => setOpenBook(book)}
              className="bg-slate-900 rounded-xl border border-slate-800 hover:border-amber-500/30 transition-all p-4 flex gap-3 cursor-pointer"
            >
              <Cover book={book} />
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                    #{book.rank}
                  </span>
                  {book.weeks_on_list > 0 && (
                    <span className="text-xs text-slate-500">
                      {book.weeks_on_list} wk{book.weeks_on_list === 1 ? '' : 's'} on list
                    </span>
                  )}
                </div>
                <h3 className="font-semibold text-amber-100 leading-snug">{book.title}</h3>
                <p className="text-slate-400 text-sm mt-0.5">{book.author}</p>
                {book.description && (
                  <p className="text-slate-500 text-xs mt-2 line-clamp-2">{book.description}</p>
                )}
                <div
                  className="mt-auto pt-2 flex items-center justify-between gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  {book.amazon_product_url && (
                    <a
                      href={book.amazon_product_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-amber-500 hover:text-amber-400"
                    >
                      Buy →
                    </a>
                  )}
                  <WantBestsellerButton book={book} compact />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {openBook && (
        <BookDetailModal
          book={nytBookToPartialBook(openBook)}
          isPending={false}
          onClose={() => setOpenBook(null)}
          extraActions={
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                #{openBook.rank} on {data?.display_name || 'NYT Best Sellers'}
                {openBook.weeks_on_list > 0
                  ? ` · ${openBook.weeks_on_list} wk${openBook.weeks_on_list === 1 ? '' : 's'} on list`
                  : ''}
              </span>
              {openBook.amazon_product_url && (
                <a
                  href={openBook.amazon_product_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-500 hover:text-amber-400 font-medium"
                >
                  Buy on Amazon →
                </a>
              )}
            </div>
          }
        />
      )}
    </div>
  )
}
