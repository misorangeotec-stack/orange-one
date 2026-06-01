import { useState, useEffect } from "react";
import {
  Bookmark, Plus, Pencil, Trash2, Eye, X, Check,
  Filter, Building2, MapPin, ShieldAlert, BarChart3,
} from "lucide-react";
import { Badge } from "@hub/components/ui/badge";
import { Button } from "@hub/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@hub/components/ui/card";
import { Input } from "@hub/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  DialogClose,
} from "@hub/components/ui/dialog";
import { useToast } from "@hub/hooks/use-toast";
import { useNavigate } from "react-router-dom";

/* ── Types ─────────────────────────────────────────────── */

interface SavedView {
  id: string;
  name: string;
  filters: {
    company?: string;
    location?: string;
    risk?: string;
    reportType?: string;
  };
  source: string;
  createdAt: string;
  lastUsedAt: string;
}

/* ── Storage helpers ───────────────────────────────────── */

const STORAGE_KEY = "rc_saved_views";

function loadViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : defaultViews;
  } catch {
    return defaultViews;
  }
}

function persistViews(views: SavedView[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
}

/* ── Seed data (first visit) ───────────────────────────── */

const defaultViews: SavedView[] = [
  {
    id: "sv1",
    name: "Critical Customers – Mumbai",
    filters: { company: "ABC Corp", location: "Mumbai", risk: "Critical" },
    source: "Risk Register",
    createdAt: "2026-03-10",
    lastUsedAt: "2026-03-24",
  },
  {
    id: "sv2",
    name: "All Overdue – XYZ Ltd",
    filters: { company: "XYZ Ltd", risk: "High" },
    source: "Risk Register",
    createdAt: "2026-02-18",
    lastUsedAt: "2026-03-20",
  },
  {
    id: "sv3",
    name: "Delhi Region Overview",
    filters: { location: "Delhi" },
    source: "Dashboard",
    createdAt: "2026-01-25",
    lastUsedAt: "2026-03-15",
  },
  {
    id: "sv4",
    name: "Credit Breach – All Locations",
    filters: { reportType: "Credit Limit Breach List" },
    source: "Reports",
    createdAt: "2026-03-01",
    lastUsedAt: "2026-03-22",
  },
];

/* ── Filter label helpers ──────────────────────────────── */

const filterIcons: Record<string, React.ElementType> = {
  company: Building2,
  location: MapPin,
  risk: ShieldAlert,
  reportType: BarChart3,
};

const filterLabels: Record<string, string> = {
  company: "Company",
  location: "Location",
  risk: "Risk",
  reportType: "Report",
};

const companyOptions = ["ABC Corp", "XYZ Ltd", "LMN Enterprises"];
const locationOptions = ["Mumbai", "Delhi", "Pune", "Hyderabad", "Chennai", "Bangalore"];
const riskOptions = ["Critical", "High", "Medium", "Low"];
const sourceOptions = ["Dashboard", "Risk Register", "Reports"];

/* ── Component ─────────────────────────────────────────── */

export default function SavedViews() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [views, setViews] = useState<SavedView[]>(loadViews);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingView, setEditingView] = useState<SavedView | null>(null);

  // Form fields
  const [name, setName] = useState("");
  const [company, setCompany] = useState("none");
  const [location, setLocation] = useState("none");
  const [risk, setRisk] = useState("none");
  const [source, setSource] = useState("Dashboard");

  // Rename inline
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => { persistViews(views); }, [views]);

  /* ── Handlers ──────────────────────────────────────── */

  const openCreate = () => {
    setEditingView(null);
    setName("");
    setCompany("none");
    setLocation("none");
    setRisk("none");
    setSource("Dashboard");
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!name.trim()) return;
    const filters: SavedView["filters"] = {};
    if (company !== "none") filters.company = company;
    if (location !== "none") filters.location = location;
    if (risk !== "none") filters.risk = risk;

    const now = new Date().toISOString().slice(0, 10);

    if (editingView) {
      setViews((prev) =>
        prev.map((v) =>
          v.id === editingView.id
            ? { ...v, name: name.trim(), filters, source, lastUsedAt: now }
            : v
        )
      );
      toast({ title: "View updated" });
    } else {
      const newView: SavedView = {
        id: `sv-${Date.now()}`,
        name: name.trim(),
        filters,
        source,
        createdAt: now,
        lastUsedAt: now,
      };
      setViews((prev) => [newView, ...prev]);
      toast({ title: "View saved" });
    }
    setDialogOpen(false);
  };

  const handleEdit = (view: SavedView) => {
    setEditingView(view);
    setName(view.name);
    setCompany(view.filters.company || "none");
    setLocation(view.filters.location || "none");
    setRisk(view.filters.risk || "none");
    setSource(view.source);
    setDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    setViews((prev) => prev.filter((v) => v.id !== id));
    toast({ title: "View deleted" });
  };

  const handleOpen = (view: SavedView) => {
    setViews((prev) =>
      prev.map((v) =>
        v.id === view.id ? { ...v, lastUsedAt: new Date().toISOString().slice(0, 10) } : v
      )
    );
    const target =
      view.source === "Reports"
        ? "/outstanding-dashboard/reports"
        : view.source === "Risk Register"
        ? "/outstanding-dashboard/risk-register"
        : "/outstanding-dashboard";
    navigate(target);
    toast({ title: `Opened "${view.name}"`, description: `Navigated to ${view.source}` });
  };

  const startRename = (view: SavedView) => {
    setRenamingId(view.id);
    setRenameValue(view.name);
  };

  const confirmRename = () => {
    if (!renameValue.trim() || !renamingId) return;
    setViews((prev) =>
      prev.map((v) => (v.id === renamingId ? { ...v, name: renameValue.trim() } : v))
    );
    setRenamingId(null);
    toast({ title: "View renamed" });
  };

  const filterEntries = (filters: SavedView["filters"]) =>
    Object.entries(filters).filter(([, v]) => v);

  return (
    <div className="p-6 space-y-6 max-w-[1180px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Saved Views</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Quickly access your frequently used filter and report combinations.
          </p>
        </div>
        <Button onClick={openCreate} className="rounded-button bg-primary hover:bg-primary-hover text-primary-foreground">
          <Plus className="h-4 w-4 mr-2" /> New View
        </Button>
      </div>

      {/* Empty state */}
      {views.length === 0 && (
        <Card className="rounded-card border-border bg-surface">
          <CardContent className="py-16 text-center space-y-3">
            <Bookmark className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground text-sm">
              No saved views yet. Create one to quickly access your favourite filter sets.
            </p>
            <Button variant="outline" size="sm" onClick={openCreate} className="rounded-button border-border">
              <Plus className="h-4 w-4 mr-1" /> Create View
            </Button>
          </CardContent>
        </Card>
      )}

      {/* View Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {views.map((view) => (
          <Card
            key={view.id}
            className="rounded-card border-border bg-surface hover:border-primary/40 transition-all hover:shadow-md group"
          >
            <CardContent className="p-5 space-y-4">
              {/* Name / Rename */}
              <div className="flex items-start justify-between gap-2">
                {renamingId === view.id ? (
                  <div className="flex items-center gap-1 flex-1">
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && confirmRename()}
                      className="h-7 text-sm rounded-input border-border"
                      autoFocus
                    />
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={confirmRename}>
                      <Check className="h-3.5 w-3.5 text-primary" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setRenamingId(null)}>
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <h3 className="text-sm font-semibold text-foreground leading-snug">{view.name}</h3>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 rounded-button bg-muted text-muted-foreground border-border shrink-0">
                      {view.source}
                    </Badge>
                  </>
                )}
              </div>

              {/* Filter Tags */}
              <div className="flex flex-wrap gap-1.5">
                {filterEntries(view.filters).length === 0 ? (
                  <span className="text-xs text-muted-foreground">No filters</span>
                ) : (
                  filterEntries(view.filters).map(([key, val]) => {
                    const Icon = filterIcons[key] || Filter;
                    return (
                      <Badge
                        key={key}
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 rounded-button bg-primary/10 text-primary border-primary/30"
                      >
                        <Icon className="h-3 w-3 mr-0.5" />
                        {filterLabels[key]}: {val}
                      </Badge>
                    );
                  })
                )}
              </div>

              {/* Dates */}
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span>Created {view.createdAt}</span>
                <span>·</span>
                <span>Last used {view.lastUsedAt}</span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 pt-1 border-t border-border">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleOpen(view)}
                  className="rounded-button text-xs h-7 text-primary hover:text-primary"
                >
                  <Eye className="h-3.5 w-3.5 mr-1" /> Open
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startRename(view)}
                  className="rounded-button text-xs h-7 text-muted-foreground"
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Rename
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleEdit(view)}
                  className="rounded-button text-xs h-7 text-muted-foreground"
                >
                  <Filter className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(view.id)}
                  className="rounded-button text-xs h-7 text-destructive hover:text-destructive ml-auto"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-card border-border bg-surface sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">
              {editingView ? "Edit View" : "Create Saved View"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">View Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Critical Customers – Mumbai"
                className="rounded-input border-border text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Source</label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger className="rounded-input border-border text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-input">
                  {sourceOptions.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Company</label>
                <Select value={company} onValueChange={setCompany}>
                  <SelectTrigger className="rounded-input border-border text-sm h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-input">
                    <SelectItem value="none">None</SelectItem>
                    {companyOptions.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Location</label>
                <Select value={location} onValueChange={setLocation}>
                  <SelectTrigger className="rounded-input border-border text-sm h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-input">
                    <SelectItem value="none">None</SelectItem>
                    {locationOptions.map((l) => (
                      <SelectItem key={l} value={l}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Risk</label>
                <Select value={risk} onValueChange={setRisk}>
                  <SelectTrigger className="rounded-input border-border text-sm h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-input">
                    <SelectItem value="none">None</SelectItem>
                    {riskOptions.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" className="rounded-button border-border">Cancel</Button>
            </DialogClose>
            <Button
              onClick={handleSave}
              disabled={!name.trim()}
              className="rounded-button bg-primary hover:bg-primary-hover text-primary-foreground"
            >
              {editingView ? "Update View" : "Save View"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
