import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { createClient } from "@/lib/supabase/server"

function buildClientId(serial: string): string {
  const combined = Buffer.concat([
    Buffer.from(serial, "utf8"),
    Buffer.from("#A2CZJZGLK2JJVM", "utf8"),
  ])
  return combined.toString("hex")
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  // Extract auth code from Amazon redirect
  const authCode =
    searchParams.get("openid.oa2.authorization_code") || searchParams.get("code")

  const codeVerifierHex = req.cookies.get("audible_code_verifier")?.value
  const codeVerifier = codeVerifierHex
    ? Buffer.from(codeVerifierHex, "hex").toString()
    : null
  const serial = req.cookies.get("audible_serial")?.value

  if (!authCode || !codeVerifier) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/settings?error=audible_auth_failed`
    )
  }

  try {
    // Register device with Amazon to get refresh token
    const deviceResponse = await fetch("https://api.amazon.com/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-amzn-identity-auth-domain": "api.amazon.com",
      },
      body: JSON.stringify({
        requested_token_type: ["bearer", "mac_dms", "website_cookies"],
        cookies: { website_cookies: [], domain: ".amazon.com" },
        registration_data: {
          domain: "Device",
          app_version: "3.56.2",
          device_serial:
            serial || crypto.randomUUID().replace(/-/g, "").toUpperCase(),
          device_type: "A2CZJZGLK2JJVM",
          device_name: "DogEar",
          os_version: "15.0.0",
          software_version: "35602678",
          device_model: "iPhone",
          app_name: "Audible",
        },
        auth_data: {
          client_id: `device:${buildClientId(serial || crypto.randomUUID().replace(/-/g, "").toUpperCase())}`,
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
      console.error(
        "Device registration failed:",
        JSON.stringify(deviceData).slice(0, 500)
      )
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/settings?error=registration_failed`
      )
    }

    const refreshToken = tokens.bearer.refresh_token
    const adpToken = tokens.mac_dms?.adp_token
    const devicePrivateKey = tokens.mac_dms?.device_private_key

    // Get user from session
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_SITE_URL}/auth/login`
      )
    }

    // Store tokens in Supabase
    const tokenData = JSON.stringify({
      refresh_token: refreshToken,
      adp_token: adpToken,
      device_private_key: devicePrivateKey,
      locale: "us",
    })

    await supabase.from("user_profiles").upsert({
      id: user.id,
      audible_refresh_token: tokenData,
      audible_locale: "us",
    })

    // Trigger sync in background (fire and forget)
    fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/audible/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    }).catch(() => {})

    // Redirect to library
    const response = NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/library?syncing=1`
    )
    response.cookies.delete("audible_code_verifier")
    response.cookies.delete("audible_serial")
    return response
  } catch (error: unknown) {
    console.error("Audible callback error:", error)
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/settings?error=callback_error`
    )
  }
}
