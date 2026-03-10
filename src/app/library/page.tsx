import { getAllBooks, getStatusLabel, getStatusColor, formatDate } from '@/lib/books'
import LibraryClient from './LibraryClient'

export default function LibraryPage() {
  const books = getAllBooks()
  return <LibraryClient books={books} />
}
