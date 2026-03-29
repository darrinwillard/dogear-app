"use client"
import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"

type Step = "start" | "login" | "paste" | "connecting" | "done" | "error"

export default function ConnectAudiblePage() {
  const [step, setStep] = useState<Step>("start")
  const [pastedUrl, setPastedUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loginUrl, setLoginUrl] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
  }, [])

  async function handleStart() {
    setError(null)
    if (!userId) { setError("Not logged in."); return }

    try {
      const res = await fetch(`/api/audible/auth-url?userId=${userId}`)
      const data = await res.json()
      
      // Store in sessionStorage — survives tab switches, no server expiry
      sessionStorage.setItem("audible_code_verifier", data.codeVerifier)
      sessionStorage.setItem("audible_serial", data.serial)
      sessionStorage.setItem("audible_user_id", data.userId)
      
      setLoginUrl(data.url)
      setStep("login")
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function handlePaste() {
    setError(null)

    // Extract auth code from pasted URL
    let authCode = ""
    try {
      const urlParams = new URLSearchParams(new URL(pastedUrl).search)
      authCode = urlParams.get("openid.oa2.authorization_code") || ""
    } catch {
      setError("That doesn't look like a valid URL. Copy the full address bar URL.")
      return
    }

    if (!authCode) {
      setError("URL is missing the authorization code. Make sure you copied the full URL after signing in to Amazon.")
      return
    }

    // Retrieve from sessionStorage
    const codeVerifier = sessionStorage.getItem("audible_code_verifier")
    const serial = sessionStorage.getItem("audible_serial")
    const storedUserId = sessionStorage.getItem("audible_user_id") || userId

    if (!codeVerifier || !serial) {
      setError("Session expired. Please tap 'Start Over' and try again.")
      setStep("start")
      return
    }

    setStep("connecting")

    try {
      const res = await fetch("/api/audible/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authCode, codeVerifier, serial, userId: storedUserId })
      })
      const result = await res.json()

      if (result.error) {
        setError(result.error)
        setStep("paste")
        return
      }

      // Clear session storage
      sessionStorage.removeItem("audible_code_verifier")
      sessionStorage.removeItem("audible_serial")
      sessionStorage.removeItem("audible_user_id")

      setStep("done")
      setTimeout(() => { window.location.href = "/library?syncing=1" }, 2000)
    } catch (e: any) {
      setError(e.message)
      setStep("paste")
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 pb-24">
      <div className="w-full max-w-md">

        {step === "start" && (
          <div className="text-center">
            <img src="/logo.png" alt="DogEar" className="w-20 h-20 rounded-2xl mx-auto mb-6 shadow-lg shadow-amber-500/30" />
            <h1 className="text-2xl font-bold text-white mb-2">Connect Audible</h1>
            <p className="text-slate-400 text-sm mb-8">Sync your audiobook library. Your Amazon password never touches DogEar.</p>
            {error && <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 mb-6 text-red-300 text-sm">{error}</div>}
            <button onClick={handleStart} disabled={!userId} className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold py-4 px-6 rounded-xl text-lg transition-colors">
              Get Started →
            </button>
          </div>
        )}

        {step === "login" && loginUrl && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-sm">1</div>
              <h2 className="text-lg font-bold text-white">Sign in to Amazon</h2>
            </div>
            <div className="bg-slate-800 rounded-xl p-4 mb-6 border border-slate-700">
              <p className="text-slate-300 text-sm">Tap below to open Amazon's login page. Sign in with your Amazon account — the same one you use for Audible.</p>
            </div>
            <a href={loginUrl} target="_blank" rel="noopener noreferrer"
              className="block w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-4 px-6 rounded-xl text-lg transition-colors text-center mb-4">
              Open Amazon Login ↗
            </a>
            <button onClick={() => setStep("paste")} className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors">
              I've signed in → Continue
            </button>
          </div>
        )}

        {step === "paste" && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-sm">2</div>
              <h2 className="text-lg font-bold text-white">Copy the URL</h2>
            </div>
            <div className="bg-slate-800 rounded-xl p-4 mb-6 border border-slate-700">
              <p className="text-slate-300 text-sm mb-3">After signing in, Amazon shows an error page — that's expected! Copy the full URL from your browser's address bar. It starts with:</p>
              <code className="text-amber-400 text-xs break-all">https://www.amazon.com/ap/maplanding?...</code>
            </div>
            {error && <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 mb-4 text-red-300 text-sm">{error}</div>}
            <textarea
              value={pastedUrl}
              onChange={e => setPastedUrl(e.target.value)}
              placeholder="Paste the full URL here..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl p-4 text-white text-sm placeholder-slate-500 resize-none h-28 mb-4 focus:outline-none focus:border-amber-500"
            />
            <button onClick={handlePaste} disabled={!pastedUrl.trim()}
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold py-4 px-6 rounded-xl text-lg transition-colors mb-3">
              Connect →
            </button>
            <button onClick={() => setStep("login")} className="w-full text-slate-500 text-sm hover:text-slate-300">← Back</button>
          </div>
        )}

        {step === "connecting" && (
          <div className="text-center">
            <div className="text-5xl mb-6 animate-pulse">🔗</div>
            <h2 className="text-xl font-bold text-white mb-2">Connecting...</h2>
            <p className="text-slate-400 text-sm">Registering your device and syncing your library.</p>
          </div>
        )}

        {step === "done" && (
          <div className="text-center">
            <div className="text-5xl mb-6">🎉</div>
            <h2 className="text-xl font-bold text-white mb-2">Connected!</h2>
            <p className="text-slate-400 text-sm">Your library is syncing. Redirecting...</p>
          </div>
        )}

        {(step === "start") && (
          <div className="text-center mt-6">
            <Link href="/library" className="text-slate-500 text-sm hover:text-slate-300">← Back to library</Link>
          </div>
        )}
      </div>
    </div>
  )
}
