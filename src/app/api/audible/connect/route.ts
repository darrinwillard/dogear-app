import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const AUDIBLE_LOCALES: Record<string, { marketPlaceId: string; countryCode: string }> = {
  us: { marketPlaceId: "AF2M0KC94RCEA", countryCode: "US" },
  uk: { marketPlaceId: "A2I9A3Q2GNFNGQ", countryCode: "GB" },
  de: { marketPlaceId: "AN7EY7DTAW63G", countryCode: "DE" },
  fr: { marketPlaceId: "A2728XDNODOQ8T", countryCode: "FR" },
  ca: { marketPlaceId: "A2CQZ5RBY40XE", countryCode: "CA" },
  au: { marketPlaceId: "AN7EY7DTAW63G", countryCode: "AU" },
};

export async function POST(req: NextRequest) {
  try {
    // Verify authenticated session
    const supabaseServer = await createServerClient();
    const { data: { user } } = await supabaseServer.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { email, password, locale = "us" } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "email and password required" }, { status: 400 });
    }

    const localeConfig = AUDIBLE_LOCALES[locale] || AUDIBLE_LOCALES.us;

    // Step 1: Amazon login via OpenID
    const loginResponse = await fetch(
      `https://www.amazon.com/ap/signin?openid.ns=http://specs.openid.net/auth/2.0&openid.claimed_id=http://specs.openid.net/auth/2.0/identifier_select&openid.identity=http://specs.openid.net/auth/2.0/identifier_select&openid.mode=checkid_setup&openid.oa2.response_type=token&openid.ns.oa2=http://www.amazon.com/ap/ext/oauth/2&openid.oa2.client_id=device:6a52316c1c67416a5866584138374e4c354c565535365367383d23413274466f414741534157564c5355304a4a464d504f454950554538&language=en_US&marketPlaceId=${localeConfig.marketPlaceId}&openid.return_to=https://www.amazon.com&openid.assoc_handle=amzn_audible_ios_us&openid.ns.pape=http://specs.openid.net/extensions/pape/1.0`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0",
        },
        body: new URLSearchParams({
          "openid.mode": "authenticate",
          "openid.ns": "http://specs.openid.net/auth/2.0",
          "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
          "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
          email,
          password,
          create: "0",
        }).toString(),
        redirect: "manual",
      }
    );

    const location = loginResponse.headers.get("location") || "";
    const tokenMatch = location.match(/openid\.oa2\.access_token=([^&]+)/);

    if (!tokenMatch) {
      return NextResponse.json(
        { error: "Amazon login failed. Please check your email and password." },
        { status: 401 }
      );
    }

    const accessToken = decodeURIComponent(tokenMatch[1]);

    // Step 2: Register device to get refresh token
    const deviceResponse = await fetch("https://api.amazon.com/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-amzn-identity-auth-domain": "api.amazon.com",
        "User-Agent": "AudibleDownloadManager",
      },
      body: JSON.stringify({
        requested_token_type: ["bearer", "mac_dms", "website_cookies"],
        cookies: { website_cookies: [], domain: ".amazon.com" },
        registration_data: {
          domain: "Device",
          app_version: "3.56.2",
          device_serial: crypto.randomUUID().replace(/-/g, "").toUpperCase(),
          device_type: "A2CZJZGLK2JJVM",
          device_name: "%FIRST_NAME%\u2019s%DUPE_STRATEGY_1ST%iPhone",
          os_version: "15.0.0",
          software_version: "35602678",
          device_model: "iPhone",
          app_name: "Audible",
        },
        auth_data: { access_token: accessToken },
        requested_extensions: ["device_info", "customer_info"],
      }),
    });

    const deviceData = await deviceResponse.json();

    if (!deviceData.response?.success?.tokens?.bearer?.refresh_token) {
      return NextResponse.json(
        {
          error: "Device registration failed",
          detail: JSON.stringify(deviceData).slice(0, 200),
        },
        { status: 401 }
      );
    }

    const refreshToken = deviceData.response.success.tokens.bearer.refresh_token;
    const adpToken = deviceData.response.success.tokens.mac_dms?.adp_token;
    const devicePrivateKey = deviceData.response.success.tokens.mac_dms?.device_private_key;

    // Step 3: Store tokens in Supabase (service role bypasses RLS)
    const supabase = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const tokenData = JSON.stringify({
      refresh_token: refreshToken,
      adp_token: adpToken,
      device_private_key: devicePrivateKey,
      locale,
    });

    const { error: upsertError } = await supabase
      .from("user_profiles")
      .upsert({
        id: user.id,
        audible_refresh_token: tokenData,
        audible_locale: locale,
      });

    if (upsertError) {
      return NextResponse.json({ error: "Failed to save tokens", detail: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Audible connected! Starting library sync..." });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
