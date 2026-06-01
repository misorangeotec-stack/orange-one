import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import AuthLayout, { Field } from "./AuthLayout";
import { useAuth } from "@/core/platform/auth";

/** Login screen — real Supabase email/password auth. */
export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuth();
  const from = (location.state as { from?: string } | null)?.from ?? "/home";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await signIn(email, password);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    navigate(from, { replace: true });
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to your Orange O Tec workspace to continue."
    >
      <form onSubmit={onSubmit}>
        <Field
          label="Email"
          type="email"
          placeholder="you@orangeotec.com"
          autoComplete="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(null); }}
          required
          autoFocus
          disabled={busy}
        />
        <Field
          label="Password"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(null); }}
          required
          disabled={busy}
        />

        {error && (
          <p className="mb-4 -mt-1 text-[13px] text-[#d4493f]">{error}</p>
        )}

        <Button type="submit" className="w-full" size="lg" disabled={busy}>
          {busy ? "Signing in…" : "Log in"}
          {!busy && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-[13px] text-grey-2 leading-relaxed">
        Accounts are created by your workspace admin. Forgot your password? Contact your admin to
        have it reset.
      </p>
    </AuthLayout>
  );
}
