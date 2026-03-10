'use client'

import { useState, useMemo } from 'react'
import { Book, getStatusLabel, getStatusColor, formatDate } from '@/lib/books'

interface Props {
  books: Book[]
}

export default function LibraryClient({ books }: Props) {
  const [search, setSearch] = useState('')
  const [filterSeries, setFilterSeries] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterAuthor, setFilterAuthor] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')

  // Unique filter options
  const allSeries = useMemo(() => {
    const s = new Set(books.map(b => b.series).filter(Boolean) as string[])
    return Array.from(s).sort()
  }, [books])

  const allAuthors = useMemo(() => {
    const a = new Set(books.flatMap(b => b.authors))
    return Array.from(a).sort()
  }, [books])

  const allStatuses = ['read', 'read_no_date', 'to_read']

  const filtered = useMemo(() => {
    return books.filter(book => {
      const q = search.toLowerCase()
      const matchSearch = !search ||
        book.title.toLowerCase().includes(q) ||
        book.authors.some(a => a.toLowerCase().includes(q)) ||
        (book.series?.toLowerCase().includes(q))
      const matchSeries = !filterSeries || book.series === filterSeries
      const matchStatus = !filterStatus || book.status === filterStatus
      const matchAuthor = !filterAuthor || book.authors.includes(filterAuthor)
      return matchSearch && matchSeries && matchStatus && matchAuthor
    })
  }, [books, search, filterSeries, filterStatus, filterAuthor])

  const clearFilters = () => {
    setSearch('')
    setFilterSeries('')
    setFilterStatus('')
    setFilterAuthor('')
  }

  const hasFilters = search || filterSeries || filterStatus || filterAuthor

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-bold text-amber-400">Library</h1>
          <p className="text-slate-400 mt-1">
            {filtered.length.toLocaleString()} of {books.length.toLocaleString()} books
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('grid')}
            className={`p-2 rounded-lg transition-colors ${view === 'grid' ? 'bg-amber-500/20 text-amber-400' : 'text-slate-500 hover:text-slate-300'}`}
            title="Grid view"
          >
            ⊞
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-2 rounded-lg transition-colors ${view === 'list' ? 'bg-amber-500/20 text-amber-400' : 'text-slate-500 hover:text-slate-300'}`}
            title="List view"
          >
            ☰
          </button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 space-y-3">
        <input
          type="text"
          placeholder="Search by title, author, or series..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-amber-50 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 text-sm"
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-amber-50 focus:outline-none focus:border-amber-500"
          >
            <option value="">All Statuses</option>
            {allStatuses.map(s => (
              <option key={s} value={s}>{getStatusLabel(s)}</option>
            ))}
          </select>
          <select
            value={filterSeries}
            onChange={e => setFilterSeries(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-amber-50 focus:outline-none focus:border-amber-500"
          >
            <option value="">All Series</option>
            {allSeries.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={filterAuthor}
            onChange={e => setFilterAuthor(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-amber-50 focus:outline-none focus:border-amber-500"
          >
            <option value="">All Authors</option>
            {allAuthors.slice(0, 50).map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-amber-500 hover:text-amber-400 transition-colors"
          >
            ✕ Clear all filters
          </button>
        )}
      </div>

      {/* Results */}
      {view === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filtered.map((book, i) => (
            <BookCard key={i} book={book} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((book, i) => (
            <BookRow key={i} book={book} />
          ))}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          <div className="text-4xl mb-3">🔍</div>
          <div>No books match your filters</div>
          <button onClick={clearFilters} className="mt-2 text-amber-500 hover:text-amber-400 text-sm">
            Clear filters
          </button>
        </div>
      )}
    </div>
  )
}

function BookCard({ book }: { book: Book }) {
  const statusColor = getStatusColor(book.status)
  
  return (
    <div className="group bg-slate-900 rounded-xl border border-slate-800 overflow-hidden hover:border-amber-500/40 transition-all hover:-translate-y-0.5">
      {/* Cover placeholder */}
      <div className="aspect-[2/3] bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center relative">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-900/20 to-transparent" />
        <div className="text-center px-2 relative z-10">
          <div className="text-3xl mb-1">📚</div>
          <div className="text-xs text-slate-400 font-serif leading-tight line-clamp-3 text-center">
            {book.title}
          </div>
        </div>
        {/* Status badge */}
        <div className={`absolute top-2 right-2 text-xs px-1.5 py-0.5 rounded-md font-medium ${statusColor}`}>
          {book.status === 'read' || book.status === 'read_no_date' ? '✓' : '○'}
        </div>
      </div>
      <div className="p-2">
        <h3 className="text-xs font-medium text-amber-100 line-clamp-2 leading-snug group-hover:text-amber-300 transition-colors">
          {book.title}
        </h3>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{book.authors[0]}</p>
        {book.series && (
          <p className="text-xs text-amber-600 mt-0.5 truncate">
            #{book.series_num} · {book.series}
          </p>
        )}
      </div>
    </div>
  )
}

function BookRow({ book }: { book: Book }) {
  const statusColor = getStatusColor(book.status)
  
  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800 px-4 py-3 flex items-center gap-4 hover:border-slate-700 transition-colors">
      {/* Cover mini */}
      <div className="w-10 h-14 bg-slate-800 rounded flex items-center justify-center shrink-0">
        <span className="text-lg">📖</span>
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-amber-100 text-sm truncate">{book.title}</h3>
        <p className="text-slate-400 text-xs mt-0.5">{book.authors.join(', ')}</p>
        {book.series && (
          <p className="text-amber-600 text-xs mt-0.5">{book.series} #{book.series_num}</p>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-3">
        {book.audible_purchased && (
          <div className="hidden sm:block text-xs text-slate-500">
            {formatDate(book.audible_purchased)}
          </div>
        )}
        <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor}`}>
          {getStatusLabel(book.status)}
        </span>
        {book.sources.includes('audible') && (
          <span title="Audible" className="text-base">🎧</span>
        )}
        {book.sources.includes('goodreads') && (
          <span title="Goodreads" className="text-base">📗</span>
        )}
      </div>
    </div>
  )
}
