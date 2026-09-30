'use client'

import { useState } from 'react'
import GapsClient from './GapsClient'
import BestSellersClient from './BestSellersClient'

/**
 * Top-level tabs: "Find Your Next Read" content (server-rendered Upcoming
 * view, passed as children, with a New Releases view passed separately so
 * both can be server-rendered up front and toggled client-side without a
 * fetch), "Fill In Series/Author Gaps" (client-fetched on demand), and
 * "NYT Best Sellers" (client-fetched, cached server-side on an interval
 * like Audible releases).
 */
export default function NextReadTabs({
  children,
  newReleases,
}: {
  children: React.ReactNode
  newReleases: React.ReactNode
}) {
  const [tab, setTab] = useState<'upcoming' | 'gaps' | 'bestsellers'>('upcoming')
  const [upcomingView, setUpcomingView] = useState<'upcoming' | 'new'>('upcoming')

  return (
    <div className="space-y-8">
      <div className="flex gap-2 border-b border-slate-800 overflow-x-auto">
        <button
          type="button"
          onClick={() => setTab('upcoming')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            tab === 'upcoming'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          📅 Find Your Next Read
        </button>
        <button
          type="button"
          onClick={() => setTab('gaps')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            tab === 'gaps'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          🔎 Fill In Gaps
        </button>
        <button
          type="button"
          onClick={() => setTab('bestsellers')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            tab === 'bestsellers'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          🏆 NYT Best Sellers
        </button>
      </div>

      {tab === 'upcoming' && (
        <div className="space-y-6">
          {/* Upcoming / New Releases sub-toggle. New Releases is where a title
              lands once its date passes — nothing disappears if you miss
              checking before release day. */}
          <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900/60 p-1">
            <button
              type="button"
              onClick={() => setUpcomingView('upcoming')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                upcomingView === 'upcoming'
                  ? 'bg-amber-500 text-slate-900'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Upcoming
            </button>
            <button
              type="button"
              onClick={() => setUpcomingView('new')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                upcomingView === 'new'
                  ? 'bg-amber-500 text-slate-900'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              New Releases
            </button>
          </div>
          {upcomingView === 'upcoming' ? children : newReleases}
        </div>
      )}
      {tab === 'gaps' && <GapsClient />}
      {tab === 'bestsellers' && <BestSellersClient />}
    </div>
  )
}
