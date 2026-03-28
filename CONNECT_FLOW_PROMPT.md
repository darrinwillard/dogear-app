Build a polished "paste URL" Audible connect flow for the DogEar web app.

## THE PROBLEM
Amazon's Audible OAuth requires openid.return_to = amazon.com/ap/maplanding
We cannot intercept this redirect server-side.
The user lands on maplanding which shows "Page not found" — but the auth code is in the URL.

## THE SOLUTION
Build a guided 3-step onboarding flow that makes this feel intentional and clean.

## TASK 1: Update src/app/settings/connect-audible/page.tsx

Replace the current broken flow with this guided flow:

```tsx
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
  const [authParams, setAuthParams] = useState<{codeVerifier: string, serial: string} | null>(null)

  async function handleStart() {
    setError(null)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError("Not logged in."); return }

      const res = await fetch(`/api/audible/auth-url?userId=${user.id}`)
      const { url, codeVerifier, serial } = await res.json()
      setLoginUrl(url)
      setAuthParams({ codeVerifier, serial })
      setStep("login")
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function handlePaste() {
    if (!pastedUrl.includes("authorization_code") || !pastedUrl.includes("maplanding")) {
      setError("That doesn't look right. Make sure you copied the full URL from the address bar.")
      return
    }
    setError(null)
    setStep("connecting")

    try {
      const urlParams = new URLSearchParams(new URL(pastedUrl).search)
      const authCode = urlParams.get("openid.oa2.authorization_code")
      if (!authCode) { setError("Could not find auth code in URL."); setStep("paste"); return }

      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setError("Not logged in."); setStep("paste"); return }

      const res = await fetch("/api/audible/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authCode,
          codeVerifier: authParams?.codeVerifier,
          serial: authParams?.serial,
          userId: user.id
        })
      })
      const result = await res.json()
      if (result.error) { setError(result.error); setStep("paste"); return }
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

        {/* STEP 1: Start */}
        {step === "start" && (
          <div className="text-center">
            <div className="text-6xl mb-6">🎧</div>
            <h1 className="text-2xl font-bold text-white mb-3">Connect Audible</h1>
            <p className="text-slate-400 text-sm mb-8">
              Sync your audiobook library. Your Amazon password never touches DogEar — you log in directly on Amazon.
            </p>
            {error && <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 mb-6 text-red-300 text-sm">{error}</div>}
            <button onClick={handleStart} className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-4 px-6 rounded-xl text-lg transition-colors">
              Get Started →
            </button>
          </div>
        )}

        {/* STEP 2: Login */}
        {step === "login" && loginUrl && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-sm">1</div>
              <h2 className="text-lg font-bold text-white">Sign in to Amazon</h2>
            </div>
            <p className="text-slate-400 text-sm mb-6">
              Click below to open Amazon's login page. Sign in with your Amazon account. After logging in, you'll see a "page not found" — that's normal! Come back here for step 2.
            </p>
            <a
              href={loginUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-4 px-6 rounded-xl text-lg transition-colors text-center mb-4"
            >
              Open Amazon Login ↗
            </a>
            <button
              onClick={() => setStep("paste")}
              className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
            >
              I've signed in → Continue
            </button>
          </div>
        )}

        {/* STEP 3: Paste URL */}
        {step === "paste" && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-full bg-amber-500 text-slate-950 font-bold flex items-center justify-center text-sm">2</div>
              <h2 className="text-lg font-bold text-white">Copy the URL</h2>
            </div>
            <div className="bg-slate-800 rounded-xl p-4 mb-6 border border-slate-700">
              <p className="text-slate-300 text-sm mb-3">After signing in, Amazon shows an error page. That's expected! Copy the full URL from your browser's address bar — it starts with:</p>
              <code className="text-amber-400 text-xs break-all">https://www.amazon.com/ap/maplanding?...</code>
            </div>
            {error && <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 mb-4 text-red-300 text-sm">{error}</div>}
            <textarea
              value={pastedUrl}
              onChange={e => setPastedUrl(e.target.value)}
              placeholder="Paste the full URL here..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl p-4 text-white text-sm placeholder-slate-500 resize-none h-28 mb-4 focus:outline-none focus:border-amber-500"
            />
            <button
              onClick={handlePaste}
              disabled={!pastedUrl.trim()}
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold py-4 px-6 rounded-xl text-lg transition-colors"
            >
              Connect →
            </button>
            <button onClick={() => setStep("login")} className="w-full text-slate-500 text-sm mt-3 hover:text-slate-300">← Back</button>
          </div>
        )}

        {/* Connecting */}
        {step === "connecting" && (
          <div className="text-center">
            <div className="text-5xl mb-6 animate-pulse">🔗</div>
            <h2 className="text-xl font-bold text-white mb-2">Connecting...</h2>
            <p className="text-slate-400 text-sm">Registering your device and syncing your library.</p>
          </div>
        )}

        {/* Done */}
        {step === "done" && (
          <div className="text-center">
            <div className="text-5xl mb-6">🎉</div>
            <h2 className="text-xl font-bold text-white mb-2">Connected!</h2>
            <p className="text-slate-400 text-sm">Your library is syncing. Redirecting you now...</p>
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
```

## TASK 2: Update src/app/api/audible/auth-url/route.ts
Return codeVerifier and serial in the JSON response (already done) — verify it's still returning them.

## TASK 3: Run npm run build — must pass 0 errors.

When done: openclaw system event --text "Done: DogEar paste-URL connect flow built" --mode now
