import { useEffect } from "react";
import { format, formatDistanceToNow, parseISO, differenceInCalendarDays } from "date-fns";
import { RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hub/components/ui/card";
import { Progress } from "@hub/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@hub/components/ui/table";
import { useToast } from "@hub/hooks/use-toast";
import { useAppData } from "@hub/lib/useAppData";
import { useRefreshJob } from "@hub/lib/useRefreshJob";
import type { RefreshSourceInfo } from "@hub/lib/types";

const STALE_DAYS = 3;

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatLastEntry(iso: string | null): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "dd-MM-yyyy");
  } catch {
    return iso;
  }
}

function isStale(iso: string | null): boolean {
  if (!iso) return false;
  try {
    return differenceInCalendarDays(new Date(), parseISO(iso)) > STALE_DAYS;
  } catch {
    return false;
  }
}

export default function Settings() {
  const { dashboard } = useAppData();
  const { toast } = useToast();
  const refresh = useRefreshJob();

  const meta = dashboard?.refreshMetadata;
  const isRunning = refresh.status === "starting" || refresh.status === "running";

  useEffect(() => {
    if (refresh.status === "done") {
      toast({
        title: "Data refreshed successfully",
        description: "Reloading the dashboard with the latest data…",
      });
      const t = setTimeout(() => window.location.reload(), 1000);
      return () => clearTimeout(t);
    }
    if (refresh.status === "error" && refresh.error) {
      toast({
        variant: "destructive",
        title: "Refresh failed",
        description: refresh.error,
      });
    }
  }, [refresh.status, refresh.error, toast]);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage data refresh and view source freshness
        </p>
      </div>

      {/* ── Data Refresh card ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Data Refresh
          </CardTitle>
          <CardDescription>
            Pulls the latest data from all 9 Google Sheets and rebuilds the dashboard. Takes 50–60 seconds.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={refresh.start}
            disabled={isRunning}
            size="lg"
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isRunning ? "animate-spin" : ""}`} />
            {isRunning ? "Refreshing…" : "Refresh Data"}
          </Button>

          {isRunning && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-foreground font-medium">
                  {refresh.stageLabel || "Working…"}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {formatElapsed(refresh.elapsed)}
                </span>
              </div>
              <Progress value={refresh.progress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                Refresh in progress. Don't close this tab.
              </p>
            </div>
          )}

          {refresh.status === "done" && (
            <div className="flex items-center gap-2 text-sm text-success-foreground bg-success/15 border border-success/30 rounded-md p-3">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Refresh complete. Reloading…
            </div>
          )}

          {refresh.status === "error" && refresh.error && (
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md p-3">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p>{refresh.error}</p>
                <Button variant="outline" size="sm" onClick={refresh.reset}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Last Refresh card ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Last Refresh</CardTitle>
          {meta?.refreshedAt ? (
            <CardDescription>
              {(() => {
                try {
                  const d = parseISO(meta.refreshedAt);
                  return `${formatDistanceToNow(d, { addSuffix: true })} — ${format(d, "dd-MM-yyyy HH:mm")}`;
                } catch {
                  return meta.refreshedAt;
                }
              })()}
            </CardDescription>
          ) : (
            <CardDescription>
              Refresh metadata not available. Run the data pipeline to populate this section.
            </CardDescription>
          )}
        </CardHeader>
        {meta?.sources && meta.sources.length > 0 && (
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Last Entry Date</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meta.sources.map((s: RefreshSourceInfo) => {
                  const stale = isStale(s.lastEntryDate);
                  return (
                    <TableRow key={s.name}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-2">
                          {formatLastEntry(s.lastEntryDate)}
                          {stale && (
                            <span
                              className="inline-block w-2 h-2 rounded-full bg-warning"
                              title={`More than ${STALE_DAYS} days old`}
                            />
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.rows.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
