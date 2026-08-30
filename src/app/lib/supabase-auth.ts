"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { setResearchRequestContextProvider } from "./research-request-context";

let client: SupabaseClient | null = null;

export function getBrowserSupabaseClient(): SupabaseClient | null {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  client = createClient(url, key);
  return client;
}

export function installSupabaseResearchContextProvider(
  supabase = getBrowserSupabaseClient()
): void {
  if (!supabase) {
    setResearchRequestContextProvider(null);
    return;
  }

  setResearchRequestContextProvider(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session) throw new Error("Vui lòng đăng nhập trước khi nghiên cứu.");
    return { accessToken: data.session.access_token };
  });
}

export async function getSupabaseSession(
  supabase = getBrowserSupabaseClient()
): Promise<Session | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}
