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
}

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

export function readCoverUrl(item: AudibleItem): string | null | undefined {
  if (!item.product_images) return undefined
  return (
    item.product_images['500'] ||
    item.product_images['1024'] ||
    item.product_images['300'] ||
    item.product_images['0'] ||
    null
  )
}
