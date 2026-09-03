import type { Book } from './types'
import type { NormalizedCatalogRelease } from './audible-catalog'
import type { DiscoveryHit } from './discover-types'

/** Convert a NormalizedCatalogRelease into a DiscoveryHit, marking owned/wanted. */
export function toDiscoveryHit(
  release: NormalizedCatalogRelease,
  ownedAsins: Set<string>,
  wantedAsins: Set<string>,
  similarityReason?: string
): DiscoveryHit {
  return {
    asin: release.asin,
    title: release.title,
    authors: release.authors,
    seriesName: release.seriesName,
    seriesPosition: release.seriesPosition,
    rating: release.rating,
    ratingCount: release.ratingCount,
    coverUrl: release.coverUrl,
    audibleUrl: release.preorderUrl,
    alreadyOwned: ownedAsins.has(release.asin),
    alreadyWanted: wantedAsins.has(release.asin),
    ...(similarityReason ? { similarityReason } : {}),
  }
}

export function ownedAsinSet(books: Book[]): Set<string> {
  return new Set(books.map((b) => b.asin).filter((a): a is string => !!a))
}

export function wantedAsinSet(books: Book[]): Set<string> {
  return new Set(
    books.filter((b) => b.wantToRead && !b.notInterested && b.asin).map((b) => b.asin as string)
  )
}

/** Apply minRating / minRatingsCount filters, dedupe by ASIN, sort by rating desc. */
export function rankAndFilterHits(
  hits: DiscoveryHit[],
  opts: { minRating?: number; minRatingsCount?: number } = {}
): DiscoveryHit[] {
  const minRating = opts.minRating ?? 0
  const minRatingsCount = opts.minRatingsCount ?? 0

  const seen = new Set<string>()
  const deduped: DiscoveryHit[] = []
  for (const h of hits) {
    if (seen.has(h.asin)) continue
    seen.add(h.asin)
    deduped.push(h)
  }

  return deduped
    .filter((h) => {
      if (h.rating == null) return minRating === 0 // unrated hits pass only if no floor set
      if (h.rating < minRating) return false
      if (h.ratingCount != null && h.ratingCount < minRatingsCount) return false
      return true
    })
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
}
