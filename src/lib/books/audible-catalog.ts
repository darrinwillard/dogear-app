/**
 * Audible catalog client for upcoming/preorder discovery.
 *
 * Proven endpoints (mkb79/Audible docs + live probe 2026-09-01):
 * - GET /1.0/catalog/products?author=&products_sort_by=-ReleaseDate
 * - GET /1.0/catalog/products/{asin}/sims?similarity_type=NextInSameSeries|InTheSameSeries|ByTheSameAuthor
 *
 * Honest limits:
 * - Only surfaces titles Audible has listed (preorder or published). Publisher
 *   announcements with no Audible SKU will not appear.
 * - Author search mixes locales/translations; we filter language=english and
 *   drop obvious non-book noise (podcasts, empty authors).
 * - Brand-new series from a familiar author only appear once Audible catalogs them.
 */

import { parseSeriesSequence } from './sync-parse'
import { readCoverUrl, type AudibleItem } from './audible-parse'

export const AUDIBLE_CATALOG_RESPONSE_GROUPS = [
  'contributors',
  'media',
  'product_attrs',
  'product_desc',
  'product_extended_attrs',
  'series',
  'product_details',
].join(',')

/** Request sizes that map cleanly into product_images keys (never include 0 — Audible 400s). */
export const AUDIBLE_CATALOG_IMAGE_SIZES = '300,500,1024'

/**
 * Response groups constant for rating-aware catalog/sims calls (Discover,
 * Similar). Kept SEPARATE from AUDIBLE_CATALOG_RESPONSE_GROUPS above rather
 * than adding `rating` to that shared constant, so existing release-refresh
 * calls (which don't need ratings) aren't bloated with the extra payload.
 *
 * `rating` confirmed live 2026-09-03 against a real owned ASIN (B002V19RO6,
 * "1984") via `GET /1.0/catalog/products/{asin}?response_groups=rating`:
 * returns `product.rating.overall_distribution` with `average_rating`,
 * `display_average_rating` (string, e.g. "4.6"), `display_stars`,
 * `num_ratings`. This is a real, dense, public catalog attribute — not
 * gated behind ownership; works for any Audible product, owned or not.
 */
export const AUDIBLE_RATING_RESPONSE_GROUPS = [
  'contributors',
  'media',
  'product_attrs',
  'product_desc',
  'product_extended_attrs',
  'series',
  'product_details',
  'rating',
].join(',')

export interface CatalogProduct {
  asin?: string
  title?: string
  subtitle?: string
  authors?: { name?: string; asin?: string }[]
  narrators?: { name?: string }[]
  series?: { title?: string; sequence?: string | number; asin?: string }[]
  release_date?: string
  issue_date?: string
  publication_datetime?: string
  product_site_launch_date?: string
  date_first_available?: string
  language?: string
  content_type?: string
  content_delivery_type?: string
  format_type?: string
  publisher_name?: string
  merchandising_summary?: string
  product_images?: Record<string, string>
  runtime_length_min?: number
  /** Present only when `rating` is in response_groups (confirmed live 2026-09-03). */
  rating?: {
    num_reviews?: number
    overall_distribution?: {
      average_rating?: number
      display_average_rating?: string
      display_stars?: number
      num_ratings?: number
    }
  }
}

export interface NormalizedCatalogRelease {
  asin: string
  title: string
  authors: string[]
  seriesName: string | null
  seriesPosition: number | null
  seriesPositionRaw: string | null
  releaseDate: string | null
  language: string | null
  contentType: string | null
  coverUrl: string | null
  preorderUrl: string
  source: 'audible_catalog' | 'audible_sims'
  /** Audible star rating (0-5), when the rating response group was requested. */
  rating: number | null
  ratingCount: number | null
}

