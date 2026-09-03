'use client'

/**
 * Server Components can't have onClick handlers at all — even a trivial
 * stopPropagation — because event handler functions aren't serializable
 * across the server/client boundary. This was the actual cause of the
 * /upcoming 500: three onClick={(e) => e.stopPropagation()} handlers were
 * added directly inside upcoming/page.tsx (an async Server Component) to
 * keep clicks on WantButton/preorder links from also opening the new book
 * detail modal (ReleaseCardClick wraps the whole card in an onClick).
 * Wrapping just the interactive-controls area in this tiny Client Component
 * fixes it without needing to convert the whole page to a Client Component.
 */
export default function StopPropagation({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  )
}
