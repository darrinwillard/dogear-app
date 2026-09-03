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
  category_ladders?: {
    ladder?: { name?: string }[]
    root?: string
  }[]
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
 *
 * `product_extended_attrs` is REQUIRED for the FULL `publisher_summary`.
 * Without it, `product_desc` alone returns a truncated ~290-char
 * `merchandising_summary`-style blurb under the SAME `publisher_summary`
 * key — silently shorter, not absent, so this was easy to miss. Confirmed
 * via live API probe 2026-09-03: product_desc alone -> 290 chars ending
 * in "..."; product_extended_attrs -> full multi-paragraph text (1400+
 * chars, HTML <br /> paragraph breaks) matching the real Audible product
 * page. Root cause of the 2026-09-03 "synopsis cuts off" bug report.
 */
export const AUDIBLE_LIBRARY_RESPONSE_GROUPS = [
  'product_desc',
  'product_attrs',
  'product_extended_attrs',
  'contributors',
  'media',
  'series',
  'percent_complete',
  'is_finished',
  'listening_status',
  'relationships',
  'category_ladders',
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
 * fallback. product_extended_attrs must be in response_groups for the FULL
 * publisher_summary — product_desc alone returns a truncated ~290-char
 * version under the same key (confirmed via live API probe 2026-09-03).
 *
 * publisher_summary commonly contains <br /> tags marking paragraph
 * breaks (confirmed live: Dark Places has 3 paragraphs joined by <br />).
 * Convert those to \n\n before stripping remaining tags, so whitespace-pre-line
 * in the UI renders real paragraph breaks instead of one run-on line.
 */
export function readSummary(item: AudibleItem): string | null | undefined {
  const raw = item.publisher_summary || item.merchandising_summary
  if (raw == null) return undefined
  const stripped = String(raw)
    .replace(/<br\s*\/?>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
  return stripped || null
}

/**
 * Genre — Audible returns category_ladders as an array of "ladders", each a
 * path from a root category down through subcategories (e.g. Genres ->
 * Mystery, Thriller & Suspense -> Thriller -> Espionage). We want the
 * broadest useful label, not the deepest — "Espionage" is too narrow for a
 * sort/filter UI, "Genres" (the root) is too broad. Takes the first
 * meaningful (non-root) level of the first ladder under the "Genres" root
 * when present, else the first ladder's first level, else undefined.
 */
export function readGenre(item: AudibleItem): string | null | undefined {
  const ladders = item.category_ladders
  if (!Array.isArray(ladders) || ladders.length === 0) return undefined

  const genreLadder = ladders.find((l) => l.root === 'Genres') ?? ladders[0]
  const names = (genreLadder?.ladder ?? [])
    .map((l) => l.name?.trim())
    .filter((n): n is string => !!n)

  if (names.length === 0) return undefined
  // First level is usually the broad genre (Mystery, Sci-Fi & Fantasy,
  // Literature & Fiction); deeper levels get more specific than useful here.
  return names[0]
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
