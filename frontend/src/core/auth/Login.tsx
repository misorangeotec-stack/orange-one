import { useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import AuthLayout, { Field } from "./AuthLayout";

/** Login screen (UI only for now — submit navigates to the workspace launcher). */
export default function Login() {
  const navigate = useNavigate();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Stage B: real Supabase email/password auth. For now, go to the launcher.
    navigate("/home");
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to your Orange O Tec workspace to continue."
    >
      <form onSubmit={onSubmit}>
        <Field label="Email" type="email" placeholder="you@orangeotec.com" autoComplete="email" />
        <Field label="Password" type="password" placeholder="••••••••" autoComplete="current-password" />

        <div className="flex items-center mb-6 mt-1">
          <label className="flex items-center gap-2 text-[13px] text-grey cursor-pointer select-none">
            <input type="checkbox" className="accent-orange w-4 h-4 rounded" />
            Remember me
          </label>
        </div>

        <Button type="submit" className="w-full" size="lg">
          Log in
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </Button>
      </form>

      <p className="mt-6 text-center text-[13px] text-grey-2 leading-relaxed">
        Accounts are created by your workspace admin. Forgot your password? Contact your admin to
        have it reset.
      </p>
    </AuthLayout>
  );
}
