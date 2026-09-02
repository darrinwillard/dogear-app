-- Extend series_releases for live Audible catalog refresh + author-scoped titles.
-- series_name may be 'Standalone' for non-series author releases.
-- interest_kind helps the UI split "series you're reading" vs "new from authors you've read".

alter table public.series_releases
  add column if not exists interest_kind text
    check (interest_kind is null or interest_kind in ('series', 'author', 'both')),
  add column if not exists matched_series text,
  add column if not exists language text,
  add column if not exists cover_url text,
  add column if not exists content_type text;

comment on column public.series_releases.interest_kind is
  'How this release was classified for DogEar: series follow, author follow, or both.';
comment on column public.series_releases.matched_series is
  'User/library series name this release was matched to (may differ slightly from Audible series title).';

-- Prefer ASIN uniqueness when Audible gives one (title+series can collide across locales).
create unique index if not exists series_releases_asin_uidx
  on public.series_releases (asin)
  where asin is not null and asin <> '';

create index if not exists series_releases_status_date_idx
  on public.series_releases (status, release_date);

-- Track per-user release refresh cadence (weekly job, not every library sync).
alter table public.user_profiles
  add column if not exists last_releases_synced_at timestamptz;

comment on column public.user_profiles.last_releases_synced_at is
  'Last successful Audible catalog release refresh for this user.';
