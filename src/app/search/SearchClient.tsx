'use client'

import { useState } from 'react'
import type { DiscoveryHit } from '@/lib/books/discover-types'
import type { Book } from '@/lib/books/types'
import DiscoverCard from './DiscoverCard'

const GENRE_CHIPS = [
  'Science Fiction',
  'Fantasy',
  'Mystery',
  'Thriller',
  'Romance',
  'Nonfiction',
  'Horror',
  'Biography',
]

function LibrarySearchTab({ books }: { books: Book[] }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const results = q
    ? books.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.authors.some((a) => a.toLowerCase().includes(q)) ||
          (b.series || '').toLowerCase().includes(q)
      )
    : []

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your library by title, author, or series…"
        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
      />
      {q && (
        <p className="text-slate-500 text-xs">
          {results.length} match{results.length === 1 ? '' : 'es'}
        </p>
      )}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {results.slice(0, 60).map((b) => (
          <div
            key={b.asin || b.title}
            className="bg-slate-900 rounded-xl border border-slate-800 p-3 flex gap-3"
          >
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-amber-100 text-sm leading-snug">{b.title}</h3>
              <p className="text-slate-400 text-xs mt-0.5">{b.authors.join(', ')}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DiscoverTab() {
  const [query, setQuery] = useState('')
  const [author, setAuthor] = useState('')
  const [subject, setSubject] = useState<string | null>(null)
  const [minRating, setMinRating] = useState(4.0)
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [hits, setHits] = useState<DiscoveryHit[]>([])
  const [error, setError] = useState<string | null>(null)

  async function runSearch() {
    if (!query.trim() && !author.trim() && !subject) return
    setState('loading')
    setError(null)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (author.trim()) params.set('author', author.trim())
      if (subject) params.set('subject', subject)
      params.set('minRating', String(minRating))
      const res = await fetch(`/api/books/discover?${params}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Search failed')
        setState('error')
        return
      }
      setHits(data.hits || [])
      setState('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
      setState('error')
    }
  }

  return (
    <div className="space-y-5">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search title, author, genre…"
        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
      />
      <input
        type="text"
        value={author}
        onChange={(e) => setAuthor(e.target.value)}
        placeholder="Filter by author (optional)…"
        className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
      />
      <div className="flex flex-wrap gap-2">
        {GENRE_CHIPS.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setSubject(subject === g ? null : g)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              subject === g
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
            }`}
          >
            {g}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs text-slate-500 shrink-0">Min rating</label>
        <input
          type="range"
          min={0}
          max={5}
          step={0.5}
          value={minRating}
          onChange={(e) => setMinRating(Number(e.target.value))}
          className="flex-1"
        />
        <span className="text-xs text-amber-400 w-10 text-right">{minRating.toFixed(1)}+</span>
      </div>
      <button
        type="button"
        onClick={() => void runSearch()}
        className="w-full bg-amber-500 text-slate-900 font-semibold px-5 py-2.5 rounded-lg hover:bg-amber-400 transition-colors"
      >
        Search
      </button>

      {state === 'loading' && (
        <div className="text-center py-8 text-slate-400 text-sm animate-pulse">
          Searching Audible&apos;s catalog…
        </div>
      )}
      {state === 'error' && (
        <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl p-4 text-sm text-amber-100">
          {error}
        </div>
      )}
      {state === 'done' && hits.length === 0 && (
        <div className="text-center py-8 text-slate-500 text-sm">
          No results at that rating threshold — try lowering it.
        </div>
      )}
      {state === 'done' && hits.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {hits.map((hit) => (
            <DiscoverCard key={hit.asin} hit={hit} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Minimal seed shape a picker card needs, whether it comes from the local
 * library (Book) or an Audible catalog search (DiscoveryHit). Unified so
 * the picker UI and the `selected` ASIN list don't care about the source. */
interface SeedCandidate {
  asin: string
  title: string
  authors: string[]
  inLibrary: boolean
}

function SimilarTab({ books }: { books: Book[] }) {
  // Book.status is the UI-mapped string ('read', not 'completed' —
  // mapDbStatusToUi() converts DB 'completed' -> UI 'read'). Filtering on
  // the raw DB value here silently emptied this list for every user
  // (confirmed live: Darrin's 496 completed books all had valid ASINs,
  // but none matched status === 'completed' client-side).
  const rated = books.filter((b) => (b.status === 'read' || b.status === 'read_no_date') && b.asin)
  const [selected, setSelected] = useState<string[]>([])
  // selectedMeta persists title/author for chips even after a book scrolls
  // out of the current filtered/search list — ASIN alone isn't enough to
  // render a removable chip once the source list has moved on.
  const [selectedMeta, setSelectedMeta] = useState<Record<string, { title: string; authors: string[] }>>({})
  const [filterQuery, setFilterQuery] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [hits, setHits] = useState<DiscoveryHit[]>([])
  const [error, setError] = useState<string | null>(null)

  // Audible catalog search — lets Darrin pick a seed he's read but doesn't
  // own on Audible (e.g. The Da Vinci Code, read years ago, never bought as
  // an audiobook). Library-only seeding was the actual gap reported
  // 2026-09-04: the picker could only ever suggest books already owned,
  // which defeats "find something like a book I read elsewhere."
  const [audibleQuery, setAudibleQuery] = useState('')
  const [audibleState, setAudibleState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [audibleResults, setAudibleResults] = useState<SeedCandidate[]>([])
  const [audibleError, setAudibleError] = useState<string | null>(null)

  const q = filterQuery.trim().toLowerCase()
  const filteredRated = q
    ? rated.filter(
        (b) =>
          b.title.toLowerCase().includes(q) || b.authors.some((a) => a.toLowerCase().includes(q))
      )
    : rated

  // Keep selected books visible even when the filter hides them, so picking
  // book #1 by search then searching for book #2 doesn't silently drop #1
  // out of view (it's still selected, just filtered out of the current list).
  const selectedBooks = rated.filter((b) => selected.includes(b.asin as string))
  const visibleBooks = q
    ? [...selectedBooks.filter((b) => !filteredRated.includes(b)), ...filteredRated]
    : filteredRated

  function toggle(asin: string, meta?: { title: string; authors: string[] }) {
    setSelected((prev) =>
      prev.includes(asin) ? prev.filter((a) => a !== asin) : prev.length < 3 ? [...prev, asin] : prev
    )
    if (meta) {
      setSelectedMeta((prev) => ({ ...prev, [asin]: meta }))
    }
  }

  // Debounced Audible search-as-you-type, mirroring DiscoverTab's request
  // shape but hitting a plain title/author query (no genre/rating filter —
  // this is a seed picker, not a results list; even a 3.2★ book you loved
  // is a valid seed).
  function runAudibleSearch(query: string) {
    setAudibleQuery(query)
    if (!query.trim()) {
      setAudibleResults([])
      setAudibleState('idle')
      return
    }
    setAudibleState('loading')
    setAudibleError(null)
    const params = new URLSearchParams({ q: query.trim(), minRating: '0', minRatingsCount: '0', limit: '12' })
    fetch(`/api/books/discover?${params}`)
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Search failed')
        const results: SeedCandidate[] = (data.hits || []).map((h: DiscoveryHit) => ({
          asin: h.asin,
          title: h.title,
          authors: h.authors,
          inLibrary: h.alreadyOwned,
        }))
        setAudibleResults(results)
        setAudibleState('done')
      })
      .catch((e) => {
        setAudibleError(e instanceof Error ? e.message : 'Search failed')
        setAudibleState('error')
      })
  }

  async function findSimilar() {
    if (!selected.length) return
    setState('loading')
    setError(null)
    try {
      const res = await fetch(`/api/books/similar?seeds=${selected.join(',')}&minRating=4.0`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Search failed')
        setState('error')
        return
      }
      setHits(data.hits || [])
      setState('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
      setState('error')
    }
  }

  const selectedChips = selected.map((asin) => selectedMeta[asin]).filter(Boolean) as {
    title: string
    authors: string[]
  }[]

  return (
    <div className="space-y-5">
      <p className="text-slate-400 text-sm">
        Pick up to 3 books you loved — we&apos;ll find similar, highly-rated books on Audible.
        Search Audible below for books you&apos;ve read even if they&apos;re not in your library.
      </p>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((asin, i) => (
            <span
              key={asin}
              className="inline-flex items-center gap-1.5 text-xs bg-amber-500/15 border border-amber-500/40 text-amber-100 px-2.5 py-1 rounded-full"
            >
              {selectedChips[i]?.title || asin}
              <button
                type="button"
                onClick={() => toggle(asin)}
                className="text-amber-300/70 hover:text-amber-100"
                aria-label={`Remove ${selectedChips[i]?.title || 'seed'}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-slate-300 text-xs font-medium">Search Audible (any book you&apos;ve read)</p>
        <input
          type="text"
          value={audibleQuery}
          onChange={(e) => runAudibleSearch(e.target.value)}
          placeholder="e.g. The Da Vinci Code…"
          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
        />
        {audibleState === 'loading' && (
          <p className="text-slate-500 text-xs">Searching Audible…</p>
        )}
        {audibleState === 'error' && (
          <p className="text-amber-400 text-xs">{audibleError}</p>
        )}
        {audibleState === 'done' && audibleResults.length === 0 && (
          <p className="text-slate-600 text-xs">No matches for &quot;{audibleQuery}&quot;</p>
        )}
        {audibleResults.length > 0 && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {audibleResults.map((r) => (
              <button
                key={r.asin}
                type="button"
                onClick={() => toggle(r.asin, { title: r.title, authors: r.authors })}
                className={`text-left text-xs p-2.5 rounded-lg border transition-colors ${
                  selected.includes(r.asin)
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-100'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                {r.title}
                {r.authors.length > 0 && (
                  <span className="block text-slate-500 text-[10px] mt-0.5 truncate">
                    {r.authors.join(', ')}
                  </span>
                )}
                {r.inLibrary && (
                  <span className="block text-emerald-400 text-[10px] mt-0.5">✓ In your library</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-slate-300 text-xs font-medium">Or pick from your library</p>
        <input
          type="text"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder={`Search your ${rated.length} read books by title or author…`}
          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/50"
        />
        {q && (
          <p className="text-slate-500 text-xs">
            {filteredRated.length} match{filteredRated.length === 1 ? '' : 'es'}
          </p>
        )}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-80 overflow-y-auto">
          {visibleBooks.length === 0 && q && (
            <p className="col-span-full text-slate-600 text-sm text-center py-6">
              No matches for &quot;{filterQuery}&quot;
            </p>
          )}
          {visibleBooks.slice(0, 200).map((b) => (
            <button
              key={b.asin}
              type="button"
              onClick={() => toggle(b.asin as string, { title: b.title, authors: b.authors })}
              className={`text-left text-xs p-2.5 rounded-lg border transition-colors ${
                selected.includes(b.asin as string)
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-100'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              {b.title}
              {b.authors.length > 0 && (
                <span className="block text-slate-500 text-[10px] mt-0.5 truncate">
                  {b.authors.join(', ')}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        disabled={!selected.length}
        onClick={() => void findSimilar()}
        className="w-full bg-amber-500 text-slate-900 font-semibold px-5 py-2.5 rounded-lg hover:bg-amber-400 transition-colors disabled:opacity-40"
      >
        Find similar high-rated books ({selected.length} selected)
      </button>

      {state === 'loading' && (
        <div className="text-center py-8 text-slate-400 text-sm animate-pulse">
          Checking Audible for similar books…
        </div>
      )}
      {state === 'error' && (
        <div className="bg-amber-400/10 border border-amber-400/20 rounded-xl p-4 text-sm text-amber-100">
          {error}
        </div>
      )}
      {state === 'done' && hits.length === 0 && (
        <div className="text-center py-8 text-slate-500 text-sm">
          No high-rated matches found — try different seed books.
        </div>
      )}
      {state === 'done' && hits.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {hits.map((hit) => (
            <DiscoverCard key={hit.asin} hit={hit} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function SearchClient({ books }: { books: Book[] }) {
  const [tab, setTab] = useState<'library' | 'discover' | 'similar'>('discover')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold text-amber-400">Discover</h1>
        <p className="text-slate-500 text-sm mt-1">Find books beyond your library</p>
      </div>

      <div className="flex gap-2 border-b border-slate-800">
        <button
          type="button"
          onClick={() => setTab('library')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'library'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          📚 Library
        </button>
        <button
          type="button"
          onClick={() => setTab('discover')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'discover'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          🔍 Discover
        </button>
        <button
          type="button"
          onClick={() => setTab('similar')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'similar'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          🎯 Similar
        </button>
      </div>

      {tab === 'library' && <LibrarySearchTab books={books} />}
      {tab === 'discover' && <DiscoverTab />}
      {tab === 'similar' && <SimilarTab books={books} />}
    </div>
  )
}
