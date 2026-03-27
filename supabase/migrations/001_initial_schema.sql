create extension if not exists "uuid-ossp";

create table public.user_profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  audible_refresh_token text,
  audible_locale text default 'us',
  last_synced_at timestamptz,
  created_at timestamptz default now()
);

create table public.books (
  id uuid default uuid_generate_v4() primary key,
  asin text unique not null,
  title text not null,
  authors text[],
  narrator text,
  runtime_minutes integer,
  cover_url text,
  series_name text,
  series_position numeric,
  publisher text,
  release_date date,
  summary text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.user_books (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  book_id uuid references public.books(id) on delete cascade not null,
  asin text not null,
  purchase_date date,
  status text default 'unstarted' check (status in ('unstarted', 'in_progress', 'completed')),
  rating integer check (rating >= 1 and rating <= 5),
  notes text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, asin)
);

create table public.sync_logs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  status text not null check (status in ('running', 'success', 'error')),
  books_synced integer default 0,
  error_message text,
  started_at timestamptz default now(),
  finished_at timestamptz
);

alter table public.user_profiles enable row level security;
alter table public.user_books enable row level security;
alter table public.sync_logs enable row level security;
alter table public.books enable row level security;

create policy "Users can manage own profile" on public.user_profiles for all using (auth.uid() = id);
create policy "Anyone can read books" on public.books for select using (true);
create policy "Service can manage books" on public.books for all using (true);
create policy "Users can manage own books" on public.user_books for all using (auth.uid() = user_id);
create policy "Users can read own sync logs" on public.sync_logs for select using (auth.uid() = user_id);
