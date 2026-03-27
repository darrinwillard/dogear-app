import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/Nav'
import BottomNav from '@/components/BottomNav'

export const metadata: Metadata = {
  title: 'DogEar — Your Reading Life',
  description: 'Track your books, series, and upcoming releases. Auto-synced from Audible and Goodreads.',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📖</text></svg>"
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-amber-50 antialiased">
        <Nav />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 sm:pb-8">
          {children}
        </main>
        <footer className="border-t border-slate-800 mt-16 py-8 mb-16 sm:mb-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between text-sm text-slate-500">
            <span>🐾 DogEar — Your Reading Life</span>
            <span>Data synced from Audible & Goodreads</span>
          </div>
        </footer>
        <BottomNav />
      </body>
    </html>
  )
}
