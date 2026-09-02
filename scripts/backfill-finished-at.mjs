#!/usr/bin/env node
/**
 * One-time backfill: set finished_at for completed user_books that still have NULL.
 *
 * Source of dates (ASIN match only via books/user_books, never title):
 *   1. reading-tracker.json gr_date_read (preferred)
 *   2. reading-tracker.json audible_purchased (fallback)
 *
 * Rules:
 *   - Only touches rows where status='completed' AND finished_at IS NULL
 *   - Never fabricates dates when static JSON has neither field
 *   - Sets status_source='seed' only when status_source is currently null
 *     (does not overwrite status_source='user')
 *   - Idempotent / safe to re-run
 *
 * Usage:
 *   node scripts/backfill-finished-at.mjs [--dry-run] [--user-id UUID]
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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
  } catch {
    // ignore
  }
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

function toIsoDate(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  // Prefer date-only → noon UTC to avoid TZ day-shift noise on pure dates
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${s}T12:00:00.000Z`
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

const tracker = JSON.parse(
  readFileSync(join(root, 'src/data/reading-tracker.json'), 'utf8')
)

/** @type {Map<string, { gr_date_read: string|null, audible_purchased: string|null, title: string }>} */
const staticByAsin = new Map()
for (const b of tracker.books || []) {
  if (!b?.asin) continue
  staticByAsin.set(b.asin, {
    gr_date_read: b.gr_date_read || null,
    audible_purchased: b.audible_purchased || null,
    title: b.title || '?',
  })
}

console.log(`Static ASINs: ${staticByAsin.size}`)
console.log(`Target user: ${USER_ID}`)
console.log(DRY ? 'DRY RUN' : 'LIVE WRITE')

const { data: rows, error } = await supabase
  .from('user_books')
  .select('id, asin, status, finished_at, status_source')
  .eq('user_id', USER_ID)
  .eq('status', 'completed')
  .is('finished_at', null)

if (error) {
  console.error('Failed to load completed rows with null finished_at', error)
  process.exit(1)
}

const targets = rows || []
console.log(`Completed with finished_at NULL: ${targets.length}`)

let backfilledFromGr = 0
let backfilledFromPurchase = 0
let noStaticMatch = 0
let noInferableDate = 0
let writeErrors = 0
const CHUNK = 50

const updates = []

for (const row of targets) {
  const staticBook = staticByAsin.get(row.asin)
  if (!staticBook) {
    noStaticMatch++
    continue
  }

  const fromGr = toIsoDate(staticBook.gr_date_read)
  const fromPurch = toIsoDate(staticBook.audible_purchased)
  const finishedAt = fromGr || fromPurch
  if (!finishedAt) {
    noInferableDate++
    continue
  }

  const source = fromGr ? 'gr_date_read' : 'audible_purchased'
  const patch = {
    finished_at: finishedAt,
    updated_at: new Date().toISOString(),
  }
  // Only stamp seed when no prior source is recorded
  if (row.status_source == null) {
    patch.status_source = 'seed'
  }

  updates.push({ id: row.id, asin: row.asin, source, patch })
  if (source === 'gr_date_read') backfilledFromGr++
  else backfilledFromPurchase++
}

console.log(`Would/will backfill: ${updates.length}`)
console.log(`  from gr_date_read: ${backfilledFromGr}`)
console.log(`  from audible_purchased: ${backfilledFromPurchase}`)
console.log(`No static ASIN match: ${noStaticMatch}`)
console.log(`Static match but no usable date: ${noInferableDate}`)

if (DRY) {
  console.log('Sample (first 10):')
  for (const u of updates.slice(0, 10)) {
    console.log(`  ${u.asin} ← ${u.source} → ${u.patch.finished_at}`)
  }
  console.log('DRY RUN complete — no writes.')
  process.exit(0)
}

for (let i = 0; i < updates.length; i += CHUNK) {
  const chunk = updates.slice(i, i + CHUNK)
  const results = await Promise.all(
    chunk.map(({ id, patch }) =>
      supabase
        .from('user_books')
        .update(patch)
        // Extra safety: only touch genuinely-null finished_at completed rows
        .eq('id', id)
        .eq('status', 'completed')
        .is('finished_at', null)
    )
  )
  for (let j = 0; j < results.length; j++) {
    if (results[j].error) {
      writeErrors++
      console.error('update fail', chunk[j].asin, results[j].error.message)
    }
  }
  process.stdout.write(`\rWrote ${Math.min(i + CHUNK, updates.length)}/${updates.length}`)
}
console.log('')

// Post-verify
const { count: stillNull } = await supabase
  .from('user_books')
  .select('*', { count: 'exact', head: true })
  .eq('user_id', USER_ID)
  .eq('status', 'completed')
  .is('finished_at', null)

const { count: completedHas } = await supabase
  .from('user_books')
  .select('*', { count: 'exact', head: true })
  .eq('user_id', USER_ID)
  .eq('status', 'completed')
  .not('finished_at', 'is', null)

const { count: completedTotal } = await supabase
  .from('user_books')
  .select('*', { count: 'exact', head: true })
  .eq('user_id', USER_ID)
  .eq('status', 'completed')

console.log({
  backfilled: updates.length - writeErrors,
  writeErrors,
  completedTotal,
  completedWithFinishedAt: completedHas,
  completedFinishedAtStillNull: stillNull,
  noStaticMatch,
  noInferableDate,
})
