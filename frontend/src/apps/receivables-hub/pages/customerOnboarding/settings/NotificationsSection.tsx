/**
 * The module's email switch.
 *
 * ⚠ THIS GATES EMAIL ONLY. Bell notifications are unaffected either way — they
 *   are written by the same fms_customer_announce() call, but unconditionally.
 *   Turning this off does not make the module silent; it stops the mail.
 *
 * ⚠ IT IS SEEDED OFF (20260802120000) and should stay off until the step owners
 *   are configured, or the first thing the org sees is a mail run addressed to
 *   nobody in particular.
 *
 * ⚠ ORG-WIDE MAIL DELIVERY HAS ITS OWN, SEPARATE PROBLEM. The Gmail sender has
 *   been down since 24-Jul-2026 (it fails at the OAuth token refresh and needs a
 *   fix in Google Cloud). Flipping this on enqueues into email_outbox
 *   correctly; whether anything leaves the building is not this switch's doing.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail } from "lucide-react";
import { Card, CardContent } from "@hub/components/ui/card";
import { Switch } from "@hub/components/ui/switch";
import { useToast } from "@hub/hooks/use-toast";
import { fetchEmailEnabled, setEmailEnabled } from "@hub/data/customerOnboarding/customerWrites";

const QK = ["customerOnboarding", "emailEnabled"] as const;

export default function NotificationsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: QK, queryFn: fetchEmailEnabled });

  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data !== undefined) setOn(data); }, [data]);

  const flip = async (next: boolean) => {
    setOn(next); // optimistic — the switch must not lag the thumb
    setBusy(true);
    try {
      await setEmailEnabled(next);
      await queryClient.invalidateQueries({ queryKey: QK });
      toast({ title: next ? "Email notifications on" : "Email notifications off" });
    } catch (e) {
      setOn(!next);
      toast({ variant: "destructive", title: "Could not change it", description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Mail className="h-4 w-4" /> Email notifications
            </h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              Emails the owners of the next step whenever a request moves. In-app notifications
              (the bell) are always sent and are not affected by this.
            </p>
            <p className="text-xs text-muted-foreground mt-1.5">
              Turn this on only once the step owners are configured.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(isLoading || busy) && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <Switch
              checked={on}
              disabled={isLoading || busy}
              onCheckedChange={(v) => void flip(v)}
              aria-label="Email notifications"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
