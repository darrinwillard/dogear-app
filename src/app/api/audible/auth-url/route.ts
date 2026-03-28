import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { createClient } from "@supabase/supabase-js"

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
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get("userId")

  const serial = buildDeviceSerial()
  const codeVerifier = crypto.randomBytes(32)
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url")
  const clientId = buildClientId(serial)
  const state = crypto.randomUUID()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://dogear-app-darrinwillards-projects.vercel.app"

  // Store verifier + serial server-side keyed to state — survives iOS redirect
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  await supabase.from("user_profiles").upsert({
    id: userId,
    audible_refresh_token: JSON.stringify({
      pkce_state: state,
      pkce_verifier: codeVerifier.toString("hex"),
      pkce_serial: serial,
      pending: true
    })
  })

  const params = new URLSearchParams([
    ["openid.oa2.response_type", "code"],
    ["openid.oa2.code_challenge_method", "S256"],
    ["openid.oa2.code_challenge", codeChallenge],
    ["openid.return_to", `${siteUrl}/api/audible/callback?state=${state}&uid=${userId}`],
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
    url: `https://www.amazon.com/ap/signin?${params.toString()}`
  })
}
