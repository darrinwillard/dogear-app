import { getLibraryForCurrentUser } from '@/lib/books/queries'
import SearchClient from './SearchClient'

export const dynamic = 'force-dynamic'

export default async function SearchPage() {
  const library = await getLibraryForCurrentUser()
  return <SearchClient books={library.books} />
}
