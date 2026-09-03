'use client'

import { useCallback, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { SeriesInfo, Book, formatDate, getGenreForSeries, mapUiStatusToDb } from '@/lib/books'
import BookDetailModal, { type DetailStatus } from '@/components/BookDetailModal'

interface Props {
  series: SeriesInfo[]
  isAuthed?: boolean
  source?: 'live' | 'demo'
}

type Filter = 'all' | 'active' | 'complete' | 'in_progress'

export default function SeriesClient({
  series,
  isAuthed = false,
  source = 'demo',
}: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  // Default 'all' until historical seed lands (Phase 2) — in_progress would look empty
  const [filterComplete, setFilterComplete] = useState<Filter>('all')
  const [detailAsin, setDetailAsin] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})

  // Flatten once for O(1)-ish lookup by asin across all series' books.
  const allBooksByAsin = useMemo(() => {
    const map = new Map<string, Book>()
    for (const s of series) {
      for (const b of s.books) {
        if (b.asin) map.set(b.asin, b)
      }
    }
    return map
  }, [series])

  const setDetailStatus = useCallback(
    async (asin: string, next: DetailStatus) => {
      if (!isAuthed) return
      setPending((p) => ({ ...p, [asin]: true }))
      try {
        if (next === 'read') {
          await fetch('/api/books/status', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asin, status: mapUiStatusToDb('completed') }),
          })
        } else if (next === 'unread') {
          await fetch('/api/books/status', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asin, status: mapUiStatusToDb('unstarted') }),
          })
          await fetch('/api/books/want', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asin, action: 'remove' }),
          })
        } else if (next === 'want') {
          await fetch('/api/books/want', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asin, action: 'add' }),
          })
        } else {
          await fetch('/api/books/want', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asin, action: 'not_interested' }),
          })
        }
        router.refresh()
      } finally {
        setPending((p) => {
          const n = { ...p }
          delete n[asin]
          return n
        })
      }
    },
    [isAuthed, router]
  )

  const detailBook = detailAsin ? allBooksByAsin.get(detailAsin) : undefined

  const filtered = useMemo(() => {
    return series.filter((s) => {
      const matchSearch =
        !search ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.author.toLowerCase().includes(search.toLowerCase())
      const pct = s.totalCount > 0 ? s.readCount / s.totalCount : 0
      const matchComplete =
        filterComplete === 'all' ||
        (filterComplete === 'complete' && pct >= 1) ||
        (filterComplete === 'active' && pct < 1) ||
        (filterComplete === 'in_progress' &&
          s.readCount >= 1 &&
          s.readCount < s.totalCount)
      return matchSearch && matchComplete
    })
  }, [series, search, filterComplete])

  const activeCount = series.filter((s) => s.readCount < s.totalCount).length
  const completeCount = series.filter((s) => s.readCount >= s.totalCount).length
  const inProgressCount = series.filter(
    (s) => s.readCount >= 1 && s.readCount < s.totalCount
  ).length

  const filters: { key: Filter; label: string; count?: number }[] = [
    { key: 'all', label: 'all' },
    { key: 'in_progress', label: 'in progress', count: inProgressCount },
    { key: 'active', label: 'incomplete', count: activeCount },
    { key: 'complete', label: 'complete', count: completeCount },
  ]

  if (series.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-serif text-3xl font-bold text-amber-400">
            Series Tracker
          </h1>
          <p className="text-slate-400 mt-1">
            {source === 'live' && isAuthed ? 'live library' : 'demo'}
          </p>
        </div>
        <div className="text-center py-16 text-slate-400 max-w-lg mx-auto">
          <div className="text-4xl mb-3">📚</div>
          <div className="text-amber-100 font-medium mb-2">No series to show yet</div>
          <p className="text-sm text-slate-500">
            {isAuthed
              ? 'Run Audible Sync Now in Settings to backfill series names from Audible. Until series tags land (and status seed later), this page stays empty rather than silently showing zero.'
              : 'Sign in and sync Audible to track series from your live library.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-bold text-amber-400">
            Series Tracker
          </h1>
          <p className="text-slate-400 mt-1">
            {series.length} series · {inProgressCount} in progress ·{' '}
            {completeCount} complete
            {source === 'live' && isAuthed
              ? ' · live'
              : source === 'demo'
                ? ' · demo'
                : ''}
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Search series or author..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-amber-50 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 text-sm"
        />
        <div className="flex gap-2 flex-wrap">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilterComplete(f.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                filterComplete === f.key
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:border-slate-700'
              }`}
            >
              {f.label}
              {f.count !== undefined ? ` (${f.count})` : ''}
            </button>
          ))}
        </div>
      </div>

      <p className="text-slate-500 text-sm">Showing {filtered.length} series</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((s) => (
          <SeriesCard key={s.name} series={s} onOpenBook={setDetailAsin} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          <div className="text-4xl mb-3">🔍</div>
          <div>No series found</div>
        </div>
      )}

      {detailBook && detailAsin && (
        <BookDetailModal
          book={detailBook}
          isPending={!!pending[detailAsin]}
          onClose={() => setDetailAsin(null)}
          onSetDetailStatus={isAuthed ? setDetailStatus : undefined}
        />
      )}
    </div>
  )
}

function SeriesCard({
  series,
  onOpenBook,
}: {
  series: SeriesInfo
  onOpenBook: (asin: string) => void
}) {
  const pct =
    series.totalCount > 0 ? (series.readCount / series.totalCount) * 100 : 0
  const isComplete = pct >= 100
  const genre = getGenreForSeries(series.name)

  const genreColors: Record<string, string> = {
    Thriller: 'text-red-400 bg-red-400/10',
    'Sci-Fi/Fantasy': 'text-purple-400 bg-purple-400/10',
    Mystery: 'text-blue-400 bg-blue-400/10',
    Fiction: 'text-emerald-400 bg-emerald-400/10',
  }

  return (
    <div
      className={`bg-slate-900 rounded-xl border ${
        isComplete ? 'border-emerald-500/30' : 'border-slate-800'
      } p-5 hover:border-amber-500/30 transition-all`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold text-amber-100 leading-snug">
            {series.name}
          </h3>
          <p className="text-slate-400 text-sm mt-0.5">{series.author}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              genreColors[genre] || genreColors.Fiction
            }`}
          >
            {genre}
          </span>
          {isComplete && (
            <span className="text-xs text-emerald-400">✓ Complete</span>
          )}
        </div>
      </div>

      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-slate-400">Progress</span>
          <span className="text-xs text-slate-300">
            {series.readCount} / {series.totalCount} books
          </span>
        </div>
        <div className="bg-slate-800 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${
              isComplete ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <div className="text-right text-xs text-slate-500 mt-1">
          {Math.round(pct)}%
        </div>
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {series.books.map((book, i) => {
          const isRead =
            book.status === 'read' || book.status === 'read_no_date'
          return (
            <button
              key={book.asin || `${book.title}-${i}`}
              type="button"
              title={`${book.title} (#${book.series_num})`}
              onClick={(e) => {
                e.stopPropagation()
                if (book.asin) onOpenBook(book.asin)
              }}
              disabled={!book.asin}
              className={`w-5 h-5 rounded-sm text-xs flex items-center justify-center font-mono transition-opacity hover:opacity-75 disabled:cursor-default disabled:hover:opacity-100 ${
                isRead
                  ? 'bg-amber-500 text-slate-900 font-bold'
                  : 'bg-slate-800 text-slate-600 border border-slate-700'
              }`}
            >
              {book.series_num ? parseFloat(book.series_num).toFixed(0) : '?'}
            </button>
          )
        })}
      </div>

      {series.nextToRead && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (series.nextToRead?.asin) onOpenBook(series.nextToRead.asin)
          }}
          disabled={!series.nextToRead.asin}
          className="w-full text-left bg-slate-800/50 rounded-lg p-2.5 mb-3 hover:bg-slate-800 transition-colors disabled:cursor-default disabled:hover:bg-slate-800/50"
        >
          <div className="text-xs text-slate-500 mb-1">📖 Next to read:</div>
          <div className="text-sm text-amber-300 font-medium truncate">
            {series.nextToRead.title}
          </div>
        </button>
      )}

      {series.upcomingRelease && series.upcomingRelease.status === 'upcoming' && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5 mb-3">
          <div className="text-xs text-amber-600 mb-1">📅 Coming soon:</div>
          <div className="text-sm text-amber-400 font-medium truncate">
            {series.upcomingRelease.title}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {formatDate(series.upcomingRelease.releaseDate)}
          </div>
        </div>
      )}

      {series.lastReadDate && (
        <div className="text-xs text-slate-500">
          Last read: {formatDate(series.lastReadDate)}
        </div>
      )}
    </div>
  )
}
