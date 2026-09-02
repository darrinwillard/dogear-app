alter table public.user_books
  drop constraint if exists user_books_rating_check;

alter table public.user_books
  add constraint user_books_rating_check
  check (rating is null or (rating >= 1 and rating <= 5 and (rating * 2) = floor(rating * 2)));
