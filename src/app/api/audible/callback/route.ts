import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function buildClientId(serial: string): string {
  const combined = Buffer.concat([
    Buffer.from(serial, "utf8"),
    Buffer.from("#A2CZJZGLK2JJVM", "utf8")
  ])
  return combined.toString("hex")
}

export async function GET(req: NextRequest) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://dogear-app-darrinwillards-projects.vercel.app"
  const { searchParams } = new URL(req.url)

  const authCode = searchParams.get("openid.oa2.authorization_code")
  const state = searchParams.get("state")
  const userId = searchParams.get("uid")

  if (!authCode || !state || !userId) {
    return NextResponse.redirect(`${siteUrl}/settings?error=missing_params`)
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Retrieve PKCE data stored server-side
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("audible_refresh_token")
    .eq("id", userId)
    .single()

  let pkceData: any = {}
  try { pkceData = JSON.parse(profile?.audible_refresh_token || "{}") } catch {}

  if (pkceData.pkce_state !== state || !pkceData.pending) {
    return NextResponse.redirect(`${siteUrl}/settings?error=invalid_state`)
  }

  const codeVerifier = Buffer.from(pkceData.pkce_verifier, "hex").toString()
  const serial = pkceData.pkce_serial
  const clientId = buildClientId(serial)

  try {
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
      console.error("Registration failed:", JSON.stringify(deviceData).slice(0, 500))
      return NextResponse.redirect(`${siteUrl}/settings?error=registration_failed`)
    }

    // Store real tokens (overwrite the pending PKCE data)
    await supabase.from("user_profiles").upsert({
      id: userId,
      audible_refresh_token: JSON.stringify({
        refresh_token: tokens.bearer.refresh_token,
        adp_token: tokens.mac_dms?.adp_token,
        device_private_key: tokens.mac_dms?.device_private_key,
        serial, locale: "us"
      }),
      audible_locale: "us",
      last_synced_at: null
    })

    // Fire sync in background
    fetch(`${siteUrl}/api/audible/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId })
    }).catch(() => {})

    return NextResponse.redirect(`${siteUrl}/library?syncing=1`)

  } catch (error: any) {
    console.error("Callback error:", error)
    return NextResponse.redirect(`${siteUrl}/settings?error=callback_error`)
  }
}
