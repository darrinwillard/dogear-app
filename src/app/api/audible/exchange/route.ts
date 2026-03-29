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
      const detail = JSON.stringify(deviceData).slice(0, 300); console.error("Device registration failed:", detail); return NextResponse.json({ error: "Amazon authentication failed: " + (deviceData?.response?.error?.message || detail) }, { status: 401 })
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