function ymd(value: string | null | undefined): string | null {
  if (!value) return null
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

function cleanAuthors(authors: CatalogProduct['authors']): string[] {
  return (authors || [])
    .map((a) => (a.name || '').trim())
    .filter(Boolean)
    // Drop translator / editor credit noise common in DE/other catalogs
    .filter((n) => !/übersetzer|translator|herausgeber|editor|foreword|afterword/i.test(n))
}

function isEnglish(p: CatalogProduct): boolean {
  const lang = (p.language || '').toLowerCase()
  return !lang || lang === 'english' || lang.startsWith('en')
}

function looksLikeBook(p: CatalogProduct): boolean {
  const title = (p.title || '').toLowerCase()
  if (!title) return false
  if (title.includes('podcast')) return false
  if (title.includes('the chris voss show')) return false
  if (/^sample\b/i.test(title)) return false
  const cdt = (p.content_delivery_type || '').toLowerCase()
  if (cdt.includes('episode') || cdt.includes('periodical') || cdt.includes('newspaper')) {
    return false
  }
  if (!cleanAuthors(p.authors).length) return false
  return true
}

export function normalizeCatalogProduct(
  p: CatalogProduct,
  source: NormalizedCatalogRelease['source']
): NormalizedCatalogRelease | null {
  if (!p?.asin || !p.title) return null
  if (!isEnglish(p)) return null
  if (!looksLikeBook(p)) return null

  const series0 = Array.isArray(p.series) ? p.series[0] : undefined
  const parsed = parseSeriesSequence(series0?.sequence)
  const releaseDate =
    ymd(p.release_date) ||
    ymd(p.issue_date) ||
    ymd(p.publication_datetime) ||
    ymd(p.date_first_available)

  // Same product_images shape as library when `media` is requested.
  // Confirmed 2026-09-01: catalog search, product-by-ASIN, and sims all return
  // product_images with media in response_groups (no separate field name).
  const cover = readCoverUrl(p as AudibleItem) ?? null

  const dist = p.rating?.overall_distribution
  const rating = typeof dist?.average_rating === 'number' ? dist.average_rating : null
  const ratingCount = typeof dist?.num_ratings === 'number' ? dist.num_ratings : null

  return {
    asin: p.asin,
    title: p.title.trim(),
    authors: cleanAuthors(p.authors),
    seriesName: series0?.title?.trim() || null,
    seriesPosition: parsed.range ? null : parsed.position,
    seriesPositionRaw: parsed.raw,
    releaseDate,
    language: p.language || null,
    contentType: p.content_delivery_type || p.content_type || null,
    coverUrl: cover,
    preorderUrl: `https://www.audible.com/pd/${p.asin}`,
    source,
    rating,
    ratingCount,
  }
}

async function audibleGet(
  accessToken: string,
  pathAndQuery: string
): Promise<Response> {
  return fetch(`https://api.audible.com${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  })
}

export async function searchCatalogByAuthor(
  accessToken: string,
  author: string,
  opts: { numResults?: number; page?: number } = {}
): Promise<NormalizedCatalogRelease[]> {
  const params = new URLSearchParams({
    author,
    products_sort_by: '-ReleaseDate',
    num_results: String(opts.numResults ?? 20),
    page: String(opts.page ?? 0),
    response_groups: AUDIBLE_CATALOG_RESPONSE_GROUPS,
    image_sizes: AUDIBLE_CATALOG_IMAGE_SIZES,
  })
  const res = await audibleGet(accessToken, `/1.0/catalog/products?${params}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`catalog author search failed (${res.status}): ${text.slice(0, 180)}`)
  }
  const data = await res.json()
  const products: CatalogProduct[] = data.products || []
  return products
    .map((p) => normalizeCatalogProduct(p, 'audible_catalog'))
    .filter((x): x is NormalizedCatalogRelease => Boolean(x))
}

/**
 * General keyword/genre/title/author discovery search, WITH ratings
 * (uses AUDIBLE_RATING_RESPONSE_GROUPS, confirmed live 2026-09-03).
 * Used by the Discover page's search bar and genre chips.
 *
 * Sort values are a fixed Audible enum, confirmed live 2026-09-03 via a
 * real 400 error response that listed the full valid set:
 *   -ReleaseDate, Heuristic, ContentLevel, -Title, AmazonEnglish,
 *   AvgRating, BestSellers, -RuntimeLength, ReleaseDate,
 *   ProductSiteLaunchDate, -ContentLevel, Title, Relevance, -Heuristic,
 *   RuntimeLength
 * Notably: `AvgRating` has NO `-` (descending) variant — unlike
 * `-ReleaseDate` — and passing `-AvgRating` 400s. Confirmed live that
 * plain `AvgRating` already returns highest-rated first (4.9★ results at
 * the top for a "science fiction" keyword search), so no prefix is
 * needed or valid for this one value.
 */
