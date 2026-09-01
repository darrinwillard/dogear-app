import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function buildClientId(serial: string): string {
  const combined = Buffer.concat([Buffer.from(serial, "utf8"), Buffer.from("#A2CZJZGLK2JJVM", "utf8")])
  return combined.toString("hex")
}

async function deregisterExistingDevice(userId: string) {
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("audible_refresh_token")
      .eq("id", userId)
      .single()

    if (!profile?.audible_refresh_token) return

    const stored = JSON.parse(profile.audible_refresh_token)
    if (!stored?.refresh_token) return

    // Exchange the old refresh_token for an access_token so we can deregister cleanly
    const refreshResponse = await fetch("https://api.amazon.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        app_name: "Audible", app_version: "3.56.2",
        source_token: stored.refresh_token,
        requested_token_type: "access_token",
        source_token_type: "refresh_token",
      }).toString(),
    })
    const refreshData = await refreshResponse.json()
    const accessToken = refreshData?.access_token
    if (!accessToken) return

    // Deregister the previously registered device so a new registration doesn't collide
    await fetch("https://api.amazon.com/auth/deregister", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ deregister_all_existing_accounts: false }),
    }).catch(() => {})
  } catch {
    // Best-effort only — if this fails, registration below may still succeed or will
    // surface its own clear error. Never block a reconnect attempt on cleanup failing.
  }
}

export async function POST(req: NextRequest) {
  try {
    const { authCode, codeVerifier, serial, userId } = await req.json()
    if (!authCode || !codeVerifier || !serial || !userId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // If a device is already registered for this user (e.g. a prior successful connect),
    // deregister it first. Registering a new device while one is already active is a likely
    // cause of Amazon rejecting the new registration with InvalidValue on repeat attempts.
    await deregisterExistingDevice(userId)

    const clientId = buildClientId(serial)

    const deviceResponse = await fetch("https://api.amazon.com/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-amzn-identity-auth-domain": "api.amazon.com" },
      body: JSON.stringify({
        requested_token_type: ["bearer", "mac_dms", "website_cookies", "store_authentication_cookie"],
        cookies: { website_cookies: [], domain: ".amazon.com" },
        registration_data: {
          domain: "Device", app_version: "3.56.2", device_serial: serial,
          device_type: "A2CZJZGLK2JJVM", device_name: "%FIRST_NAME%%FIRST_NAME_POSSESSIVE_STRING%%DUPE_STRATEGY_1ST%Audible for iPhone",
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
