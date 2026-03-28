"use client"
import { useState, useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"

export default function ConnectAudiblePage() {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const popupRef = useRef<Window | null>(null)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  async function handleConnect() {
    setLoading(true)
    setError(null)
    setStatus("Opening Amazon login...")

    try {
      const res = await fetch("/api/audible/auth-url")
      const { url, codeVerifier, serial } = await res.json()

      const popup = window.open(url, "AudibleLogin", "width=500,height=700,scrollbars=yes")
      popupRef.current = popup

      if (!popup) {
        setError("Popup was blocked. Please allow popups for this site and try again.")
        setLoading(false)
        return
      }

      setStatus("Sign in to Amazon in the popup window...")

      pollRef.current = setInterval(async () => {
        try {
          if (!popupRef.current || popupRef.current.closed) {
            clearInterval(pollRef.current!)
            setLoading(false)
            setStatus(null)
            return
          }

          let popupUrl = ""
          try {
            popupUrl = popupRef.current.location.href
          } catch (e) {
            return // Cross-origin, still on Amazon — keep polling
          }

          if (popupUrl.includes("maplanding") && popupUrl.includes("authorization_code")) {
            clearInterval(pollRef.current!)
            popupRef.current.close()

            const urlParams = new URLSearchParams(new URL(popupUrl).search)
            const authCode = urlParams.get("openid.oa2.authorization_code")

            if (!authCode) {
              setError("Could not get auth code. Please try again.")
              setLoading(false)
              return
            }

            setStatus("Connected! Syncing your library...")

            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
              setError("Not logged in.")
              setLoading(false)
              return
            }

            const exchangeRes = await fetch("/api/audible/exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ authCode, codeVerifier, serial, userId: user.id })
            })

            const result = await exchangeRes.json()
            if (result.error) {
              setError(result.error)
              setLoading(false)
              return
            }

            window.location.href = "/library?syncing=1"
          }
        } catch (e) {}
      }, 500)
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (popupRef.current) popupRef.current.close()
    }
  }, [])

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🎧</div>
          <h1 className="text-2xl font-bold text-white mb-2">Connect Audible</h1>
          <p className="text-slate-400 text-sm">Sign in with your Amazon account to sync your audiobook library. Your password goes directly to Amazon — we never see it.</p>
        </div>
        {error && <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 mb-6 text-red-300 text-sm">{error}</div>}
        {status && <div className="bg-amber-900/30 border border-amber-700 rounded-xl p-4 mb-6 text-amber-300 text-sm text-center">{status}</div>}
        <button onClick={handleConnect} disabled={loading} className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold py-4 px-6 rounded-xl text-lg transition-colors">
          {loading ? "Connecting..." : "Sign in with Amazon"}
        </button>
        <p className="text-center text-slate-500 text-xs mt-6">A popup will open for Amazon login. Allow popups if prompted.</p>
      </div>
    </div>
  )
}
