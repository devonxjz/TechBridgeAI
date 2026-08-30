"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  getBrowserSupabaseClient,
  getSupabaseSession,
  installSupabaseResearchContextProvider,
} from "../lib/supabase-auth";

export function AuthControls() {
  const supabase = getBrowserSupabaseClient();
  const [email, setEmail] = useState("");
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    installSupabaseResearchContextProvider(supabase);
    if (!supabase) return;

    void getSupabaseSession(supabase).then((session) => {
      setSignedInEmail(session?.user.email ?? null);
    }).catch(() => setSignedInEmail(null));

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedInEmail(session?.user.email ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  if (!supabase) {
    return <p className="text-xs text-error">Chưa cấu hình Supabase Auth.</p>;
  }

  if (signedInEmail) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted max-w-40 truncate">{signedInEmail}</span>
        <button
          type="button"
          className="btn-secondary text-xs px-3 py-1.5"
          onClick={() => void supabase.auth.signOut()}
        >
          Đăng xuất
        </button>
      </div>
    );
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setPending(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setMessage(error ? error.message : "Đã gửi liên kết đăng nhập vào email.");
    setPending(false);
  }

  return (
    <form onSubmit={signIn} className="flex items-center gap-2">
      <label htmlFor="auth-email" className="sr-only">Email đăng nhập</label>
      <input
        id="auth-email"
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="email@company.com"
        className="w-44 rounded-lg border border-card-border bg-surface px-3 py-1.5 text-xs"
      />
      <button type="submit" disabled={pending} className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50">
        {pending ? "Đang gửi…" : "Đăng nhập"}
      </button>
      {message && <span role="status" className="sr-only">{message}</span>}
    </form>
  );
}
