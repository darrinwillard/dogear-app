/**
 * series_releases / user_profiles column capability probes.
 * Migration 003 adds interest_kind, matched_series, cover_url, language,
 * content_type, last_releases_synced_at. Until applied, we degrade gracefully.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReleaseInterestKind } from './types'

let releaseColsCache: Set<string> | null = null
let profileColsCache: Set<string> | null = null

export async function getSeriesReleaseColumns(
  supabase: SupabaseClient
): Promise<Set<string>> {
  if (releaseColsCache) return releaseColsCache
  // Probe by selecting * limit 0 isn't available; try optional columns one-by-one
  const base = [
    'id',
    'series_name',
    'series_position',
    'title',
    'authors',
    'asin',
    'release_date',
    'status',
    'source',
    'preorder_url',
    'notes',
    'detected_at',
    'updated_at',
  ]
  const optional = [
    'interest_kind',
    'matched_series',
    'language',
    'cover_url',
    'content_type',
  ]
  const have = new Set(base)
  for (const col of optional) {
    const { error } = await supabase
      .from('series_releases')
      .select(col)
      .limit(1)
    if (!error) have.add(col)
  }
  releaseColsCache = have
  return have
}

export async function getProfileColumns(
  supabase: SupabaseClient
): Promise<Set<string>> {
  if (profileColsCache) return profileColsCache
  const base = [
    'id',
    'audible_refresh_token',
    'audible_locale',
    'last_synced_at',
    'created_at',
  ]
  const optional = ['last_releases_synced_at']
  const have = new Set(base)
  for (const col of optional) {
    const { error } = await supabase.from('user_profiles').select(col).limit(1)
    if (!error) have.add(col)
  }
  profileColsCache = have
  return have
}

export function encodeInterestNotes(
  kind: ReleaseInterestKind,
  base?: string | null
): string {
  const tag =
    kind === 'series'
      ? '[interest:series]'
      : kind === 'author'
        ? '[interest:author]'
        : '[interest:both]'
  const human =
    kind === 'author'
      ? 'New from an author you have read'
      : kind === 'both'
        ? 'Matches a series you follow and an author you have read'
        : 'Next / upcoming in a series you follow'
  const rest = (base || human).replace(/\[interest:(series|author|both)\]\s*/g, '')
  return `${tag} ${rest}`.trim()
}

export function parseInterestFromNotes(
  notes: string | null | undefined
): ReleaseInterestKind | null {
  if (!notes) return null
  const m = notes.match(/\[interest:(series|author|both)\]/i)
  if (!m) return null
  return m[1].toLowerCase() as ReleaseInterestKind
}

export function stripInterestTag(notes: string | null | undefined): string | null {
  if (!notes) return null
  const cleaned = notes.replace(/\[interest:(series|author|both)\]\s*/gi, '').trim()
  return cleaned || null
}

/** Keep only keys the live table accepts */
export function pickReleaseRow(
  row: Record<string, unknown>,
  cols: Set<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (cols.has(k)) out[k] = v
  }
  return out
}
