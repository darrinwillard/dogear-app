import { getAllUpcoming, getComingSoon, formatDate } from '@/lib/books'

export default function UpcomingPage() {
  const allReleases = getAllUpcoming()
  const comingSoon = getComingSoon()

  const released = allReleases.filter(r => r.status === 'released')
  const upcoming = allReleases.filter(r => r.status === 'upcoming')
    .sort((a, b) => {
      if (!a.releaseDate) return 1
      if (!b.releaseDate) return -1
      return new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime()
    })

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-serif text-3xl font-bold text-amber-400">Upcoming Releases</h1>
        <p className="text-slate-400 mt-1">
          Confirmed 2026 releases for series you&apos;re tracking
        </p>
      </div>

      {/* Timeline: Upcoming */}
      <section>
        <h2 className="font-serif text-xl font-bold text-amber-100 mb-4 flex items-center gap-2">
          <span>📅</span> Coming in 2026
        </h2>
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-5 top-0 bottom-0 w-px bg-slate-800 hidden sm:block" />
          <div className="space-y-4">
            {upcoming.map((release, i) => {
              const daysUntil = release.releaseDate
                ? Math.ceil((new Date(release.releaseDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : null
              const isPast = daysUntil !== null && daysUntil < 0
              
              return (
                <div key={i} className="sm:pl-14 relative group">
                  {/* Timeline dot */}
                  <div className="hidden sm:flex absolute left-3 top-5 w-5 h-5 rounded-full bg-amber-500 border-2 border-slate-950 items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-amber-300" />
                  </div>
                  
                  <div className={`bg-slate-900 rounded-xl border ${isPast ? 'border-slate-800 opacity-60' : 'border-slate-800 hover:border-amber-500/30'} p-5 transition-all`}>
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full">
                            {release.series} #{release.seriesNumber}
                          </span>
                          {daysUntil !== null && daysUntil > 0 && (
                            <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
                              {daysUntil} days away
                            </span>
                          )}
                          {isPast && (
                            <span className="text-xs bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full">
                              Past due
                            </span>
                          )}
                        </div>
                        <h3 className="font-semibold text-amber-100 text-lg mb-1">{release.title}</h3>
                        <p className="text-slate-400 text-sm">{release.author}</p>
                        {release.notes && (
                          <p className="text-slate-500 text-xs mt-2 italic">{release.notes}</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-medium text-amber-400">{formatDate(release.releaseDate)}</div>
                        {release.preorderUrl && (
                          <a
                            href={release.preorderUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-block text-xs bg-amber-500/15 text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-lg hover:bg-amber-500/25 transition-colors"
                          >
                            Pre-order →
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Already Released in 2026 */}
      <section>
        <h2 className="font-serif text-xl font-bold text-amber-100 mb-4 flex items-center gap-2">
          <span>✅</span> Released in 2026
          <span className="text-sm font-normal text-slate-400">(already out)</span>
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {released.map((release, i) => (
            <div key={i} className="bg-slate-900/60 rounded-xl border border-emerald-500/20 p-4 hover:border-emerald-500/40 transition-all">
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                  {release.series}
                </span>
                <span className="text-lg">✅</span>
              </div>
              <h3 className="font-semibold text-amber-100 mb-1">{release.title}</h3>
              <p className="text-slate-400 text-sm mb-2">{release.author}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Released {formatDate(release.releaseDate)}</span>
                {release.preorderUrl && (
                  <a
                    href={release.preorderUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-amber-500 hover:text-amber-400"
                  >
                    Buy →
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Coming Soon / TBA */}
      <section>
        <h2 className="font-serif text-xl font-bold text-amber-100 mb-4 flex items-center gap-2">
          <span>🔮</span> Coming Soon
          <span className="text-sm font-normal text-slate-400">(no date yet)</span>
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {comingSoon.map((release, i) => (
            <div key={i} className="bg-slate-900/60 rounded-xl border border-slate-800 p-4 hover:border-slate-700 transition-all">
              <div className="mb-2">
                <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
                  {release.series}
                  {release.seriesNumber ? ` #${release.seriesNumber}` : ''}
                </span>
              </div>
              <h3 className="font-semibold text-amber-100 mb-1">{release.title}</h3>
              <p className="text-slate-400 text-sm mb-2">{release.author}</p>
              {release.notes && (
                <p className="text-slate-500 text-xs italic">{release.notes}</p>
              )}
              <div className="mt-2">
                <span className="text-xs text-slate-600">📅 Date TBA</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
