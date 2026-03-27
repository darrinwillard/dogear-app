"use client"
import { useState } from "react"

export default function ConnectAudiblePage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConnect() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/audible/auth-url")
      const { url } = await res.json()
      window.location.href = url
    } catch (e: unknown) {
      setError("Failed to start Audible login. Please try again.")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🎧</div>
          <h1 className="text-2xl font-bold text-white mb-2">Connect Audible</h1>
          <p className="text-slate-400">
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
          disabled={loading}
          className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold py-4 px-6 rounded-xl text-lg transition-colors flex items-center justify-center gap-2"
        >
          {loading ? "Opening Amazon..." : "Sign in with Amazon"}
        </button>

        <p className="text-center text-slate-500 text-xs mt-6">
          You will be redirected to Amazon to sign in securely.
          DogEar never stores your Amazon password.
        </p>
      </div>
    </div>
  )
}
