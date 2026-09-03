'use client'

import { useState } from 'react'
import GapsClient from './GapsClient'

/**
 * Toggle between "Upcoming Releases" (children — the existing server-rendered
 * content) and "Fill In Series/Author Gaps" (new, client-fetched on demand).
 * Upcoming content is passed as children so it stays server-rendered; the
 * gaps tab mounts its own client component only when selected.
 */
export default function NextReadTabs({ children }: { children: React.ReactNode }) {
  const [tab, setTab] = useState<'upcoming' | 'gaps'>('upcoming')

  return (
    <div className="space-y-8">
      <div className="flex gap-2 border-b border-slate-800">
        <button
          type="button"
          onClick={() => setTab('upcoming')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'upcoming'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          📅 Upcoming Releases
        </button>
        <button
          type="button"
          onClick={() => setTab('gaps')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'gaps'
              ? 'border-amber-500 text-amber-400'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          🔎 Fill In Gaps
        </button>
      </div>

      {tab === 'upcoming' ? children : <GapsClient />}
    </div>
  )
}
