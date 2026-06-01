import { type LucideIcon } from "lucide-react";

interface InfoCardProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  variant?: "default" | "alert";
}

const InfoCard = ({ icon: Icon, title, description, variant = "default" }: InfoCardProps) => (
  <div className="group relative rounded-card bg-surface p-6 md:p-7 transition-all duration-200 ease-out hover:shadow-card-hover hover:-translate-y-1 border border-border/50 hover:border-border">
    <div
      className={`inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-5 ${
        variant === "alert"
          ? "bg-gradient-to-br from-destructive/10 to-primary/10"
          : "bg-gradient-to-br from-navy/10 to-primary/10"
      }`}
    >
      <Icon
        className={`w-5 h-5 ${variant === "alert" ? "text-primary" : "text-navy"}`}
        strokeWidth={1.8}
      />
    </div>
    <h3 className="text-[15px] font-bold text-foreground leading-snug mb-2">{title}</h3>
    {description && (
      <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>
    )}
  </div>
);

export { InfoCard };
