import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

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
  const codeVerifierHex = req.cookies.get("audible_code_verifier")?.value
  const serial = req.cookies.get("audible_serial")?.value

  if (!authCode || !codeVerifierHex || !serial) {
    console.error("Missing params:", { authCode: !!authCode, codeVerifier: !!codeVerifierHex, serial: !!serial })
    return NextResponse.redirect(`${siteUrl}/settings?error=missing_params`)
  }

  const codeVerifier = Buffer.from(codeVerifierHex, "hex").toString()
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

    const supabaseAuth = await createClient()
    const { data: { user } } = await supabaseAuth.auth.getUser()

    if (!user) {
      return NextResponse.redirect(`${siteUrl}/auth/login`)
    }

    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    await supabase.from("user_profiles").upsert({
      id: user.id,
      audible_refresh_token: JSON.stringify({
        refresh_token: tokens.bearer.refresh_token,
        adp_token: tokens.mac_dms?.adp_token,
        device_private_key: tokens.mac_dms?.device_private_key,
        serial, locale: "us"
      }),
      audible_locale: "us"
    })

    // Fire sync in background
    fetch(`${siteUrl}/api/audible/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id })
    }).catch(() => {})

    const response = NextResponse.redirect(`${siteUrl}/library?syncing=1`)
    response.cookies.delete("audible_code_verifier")
    response.cookies.delete("audible_serial")
    return response

  } catch (error: any) {
    console.error("Callback error:", error)
    return NextResponse.redirect(`${siteUrl}/settings?error=callback_error`)
  }
}
