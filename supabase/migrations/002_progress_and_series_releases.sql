-- Progress signals from Audible library sync + series release tracking
-- Apply in Supabase SQL editor before deploying progress-field writes.

alter table public.user_books
  add column if not exists percent_complete numeric
    check (percent_complete is null or (percent_complete >= 0 and percent_complete <= 100)),
  add column if not exists is_finished boolean default false,
  add column if not exists progress_synced_at timestamptz,
  add column if not exists almost_finished_dismissed_at timestamptz,
  add column if not exists status_source text
    check (status_source is null or status_source in ('user', 'seed', 'audible_hint'));

comment on column public.user_books.percent_complete is
  'Audible library percent_complete (0-100). Hint only; never auto-sets status=completed.';
comment on column public.user_books.is_finished is
  'Audible is_finished flag. Hint only; user must confirm mark-as-read.';
comment on column public.user_books.status_source is
  'Who last set status: explicit user action, one-time JSON seed, or non-binding audible hint metadata.';

create index if not exists user_books_user_status_idx
  on public.user_books (user_id, status);

create index if not exists user_books_user_progress_idx
  on public.user_books (user_id, percent_complete desc nulls last)
  where percent_complete is not null;

create index if not exists books_series_name_idx
  on public.books (series_name)
  where series_name is not null;

create table if not exists public.series_releases (
  id uuid default uuid_generate_v4() primary key,
  series_name text not null,
  series_position numeric,
  title text not null,
  authors text[],
  asin text,
  release_date date,
  status text not null default 'upcoming'
    check (status in ('upcoming', 'announced', 'released', 'canceled', 'unknown')),
  source text not null default 'manual'
    check (source in ('manual', 'audible_sims', 'audible_catalog', 'seed_json')),
  preorder_url text,
  notes text,
  detected_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (series_name, title)
);

create index if not exists series_releases_series_idx
  on public.series_releases (series_name);

create index if not exists series_releases_date_idx
  on public.series_releases (release_date);

alter table public.series_releases enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'series_releases'
      and policyname = 'Authenticated can read series_releases'
  ) then
    create policy "Authenticated can read series_releases"
      on public.series_releases for select
      to authenticated
      using (true);
  end if;
end $$;
