import { useState } from "react";
import {
  Download, FileText, ShieldAlert, AlertTriangle, Building2,
  MapPin, CreditCard, Filter, X, CheckCircle2,
} from "lucide-react";
import { Badge } from "@hub/components/ui/badge";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hub/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import { useToast } from "@hub/hooks/use-toast";

/* ── Types ─────────────────────────────────────────────── */

interface ReportType {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  filters: string[];
  formats: string[];
}

/* ── Report Definitions ────────────────────────────────── */

const reportTypes: ReportType[] = [
  {
    id: "risk-register",
    title: "Customer Risk Register",
    description: "Complete customer-level risk register with outstanding, overdue, utilization, and risk category for all customers.",
    icon: ShieldAlert,
    filters: ["company", "location", "risk"],
    formats: ["xlsx", "csv", "pdf"],
  },
  {
    id: "overdue-summary",
    title: "Overdue Summary",
    description: "Aging-wise overdue summary across all customers with breakdowns by 0–30, 31–60, 61–90, and 90+ day buckets.",
    icon: AlertTriangle,
    filters: ["company", "location", "risk"],
    formats: ["xlsx", "csv", "pdf"],
  },
  {
    id: "company-wise",
    title: "Company-wise Report",
    description: "Aggregated receivables report grouped by company showing total outstanding, overdue, and collection efficiency.",
    icon: Building2,
    filters: ["company"],
    formats: ["xlsx", "csv"],
  },
  {
    id: "location-wise",
    title: "Location-wise Report",
    description: "Receivables breakdown by customer location with regional outstanding and overdue comparisons.",
    icon: MapPin,
    filters: ["location"],
    formats: ["xlsx", "csv"],
  },
  {
    id: "critical-customers",
    title: "Critical Customer List",
    description: "Focused list of customers flagged as critical risk — includes key metrics and alert summaries for escalation.",
    icon: AlertTriangle,
    filters: ["company", "location"],
    formats: ["xlsx", "csv", "pdf"],
  },
  {
    id: "credit-breach",
    title: "Credit Limit Breach List",
    description: "Customers whose outstanding exceeds their approved credit limit, sorted by breach percentage.",
    icon: CreditCard,
    filters: ["company", "location"],
    formats: ["xlsx", "csv", "pdf"],
  },
];

const companyOptions = ["All Companies", "ABC Corp", "XYZ Ltd", "LMN Enterprises"];
const locationOptions = ["All Locations", "Mumbai", "Delhi", "Pune", "Hyderabad", "Chennai", "Bangalore"];
const riskOptions = ["All Risk Levels", "Critical", "High", "Medium", "Low"];

/* ── Component ─────────────────────────────────────────── */

export default function Reports() {
  const { toast } = useToast();
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [company, setCompany] = useState("All Companies");
  const [location, setLocation] = useState("All Locations");
  const [risk, setRisk] = useState("All Risk Levels");
  const [format, setFormat] = useState("xlsx");

  const activeReport = reportTypes.find((r) => r.id === selectedReport);
  const hasFilters = company !== "All Companies" || location !== "All Locations" || risk !== "All Risk Levels";

  const clearFilters = () => {
    setCompany("All Companies");
    setLocation("All Locations");
    setRisk("All Risk Levels");
  };

  const handleExport = () => {
    if (!activeReport) return;
    const filterParts: string[] = [];
    if (company !== "All Companies") filterParts.push(company);
    if (location !== "All Locations") filterParts.push(location);
    if (risk !== "All Risk Levels") filterParts.push(risk);

    toast({
      title: "Export started",
      description: `Generating ${activeReport.title} (${format.toUpperCase()})${filterParts.length ? ` — filtered by ${filterParts.join(", ")}` : ""}`,
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-[1180px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reports & Export</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate and export structured reports for meetings, reviews, and follow-ups.
          </p>
        </div>
        {hasFilters && (
          <Button variant="outline" size="sm" onClick={clearFilters} className="rounded-button border-border">
            <X className="h-4 w-4 mr-1" /> Clear Filters
          </Button>
        )}
      </div>

      {/* Active Filter Tags */}
      {hasFilters && (
        <div className="flex flex-wrap gap-2">
          {company !== "All Companies" && (
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 rounded-button text-xs">
              <Building2 className="h-3 w-3 mr-1" /> {company}
            </Badge>
          )}
          {location !== "All Locations" && (
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 rounded-button text-xs">
              <MapPin className="h-3 w-3 mr-1" /> {location}
            </Badge>
          )}
          {risk !== "All Risk Levels" && (
            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 rounded-button text-xs">
              <ShieldAlert className="h-3 w-3 mr-1" /> {risk}
            </Badge>
          )}
        </div>
      )}

      {/* Filter Bar */}
      <Card className="rounded-card border-border bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Filter className="h-4 w-4 text-primary" /> Report Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select value={company} onValueChange={setCompany}>
              <SelectTrigger className="rounded-input border-border text-sm h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-input">
                {companyOptions.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={location} onValueChange={setLocation}>
              <SelectTrigger className="rounded-input border-border text-sm h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-input">
                {locationOptions.map((l) => (
                  <SelectItem key={l} value={l}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={risk} onValueChange={setRisk}>
              <SelectTrigger className="rounded-input border-border text-sm h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-input">
                {riskOptions.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Report Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {reportTypes.map((report) => {
          const isSelected = selectedReport === report.id;
          return (
            <Card
              key={report.id}
              onClick={() => setSelectedReport(isSelected ? null : report.id)}
              className={`rounded-card border cursor-pointer transition-all hover:shadow-md ${
                isSelected
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border bg-surface hover:border-primary/40"
              }`}
            >
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div className={`w-10 h-10 rounded-button flex items-center justify-center ${
                    isSelected ? "bg-primary/15" : "bg-muted"
                  }`}>
                    <report.icon className={`h-5 w-5 ${isSelected ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                  {isSelected && <CheckCircle2 className="h-5 w-5 text-primary" />}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{report.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{report.description}</p>
                </div>
                <div className="flex gap-1">
                  {report.formats.map((f) => (
                    <Badge key={f} variant="outline" className="text-[10px] px-1.5 py-0 rounded-button uppercase bg-muted text-muted-foreground border-border">
                      {f}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Export Action */}
      {activeReport && (
        <Card className="rounded-card border-primary/30 bg-primary/5">
          <CardContent className="p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  {activeReport.title}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {hasFilters
                    ? "Filters will be applied to the exported report."
                    : "No filters applied — full data will be exported."}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Select value={format} onValueChange={setFormat}>
                  <SelectTrigger className="w-[100px] rounded-input border-border text-sm h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-input">
                    {activeReport.formats.map((f) => (
                      <SelectItem key={f} value={f}>{f.toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleExport} className="rounded-button bg-primary hover:bg-primary-hover text-primary-foreground">
                  <Download className="h-4 w-4 mr-2" /> Export Report
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