export async function searchCatalog(
  accessToken: string,
  opts: {
    keywords?: string
    author?: string
    title?: string
    categoryId?: string
    sortBy?: 'Relevance' | 'AvgRating' | 'ReleaseDate'
    numResults?: number
    page?: number
  } = {}
): Promise<NormalizedCatalogRelease[]> {
  const sortValue =
    opts.sortBy === 'ReleaseDate' ? '-ReleaseDate' : opts.sortBy === 'AvgRating' ? 'AvgRating' : 'Relevance'
  const params = new URLSearchParams({
    products_sort_by: sortValue,
    num_results: String(opts.numResults ?? 20),
    page: String(opts.page ?? 0),
    response_groups: AUDIBLE_RATING_RESPONSE_GROUPS,
    image_sizes: AUDIBLE_CATALOG_IMAGE_SIZES,
  })
  if (opts.keywords) params.set('keywords', opts.keywords)
  if (opts.author) params.set('author', opts.author)
  if (opts.title) params.set('title', opts.title)
  if (opts.categoryId) params.set('category_id', opts.categoryId)

  const res = await audibleGet(accessToken, `/1.0/catalog/products?${params}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`catalog search failed (${res.status}): ${text.slice(0, 180)}`)
  }
  const data = await res.json()
  const products: CatalogProduct[] = data.products || []
  return products
    .map((p) => normalizeCatalogProduct(p, 'audible_catalog'))
    .filter((x): x is NormalizedCatalogRelease => Boolean(x))
}

export async function getSeriesSims(
  accessToken: string,
  asin: string,
  similarityType: 'NextInSameSeries' | 'InTheSameSeries' | 'ByTheSameAuthor' | 'RawSimilarities',
  numResults = 20,
  opts: { includeRating?: boolean } = {}
): Promise<NormalizedCatalogRelease[]> {
  // `RawSimilarities` confirmed live 2026-09-03 against a real owned ASIN
  // (B002V19RO6, "1984") — returned 5 genuinely relevant results (Animal
  // Farm, Brave New World, Lord of the Flies, an Audible-original 1984
  // adaptation, and a themed nonfiction title), each with rating data
  // attached when `rating` is requested. This is the general "customers
  // also liked" similarity type, distinct from the series/author-scoped
  // ones above — used for the Similar-to-these Discover feature.
  const params = new URLSearchParams({
    similarity_type: similarityType,
    num_results: String(numResults),
    response_groups: opts.includeRating ? AUDIBLE_RATING_RESPONSE_GROUPS : AUDIBLE_CATALOG_RESPONSE_GROUPS,
    image_sizes: AUDIBLE_CATALOG_IMAGE_SIZES,
  })
  const res = await audibleGet(
    accessToken,
    `/1.0/catalog/products/${encodeURIComponent(asin)}/sims?${params}`
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`sims ${similarityType} failed (${res.status}): ${text.slice(0, 180)}`)
  }
  const data = await res.json()
  const products: CatalogProduct[] =
    data.similar_products || data.products || []
  return products
    .map((p) => normalizeCatalogProduct(p, 'audible_sims'))
    .filter((x): x is NormalizedCatalogRelease => Boolean(x))
}

/**
 * Bulk product lookup by ASIN list. Used for cover backfill and per-ASIN enrichment.
 * Audible accepts comma-separated `asins` on /1.0/catalog/products.
 */
export async function fetchCatalogProductsByAsins(
  accessToken: string,
  asins: string[],
  opts: { chunkSize?: number } = {}
): Promise<NormalizedCatalogRelease[]> {
  const chunkSize = opts.chunkSize ?? 20
  const out: NormalizedCatalogRelease[] = []
  const unique = Array.from(new Set(asins.map((a) => a.trim()).filter(Boolean)))
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize)
    const params = new URLSearchParams({
      asins: chunk.join(','),
      response_groups: AUDIBLE_CATALOG_RESPONSE_GROUPS,
      image_sizes: AUDIBLE_CATALOG_IMAGE_SIZES,
    })
    const res = await audibleGet(accessToken, `/1.0/catalog/products?${params}`)
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`catalog asins fetch failed (${res.status}): ${text.slice(0, 180)}`)
    }
    const data = await res.json()
    const products: CatalogProduct[] = data.products || []
    for (const p of products) {
      // Skip english/book filters for backfill — we already stored these ASINs as releases.
      // Still normalize when possible; fall back to a minimal cover-only row.
      const norm = normalizeCatalogProduct(p, 'audible_catalog')
      if (norm) {
        out.push(norm)
        continue
      }
      if (!p?.asin) continue
      const cover = readCoverUrl(p as AudibleItem) ?? null
      if (!cover && !p.title) continue
      out.push({
        asin: p.asin,
        title: (p.title || p.asin).trim(),
        authors: cleanAuthors(p.authors),
        rating: null,
        ratingCount: null,
        seriesName: Array.isArray(p.series) ? p.series[0]?.title?.trim() || null : null,
        seriesPosition: null,
        seriesPositionRaw: null,
        releaseDate: ymd(p.release_date) || ymd(p.issue_date) || null,
        language: p.language || null,
        contentType: p.content_delivery_type || p.content_type || null,
        coverUrl: cover,
        preorderUrl: `https://www.audible.com/pd/${p.asin}`,
        source: 'audible_catalog',
      })
    }
  }
  return out
}

