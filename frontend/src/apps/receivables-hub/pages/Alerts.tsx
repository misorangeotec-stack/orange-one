import { useState, useMemo } from "react";
import {
  AlertTriangle, ShieldAlert, Clock, CreditCard, TrendingUp,
  FileQuestion, Filter, Eye, ChevronRight, Bell, RefreshCw,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@hub/components/ui/badge";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hub/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@hub/components/ui/tabs";
import { useToast } from "@hub/hooks/use-toast";
import { useAppData } from "@hub/lib/useAppData";
import type { AlertItem } from "@hub/lib/types";
import { formatDateTimeDMY } from "@hub/lib/utils";

/* ── Types ─────────────────────────────────────────────── */

type Severity = "critical" | "high" | "medium" | "low";
type AlertType =
  | "critical_customer"
  | "overdue_180"
  | "credit_breach"
  | "rising_trend"
  | "unapplied_receipt";

const typeConfig: Record<AlertType, { label: string; icon: typeof AlertTriangle }> = {
  critical_customer: { label: "Critical Customers", icon: ShieldAlert },
  overdue_180: { label: "Overdue > 180 Days", icon: Clock },
  credit_breach: { label: "Credit Limit Breach", icon: CreditCard },
  rising_trend: { label: "Rising Overdue Trend", icon: TrendingUp },
  unapplied_receipt: { label: "Unapplied Receipts", icon: FileQuestion },
};

const severityStyle: Record<Severity, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  high: "bg-primary/15 text-primary border-primary/30",
  medium: "bg-warning/15 text-warning border-warning/30",
  low: "bg-muted text-muted-foreground border-border",
};

const allTypes: AlertType[] = [
  "critical_customer", "overdue_180", "credit_breach", "rising_trend", "unapplied_receipt",
];

/* ── Component ─────────────────────────────────────────── */

