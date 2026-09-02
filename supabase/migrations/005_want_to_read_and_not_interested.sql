-- Want-to-read vs owned-unread vs not-interested
-- Additive only: keeps status enum (unstarted/in_progress/completed) intact.
--
-- Model:
--   status = reading progress (owned library lifecycle)
--   want_to_read = explicit wishlist intent (Upcoming add, or manual flag)
--   not_interested = dismissed wishlist items (removed from Want to Read)
--
-- "Owned but Unread" = status='unstarted' + typically has purchase_date from Audible
-- "Want to Read"     = want_to_read=true AND not_interested=false
-- Existing completed / in_progress rows are untouched.

alter table public.user_books
  add column if not exists want_to_read boolean not null default false,
  add column if not exists not_interested boolean not null default false;

comment on column public.user_books.want_to_read is
  'Explicit wishlist flag. Independent of status. Synced Audible unstarted books stay false until user (or Upcoming add) sets this.';
comment on column public.user_books.not_interested is
  'Dismissed from Want to Read. When true, want_to_read should be false. Does not delete the row.';

-- Keep flags coherent: not interested implies not on the want list
create or replace function public.user_books_want_flags_guard()
returns trigger
language plpgsql
as $$
begin
  if new.not_interested is true then
    new.want_to_read := false;
  end if;
  return new;
end;
$$;

drop trigger if exists user_books_want_flags_guard_trg on public.user_books;
create trigger user_books_want_flags_guard_trg
  before insert or update of want_to_read, not_interested
  on public.user_books
  for each row
  execute function public.user_books_want_flags_guard();

create index if not exists user_books_user_want_idx
  on public.user_books (user_id, want_to_read)
  where want_to_read = true and not_interested = false;

create index if not exists user_books_user_not_interested_idx
  on public.user_books (user_id, not_interested)
  where not_interested = true;
