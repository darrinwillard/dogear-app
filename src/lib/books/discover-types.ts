/**
 * Normalized hit type for Discover / Similar. Audible-only ratings source
 * (Darrin's decision 2026-09-03: "this app is just for Audible anyway so
 * ratings on books without an Audible [edition] are irrelevant" — Goodreads
 * scraping was explored, live-tested, and dropped due to aggressive/broad
 * AWS WAF blocking that made a reliable weekly refresh unworkable).
 */
export interface DiscoveryHit {
  /** Audible ASIN — the only identity this app needs since it's Audible-only. */
  asin: string
  title: string
  authors: string[]
  seriesName: string | null
  seriesPosition: number | null
  rating: number | null
  ratingCount: number | null
  coverUrl: string | null
  audibleUrl: string
  alreadyOwned: boolean
  alreadyWanted: boolean
  /** "Because you liked X" — set only on Similar results. */
  similarityReason?: string
}
