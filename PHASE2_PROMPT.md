# DogEar Phase 2 — Claude Code Build Prompt

## PROJECT
DogEar: multi-user audiobook tracker. Web (Next.js) + iOS (SwiftUI). Same Supabase backend.

## CREDENTIALS (already in .env.local)
- Supabase URL: https://nhkgwehogbywycxwzgyl.supabase.co
- Publishable Key: sb_publishable_WdY2T5p08ktDlfpVuuiKBA_pjwPrwwP
- Audible auth: /Users/darrin/.openclaw/integrations/audible_auth.json

## TASK 1: DATABASE SCHEMA
Create supabase/migrations/001_initial_schema.sql:

```sql
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
```

## TASK 2: SUPABASE CLIENT
Create src/lib/supabase/client.ts and src/lib/supabase/server.ts using @supabase/ssr.
Use env vars: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.

## TASK 3: AUTH
- src/app/auth/login/page.tsx — email/password + Google OAuth. Dark theme matching app.
- src/app/auth/signup/page.tsx — sign up form
- src/app/auth/callback/route.ts — OAuth callback handler
- src/middleware.ts — protect all routes except /auth/* redirect to /auth/login

## TASK 4: CONNECT AUDIBLE PAGE
src/app/settings/connect-audible/page.tsx
- Simple form: Amazon email + password
- Clear privacy notice: "Your credentials go directly to Amazon. We never store your password."
- POST to /api/audible/connect
- On success: redirect to /library with "Syncing..." state

## TASK 5: PYTHON SYNC API (Vercel Python functions)
api/sync.py — POST endpoint, accepts {user_id}, returns sync status
api/audible/connect.py — POST endpoint, accepts {email, password, locale}, runs audible auth, stores refresh token
requirements.txt in project root: audible==0.10.0, supabase==2.3.0, cryptography==42.0.0

## TASK 6: SwiftUI iOS APP
Create /Users/darrin/.openclaw/workspace/dogear-ios/ — complete SwiftUI scaffold:

- DogEarApp.swift (entry point, Supabase init)
- Models/Book.swift, UserBook.swift, ReadingStatus.swift
- Views/LibraryView.swift (grid, search, filter tabs)
- Views/BookDetailView.swift (cover, narrator, runtime, star rating, status)
- Views/AuthView.swift (sign in/up)
- Views/SettingsView.swift (connect Audible)
- Services/SupabaseService.swift (fetch library, update status/rating)
- ViewModels/LibraryViewModel.swift
- Package.swift with supabase-swift dependency

Supabase URL: https://nhkgwehogbywycxwzgyl.supabase.co
Supabase Key: sb_publishable_WdY2T5p08ktDlfpVuuiKBA_pjwPrwwP

Dark theme. Book covers prominent. Think Audible meets Letterboxd aesthetic.

## TASK 7: UPDATE WEB LIBRARY
Update library page to fetch from Supabase when logged in, fall back to static JSON for guests.

## TASK 8: VERIFY
npm run build must pass 0 errors.

## WHEN DONE
Run: openclaw system event --text "Done: DogEar Phase 2 — Supabase auth, schema, Audible connect, Python sync API, SwiftUI iOS scaffold" --mode now
