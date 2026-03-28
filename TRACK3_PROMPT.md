Fix the library page to fetch from Supabase when logged in, instead of static JSON.

File: src/app/library/page.tsx

The page currently imports from the static JSON file. Update it to:

1. Check if user is authenticated (use createClient from @/lib/supabase/server)
2. If authenticated: fetch user_books JOIN books from Supabase
3. If not authenticated: fall back to the static JSON

The Supabase query should be:
```
const { data: userBooks } = await supabase
  .from('user_books')
  .select('*, book:books(*)')
  .eq('user_id', user.id)
  .order('created_at', { ascending: false })
```

Map the result to the same Book shape the UI expects:
- title, authors (array), narrator, runtime_minutes (as runtime_length_min), cover_url, asin, status, rating, series_name

If userBooks is empty (new user who hasn't synced): show the empty state with "Connect Audible" CTA linking to /settings/connect-audible.

Also update the stats bar to count from live data.

Run npm run build — must pass 0 errors.
When done: openclaw system event --text "Done: DogEar library page fetches live Supabase data" --mode now
