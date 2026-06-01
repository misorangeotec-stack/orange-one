import { createContext, useContext, useState, useMemo, ReactNode } from "react";

export type FY = "fy2526" | "fy2627";

export const FY_LABELS: Record<FY, string> = {
  fy2526: "FY 25-26",
  fy2627: "FY 26-27",
};

export const ALL_FYS: FY[] = ["fy2526", "fy2627"];

interface FYContextValue {
  selected: FY[];                  // empty array = both (default)
  setSelected: (fys: FY[]) => void;
  /** Suffix to append to JSON filenames: "_fy2526", "_fy2627", or "" for both */
  suffix: string;
  /** Human-readable label for the active filter, e.g. "FY 25-26" or "Both FYs" */
  label: string;
}

const FYContext = createContext<FYContextValue | null>(null);

export function FYProvider({ children }: { children: ReactNode }) {
  const [selected, setSelectedRaw] = useState<FY[]>([]);

  const setSelected = (fys: FY[]) => {
    // Treat "all selected" same as "none selected" — both mean "Both FYs"
    setSelectedRaw(fys.length === ALL_FYS.length ? [] : fys);
  };

  const value = useMemo<FYContextValue>(() => {
    let suffix = "";
    let label  = "Both FYs";
    if (selected.length === 1) {
      suffix = `_${selected[0]}`;
      label  = FY_LABELS[selected[0]];
    }
    return { selected, setSelected, suffix, label };
  }, [selected]);

  return <FYContext.Provider value={value}>{children}</FYContext.Provider>;
}

export function useFY(): FYContextValue {
  const ctx = useContext(FYContext);
  if (!ctx) throw new Error("useFY must be used within FYProvider");
  return ctx;
}
