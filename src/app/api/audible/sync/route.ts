import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(_req: NextRequest) {
  try {
    // Verify authenticated session
    const supabaseServer = await createServerClient();
    const { data: { user } } = await supabaseServer.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const supabase = createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Get stored tokens
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("audible_refresh_token, audible_locale")
      .eq("id", user.id)
      .single();

    if (!profile?.audible_refresh_token) {
      return NextResponse.json({ error: "No Audible account connected" }, { status: 400 });
    }

    const tokens = JSON.parse(profile.audible_refresh_token);

    // Refresh access token
    const refreshResponse = await fetch("https://api.amazon.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        app_name: "Audible",
        app_version: "3.56.2",
        source_token: tokens.refresh_token,
        requested_token_type: "access_token",
        source_token_type: "refresh_token",
      }).toString(),
    });

    const refreshData = await refreshResponse.json();
    const accessToken = refreshData.access_token;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Token refresh failed — please reconnect Audible" },
        { status: 401 }
      );
    }

    // Fetch library
    const libraryResponse = await fetch(
      "https://api.audible.com/1.0/library?response_groups=product_desc,product_attrs,relationships,contributors&num_results=1000",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const libraryData = await libraryResponse.json();
    const items: AudibleItem[] = libraryData.items || [];

    let synced = 0;
    for (const item of items) {
      const asin = item.asin;
      if (!asin) continue;

      const narrators = (item.narrators || []).map((n: { name: string }) => n.name).filter(Boolean);
      const authors = (item.authors || []).map((a: { name: string }) => a.name).filter(Boolean);

      const { data: book } = await supabase
        .from("books")
        .upsert(
          {
            asin,
            title: item.title || "Unknown",
            authors,
            narrator: narrators.join(", ") || null,
            runtime_minutes: item.runtime_length_min || null,
            cover_url:
              item.product_images?.["500"] ||
              item.product_images?.["1024"] ||
              null,
            series_name: item.series?.[0]?.title || null,
            series_position: item.series?.[0]?.sequence
              ? parseFloat(item.series[0].sequence)
              : null,
          },
          { onConflict: "asin" }
        )
        .select("id")
        .single();

      if (book) {
        await supabase
          .from("user_books")
          .upsert(
            {
              user_id: user.id,
              book_id: book.id,
              asin,
              purchase_date: item.purchase_date
                ? new Date(item.purchase_date).toISOString().split("T")[0]
                : null,
            },
            { onConflict: "user_id,asin", ignoreDuplicates: true }
          );
        synced++;
      }
    }

    // Update last synced timestamp
    await supabase
      .from("user_profiles")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", user.id);

    return NextResponse.json({ success: true, books_synced: synced });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface AudibleItem {
  asin?: string;
  title?: string;
  narrators?: { name: string }[];
  authors?: { name: string }[];
  runtime_length_min?: number;
  product_images?: Record<string, string>;
  series?: { title?: string; sequence?: string }[];
  purchase_date?: string;
}
