'use client'

import { useState, useMemo } from 'react'
import { SeriesInfo, formatDate, getGenreForSeries } from '@/lib/books'

interface Props {
  series: SeriesInfo[]
}

export default function SeriesClient({ series }: Props) {
  const [search, setSearch] = useState('')
  const [filterComplete, setFilterComplete] = useState<'all' | 'active' | 'complete'>('all')

  const filtered = useMemo(() => {
    return series.filter(s => {
      const matchSearch = !search ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.author.toLowerCase().includes(search.toLowerCase())
      const pct = s.readCount / s.totalCount
      const matchComplete =
        filterComplete === 'all' ||
        (filterComplete === 'complete' && pct >= 1) ||
        (filterComplete === 'active' && pct < 1)
      return matchSearch && matchComplete
    })
  }, [series, search, filterComplete])

  const activeCount = series.filter(s => s.readCount < s.totalCount).length
  const completeCount = series.filter(s => s.readCount >= s.totalCount).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-bold text-amber-400">Series Tracker</h1>
          <p className="text-slate-400 mt-1">
            {series.length} series · {activeCount} active · {completeCount} complete
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Search series or author..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-amber-50 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 text-sm"
        />
        <div className="flex gap-2">
          {(['all', 'active', 'complete'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilterComplete(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                filterComplete === f
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:border-slate-700'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <p className="text-slate-500 text-sm">Showing {filtered.length} series</p>

      {/* Series Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map(s => (
          <SeriesCard key={s.name} series={s} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          <div className="text-4xl mb-3">🔍</div>
          <div>No series found</div>
        </div>
      )}
    </div>
  )
}

function SeriesCard({ series }: { series: SeriesInfo }) {
  const pct = series.totalCount > 0 ? (series.readCount / series.totalCount) * 100 : 0
  const isComplete = pct >= 100
  const genre = getGenreForSeries(series.name)

  const genreColors: Record<string, string> = {
    Thriller: 'text-red-400 bg-red-400/10',
    'Sci-Fi/Fantasy': 'text-purple-400 bg-purple-400/10',
    Mystery: 'text-blue-400 bg-blue-400/10',
    Fiction: 'text-emerald-400 bg-emerald-400/10',
  }

  return (
    <div className={`bg-slate-900 rounded-xl border ${isComplete ? 'border-emerald-500/30' : 'border-slate-800'} p-5 hover:border-amber-500/30 transition-all`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold text-amber-100 leading-snug">{series.name}</h3>
          <p className="text-slate-400 text-sm mt-0.5">{series.author}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${genreColors[genre] || genreColors.Fiction}`}>
            {genre}
          </span>
          {isComplete && (
            <span className="text-xs text-emerald-400">✓ Complete</span>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-slate-400">Progress</span>
          <span className="text-xs text-slate-300">
            {series.readCount} / {series.totalCount} books
          </span>
        </div>
        <div className="bg-slate-800 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${isComplete ? 'bg-emerald-500' : 'bg-amber-500'}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <div className="text-right text-xs text-slate-500 mt-1">{Math.round(pct)}%</div>
      </div>

      {/* Books visual dots */}
      <div className="flex flex-wrap gap-1 mb-3">
        {series.books.slice(0, 20).map((book, i) => {
          const isRead = book.status === 'read' || book.status === 'read_no_date'
          return (
            <div
              key={i}
              title={`${book.title} (#${book.series_num})`}
              className={`w-5 h-5 rounded-sm text-xs flex items-center justify-center font-mono ${
                isRead
                  ? 'bg-amber-500 text-slate-900 font-bold'
                  : 'bg-slate-800 text-slate-600 border border-slate-700'
              }`}
            >
              {book.series_num ? parseFloat(book.series_num).toFixed(0) : '?'}
            </div>
          )
        })}
        {series.books.length > 20 && (
          <div className="text-xs text-slate-500 self-center">+{series.books.length - 20}</div>
        )}
      </div>

      {/* Next to read */}
      {series.nextToRead && (
        <div className="bg-slate-800/50 rounded-lg p-2.5 mb-3">
          <div className="text-xs text-slate-500 mb-1">📖 Next to read:</div>
          <div className="text-sm text-amber-300 font-medium truncate">{series.nextToRead.title}</div>
        </div>
      )}

      {/* Upcoming release */}
      {series.upcomingRelease && series.upcomingRelease.status === 'upcoming' && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5 mb-3">
          <div className="text-xs text-amber-600 mb-1">📅 Coming soon:</div>
          <div className="text-sm text-amber-400 font-medium truncate">{series.upcomingRelease.title}</div>
          <div className="text-xs text-slate-400 mt-0.5">{formatDate(series.upcomingRelease.releaseDate)}</div>
        </div>
      )}

      {/* Last read */}
      {series.lastReadDate && (
        <div className="text-xs text-slate-500">
          Last read: {formatDate(series.lastReadDate)}
        </div>
      )}
    </div>
  )
}
