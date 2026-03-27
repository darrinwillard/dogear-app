import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"

export async function GET(req: NextRequest) {
  // Generate PKCE values
  const codeVerifier = crypto.randomBytes(32).toString("base64url")
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url")
  const serial = crypto.randomBytes(16).toString("hex").toUpperCase()

  // Amazon Audible OAuth URL
  const clientId = `device:${Buffer.from(
    `68336e6c314d5436714d624c4c504f4549505545382341327446754147415357564c5355304a4a464d`
      .match(/.{2}/g)!
      .map(h => parseInt(h, 16))
      .reduce((s, b) => s + String.fromCharCode(b), "")
  ).toString("base64")}#A2CZJZGLK2JJVM`

  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.mode": "checkid_setup",
    "openid.oa2.response_type": "code",
    "openid.oa2.code_challenge": codeChallenge,
    "openid.oa2.code_challenge_method": "S256",
    "openid.ns.oa2": "http://www.amazon.com/ap/ext/oauth/2",
    "openid.oa2.client_id": clientId,
    "openid.oa2.scope": "device_auth_access",
    "language": "en_US",
    "marketPlaceId": "AF2M0KC94RCEA",
    "openid.return_to": `${process.env.NEXT_PUBLIC_SITE_URL}/api/audible/callback`,
    "openid.assoc_handle": "amzn_audible_ios_us",
    "openid.ns.pape": "http://specs.openid.net/extensions/pape/1.0",
  })

  const amazonLoginUrl = `https://www.amazon.com/ap/signin?${params.toString()}`

  // Store verifier in cookie for callback
  const response = NextResponse.json({ url: amazonLoginUrl })
  response.cookies.set("audible_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
  })
  response.cookies.set("audible_serial", serial, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
  })

  return response
}
