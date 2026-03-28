"use client"
import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"

export default function ConnectAudiblePage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
  }, [])

  async function handleConnect() {
    if (!userId) {
      setError("Not logged in. Please sign in first.")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/audible/auth-url?userId=${userId}`)
      const { url } = await res.json()
      window.location.href = url
    } catch (e: any) {
      setError("Failed to start Amazon login. Please try again.")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 pb-24">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🎧</div>
          <h1 className="text-2xl font-bold text-white mb-2">Connect Audible</h1>
          <p className="text-slate-400 text-sm">
            Sign in with your Amazon account to sync your audiobook library.
            Your password goes directly to Amazon — we never see it.
          </p>
        </div>

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 mb-6 text-red-300 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleConnect}
          disabled={loading || !userId}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold py-4 px-6 rounded-xl text-lg transition-colors"
        >
          {loading ? "Redirecting to Amazon..." : "Sign in with Amazon"}
        </button>

        <p className="text-center text-slate-500 text-xs mt-6">
          You will be redirected to Amazon to sign in securely.
          DogEar never stores your Amazon password.
        </p>

        <div className="text-center mt-6">
          <Link href="/library" className="text-slate-500 text-sm hover:text-slate-300">
            ← Back to library
          </Link>
        </div>
      </div>
    </div>
  )
}
