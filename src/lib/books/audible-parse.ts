import { parseSeriesSequence, readPercentPresent, readFinishedPresent } from './sync-parse'

export interface AudibleItem {
  asin?: string
  title?: string
  narrators?: { name: string }[]
  authors?: { name: string }[]
  runtime_length_min?: number
  product_images?: Record<string, string>
  series?: { title?: string; sequence?: string | number }[]
  purchase_date?: string
  percent_complete?: number | string
  is_finished?: boolean | string
  listening_status?: {
    percent_complete?: number | string
    is_finished?: boolean | string
  }
  release_date?: string
  publication_datetime?: string
  publisher_name?: string
  publisher_summary?: string
  merchandising_summary?: string
}

/**
 * Library response_groups for DogEar sync.
 *
 * `media` is REQUIRED for cover art — without it, `product_images` is null
 * even when product_desc/product_attrs are present. Confirmed via live API
 * probes 2026-09-01: media alone (or any set including media) returns
 * product_images like { "500": "https://m.media-amazon.com/..." }; sets
 * without media return product_images: null.
 *
 * series / percent_complete / is_finished / listening_status can be combined
 * with media in one call — combining them does NOT drop product_images.
 */
export const AUDIBLE_LIBRARY_RESPONSE_GROUPS = [
  'product_desc',
  'product_attrs',
  'contributors',
  'media',
  'series',
  'percent_complete',
  'is_finished',
  'listening_status',
  'relationships',
].join(',')

/**
 * undefined = field absent (do not write)
 * null = explicitly empty / unparseable but present
 * number = value to store
 */
export function readPercent(item: AudibleItem): number | null | undefined {
  const result = readPercentPresent(item as unknown as Record<string, unknown>)
  if (!result.present) return undefined
  return result.value
}

/**
 * undefined = field absent (do not write)
 * boolean = value to store
 */
export function readIsFinished(item: AudibleItem): boolean | undefined {
  const result = readFinishedPresent(item as unknown as Record<string, unknown>)
  if (!result.present) return undefined
  return result.value
}

export function readSeriesFields(item: AudibleItem): {
  seriesName?: string
  seriesPosition?: number
  seriesPositionRaw?: string
  seriesIsRange?: boolean
  /** true when Audible included a series array (even if empty) */
  seriesPresent: boolean
} {
  const seriesPresent = Array.isArray(item.series)
  if (!seriesPresent) {
    return { seriesPresent: false }
  }

  const first = item.series?.[0]
  if (!first?.title) {
    return { seriesPresent: true }
  }

  const parsed = parseSeriesSequence(first.sequence)
  return {
    seriesPresent: true,
    seriesName: first.title.trim(),
    seriesPosition: parsed.position ?? undefined,
    seriesPositionRaw: parsed.raw ?? undefined,
    seriesIsRange: parsed.range,
  }
}

/**
 * Synopsis text — Audible returns this under publisher_summary (preferred,
 * fuller description) or merchandising_summary (shorter, marketing-style)
 * depending on the title. product_desc must be in response_groups for
 * either field to be present at all. HTML entities/tags occasionally show
 * up in publisher_summary; stripped here so the modal renders plain text.
 */
export function readSummary(item: AudibleItem): string | null | undefined {
  const raw = item.publisher_summary || item.merchandising_summary
  if (raw == null) return undefined
  const stripped = String(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped || null
}

export function readCoverUrl(item: AudibleItem): string | null | undefined {
  const images = item.product_images
  if (!images || typeof images !== 'object') return undefined

  // Prefer known sizes first (Audible commonly returns only "500" today).
  const preferred =
    images['500'] ||
    images['1024'] ||
    images['300'] ||
    images['0'] ||
    images['100'] ||
    images['60']
  if (typeof preferred === 'string' && preferred.trim()) {
    return preferred.trim()
  }

  // Fallback: first non-empty string value in the map (size keys vary by locale/API).
  for (const value of Object.values(images)) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  // Present but empty/unusable — caller should not clobber an existing cover.
  return undefined
}
