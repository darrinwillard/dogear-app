"use client"
import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"

type Step = "start" | "login" | "paste" | "connecting" | "done"

export default function ConnectAudiblePage() {
  const [step, setStep] = useState<Step>("start")
  const [pastedUrl, setPastedUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loginUrl, setLoginUrl] = useState<string | null>(null)
  const [pkceData, setPkceData] = useState<{codeVerifier: string, serial: string} | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    createClient().auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
  }, [])

  async function handleStart() {
    setError(null)
    if (!userId) { setError("Not logged in."); return }

    const res = await fetch(`/api/audible/auth-url?userId=${userId}`)
    const data = await res.json()

    // Store in BOTH localStorage AND in-memory state
    // In-memory is most reliable but lost on tab close
    // localStorage is backup
    setPkceData({ codeVerifier: data.codeVerifier, serial: data.serial })
    try {
      localStorage.setItem("dogear_cv", data.codeVerifier)
      localStorage.setItem("dogear_serial", data.serial)
      localStorage.setItem("dogear_uid", userId)
    } catch {}

    setLoginUrl(data.url)
    setStep("login")
  }

  async function handlePaste() {
    setError(null)

    let authCode = ""
    try {
      const u = new URL(pastedUrl)
      authCode = u.searchParams.get("openid.oa2.authorization_code") || ""
    } catch {
      setError("Paste the full URL from the address bar — it must start with https://www.amazon.com/ap/maplanding")
      return
    }

    if (!authCode) {
      setError("The URL is missing the authorization code. Make sure you:\n1. Fully signed in to Amazon\n2. Copied the URL from the error page that appeared after sign-in")
      return
    }

    // Try in-memory first, fall back to localStorage
    let codeVerifier = pkceData?.codeVerifier
    let serial = pkceData?.serial
    let uid = userId

    if (!codeVerifier) {
      try {
        codeVerifier = localStorage.getItem("dogear_cv") || ""
        serial = localStorage.getItem("dogear_serial") || ""
        uid = localStorage.getItem("dogear_uid") || userId || ""
      } catch {}
    }

    if (!codeVerifier || !serial) {
      setError("Session data lost — this can happen if iOS cleared browser storage. Tap Start Over to try again.")
      setStep("start")
      return
    }

    setStep("connecting")

    const res = await fetch("/api/audible/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authCode, codeVerifier, serial, userId: uid })
    })
    const result = await res.json()

    if (result.error) {
      setError(result.error)
      setStep("paste")
      return
    }

    try { localStorage.removeItem("dogear_cv"); localStorage.removeItem("dogear_serial"); localStorage.removeItem("dogear_uid") } catch {}
    setStep("done")
    setTimeout(() => { window.location.href = "/library?syncing=1" }, 2000)
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 pb-24">
      <div className="w-full max-w-md">

        {step === "start" && (
          <div className="text-center">
            <img src="/logo.png" alt="DogEar" className="w-20 h-20 rounded-2xl mx-auto mb-6 shadow-lg shadow-amber-500/30" />
            <h1 className="text-2xl font-bold text-white mb-2">Connect Audible</h1>
            <p className="text-slate-400 text-sm mb-8">Sync your audiobook library. Your Amazon password never touches DogEar.</p>
            {error && <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 mb-6 text-red-300 text-sm whitespace-pre-line">{error}</div>}
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
              <p className="text-slate-300 text-sm">Tap below. Sign in with your Amazon account. After signing in, you&apos;ll see an error page — that&apos;s expected!</p>
            </div>
            <a href={loginUrl} target="_blank" rel="noopener noreferrer"
              className="block w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-4 px-6 rounded-xl text-lg transition-colors text-center mb-4">
              Open Amazon Login ↗
            </a>
            <button onClick={() => setStep("paste")} className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors">
              Done signing in → Continue
            </button>
          </div>
        )}

        {step === "paste" && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-sm">2</div>
              <h2 className="text-lg font-bold text-white">Copy the URL</h2>
            </div>
            <div className="bg-slate-800 rounded-xl p-4 mb-4 border border-slate-700">
              <p className="text-slate-300 text-sm mb-2">After signing in, Amazon shows a &quot;page not found&quot; error. Copy the full URL from the address bar — it starts with:</p>
              <code className="text-amber-400 text-xs break-all block">https://www.amazon.com/ap/maplanding?...</code>
            </div>
            {error && <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 mb-4 text-red-300 text-sm whitespace-pre-line">{error}</div>}
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
            <div className="flex gap-4 justify-center">
              <button onClick={() => setStep("login")} className="text-slate-500 text-sm hover:text-slate-300">← Back</button>
              <button onClick={() => { setStep("start"); setError(null); setPastedUrl("") }} className="text-slate-500 text-sm hover:text-slate-300">Start Over</button>
            </div>
          </div>
        )}

        {step === "connecting" && (
          <div className="text-center">
            <div className="text-5xl mb-6 animate-pulse">🔗</div>
            <h2 className="text-xl font-bold text-white mb-2">Connecting...</h2>
            <p className="text-slate-400 text-sm">Registering your device with Amazon.</p>
          </div>
        )}

        {step === "done" && (
          <div className="text-center">
            <div className="text-5xl mb-6">🎉</div>
            <h2 className="text-xl font-bold text-white mb-2">Connected!</h2>
            <p className="text-slate-400 text-sm">Your library is syncing now...</p>
          </div>
        )}

        {step === "start" && (
          <div className="text-center mt-6">
            <Link href="/library" className="text-slate-500 text-sm hover:text-slate-300">← Back to library</Link>
          </div>
        )}
      </div>
    </div>
  )
}
