import {
  User, Shield, Mail, Clock, LogOut, KeyRound, Building2,
} from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hub/components/ui/card";
import { Badge } from "@hub/components/ui/badge";
import { Separator } from "@hub/components/ui/separator";
import { useToast } from "@hub/hooks/use-toast";
import { useNavigate } from "react-router-dom";

/* ── Mock user ─────────────────────────────────────────── */

const mockUser = {
  name: "Rajesh Kumar",
  email: "rajesh.kumar@abccorp.in",
  role: "Collections Manager",
  company: "ABC Corp",
  accessType: "Full Access",
  lastLogin: "25 Mar 2026, 09:14 AM",
  sessionStart: "25 Mar 2026, 09:14 AM",
};

const infoRows: { icon: React.ElementType; label: string; value: string }[] = [
  { icon: Mail, label: "Email", value: mockUser.email },
  { icon: Shield, label: "Role", value: mockUser.role },
  { icon: Building2, label: "Company", value: mockUser.company },
  { icon: KeyRound, label: "Access Type", value: mockUser.accessType },
  { icon: Clock, label: "Last Login", value: mockUser.lastLogin },
  { icon: Clock, label: "Current Session", value: mockUser.sessionStart },
];

/* ── Component ─────────────────────────────────────────── */

export default function Profile() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleLogout = () => {
    toast({ title: "Logged out", description: "You have been signed out." });
    navigate("/access");
  };

  const handleChangePassword = () => {
    toast({ title: "Password change", description: "This feature will be available once authentication is connected." });
  };

  return (
    <div className="p-6 space-y-6 max-w-[720px] mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Profile & Session</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View your account details and manage your session.
        </p>
      </div>

      {/* Avatar + Name Card */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-6 flex items-center gap-5">
          <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
            <User className="h-8 w-8 text-primary" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-foreground">{mockUser.name}</h2>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-button bg-primary/10 text-primary border-primary/30">
                {mockUser.role}
              </Badge>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-button bg-muted text-muted-foreground border-border">
                {mockUser.accessType}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Account Details */}
      <Card className="rounded-card border-border bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Account Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0">
          {infoRows.map((row, i) => (
            <div key={row.label}>
              {i > 0 && <Separator className="my-0" />}
              <div className="flex items-center gap-3 py-3">
                <row.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm text-muted-foreground w-32 shrink-0">{row.label}</span>
                <span className="text-sm font-medium text-foreground">{row.value}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card className="rounded-card border-border bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Session Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="outline"
            onClick={handleChangePassword}
            className="rounded-button border-border"
          >
            <KeyRound className="h-4 w-4 mr-2" /> Change Password
          </Button>
          <Button
            variant="outline"
            onClick={handleLogout}
            className="rounded-button border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-4 w-4 mr-2" /> Log Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
