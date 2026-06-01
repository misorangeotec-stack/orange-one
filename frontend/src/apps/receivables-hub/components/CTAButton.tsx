import { Button } from "@hub/components/ui/button";
import { cn } from "@hub/lib/utils";
import { ArrowRight } from "lucide-react";

interface CTAButtonProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  showArrow?: boolean;
  size?: "default" | "lg";
}

const CTAButton = ({ children, className, onClick, showArrow = false, size = "default" }: CTAButtonProps) => (
  <Button
    onClick={onClick}
    className={cn(
      "rounded-button bg-gradient-to-r from-primary to-primary-hover text-primary-foreground font-semibold shadow-cta transition-all duration-200 ease-out hover:shadow-cta-hover hover:-translate-y-0.5 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 group",
      size === "lg" ? "px-8 py-4 h-auto text-base gap-2" : "px-6 py-3 h-auto text-[15px] gap-1.5",
      className
    )}
  >
    {children}
    {showArrow && <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />}
  </Button>
);

export { CTAButton };
