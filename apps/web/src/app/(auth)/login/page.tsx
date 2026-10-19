"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    setBusy(false);

    if (!res.ok) {
      setErr(data.error ?? "Login failed");
      return;
    }

    // Redirect to dashboard (or ?next= param if present)
    const params = new URLSearchParams(window.location.search);
    router.replace(params.get("next") ?? "/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="panel panel-pad w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1">Sign in to MailPilot AI</h1>
        <p className="text-sm text-ink-muted mb-4">Enter your credentials to continue.</p>
        <form onSubmit={signIn} className="space-y-3">
          <input
            type="email"
            required
            placeholder="Email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            required
            placeholder="Password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {err && (
            <div className="text-sm text-danger bg-danger-subtle border border-danger/30 rounded-md px-3 py-2">
              {err}
            </div>
          )}
          <button className="btn-primary w-full justify-center" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
