import { getStats, getWhatToReadNext, getUpcomingReleases, formatDate, getSeriesData } from '@/lib/books'
import Link from 'next/link'

export default function Dashboard() {
  const stats = getStats()
  const whatToReadNext = getWhatToReadNext()
  const upcomingReleases = getUpcomingReleases(3)
  const allSeries = getSeriesData()
  const activeSeries = allSeries.filter(s => s.readCount > 0 && s.nextToRead !== null).slice(0, 5)

  return (
    <div className="space-y-10">
      {/* Hero */}
      <div className="text-center py-8">
        <h1 className="font-serif text-4xl sm:text-5xl font-bold text-amber-400 mb-2">
          Your Reading Life
        </h1>
        <p className="text-slate-400 text-lg">
          Synced from Audible & Goodreads · Last updated March 9, 2026
        </p>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          value={stats.totalBooks.toLocaleString()}
          label="Total Books"
          icon="📚"
          sub="in your library"
        />
        <StatCard
          value={stats.confirmedRead.toLocaleString()}
          label="Books Read"
          icon="✅"
          sub="confirmed read"
        />
        <StatCard
          value={stats.totalSeries.toString()}
          label="Series Tracked"
          icon="🔖"
          sub="across all libraries"
        />
        <StatCard
          value={stats.booksThisYear.toString()}
          label="Read in 2026"
          icon="🗓️"
          sub="this year so far"
        />
      </div>

      {/* Sources */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 flex items-center gap-3">
          <span className="text-3xl">🎧</span>
          <div>
            <div className="font-bold text-xl text-amber-400">{stats.audibleTotal}</div>
            <div className="text-slate-400 text-sm">Audible titles</div>
          </div>
        </div>
        <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 flex items-center gap-3">
          <span className="text-3xl">📖</span>
          <div>
            <div className="font-bold text-xl text-emerald-400">{stats.goodreadsTotal}</div>
            <div className="text-slate-400 text-sm">Goodreads books</div>
          </div>
        </div>
      </div>

      {/* What to Read Next */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-2xl font-bold text-amber-100">
            📖 What to Read Next
          </h2>
          <Link href="/series" className="text-sm text-amber-500 hover:text-amber-400 transition-colors">
            View all series →
          </Link>
        </div>
        <p className="text-slate-400 text-sm mb-4">Based on your series momentum — you were just reading these:</p>
        <div className="grid sm:grid-cols-3 gap-4">
          {whatToReadNext.map((book, i) => (
            <NextReadCard key={i} book={book} rank={i + 1} />
          ))}
          {whatToReadNext.length === 0 && (
            <div className="col-span-3 text-slate-500 text-center py-8">
              No recommendations available
            </div>
          )}
        </div>
      </section>

      {/* Active Series Progress */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-2xl font-bold text-amber-100">
            🔖 Active Series
          </h2>
          <Link href="/series" className="text-sm text-amber-500 hover:text-amber-400 transition-colors">
            All {allSeries.length} series →
          </Link>
        </div>
        <div className="space-y-3">
          {activeSeries.map(s => (
            <SeriesProgressRow key={s.name} series={s} />
          ))}
        </div>
      </section>

      {/* Upcoming Releases */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-2xl font-bold text-amber-100">
            📅 Upcoming Releases
          </h2>
          <Link href="/upcoming" className="text-sm text-amber-500 hover:text-amber-400 transition-colors">
            See full calendar →
          </Link>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {upcomingReleases.map((release, i) => (
            <UpcomingCard key={i} release={release} />
          ))}
        </div>
      </section>
    </div>
  )
}

function StatCard({ value, label, icon, sub }: { value: string; label: string; icon: string; sub: string }) {
  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 text-center hover:border-amber-500/30 transition-colors">
      <div className="text-2xl mb-1">{icon}</div>
      <div className="font-bold text-3xl text-amber-400">{value}</div>
      <div className="text-amber-100 font-medium text-sm mt-1">{label}</div>
      <div className="text-slate-500 text-xs mt-0.5">{sub}</div>
    </div>
  )
}

function NextReadCard({ book, rank }: { book: { title: string; authors: string[]; series: string | null; series_num: string | null }; rank: number }) {
  const rankColors = ['text-amber-400', 'text-slate-300', 'text-amber-700']
  const rankEmojis = ['🥇', '🥈', '🥉']

  return (
    <div className="bg-slate-900 rounded-xl border border-amber-500/20 p-5 hover:border-amber-500/40 transition-all group">
      <div className="flex items-start gap-3">
        <div className={`text-2xl ${rankColors[rank - 1] || 'text-slate-400'}`}>
          {rankEmojis[rank - 1] || rank}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-amber-100 text-sm leading-snug line-clamp-2 group-hover:text-amber-300 transition-colors">
            {book.title}
          </h3>
          <p className="text-slate-400 text-xs mt-1">{book.authors[0]}</p>
          {book.series && (
            <div className="mt-2">
              <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                {book.series} #{book.series_num}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SeriesProgressRow({ series }: { series: { name: string; author: string; readCount: number; totalCount: number; nextToRead: { title: string } | null } }) {
  const pct = Math.round((series.readCount / series.totalCount) * 100)

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800 p-4 hover:border-slate-700 transition-colors">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-amber-100 text-sm truncate">{series.name}</span>
            <span className="text-slate-500 text-xs shrink-0">{series.author}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-slate-800 rounded-full h-1.5">
              <div
                className="bg-amber-500 h-1.5 rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-slate-400 shrink-0">
              {series.readCount}/{series.totalCount}
            </span>
          </div>
        </div>
        {series.nextToRead && (
          <div className="shrink-0 text-right">
            <div className="text-xs text-slate-500">Next:</div>
            <div className="text-xs text-amber-400 max-w-[140px] truncate">{series.nextToRead.title}</div>
          </div>
        )}
      </div>
    </div>
  )
}

function UpcomingCard({ release }: { release: { title: string; author: string; series: string; releaseDate: string | null; preorderUrl: string | null; notes: string | null } }) {
  const daysUntil = release.releaseDate
    ? Math.ceil((new Date(release.releaseDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-5 hover:border-amber-500/30 transition-all">
      <div className="mb-3">
        <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
          {release.series}
        </span>
      </div>
      <h3 className="font-semibold text-amber-100 mb-1 leading-snug">{release.title}</h3>
      <p className="text-slate-400 text-sm mb-3">{release.author}</p>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-slate-500">Release Date</div>
          <div className="text-sm text-amber-400 font-medium">{formatDate(release.releaseDate)}</div>
          {daysUntil !== null && daysUntil > 0 && (
            <div className="text-xs text-slate-500">in {daysUntil} days</div>
          )}
        </div>
        {release.preorderUrl && (
          <a
            href={release.preorderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs bg-amber-500/15 text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-lg hover:bg-amber-500/25 transition-colors"
          >
            Pre-order →
          </a>
        )}
      </div>
    </div>
  )
}
