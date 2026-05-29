import Card from "@/shared/components/ui/Card";

/** Themed placeholder for screens slated for a later build phase. */
export default function ComingSoon({ name, phase }: { name: string; phase?: string }) {
  return (
    <Card className="p-12 text-center">
      <div className="mx-auto mb-5 w-14 h-14 rounded-card bg-orange-soft text-orange flex items-center justify-center">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-navy">{name}</h2>
      <p className="text-grey mt-2 text-sm max-w-sm mx-auto leading-relaxed">
        This screen is{phase ? ` part of ${phase} and` : ""} coming up next in the build. The
        navigation, shell, and structure are ready for it.
      </p>
    </Card>
  );
}
