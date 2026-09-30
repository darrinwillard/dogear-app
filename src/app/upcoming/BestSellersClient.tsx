'use client'

/**
 * NYT Best Sellers tab — placeholder until NEXT_PUBLIC_NYT_API_KEY (or a
 * server-side NYT_API_KEY env var backing /api/books/bestsellers) is wired
 * up. Real implementation: fetch NYT Books API list-names, let the user
 * pick a list (Combined Print & E-Book Fiction/Nonfiction as defaults),
 * cache server-side on an interval (NYT updates lists weekly), and reuse
 * WantButton for adding titles straight to Want to Read.
 */
export default function BestSellersClient() {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center space-y-3">
      <div className="text-3xl">🏆</div>
      <h2 className="font-serif text-xl font-bold text-amber-100">NYT Best Sellers</h2>
      <p className="text-slate-400 text-sm max-w-md mx-auto">
        Coming soon — waiting on an NYT Books API key to go live.
      </p>
    </div>
  )
}
