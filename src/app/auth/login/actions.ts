"use server"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

export async function login(
  _prevState: { error: string } | null,
  formData: FormData
) {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  })
  if (error) return { error: error.message }
  redirect("/library")
}

export async function signup(formData: FormData) {
  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
    options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || "https://dogear-1dwepsih1-darrinwillards-projects.vercel.app"}/auth/callback` }
  })
  if (error) return { error: error.message }
  return { success: "Check your email to confirm your account." }
}
