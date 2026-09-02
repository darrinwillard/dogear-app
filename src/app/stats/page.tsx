import Link from 'next/link'
import { formatDate } from '@/lib/books'
import { getDashboardData } from '@/lib/books/queries'

export const dynamic = 'force-dynamic'

export default async function StatsPage() {
  const { stats, series, isAuthed, isDemo, lastUpdatedLabel, isNewUser } = await getDashboardData()

  const topSeries = [...series]
    .filter(s => s.totalCount > 0)
    .sort((a, b) => b.readCount - a.readCount || b.totalCount - a.totalCount)
    .slice(0, 10)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl font-bold text-amber-400">Reading Stats</h1>
        <p className="text-slate-400 mt-1">{lastUpdatedLabel}</p>
        {isDemo && (
          <p className="text-amber-500/80 text-sm mt-2">Demo snapshot — sign in for live stats.</p>
        )}
      </div>

      {!isAuthed && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-sm text-slate-300">
          <Link href="/auth/login" className="text-amber-400 hover:text-amber-300">
            Sign in
          </Link>{' '}
          and sync Audible to replace demo numbers with your library.
        </div>
      )}

      {isAuthed && isNewUser && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-sm text-slate-300">
          No books yet — connect Audible in{' '}
          <Link href="/settings" className="text-amber-400 hover:text-amber-300">
            Settings
          </Link>{' '}
          and run Sync.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatTile label="Total books" value={stats.totalBooks} />
        <StatTile label="Read" value={stats.confirmedRead} accent="text-emerald-400" />
        <StatTile label="Reading" value={stats.reading ?? 0} accent="text-blue-400" />
        <StatTile label="Want to read" value={stats.wantToRead ?? 0} accent="text-amber-400" />
        <StatTile label="Series tracked" value={stats.totalSeries} />
        <StatTile
          label="Hours (completed, approx)"
          value={stats.hoursListened ?? 0}
          accent="text-amber-400"
        />
        <StatTile
          label={`Read in ${new Date().getFullYear()}`}
          value={stats.booksThisYear}
        />
        <StatTile
          label="Avg rating"
          value={stats.avgRating != null ? stats.avgRating.toFixed(1) : '—'}
        />
        <StatTile label="Audible titles" value={stats.audibleTotal} />
      </div>

      <section>
        <h2 className="font-serif text-xl font-bold text-amber-100 mb-4">Top series by books read</h2>
        {topSeries.length === 0 ? (
          <p className="text-slate-500 text-sm">
            No series data yet. After a successful Audible sync with series backfill, progress appears here.
          </p>
        ) : (
          <div className="space-y-3">
            {topSeries.map(s => {
              const pct = s.totalCount > 0 ? Math.round((s.readCount / s.totalCount) * 100) : 0
              return (
                <div
                  key={s.name}
                  className="bg-slate-900 border border-slate-800 rounded-lg p-4"
                >
                  <div className="flex justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="text-amber-100 font-medium truncate">{s.name}</div>
                      <div className="text-xs text-slate-500">{s.author}</div>
                    </div>
                    <div className="text-sm text-slate-300 shrink-0">
                      {s.readCount}/{s.totalCount}
                    </div>
                  </div>
                  <div className="bg-slate-800 rounded-full h-1.5">
                    <div
                      className="bg-amber-500 h-1.5 rounded-full"
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  {s.lastReadDate && (
                    <div className="text-xs text-slate-500 mt-2">
                      Last activity: {formatDate(s.lastReadDate)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function StatTile({
  label,
  value,
  accent = 'text-amber-400',
}: {
  label: string
  value: string | number
  accent?: string
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
      <div className={`text-2xl font-bold ${accent}`}>{value}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  )
}
