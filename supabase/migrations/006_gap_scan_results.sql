-- Persist "Fill In Gaps" scan results so they survive navigation and don't
-- require a full re-scan every visit. Previously ephemeral (client fetch on
-- tab open, nothing stored) — Darrin reported losing scan results when he
-- came back to the app later. Fixed by storing results per-user, updating
-- incrementally on each scan rather than wiping and rebuilding from scratch.
--
-- Design:
--   gap_scan_results: one row per (user, kind, key) — kind='series' rows
--   keyed by series_name, kind='author' rows keyed by author name. Missing
--   books stored as jsonb (matches NormalizedCatalogRelease shape already
--   used everywhere else in this app for Audible catalog data — no new
--   type needed, no join to a separate books-like table).
--
--   A book is removed from a gap's `missing` list on the NEXT scan once
--   the user owns it (bought on Audible, synced) or marks it read via
--   mark-external-read — at which point rescanning naturally drops it
--   from the diff (ownedAsins already includes it). No separate dismiss
--   flag needed for that path.

create table if not exists public.gap_scan_results (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  kind text not null check (kind in ('series', 'author')),
  key text not null, -- series_name or author name
  display_author text, -- only meaningful for kind='series'
  read_count integer not null default 0,
  total_known integer, -- only meaningful for kind='series'
  missing jsonb not null default '[]'::jsonb, -- NormalizedCatalogRelease[]
  last_scanned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id, kind, key)
);

comment on table public.gap_scan_results is
  'Persisted "Fill In Gaps" scan results, one row per series/author checked. Survives navigation; updated incrementally on re-scan rather than wiped.';
comment on column public.gap_scan_results.missing is
  'Array of NormalizedCatalogRelease-shaped objects (asin, title, authors, seriesName, seriesPosition, rating, ratingCount, coverUrl, preorderUrl, source) for books not yet owned.';

alter table public.gap_scan_results enable row level security;

drop policy if exists "gap_scan_results_select_own" on public.gap_scan_results;
create policy "gap_scan_results_select_own" on public.gap_scan_results
  for select using (auth.uid() = user_id);

drop policy if exists "gap_scan_results_insert_own" on public.gap_scan_results;
create policy "gap_scan_results_insert_own" on public.gap_scan_results
  for insert with check (auth.uid() = user_id);

drop policy if exists "gap_scan_results_update_own" on public.gap_scan_results;
create policy "gap_scan_results_update_own" on public.gap_scan_results
  for update using (auth.uid() = user_id);

drop policy if exists "gap_scan_results_delete_own" on public.gap_scan_results;
create policy "gap_scan_results_delete_own" on public.gap_scan_results
  for delete using (auth.uid() = user_id);

create index if not exists gap_scan_results_user_idx
  on public.gap_scan_results (user_id, kind);
