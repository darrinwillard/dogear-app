#!/usr/bin/env node
/**
 * One-time historical seed: reading-tracker.json → user_books / books
 *
 * Usage:
 *   node scripts/seed-status-from-static.mjs [--dry-run] [--user-id UUID]
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Rules:
 *   - Match by ASIN only (never title)
 *   - Never overwrite status_source='user'
 *   - Only set status when current is unstarted and status_source is null
 *   - Presence-guard books.series_* — only fill when currently null
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(root, '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch {}
}

loadEnvLocal()

const DRY = process.argv.includes('--dry-run')
const userArgIdx = process.argv.indexOf('--user-id')
const USER_ID =
  (userArgIdx >= 0 && process.argv[userArgIdx + 1]) ||
  process.env.DOGEAR_USER_ID ||
  'aacf4e0f-2267-413d-ab88-df6b28f4c4dd'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)

function mapStaticStatus(s) {
  switch (s) {
    case 'read':
    case 'read_no_date':
      return 'completed'
    case 'reading':
    case 'currently-reading':
      return 'in_progress'
    case 'to_read':
    case 'in_library':
    default:
      return 'unstarted'
  }
}

function parseSeriesPos(raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  if (!/^\d+(\.\d+)?$/.test(s)) return null // skip ranges like 1-3
  return parseFloat(s)
}

const tracker = JSON.parse(
  readFileSync(join(root, 'src/data/reading-tracker.json'), 'utf8')
)

const staticBooks = (tracker.books || []).filter((b) => b.asin)
console.log(`Static books with ASIN: ${staticBooks.length}`)
console.log(`Target user: ${USER_ID}`)
console.log(DRY ? 'DRY RUN' : 'LIVE WRITE')

// Load all user_books for user
const { data: userBooks, error: ubErr } = await supabase
  .from('user_books')
  .select(
    'id, asin, status, rating, status_source, finished_at, started_at'
  )
  .eq('user_id', USER_ID)

if (ubErr) {
  // status_source may not exist yet
  console.warn('user_books select with status_source failed, trying legacy', ubErr.message)
  const legacy = await supabase
    .from('user_books')
    .select('id, asin, status, rating, finished_at, started_at')
    .eq('user_id', USER_ID)
  if (legacy.error) {
    console.error(legacy.error)
    process.exit(1)
  }
  var rows = legacy.data || []
} else {
  var rows = userBooks || []
}

const byAsin = new Map(rows.map((r) => [r.asin, r]))
console.log(`Existing user_books: ${rows.length}`)

let statusUpdated = 0
let ratingUpdated = 0
let seriesUpdated = 0
let skippedUser = 0
let skippedNoRow = 0
let skippedAlready = 0

for (const b of staticBooks) {
  const asin = b.asin
  const row = byAsin.get(asin)
  if (!row) {
    skippedNoRow++
    continue
  }

  if (row.status_source === 'user') {
    skippedUser++
    continue
  }

  const dbStatus = mapStaticStatus(b.status)
  const patch = {}

  const canSetStatus =
    (row.status_source == null || row.status_source === undefined) &&
    (row.status === 'unstarted' || row.status == null)

  if (canSetStatus && dbStatus !== 'unstarted') {
    patch.status = dbStatus
    patch.status_source = 'seed'
    if (dbStatus === 'completed') {
      const fin = b.gr_date_read || null
      if (fin) patch.finished_at = new Date(fin).toISOString()
    }
    if (dbStatus === 'in_progress' && !row.started_at) {
      patch.started_at = new Date().toISOString()
    }
  } else if (!canSetStatus) {
    skippedAlready++
  }

  if (
    (row.rating == null || row.rating === undefined) &&
    typeof b.gr_rating === 'number' &&
    b.gr_rating >= 1 &&
    b.gr_rating <= 5
  ) {
    patch.rating = b.gr_rating
  }

  if (Object.keys(patch).length > 0) {
    if (DRY) {
      console.log('would update user_books', asin, patch)
    } else {
      const { error } = await supabase
        .from('user_books')
        .update(patch)
        .eq('id', row.id)
      if (error) {
        // retry without status_source if column missing
        if (error.message?.includes('status_source')) {
          const { status_source, ...rest } = patch
          const retry = await supabase
            .from('user_books')
            .update(rest)
            .eq('id', row.id)
          if (retry.error) console.error('update fail', asin, retry.error.message)
          else {
            if (rest.status) statusUpdated++
            if (rest.rating) ratingUpdated++
          }
        } else {
          console.error('update fail', asin, error.message)
        }
      } else {
        if (patch.status) statusUpdated++
        if (patch.rating) ratingUpdated++
      }
    }
  }

  // Series backfill on books when null
  if (b.series) {
    const pos = parseSeriesPos(b.series_num)
    if (DRY) {
      // skip noisy logs
    } else {
      // Only fill nulls — fetch current
      const { data: book } = await supabase
        .from('books')
        .select('id, series_name, series_position')
        .eq('asin', asin)
        .maybeSingle()
      if (book && !book.series_name) {
        const bookPatch = { series_name: b.series }
        if (pos != null && book.series_position == null) {
          bookPatch.series_position = pos
        }
        const { error } = await supabase
          .from('books')
          .update(bookPatch)
          .eq('id', book.id)
        if (!error) seriesUpdated++
      }
    }
  }
}

console.log({
  statusUpdated,
  ratingUpdated,
  seriesUpdated,
  skippedUser,
  skippedNoRow,
  skippedAlready,
})

// Distribution
const { data: dist } = await supabase
  .from('user_books')
  .select('status')
  .eq('user_id', USER_ID)

const counts = {}
for (const r of dist || []) {
  counts[r.status] = (counts[r.status] || 0) + 1
}
console.log('status distribution', counts)

const { count: seriesCount } = await supabase
  .from('books')
  .select('asin', { count: 'exact', head: true })
  .not('series_name', 'is', null)
console.log('books with series_name', seriesCount)
