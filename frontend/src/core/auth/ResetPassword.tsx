import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import AuthLayout, { Field } from "./AuthLayout";

/** Reset Password screen (target of the email recovery link; UI only for now). */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [done, setDone] = useState(false);

  return (
    <AuthLayout
      title={done ? "Password updated" : "Set a new password"}
      subtitle={
        done
          ? "Your password has been changed. You can now log in."
          : "Choose a strong new password for your account."
      }
      footer={
        <Link to="/login" className="text-orange font-semibold hover:underline">
          ← Back to login
        </Link>
      }
    >
      {done ? (
        <Button className="w-full" size="lg" onClick={() => navigate("/login")}>
          Continue to login
        </Button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setDone(true);
          }}
        >
          <Field label="New password" type="password" placeholder="••••••••" autoComplete="new-password" />
          <Field label="Confirm new password" type="password" placeholder="••••••••" autoComplete="new-password" />
          <Button type="submit" className="w-full mt-2" size="lg">
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
