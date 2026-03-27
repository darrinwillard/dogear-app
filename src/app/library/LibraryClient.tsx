'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Book, getStatusLabel, getStatusColor, formatDate, formatRuntime } from '@/lib/books'

interface Props {
  books: Book[]
  isAuthed?: boolean
  isNewUser?: boolean
}

type FilterTab = 'all' | 'audible' | 'goodreads' | 'read' | 'reading' | 'want'

// LocalStorage helpers
function lsGet(key: string): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(key) } catch { return null }
}
function lsSet(key: string, val: string) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(key, val) } catch {}
}

function bookKey(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '_')
}

const STATUS_CYCLE: Record<string, string> = {
  to_read: 'reading',
  reading: 'read',
  'currently-reading': 'read',
  read: 'to_read',
  read_no_date: 'to_read',
}

export default function LibraryClient({ books, isAuthed = false, isNewUser = false }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [syncing, setSyncing] = useState(false)
  // Per-book overrides from localStorage
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [statuses, setStatuses] = useState<Record<string, string>>({})

  // Load localStorage on mount
  useEffect(() => {
    const r: Record<string, number> = {}
    const s: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k) continue
      if (k.startsWith('dogear_rating_')) {
        const key = k.slice('dogear_rating_'.length)
        const v = parseInt(lsGet(k) || '', 10)
        if (v >= 1 && v <= 5) r[key] = v
      } else if (k.startsWith('dogear_status_')) {
        const key = k.slice('dogear_status_'.length)
        const v = lsGet(k)
        if (v) s[key] = v
      }
    }
    setRatings(r)
    setStatuses(s)
  }, [])

  const setRating = useCallback((title: string, stars: number) => {
    const key = bookKey(title)
    lsSet(`dogear_rating_${key}`, String(stars))
    setRatings(prev => ({ ...prev, [key]: stars }))
  }, [])

  const cycleStatus = useCallback((title: string, currentStatus: string) => {
    const key = bookKey(title)
    const next = STATUS_CYCLE[currentStatus] || 'to_read'
    lsSet(`dogear_status_${key}`, next)
    setStatuses(prev => ({ ...prev, [key]: next }))
  }, [])

  async function handleSync() {
    setSyncing(true)
    try {
      await fetch('/api/audible/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      router.refresh()
    } finally {
      setSyncing(false)
    }
  }

  const getEffectiveStatus = useCallback((book: Book) => {
    return statuses[bookKey(book.title)] || book.status
  }, [statuses])

  const getEffectiveRating = useCallback((book: Book) => {
    return ratings[bookKey(book.title)] ?? book.gr_rating ?? null
  }, [ratings])

  // Tab filter
  const tabFiltered = useMemo(() => {
    return books.filter(book => {
      const status = getEffectiveStatus(book)
      if (activeTab === 'audible') return book.sources.includes('audible')
      if (activeTab === 'goodreads') return book.sources.includes('goodreads')
      if (activeTab === 'read') return status === 'read' || status === 'read_no_date'
      if (activeTab === 'reading') return status === 'reading' || status === 'currently-reading'
      if (activeTab === 'want') return status === 'to_read'
      return true
    })
  }, [books, activeTab, getEffectiveStatus])

  // Search filter
  const filtered = useMemo(() => {
    if (!search) return tabFiltered
    const q = search.toLowerCase()
    return tabFiltered.filter(book =>
      book.title.toLowerCase().includes(q) ||
      book.authors.some(a => a.toLowerCase().includes(q)) ||
      (book.series?.toLowerCase().includes(q))
    )
  }, [tabFiltered, search])

  // Stats
  const stats = useMemo(() => {
    const read = books.filter(b => {
      const s = getEffectiveStatus(b)
      return s === 'read' || s === 'read_no_date'
    }).length
    const audible = books.filter(b => b.sources.includes('audible')).length
    const rated = books.map(b => getEffectiveRating(b)).filter(r => r !== null) as number[]
    const avgRating = rated.length > 0
      ? (rated.reduce((a, b) => a + b, 0) / rated.length).toFixed(1)
      : null
    return { total: books.length, read, audible, avgRating, ratedCount: rated.length }
  }, [books, getEffectiveStatus, getEffectiveRating])

  const tabs: { key: FilterTab; label: string; count?: number }[] = [
    { key: 'all', label: 'All', count: books.length },
    { key: 'audible', label: 'Audible', count: books.filter(b => b.sources.includes('audible')).length },
    { key: 'goodreads', label: 'Goodreads', count: books.filter(b => b.sources.includes('goodreads')).length },
    { key: 'read', label: 'Read', count: books.filter(b => { const s = getEffectiveStatus(b); return s === 'read' || s === 'read_no_date' }).length },
    { key: 'reading', label: 'Reading', count: books.filter(b => { const s = getEffectiveStatus(b); return s === 'reading' || s === 'currently-reading' }).length },
    { key: 'want', label: 'Want to Read', count: books.filter(b => getEffectiveStatus(b) === 'to_read').length },
  ]

  // Empty state for new authenticated users
  if (isNewUser) {
    return (
      <div className="space-y-6">
        <h1 className="font-serif text-3xl font-bold text-amber-400">Library</h1>
        <div className="text-center py-20">
          <div className="text-6xl mb-5">🎧</div>
          <h2 className="text-xl font-semibold text-amber-50 mb-2">Your library is empty</h2>
          <p className="text-slate-400 mb-8 max-w-sm mx-auto">
            Connect your Audible account to sync your books and get started.
          </p>
          <Link
            href="/settings/connect-audible"
            className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-xl transition-colors"
          >
            <span>🎧</span> Connect Audible Account
          </Link>
          <p className="mt-4 text-slate-500 text-sm">
            You can also{' '}
            <Link href="/settings" className="text-amber-500 hover:text-amber-400">
              visit Settings
            </Link>
            {' '}to manage your account.
          </p>
        </div>
      </div>
    )
  }

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
          {isAuthed && (
            <button
              onClick={handleSync}
              disabled={syncing}
              className={`p-2 rounded-lg transition-colors text-sm font-medium ${
                syncing
                  ? 'text-amber-400 bg-amber-500/10 cursor-not-allowed'
                  : 'text-slate-500 hover:text-amber-400 hover:bg-amber-500/10'
              }`}
              title={syncing ? 'Syncing...' : 'Sync Audible library'}
            >
              {syncing ? '⏳' : '🔄'}
            </button>
          )}
          <button
            onClick={() => setView('grid')}
            className={`p-2 rounded-lg transition-colors ${view === 'grid' ? 'bg-amber-500/20 text-amber-400' : 'text-slate-500 hover:text-slate-300'}`}
            title="Grid view"
          >⊞</button>
          <button
            onClick={() => setView('list')}
            className={`p-2 rounded-lg transition-colors ${view === 'list' ? 'bg-amber-500/20 text-amber-400' : 'text-slate-500 hover:text-slate-300'}`}
            title="List view"
          >☰</button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <div className="text-xl font-bold text-amber-400">{stats.total}</div>
          <div className="text-xs text-slate-400 mt-0.5">Total Books</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <div className="text-xl font-bold text-emerald-400">{stats.read}</div>
          <div className="text-xs text-slate-400 mt-0.5">Read</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <div className="text-xl font-bold text-blue-400">{stats.audible}</div>
          <div className="text-xs text-slate-400 mt-0.5">Audible</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 text-center">
          <div className="text-xl font-bold text-amber-400">
            {stats.avgRating ? `★ ${stats.avgRating}` : '—'}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">Avg Rating</div>
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search by title, author, or series..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-amber-50 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 text-sm"
      />

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-amber-500 text-slate-900'
                : 'bg-slate-800 text-slate-400 hover:text-amber-200 hover:bg-slate-700'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`ml-1.5 text-xs ${activeTab === tab.key ? 'text-slate-700' : 'text-slate-500'}`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Results */}
      {view === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filtered.map((book, i) => (
            <BookCard
              key={i}
              book={book}
              effectiveStatus={getEffectiveStatus(book)}
              effectiveRating={getEffectiveRating(book)}
              onRate={setRating}
              onCycleStatus={cycleStatus}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((book, i) => (
            <BookRow
              key={i}
              book={book}
              effectiveStatus={getEffectiveStatus(book)}
              effectiveRating={getEffectiveRating(book)}
              onRate={setRating}
              onCycleStatus={cycleStatus}
            />
          ))}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          <div className="text-4xl mb-3">🔍</div>
          <div>No books match your filters</div>
          <button
            onClick={() => { setSearch(''); setActiveTab('all') }}
            className="mt-2 text-amber-500 hover:text-amber-400 text-sm"
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  )
}

