import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const errorDescription = searchParams.get("error_description") ?? searchParams.get("error");

  if (errorDescription) {
    return NextResponse.redirect(
      `${origin}/login?notice=${encodeURIComponent(errorDescription)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?notice=${encodeURIComponent("Sign-in link was missing a code. Try again from the login page.")}`,
    );
  }

  const supa = await supabaseServer();
  const { error } = await supa.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("auth/callback exchangeCodeForSession failed:", error.message);
    return NextResponse.redirect(
      `${origin}/login?notice=${encodeURIComponent(`Sign-in failed: ${error.message}. If you clicked the link in a different browser than where you started, request a new link from the same browser.`)}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