export default function Alerts() {
  const { toast } = useToast();
  const navigate  = useNavigate();
  const [seenIds, setSeenIds]         = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState("all");
  const [companyFilter,  setCompanyFilter]  = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [activeTab,      setActiveTab]      = useState("all");

  // Load real alerts from hook (no company/location pre-filter — we filter in UI)
  const { loading, error, dashboard, allCustomers } = useAppData();
  const rawAlerts: AlertItem[] = dashboard?.alerts ?? [];

  // Apply seen state on top of raw alerts
  const alerts = useMemo(
    () => rawAlerts.map((a) => ({ ...a, seen: seenIds.has(a.id) })),
    [rawAlerts, seenIds],
  );

  const companies = useMemo(
    () => [...new Set(allCustomers.map((c) => c.company))].sort(),
    [allCustomers],
  );
  const locations = useMemo(
    () => [...new Set(allCustomers.map((c) => c.location))].sort(),
    [allCustomers],
  );

  const filtered = alerts.filter((a) => {
    if (activeTab !== "all" && a.type !== activeTab) return false;
    if (severityFilter !== "all" && a.severity !== severityFilter) return false;
    if (companyFilter  !== "all" && a.company  !== companyFilter)  return false;
    if (locationFilter !== "all" && a.location !== locationFilter) return false;
    return true;
  });

  const unseenCount = alerts.filter((a) => !a.seen).length;

  const markSeen = (id: string) => {
    setSeenIds((prev) => new Set([...prev, id]));
    toast({ title: "Alert marked as seen" });
  };

  const markAllSeen = () => {
    setSeenIds(new Set(alerts.map((a) => a.id)));
    toast({ title: "All alerts marked as seen" });
  };

  const countByType = (type: AlertType) =>
    alerts.filter((a) => a.type === type && (severityFilter === "all" || a.severity === severityFilter)).length;

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          <RefreshCw className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading alerts…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3 max-w-md">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
          <p className="text-sm font-medium text-destructive">Data not loaded</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-content mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-button bg-destructive/15 flex items-center justify-center">
            <Bell className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Alerts & Notifications</h1>
            <p className="text-sm text-muted-foreground">
              {unseenCount > 0
                ? `${unseenCount} unseen alert${unseenCount > 1 ? "s" : ""} require attention`
                : "All alerts reviewed"}
            </p>
          </div>
        </div>
        {unseenCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={markAllSeen}
            className="rounded-button border-border"
          >
            <Eye className="h-4 w-4 mr-2" />
            Mark all as seen
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card className="rounded-card border-border bg-surface">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Filter className="h-4 w-4 text-muted-foreground mb-2.5" />
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Severity</span>
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger className="w-[150px] rounded-input border-border text-sm">
                  <SelectValue placeholder="Severity" />
                </SelectTrigger>
                <SelectContent className="rounded-input">
                  <SelectItem value="all">All Severity</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Company</span>
              <Select value={companyFilter} onValueChange={setCompanyFilter}>
                <SelectTrigger className="w-[150px] rounded-input border-border text-sm">
                  <SelectValue placeholder="Company" />
                </SelectTrigger>
                <SelectContent className="rounded-input">
                  <SelectItem value="all">All Companies</SelectItem>
                  {companies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide leading-none">Location</span>
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className="w-[150px] rounded-input border-border text-sm">
                  <SelectValue placeholder="Location" />
                </SelectTrigger>
                <SelectContent className="rounded-input">
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs by type */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-surface border border-border rounded-button flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="all" className="rounded-button text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            All ({filtered.length})
          </TabsTrigger>
          {allTypes.map((type) => {
            const cfg = typeConfig[type];
            return (
              <TabsTrigger
                key={type}
                value={type}
                className="rounded-button text-xs data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                {cfg.label} ({countByType(type)})
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* Alert list — rendered once, filtering handles content */}
        <div className="mt-4 space-y-3">
          {filtered.length === 0 ? (
            <Card className="rounded-card border-border bg-surface">
              <CardContent className="p-8 text-center text-muted-foreground">
                No alerts match your current filters.
              </CardContent>
            </Card>
          ) : (
            filtered.map((alert) => {
              const cfg = typeConfig[alert.type];
              const Icon = cfg.icon;
              return (
                <Card
                  key={alert.id}
                  className={`rounded-card border bg-surface transition-colors ${
                    !alert.seen ? "border-primary/30 bg-primary/[0.02]" : "border-border"
                  }`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      {/* Icon */}
                      <div
                        className={`w-9 h-9 rounded-button flex items-center justify-center shrink-0 ${
                          alert.severity === "critical"
                            ? "bg-destructive/15 text-destructive"
                            : alert.severity === "high"
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-semibold text-sm ${!alert.seen ? "text-foreground" : "text-muted-foreground"}`}>
                              {alert.title}
                            </span>
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 rounded-button capitalize ${severityStyle[alert.severity]}`}
                            >
                              {alert.severity}
                            </Badge>
                            {!alert.seen && (
                              <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDateTimeDMY(alert.timestamp)}
                          </span>
                        </div>

                        <p className="text-sm text-muted-foreground">{alert.description}</p>

                        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground pt-1">
                          {alert.customer && (
                            <span className="flex items-center gap-1">
                              <span className="font-medium text-foreground/70">Customer:</span> {alert.customer}
                            </span>
                          )}
                          {alert.invoiceRef && (
                            <span className="flex items-center gap-1">
                              <span className="font-medium text-foreground/70">Ref:</span> {alert.invoiceRef}
                            </span>
                          )}
                          <span>{alert.company}</span>
                          <span>{alert.location}</span>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 pt-2">
                          {!alert.seen && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => markSeen(alert.id)}
                              className="h-7 text-xs rounded-button text-muted-foreground hover:text-foreground"
                            >
                              <Eye className="h-3 w-3 mr-1" />
                              Mark seen
                            </Button>
                          )}
                          {alert.customer && alert.customerId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs rounded-button text-primary hover:text-primary"
                              onClick={() => navigate(`/outstanding-dashboard/customer/${encodeURIComponent(alert.customer ?? alert.customerId ?? "")}`)}
                            >
                              View Customer
                              <ChevronRight className="h-3 w-3 ml-1" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </Tabs>
    </div>
  );
}
