/**
 * Audible library field parsers.
 * Presence-guarded: missing fields must not overwrite existing DB values.
 */

export type PresentValue<T> =
  | { present: false }
  | { present: true; value: T }

export interface SeriesSequenceParse {
  /** Numeric position to store, or null = do not write series_position */
  position: number | null
  /** True when sequence looks like a range/omnibus (e.g. "1-3") */
  range: boolean
  raw: string | null
}

const CLEAN_NUMBER = /^\d+(\.\d+)?$/
const RANGE_NUMBER = /^(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/

/**
 * Parse Audible series sequence safely.
 * - "3" / "3.5" → position 3 / 3.5
 * - "1-3" → position 1 + range flag (log; do not silently pretend it's only #1 without notice)
 * - garbage → no write
 */
export function parseSeriesSequence(sequence: unknown): SeriesSequenceParse {
  if (sequence === undefined || sequence === null) {
    return { position: null, range: false, raw: null }
  }
  const raw = String(sequence).trim()
  if (!raw) return { position: null, range: false, raw: null }

  if (CLEAN_NUMBER.test(raw)) {
    const n = Number(raw)
    if (!Number.isFinite(n)) return { position: null, range: false, raw }
    return { position: n, range: false, raw }
  }

  const rangeMatch = raw.match(RANGE_NUMBER)
  if (rangeMatch) {
    const n = Number(rangeMatch[1])
    if (!Number.isFinite(n)) return { position: null, range: true, raw }
    // Store leading number but flag as range so callers can log.
    return { position: n, range: true, raw }
  }

  // Leading number with trailing junk (e.g. "2 of 5") — take leading only, not a range
  const leading = raw.match(/^(\d+(?:\.\d+)?)/)
  if (leading && !raw.includes('-') && !raw.includes('–')) {
    const n = Number(leading[1])
    if (Number.isFinite(n)) return { position: n, range: false, raw }
  }

  return { position: null, range: false, raw }
}

export function readPercentPresent(item: Record<string, unknown> | null | undefined): PresentValue<number | null> {
  if (!item || typeof item !== 'object') return { present: false }

  const listening = item.listening_status
  const nested =
    listening && typeof listening === 'object'
      ? (listening as Record<string, unknown>).percent_complete
      : undefined

  const hasTop = Object.prototype.hasOwnProperty.call(item, 'percent_complete')
  const hasNested = nested !== undefined

  if (!hasTop && !hasNested) return { present: false }

  const raw = hasTop ? item.percent_complete : nested
  if (raw === null) return { present: true, value: null }

  const n = typeof raw === 'string' ? parseFloat(raw) : raw
  if (typeof n !== 'number' || Number.isNaN(n)) return { present: true, value: null }
  return { present: true, value: Math.min(100, Math.max(0, n)) }
}

export function readFinishedPresent(item: Record<string, unknown> | null | undefined): PresentValue<boolean> {
  if (!item || typeof item !== 'object') return { present: false }
  if (!Object.prototype.hasOwnProperty.call(item, 'is_finished')) return { present: false }

  const raw = item.is_finished
  if (raw === true || raw === 'true' || raw === 1 || raw === '1') {
    return { present: true, value: true }
  }
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') {
    return { present: true, value: false }
  }
  // Present but unparseable — do not write
  return { present: false }
}

/** Only assign optional keys when value is non-null / non-empty. */
export function assignIfPresent(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  opts?: { emptyStringAsMissing?: boolean }
): void {
  if (value === undefined || value === null) return
  if (opts?.emptyStringAsMissing && value === '') return
  target[key] = value
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}
