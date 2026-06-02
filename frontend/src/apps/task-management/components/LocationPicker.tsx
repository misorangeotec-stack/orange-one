import { FieldLabel } from "@/shared/components/ui/Form";
import { cn } from "@/shared/lib/cn";
import { useTaskStore } from "../mock/store";
import { locationLabel } from "../types";

/**
 * Optional multi-select of locations (chips), reused by the create-task and
 * recurring-task forms. Selecting locations attaches a per-location checklist to
 * the task; leaving it empty keeps the task's behaviour exactly as before.
 */
export default function LocationPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { activeLocations } = useTaskStore();

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  if (activeLocations.length === 0) {
    return (
      <FieldLabel label="Locations" hint="optional">
        <p className="text-[12.5px] text-grey-2">
          No locations defined yet. An admin can add them in Settings → Locations.
        </p>
      </FieldLabel>
    );
  }

  return (
    <FieldLabel label="Locations" hint="optional — task can't be completed until every selected location is ticked off">
      <div className="flex flex-wrap gap-2">
        {activeLocations.map((loc) => {
          const on = value.includes(loc.id);
          return (
            <button
              key={loc.id}
              type="button"
              onClick={() => toggle(loc.id)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border transition",
                on ? "bg-orange text-white border-orange shadow-cta" : "bg-white text-grey border-line hover:border-orange/40"
              )}
            >
              {locationLabel(loc)}
            </button>
          );
        })}
      </div>
    </FieldLabel>
  );
}