/** Case-fold + strip common punctuation for fuzzy series/author compare */
export function normKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|series|novel|novels|chronicles|saga|trilogy|omnibus)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function seriesNamesMatch(a: string, b: string): boolean {
  const na = normKey(a)
  const nb = normKey(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true
  // token overlap ≥ 2 or single long token match
  const ta = new Set(na.split(' ').filter((t) => t.length > 2))
  const tb = new Set(nb.split(' ').filter((t) => t.length > 2))
  let overlap = 0
  for (const t of Array.from(ta)) if (tb.has(t)) overlap++
  if (overlap >= 2) return true
  if (overlap === 1 && (ta.size === 1 || tb.size === 1)) return true
  return false
}

export function authorNamesMatch(a: string, b: string): boolean {
  const na = normKey(a)
  const nb = normKey(b)
  if (!na || !nb) return false
  if (na === nb) return true
  // "J R R Tolkien" vs "J.R.R. Tolkien" already collapsed by normKey
  const ta = na.split(' ')
  const tb = nb.split(' ')
  if (ta.length >= 2 && tb.length >= 2) {
    const lastA = ta[ta.length - 1]
    const lastB = tb[tb.length - 1]
    const firstA = ta[0]
    const firstB = tb[0]
    if (lastA === lastB && firstA[0] === firstB[0]) return true
  }
  return na.includes(nb) || nb.includes(na)
}

export function releaseStatusForDate(releaseDate: string | null, now = new Date()): string {
  if (!releaseDate) return 'announced'
  const d = new Date(releaseDate + 'T12:00:00Z')
  if (Number.isNaN(d.getTime())) return 'unknown'
  // grace: still "upcoming" until end of release day UTC
  const endOfDay = new Date(releaseDate + 'T23:59:59Z')
  if (endOfDay.getTime() >= now.getTime()) return 'upcoming'
  return 'released'
}

/** Keep future releases + recent releases (last 45 days) for the "already out" shelf */
export function isRelevantReleaseWindow(releaseDate: string | null, now = new Date()): boolean {
  if (!releaseDate) return true // TBA / announced
  const d = new Date(releaseDate + 'T12:00:00Z')
  if (Number.isNaN(d.getTime())) return true
  const days = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  // past 60 days → drop; future up to ~3 years keep
  if (days < -60) return false
  if (days > 366 * 3) return false
  return true
}
