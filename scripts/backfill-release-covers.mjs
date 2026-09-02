#!/usr/bin/env node
/**
 * One-time backfill: populate cover art for existing series_releases rows.
 *
 * Strategy:
 *  1. Fetch product_images from Audible catalog by ASIN bulk lookup
 *     (GET /1.0/catalog/products?asins=...&response_groups=...media...&image_sizes=300,500,1024)
 *  2. Always mirror cover_url onto books.cover_url by ASIN (migration 001 column —
 *     works even when series_releases.cover_url from migration 003 is missing).
 *  3. If series_releases.cover_url exists, write it there too.
 *
 * Usage:
 *   node scripts/backfill-release-covers.mjs [--dry-run]
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Requires a user_profiles row with audible_refresh_token.
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
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const sb = createClient(url, key)

const RG =
  'contributors,media,product_attrs,product_desc,product_extended_attrs,series,product_details'
const IMAGE_SIZES = '300,500,1024'

function pickCover(productImages) {
  if (!productImages || typeof productImages !== 'object') return null
  const preferred =
    productImages['500'] ||
    productImages['1024'] ||
    productImages['300'] ||
    productImages['0'] ||
    productImages['100'] ||
    productImages['60']
  if (typeof preferred === 'string' && preferred.trim()) return preferred.trim()
  for (const v of Object.values(productImages)) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

async function getAccessToken() {
  const { data: profiles } = await sb
    .from('user_profiles')
    .select('id, audible_refresh_token')
    .not('audible_refresh_token', 'is', null)
    .limit(1)
  const profile = profiles?.[0]
  if (!profile?.audible_refresh_token) throw new Error('No Audible token on any profile')
  const tokens = JSON.parse(profile.audible_refresh_token)
  const refreshResponse = await fetch('https://api.amazon.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      app_name: 'Audible',
      app_version: '3.56.2',
      source_token: tokens.refresh_token,
      requested_token_type: 'access_token',
      source_token_type: 'refresh_token',
    }).toString(),
  })
  const accessToken = (await refreshResponse.json()).access_token
  if (!accessToken) throw new Error('Token refresh failed')
  return accessToken
}

async function fetchCoversByAsin(accessToken, asins) {
  const map = new Map()
  for (let i = 0; i < asins.length; i += 20) {
    const chunk = asins.slice(i, i + 20)
    const params = new URLSearchParams({
      asins: chunk.join(','),
      response_groups: RG,
      image_sizes: IMAGE_SIZES,
    })
    const res = await fetch(`https://api.audible.com/1.0/catalog/products?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`catalog asins ${res.status}: ${text.slice(0, 180)}`)
    }
    const data = await res.json()
    for (const p of data.products || []) {
      if (!p?.asin) continue
      const cover = pickCover(p.product_images)
      if (cover) {
        map.set(p.asin, {
          cover,
          title: p.title || null,
          authors: (p.authors || []).map((a) => a.name).filter(Boolean),
          releaseDate: (p.release_date || p.issue_date || '').slice(0, 10) || null,
        })
      }
    }
    await new Promise((r) => setTimeout(r, 120))
  }
  return map
}

async function columnExists(table, col) {
  const { error } = await sb.from(table).select(col).limit(1)
  return !error
}

async function main() {
  console.log(DRY ? 'DRY RUN' : 'LIVE backfill')

  const hasReleaseCover = await columnExists('series_releases', 'cover_url')
  console.log('series_releases.cover_url present:', hasReleaseCover)
  if (!hasReleaseCover) {
    console.log(
      'NOTE: migration 003 not applied — covers will still land on books.cover_url and Upcoming will join them by ASIN.'
    )
  }

  const { data: releases, error } = await sb
    .from('series_releases')
    .select('id, asin, title')
    .not('asin', 'is', null)
  if (error) throw error

  const rows = (releases || []).filter((r) => r.asin)
  console.log('series_releases with asin:', rows.length)
  if (!rows.length) {
    console.log('nothing to do')
    return
  }

  const accessToken = await getAccessToken()
  const asins = Array.from(new Set(rows.map((r) => r.asin)))
  console.log('unique asins:', asins.length)

  const coverMap = await fetchCoversByAsin(accessToken, asins)
  console.log('covers found from Audible:', coverMap.size)
  if (!coverMap.size) {
    console.error('No covers returned — aborting')
    process.exit(1)
  }

  // Sample
  const sample = [...coverMap.entries()].slice(0, 5).map(([asin, v]) => ({
    asin,
    title: v.title,
    cover: v.cover,
  }))
  console.log('sample', JSON.stringify(sample, null, 2))

  if (DRY) {
    console.log('dry-run complete — no writes')
    return
  }

  // 1) books.cover_url mirror (always)
  let booksUpdated = 0
  let booksInserted = 0
  const now = new Date().toISOString()
  for (const [asin, info] of coverMap.entries()) {
    const { data: existing } = await sb
      .from('books')
      .select('id, cover_url')
      .eq('asin', asin)
      .maybeSingle()
    if (existing?.id) {
      if (existing.cover_url === info.cover) continue
      const { error: uErr } = await sb
        .from('books')
        .update({ cover_url: info.cover, updated_at: now })
        .eq('id', existing.id)
      if (uErr) {
        console.warn('books update fail', asin, uErr.message)
      } else {
        booksUpdated++
      }
    } else {
      const { error: iErr } = await sb.from('books').insert({
        asin,
        title: info.title || asin,
        authors: info.authors || [],
        cover_url: info.cover,
        release_date: info.releaseDate,
        updated_at: now,
      })
      if (iErr) {
        console.warn('books insert fail', asin, iErr.message)
      } else {
        booksInserted++
      }
    }
  }

  // 2) series_releases.cover_url when column exists
  let releasesUpdated = 0
  if (hasReleaseCover) {
    for (const row of rows) {
      const info = coverMap.get(row.asin)
      if (!info?.cover) continue
      const { error: uErr } = await sb
        .from('series_releases')
        .update({ cover_url: info.cover, updated_at: now })
        .eq('id', row.id)
      if (uErr) {
        console.warn('release update fail', row.asin, uErr.message)
      } else {
        releasesUpdated++
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        booksUpdated,
        booksInserted,
        releasesUpdated,
        coversFound: coverMap.size,
        totalReleases: rows.length,
      },
      null,
      2
    )
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
