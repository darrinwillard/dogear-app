Rebuild the Audible connect flow using a popup window approach.

KEY CONSTRAINT: Amazon REQUIRES openid.return_to = "https://www.amazon.com/ap/maplanding" — we cannot change this to our callback URL.

SOLUTION: Open Amazon login in a popup. Poll the popup URL. When it hits maplanding with auth code, extract the code, close popup, call our exchange API.

## 1. Update src/app/api/audible/auth-url/route.ts

Return the login URL plus codeVerifier + serial in JSON (no cookies needed):

```typescript
import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"

function buildDeviceSerial(): string {
  return crypto.randomUUID().replace(/-/g, "").toUpperCase()
}

function buildClientId(serial: string): string {
  const combined = Buffer.concat([
    Buffer.from(serial, "utf8"),
    Buffer.from("#A2CZJZGLK2JJVM", "utf8")
  ])
  return combined.toString("hex")
}

export async function GET(req: NextRequest) {
  const serial = buildDeviceSerial()
  const codeVerifier = crypto.randomBytes(32)
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url")
  const clientId = buildClientId(serial)

  const params = new URLSearchParams([
    ["openid.oa2.response_type", "code"],
    ["openid.oa2.code_challenge_method", "S256"],
    ["openid.oa2.code_challenge", codeChallenge],
    ["openid.return_to", "https://www.amazon.com/ap/maplanding"],
    ["openid.assoc_handle", "amzn_audible_ios_us"],
    ["openid.identity", "http://specs.openid.net/auth/2.0/identifier_select"],
    ["pageId", "amzn_audible_ios"],
    ["accountStatusPolicy", "P1"],
    ["openid.claimed_id", "http://specs.openid.net/auth/2.0/identifier_select"],
    ["openid.mode", "checkid_setup"],
    ["openid.ns.oa2", "http://www.amazon.com/ap/ext/oauth/2"],
    ["openid.oa2.client_id", `device:${clientId}`],
    ["openid.ns.pape", "http://specs.openid.net/extensions/pape/1.0"],
    ["marketPlaceId", "AF2M0KC94RCEA"],
    ["openid.oa2.scope", "device_auth_access"],
    ["forceMobileLayout", "true"],
    ["openid.ns", "http://specs.openid.net/auth/2.0"],
    ["openid.pape.max_auth_age", "0"],
  ])

  return NextResponse.json({
    url: `https://www.amazon.com/ap/signin?${params.toString()}`,
    codeVerifier: codeVerifier.toString("hex"),
    serial,
  })
}
```

## 2. Update src/app/settings/connect-audible/page.tsx

Popup approach — open Amazon login in popup, poll for maplanding redirect:

```tsx
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
```

## 3. Create src/app/api/audible/exchange/route.ts

```typescript
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function buildClientId(serial: string): string {
  const combined = Buffer.concat([Buffer.from(serial, "utf8"), Buffer.from("#A2CZJZGLK2JJVM", "utf8")])
  return combined.toString("hex")
}

export async function POST(req: NextRequest) {
  try {
    const { authCode, codeVerifier, serial, userId } = await req.json()
    if (!authCode || !codeVerifier || !serial || !userId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const clientId = buildClientId(serial)

    const deviceResponse = await fetch("https://api.amazon.com/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-amzn-identity-auth-domain": "api.amazon.com" },
      body: JSON.stringify({
        requested_token_type: ["bearer", "mac_dms", "website_cookies"],
        cookies: { website_cookies: [], domain: ".amazon.com" },
        registration_data: {
          domain: "Device", app_version: "3.56.2", device_serial: serial,
          device_type: "A2CZJZGLK2JJVM", device_name: "DogEar",
          os_version: "15.0.0", software_version: "35602678", device_model: "iPhone", app_name: "Audible"
        },
        auth_data: {
          client_id: `device:${clientId}`,
          authorization_code: authCode,
          code_verifier: codeVerifier,
          code_algorithm: "SHA-256",
          client_domain: "DeviceLegacy",
        },
        requested_extensions: ["device_info", "customer_info"],
      }),
    })

    const deviceData = await deviceResponse.json()
    const tokens = deviceData?.response?.success?.tokens

    if (!tokens?.bearer?.refresh_token) {
      return NextResponse.json({ error: "Amazon authentication failed. Please try again.", detail: JSON.stringify(deviceData).slice(0, 200) }, { status: 401 })
    }

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    await supabase.from("user_profiles").upsert({
      id: userId,
      audible_refresh_token: JSON.stringify({
        refresh_token: tokens.bearer.refresh_token,
        adp_token: tokens.mac_dms?.adp_token,
        device_private_key: tokens.mac_dms?.device_private_key,
        serial, locale: "us"
      }),
      audible_locale: "us"
    })

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || ""
    fetch(`${siteUrl}/api/audible/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) }).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
```

## 4. Delete src/app/api/audible/callback/route.ts (no longer needed)

## 5. Run npm run build — must pass 0 errors.

When done: openclaw system event --text "Done: Audible popup OAuth flow built" --mode now
