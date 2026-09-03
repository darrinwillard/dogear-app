'use client'

import type { UpcomingRelease } from '@/lib/books'
import { useReleaseDetail } from './ReleaseDetailWrapper'

/**
 * Thin clickable wrapper so server-rendered release cards on the Upcoming
 * page can open the shared book detail modal without each card needing to
 * be its own client component. Wrap the existing card markup with this.
 */
export default function ReleaseCardClick({
  release,
  className,
  children,
}: {
  release: UpcomingRelease
  className?: string
  children: React.ReactNode
}) {
  const { openRelease } = useReleaseDetail()
  return (
    <div
      onClick={() => openRelease(release)}
      role="button"
      tabIndex={0}
      className={className}
    >
      {children}
    </div>
  )
}
