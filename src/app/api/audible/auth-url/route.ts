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

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://dogear-app-darrinwillards-projects.vercel.app"

  // Use our own callback URL — Amazon accepts this for web flows
  const params = new URLSearchParams([
    ["openid.oa2.response_type", "code"],
    ["openid.oa2.code_challenge_method", "S256"],
    ["openid.oa2.code_challenge", codeChallenge],
    ["openid.return_to", `${siteUrl}/api/audible/callback`],
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

  const loginUrl = `https://www.amazon.com/ap/signin?${params.toString()}`

  // Store verifier + serial in cookies for callback
  const response = NextResponse.json({ url: loginUrl })
  response.cookies.set("audible_code_verifier", codeVerifier.toString("hex"), {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/"
  })
  response.cookies.set("audible_serial", serial, {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/"
  })
  return response
}
