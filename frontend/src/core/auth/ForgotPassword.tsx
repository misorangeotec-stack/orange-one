import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import AuthLayout, { Field } from "./AuthLayout";

/** Forgot Password screen (UI only — submit shows a confirmation state). */
export default function ForgotPassword() {
  const [sent, setSent] = useState(false);

  return (
    <AuthLayout
      title={sent ? "Check your inbox" : "Forgot password?"}
      subtitle={
        sent
          ? "If an account exists for that email, we've sent a reset link."
          : "Enter your account email and we'll send you a reset link."
      }
      footer={
        <Link to="/login" className="text-orange font-semibold hover:underline">
          ← Back to login
        </Link>
      }
    >
      {sent ? (
        <div className="text-center">
          <div className="mx-auto mb-5 w-14 h-14 rounded-full bg-orange-soft text-orange flex items-center justify-center">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 7l9 6 9-6" />
            </svg>
          </div>
          <p className="text-sm text-grey leading-relaxed">
            Didn't get it? Check spam, or{" "}
            <button onClick={() => setSent(false)} className="text-orange font-semibold hover:underline">
              try another email
            </button>
            .
          </p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSent(true);
          }}
        >
          <Field label="Email" type="email" placeholder="you@orangeotec.com" autoComplete="email" />
          <Button type="submit" className="w-full mt-2" size="lg">
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
