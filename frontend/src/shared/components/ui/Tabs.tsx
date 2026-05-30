import { cn } from "@/shared/lib/cn";

export interface TabDef {
  key: string;
  label: string;
  count?: number;
}

/** Underline-style tab strip matching the landing's nav underline accent. */
export default function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-line overflow-x-auto">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={cn(
              "relative px-3.5 py-2.5 text-[13.5px] font-medium whitespace-nowrap transition-colors",
              on ? "text-orange" : "text-grey hover:text-navy"
            )}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span
                className={cn(
                  "ml-1.5 text-[11px] font-semibold rounded-full px-1.5 py-0.5",
                  on ? "bg-orange-soft text-orange" : "bg-page text-grey-2"
                )}
              >
                {t.count}
              </span>
            )}
            {on && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-orange rounded-full" />}
          </button>
        );
      })}
    </div>
  );
}