interface CardProps {
  book: Book
  effectiveStatus: string
  effectiveRating: number | null
  onRate: (title: string, stars: number) => void
  onCycleStatus: (title: string, currentStatus: string) => void
}

function StarRating({ rating, onRate, title }: { rating: number | null; onRate: (t: string, s: number) => void; title: string }) {
  const [hover, setHover] = useState<number | null>(null)
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          onClick={e => { e.stopPropagation(); onRate(title, star) }}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(null)}
          className={`text-xs leading-none transition-colors ${
            star <= (hover ?? rating ?? 0) ? 'text-amber-400' : 'text-slate-600 hover:text-amber-600'
          }`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

function StatusBadge({ status, onCycle, title }: { status: string; onCycle: (t: string, s: string) => void; title: string }) {
  const colorMap: Record<string, string> = {
    read: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
    read_no_date: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20',
    reading: 'bg-blue-400/10 text-blue-400 border-blue-400/20',
    'currently-reading': 'bg-blue-400/10 text-blue-400 border-blue-400/20',
    to_read: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
  }
  const color = colorMap[status] || 'bg-slate-400/10 text-slate-400 border-slate-400/20'
  return (
    <button
      onClick={e => { e.stopPropagation(); onCycle(title, status) }}
      className={`text-xs px-2 py-0.5 rounded-full border font-medium transition-opacity hover:opacity-70 ${color}`}
      title="Click to change status"
    >
      {getStatusLabel(status)}
    </button>
  )
}

function CoverImage({ book }: { book: Book }) {
  const [imgError, setImgError] = useState(false)

  if (book.cover_url && !imgError) {
    return (
      <Image
        src={book.cover_url}
        alt={book.title}
        fill
        className="object-cover"
        onError={() => setImgError(true)}
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
        unoptimized
      />
    )
  }

  return (
    <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center">
      <div className="absolute inset-0 bg-gradient-to-br from-amber-900/20 to-transparent" />
      <div className="text-center px-2 relative z-10">
        <div className="w-8 h-10 mx-auto mb-1 border border-amber-800/40 rounded-sm bg-amber-900/20 flex items-center justify-center">
          <span className="text-amber-700/60 text-xs font-serif">A</span>
        </div>
        <div className="text-xs text-slate-500 font-serif leading-tight line-clamp-3 text-center">
          {book.title}
        </div>
      </div>
    </div>
  )
}

function BookCard({ book, effectiveStatus, effectiveRating, onRate, onCycleStatus }: CardProps) {
  const runtime = formatRuntime(book.runtime_length_min)

  return (
    <div className="group bg-slate-900 rounded-xl border border-slate-800 overflow-hidden hover:border-amber-500/40 transition-all hover:-translate-y-0.5">
      {/* Cover */}
      <div className="aspect-[2/3] relative overflow-hidden">
        <CoverImage book={book} />
        {/* Status badge overlay */}
        <div className="absolute top-2 right-2 z-10">
          <StatusBadge status={effectiveStatus} onCycle={onCycleStatus} title={book.title} />
        </div>
        {/* Runtime badge */}
        {runtime && (
          <div className="absolute bottom-2 left-2 z-10 text-xs bg-slate-900/80 text-slate-300 px-1.5 py-0.5 rounded backdrop-blur-sm">
            {runtime}
          </div>
        )}
      </div>

      <div className="p-2 space-y-1.5">
        <h3 className="text-xs font-medium text-amber-100 line-clamp-2 leading-snug group-hover:text-amber-300 transition-colors">
          {book.title}
        </h3>
        <p className="text-xs text-slate-500 truncate">{book.authors[0]}</p>
        {book.narrator && (
          <p className="text-xs text-slate-500 truncate">
            <span className="text-slate-600">🎙</span> {book.narrator}
          </p>
        )}
        {book.series && (
          <p className="text-xs text-amber-700 truncate">
            #{book.series_num} · {book.series}
          </p>
        )}
        <StarRating rating={effectiveRating} onRate={onRate} title={book.title} />
      </div>
    </div>
  )
}

function BookRow({ book, effectiveStatus, effectiveRating, onRate, onCycleStatus }: CardProps) {
  const [imgError, setImgError] = useState(false)
  const runtime = formatRuntime(book.runtime_length_min)

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800 px-4 py-3 flex items-center gap-4 hover:border-slate-700 transition-colors">
      {/* Thumbnail */}
      <div className="w-10 h-14 bg-slate-800 rounded overflow-hidden relative shrink-0">
        {book.cover_url && !imgError ? (
          <Image
            src={book.cover_url}
            alt={book.title}
            fill
            className="object-cover"
            onError={() => setImgError(true)}
            sizes="40px"
            unoptimized
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-slate-600 text-xs font-serif">📖</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-amber-100 text-sm truncate">{book.title}</h3>
        <p className="text-slate-400 text-xs mt-0.5">{book.authors.join(', ')}</p>
        {book.narrator && (
          <p className="text-slate-500 text-xs mt-0.5 truncate">🎙 {book.narrator}</p>
        )}
        {book.series && (
          <p className="text-amber-700 text-xs mt-0.5">{book.series} #{book.series_num}</p>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-3">
        {runtime && (
          <span className="hidden sm:block text-xs text-slate-500">{runtime}</span>
        )}
        {book.audible_purchased && !runtime && (
          <div className="hidden sm:block text-xs text-slate-500">{formatDate(book.audible_purchased)}</div>
        )}
        <StarRating rating={effectiveRating} onRate={onRate} title={book.title} />
        <StatusBadge status={effectiveStatus} onCycle={onCycleStatus} title={book.title} />
        {book.sources.includes('audible') && <span title="Audible" className="text-base">🎧</span>}
        {book.sources.includes('goodreads') && <span title="Goodreads" className="text-base">📗</span>}
      </div>
    </div>
  )
}
